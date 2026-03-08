import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { asSdkClient, redeemShares } from '../viem/index.js'
import type { RedeemResult } from '../viem/index.js'

interface UseRedeemSharesReturn {
  /** Execute redeemShares (R1 flow). */
  redeem: (sharesInWei: bigint, receiver: `0x${string}`, owner: `0x${string}`) => Promise<void>
  isLoading: boolean
  txHash: `0x${string}` | undefined
  /** Assets received. Available after tx confirmation. */
  assets: bigint | undefined
  error: Error | undefined
  reset: () => void
}

/**
 * Hook for standard ERC-4626 share redemption (R1 flow).
 *
 * Used for local and oracle-on cross-chain vaults.
 * No LZ fee required — single transaction.
 *
 * @example
 * const { redeem, isLoading, txHash, assets } = useRedeemShares('0xVAULT', 747)
 * await redeem(sharesInWei, userAddress, userAddress)
 */
export function useRedeemShares(
  vault: `0x${string}` | undefined,
  chainId: number,
): UseRedeemSharesReturn {
  const { data: walletClient } = useWalletClient({ chainId })
  const publicClient = usePublicClient({ chainId })

  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<RedeemResult | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const redeem = useCallback(
    async (sharesInWei: bigint, receiver: `0x${string}`, owner: `0x${string}`) => {
      if (!vault || !walletClient || !publicClient) return
      setIsLoading(true)
      setError(undefined)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await redeemShares(
          walletClient as any,
          asSdkClient(publicClient),
          { vault, hubChainId: chainId },
          sharesInWei,
          receiver,
          owner,
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
    redeem,
    isLoading,
    txHash: result?.txHash,
    assets: result?.assets,
    error,
    reset,
  }
}
