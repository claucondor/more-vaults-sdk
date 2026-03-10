import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { getInboundRoutes, getUserBalancesForRoutes } from '../viem/spokeRoutes.js'
import type { InboundRouteWithBalance } from '../viem/spokeRoutes.js'

interface UseInboundRoutesReturn {
  routes: InboundRouteWithBalance[]
  isLoading: boolean
  error: Error | null
}

/**
 * Return the decimals typically used by a route's token symbol.
 *
 * Useful for formatting `userBalance` (a bigint in the token's smallest unit)
 * into a human-readable string.
 *
 * @example
 * ```ts
 * import { formatUnits } from 'viem'
 * const decimals = getRouteTokenDecimals(route.symbol)
 * const formatted = formatUnits(route.userBalance, decimals)
 * ```
 */
export function getRouteTokenDecimals(symbol: string): number {
  switch (symbol) {
    case 'stgUSDC':
    case 'USDT':
    case 'USDC':
      return 6
    default:
      return 18
  }
}

/**
 * Discover all valid inbound deposit routes for a vault and fetch the
 * connected user's token balance on each route's spoke chain.
 *
 * The hook is disabled until all four parameters are defined, so it is
 * safe to pass `undefined` during initial render.
 *
 * @example
 * ```tsx
 * const { routes, isLoading, error } = useInboundRoutes(
 *   8453,            // hubChainId (Base)
 *   '0xVAULT',       // vault address
 *   '0xASSET',       // vault asset on hub
 *   '0xUSER',        // connected wallet
 * )
 *
 * for (const r of routes) {
 *   const decimals = getRouteTokenDecimals(r.symbol)
 *   console.log(`${r.symbol} on chain ${r.spokeChainId}: ${formatUnits(r.userBalance, decimals)}`)
 * }
 * ```
 */
export function useInboundRoutes(
  hubChainId: number | undefined,
  vault: Address | undefined,
  vaultAsset: Address | undefined,
  userAddress: Address | undefined,
): UseInboundRoutesReturn {
  const enabled = hubChainId != null && !!vault && !!vaultAsset && !!userAddress

  const { data, isLoading, error } = useQuery<InboundRouteWithBalance[], Error>({
    queryKey: ['inboundRoutes', hubChainId, vault, vaultAsset, userAddress],
    queryFn: async () => {
      const routes = await getInboundRoutes(hubChainId!, vault!, vaultAsset!, userAddress!)
      return getUserBalancesForRoutes(routes, userAddress!)
    },
    enabled,
    staleTime: 60_000, // routes change infrequently — 1 min cache
  })

  return {
    routes: data ?? [],
    isLoading,
    error: error ?? null,
  }
}
