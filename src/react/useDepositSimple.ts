import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { asSdkClient, depositSimple } from '../viem/index.js'
import type { DepositResult } from '../viem/index.js'

interface UseDepositSimpleReturn {
  /** Execute approve + depositSimple (D1/D3 flows). */
  deposit: (amountInWei: bigint, receiver: `0x${string}`) => Promise<void>
  isLoading: boolean
  txHash: `0x${string}` | undefined
  /** Shares minted. Available after tx confirmation. */
  shares: bigint | undefined
  error: Error | undefined
  reset: () => void
}

/**
 * Hook for local and oracle-on cross-chain vaults (D1/D3 flows).
 *
 * Simpler than useOmniDeposit — no LZ fee, no GUID, no polling.
 * One approve + one deposit transaction.
 *
 * @example
 * const { deposit, isLoading, txHash, shares } = useDepositSimple('0xVAULT', 747)
 * await deposit(parseUnits('100', 6), userAddress)
 */
export function useDepositSimple(
  vault: `0x${string}` | undefined,
  chainId: number,
): UseDepositSimpleReturn {
  const { data: walletClient } = useWalletClient({ chainId })
  const publicClient = usePublicClient({ chainId })

  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<DepositResult | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const deposit = useCallback(
    async (amountInWei: bigint, receiver: `0x${string}`) => {
      if (!vault || !walletClient || !publicClient) return
      setIsLoading(true)
      setError(undefined)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await depositSimple(
          walletClient as any,
          asSdkClient(publicClient),
          { vault, hubChainId: chainId },
          amountInWei,
          receiver,
        )
        setResult(res)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setIsLoading(false)
      }
    },
    [vault, walletClient, publicClient, chainId],
  )

  const reset = useCallback(() => {
    setResult(undefined)
    setError(undefined)
    setIsLoading(false)
  }, [])

  return {
    deposit,
    isLoading,
    txHash: result?.txHash,
    shares: result?.shares,
    error,
    reset,
  }
}
