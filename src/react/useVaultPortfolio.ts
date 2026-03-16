import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultPortfolio } from '../viem/index.js'
import type { VaultPortfolio } from '../viem/index.js'

export type { VaultPortfolio }

interface UseVaultPortfolioOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read the full portfolio view for a curator vault.
 *
 * Combines liquid asset balances with ERC4626/ERC7540 sub-vault positions
 * and locked ERC7540 pending assets into a single portfolio snapshot.
 *
 * @example
 * const { data: portfolio, isLoading } = useVaultPortfolio('0xVAULT', 8453)
 */
export function useVaultPortfolio(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseVaultPortfolioOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['vaultPortfolio', vault, chainId],
    queryFn: () => getVaultPortfolio(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
