import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultAnalysis } from '../viem/index.js'
import type { VaultAnalysis } from '../viem/index.js'

export type { VaultAnalysis }

interface UseVaultAnalysisOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read a detailed analysis of a vault.
 *
 * @example
 * const { data: analysis, isLoading } = useVaultAnalysis('0xVAULT', 747)
 */
export function useVaultAnalysis(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseVaultAnalysisOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['vaultAnalysis', vault, chainId],
    queryFn: () => getVaultAnalysis(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
