import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient, useChainId } from 'wagmi'
import {
  asSdkClient,
  depositAsync,
  getVaultStatus,
} from '../viem/index.js'
import type { AsyncRequestStatusInfo } from '../viem/index.js'
import { useLzFee } from './useLzFee.js'
import { useAsyncRequestStatus } from './useAsyncRequestStatus.js'

interface UseOmniDepositReturn {
  /** Execute approve + depositAsync. Handles everything internally. */
  deposit: (amountInWei: bigint, receiver: `0x${string}`) => Promise<void>
  isLoading: boolean
  txHash: `0x${string}` | undefined
  /** GUID for cross-chain tracking. Available after tx confirmation. */
  guid: `0x${string}` | undefined
  /** Cross-chain request status. undefined until a guid is available. */
  requestStatus: AsyncRequestStatusInfo | undefined
  /** true when the wallet is connected to the wrong chain */
  wrongChain: boolean
  error: Error | undefined
  reset: () => void
}

/**
 * Complete hook for async deposits on hub vaults (D4 flow).
 *
 * Handles: fee quote, chain validation, approve, depositAsync, and GUID polling.
 * The deposit function wraps the entire flow — callers only pass amount + receiver.
 *
 * @example
 * const { deposit, isLoading, guid, requestStatus, wrongChain } = useOmniDeposit('0xVAULT', 747)
 *
 * if (wrongChain) return <SwitchNetworkButton chainId={747} />
 *
 * await deposit(parseUnits('100', 6), userAddress)
 * // requestStatus.status goes: 'pending' → 'completed' | 'refunded'
 */
export function useOmniDeposit(
  vault: `0x${string}` | undefined,
  hubChainId: number,
): UseOmniDepositReturn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: walletClient } = useWalletClient({ chainId: hubChainId })
  const publicClient = usePublicClient({ chainId: hubChainId })
  const currentChainId = useChainId()

  const [isLoading, setIsLoading] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [guid, setGuid] = useState<`0x${string}` | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const { feeWithBuffer } = useLzFee(vault, hubChainId)
  const { data: requestStatus } = useAsyncRequestStatus(vault, guid, hubChainId)

  const wrongChain = currentChainId !== hubChainId

  const deposit = useCallback(
    async (amountInWei: bigint, receiver: `0x${string}`) => {
      if (!vault || !walletClient || !publicClient || !feeWithBuffer) return
      setIsLoading(true)
      setError(undefined)
      try {
        const pc = asSdkClient(publicClient)
        const status = await getVaultStatus(pc, vault)
        // walletClient from wagmi is structurally compatible with viem WalletClient
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await depositAsync(
          walletClient as any,
          pc,
          { vault, escrow: status.escrow, hubChainId },
          amountInWei,
          receiver,
          feeWithBuffer,
        )
        setTxHash(result.txHash)
        setGuid(result.guid)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setIsLoading(false)
      }
    },
    [vault, walletClient, publicClient, feeWithBuffer, hubChainId],
  )

  const reset = useCallback(() => {
    setTxHash(undefined)
    setGuid(undefined)
    setError(undefined)
    setIsLoading(false)
  }, [])

  return { deposit, isLoading, txHash, guid, requestStatus, wrongChain, error, reset }
}
