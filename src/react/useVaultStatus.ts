import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultStatus } from '../viem/index.js'
import type { VaultStatus } from '../viem/index.js'

export type { VaultStatus }

interface UseVaultStatusOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read the full vault status snapshot.
 * Automatically refetches on a configurable interval.
 *
 * @example
 * const { data: status, isLoading } = useVaultStatus('0xVAULT', 747)
 * if (status?.mode === 'cross-chain-async') { ... }
 */
export function useVaultStatus(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseVaultStatusOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['vaultStatus', vault, chainId],
    queryFn: () => getVaultStatus(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
