import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultAssetBreakdown } from '../viem/index.js'
import type { VaultAssetBreakdown } from '../viem/index.js'

export type { VaultAssetBreakdown }

interface UseVaultAssetBreakdownOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read the asset breakdown of a vault.
 *
 * @example
 * const { data: breakdown, isLoading } = useVaultAssetBreakdown('0xVAULT', 747)
 */
export function useVaultAssetBreakdown(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseVaultAssetBreakdownOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['vaultAssetBreakdown', vault, chainId],
    queryFn: () => getVaultAssetBreakdown(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
