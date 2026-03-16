import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultPortfolioMultiChain } from '../viem/index.js'
import type { MultiChainPortfolio } from '../viem/index.js'

export type { MultiChainPortfolio }

interface UseVaultPortfolioMultiChainOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
  /**
   * Hub chain ID override. When provided the hook will skip topology discovery
   * for selecting the hub client. Useful if you already know the hub chain.
   */
  hubChainId?: number
}

/**
 * Read the full portfolio of a vault across its hub chain and all spoke chains.
 *
 * Discovers topology automatically via `discoverVaultTopology`, then fetches
 * `getVaultPortfolio()` on each chain in parallel. Returns aggregated totals
 * alongside per-chain breakdowns.
 *
 * Because MoreVaults uses CREATE3, the vault address is the same on all chains.
 * Spoke chains without a known public RPC are silently skipped.
 *
 * @example
 * const { data: portfolio, isLoading } = useVaultPortfolioMultiChain('0xVAULT', 8453)
 * // portfolio.chains[0].role === 'hub'
 * // portfolio.totalDeployedValue — sum of sub-vault positions
 * // portfolio.allSubVaultPositions — all positions with chainId
 */
export function useVaultPortfolioMultiChain(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseVaultPortfolioMultiChainOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery<MultiChainPortfolio>({
    queryKey: ['vaultPortfolioMultiChain', vault, chainId, options?.hubChainId],
    queryFn: () =>
      getVaultPortfolioMultiChain(
        asSdkClient(publicClient),
        vault!,
        options?.hubChainId,
      ),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
