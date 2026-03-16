import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultConfiguration } from '../viem/index.js'
import type { VaultConfiguration } from '../viem/index.js'

export type { VaultConfiguration }

interface UseVaultConfigurationOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read the full vault configuration snapshot (Phase 7).
 *
 * Returns roles, fees, capacity, timelock, withdrawal settings, whitelist,
 * asset lists, cross-chain config, and state in a single multicall.
 *
 * @example
 * const { data: config, isLoading } = useVaultConfiguration('0xVAULT', 747)
 */
export function useVaultConfiguration(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseVaultConfigurationOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['vaultConfiguration', vault, chainId],
    queryFn: () => getVaultConfiguration(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
