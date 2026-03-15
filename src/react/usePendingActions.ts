import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getPendingActions } from '../viem/index.js'
import type { PendingAction } from '../viem/index.js'

export type { PendingAction }

interface UsePendingActionsOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read pending curator actions for a vault by nonce.
 *
 * @example
 * const { data: pending, isLoading } = usePendingActions('0xVAULT', 747, 1n)
 */
export function usePendingActions(
  vault: `0x${string}` | undefined,
  chainId: number,
  nonce: bigint | undefined,
  options?: UsePendingActionsOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['pendingActions', vault, chainId, nonce?.toString()],
    queryFn: () => getPendingActions(asSdkClient(publicClient), vault!, nonce!),
    enabled: !!vault && !!publicClient && nonce !== undefined,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
