import { useQuery } from '@tanstack/react-query'
import { getUserPositionMultiChain } from '../viem/userHelpers.js'
import type { MultiChainUserPosition } from '../viem/userHelpers.js'

export type { MultiChainUserPosition }

/**
 * Read the user's position across all chains of an omni vault.
 *
 * Discovers topology automatically, reads hub shares + pending withdrawal,
 * then reads SHARE_OFT balances on each spoke chain in parallel.
 * Works without a connected wallet (uses public RPCs).
 *
 * @example
 * const { data: position } = useUserPositionMultiChain('0xVAULT', '0xUSER')
 * // position.hubShares      — shares on hub (Base)
 * // position.spokeShares    — { 1: 500n, 42161: 0n } per spoke
 * // position.totalShares    — hub + all spokes
 * // position.estimatedAssets — convertToAssets(totalShares)
 * // position.pendingWithdrawal — async withdrawal if any
 */
export function useUserPositionMultiChain(
  vault: `0x${string}` | undefined,
  user: `0x${string}` | undefined,
) {
  return useQuery<MultiChainUserPosition>({
    queryKey: ['userPositionMultiChain', vault, user],
    queryFn: () => getUserPositionMultiChain(vault!, user!),
    enabled: !!vault && !!user,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
