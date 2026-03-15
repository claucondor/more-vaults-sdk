import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getCuratorVaultStatus } from '../viem/index.js'
import type { CuratorVaultStatus } from '../viem/index.js'

export type { CuratorVaultStatus }

interface UseCuratorVaultStatusOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read the curator vault status snapshot.
 *
 * @example
 * const { data: status, isLoading } = useCuratorVaultStatus('0xVAULT', 747)
 */
export function useCuratorVaultStatus(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseCuratorVaultStatusOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['curatorVaultStatus', vault, chainId],
    queryFn: () => getCuratorVaultStatus(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
