import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getUserPosition } from '../viem/index.js'
import type { UserPosition } from '../viem/index.js'

export type { UserPosition }

/**
 * Read the user's current position in a vault.
 * Refetches every 15s to keep the balance display current.
 *
 * @example
 * const { data: position } = useUserPosition('0xVAULT', '0xUSER', 747)
 * // position.shares, position.estimatedAssets, position.pendingWithdrawal
 */
export function useUserPosition(
  vault: `0x${string}` | undefined,
  user: `0x${string}` | undefined,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['userPosition', vault, user, chainId],
    queryFn: () => getUserPosition(asSdkClient(publicClient), vault!, user!),
    enabled: !!vault && !!user && !!publicClient,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
}
