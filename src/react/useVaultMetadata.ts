import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getVaultMetadata } from '../viem/index.js'
import type { VaultMetadata } from '../viem/index.js'

export type { VaultMetadata }

/**
 * Read display metadata for a vault and its underlying token.
 * Uses a long stale time (5 min) because metadata rarely changes.
 *
 * @example
 * const { data: meta } = useVaultMetadata('0xVAULT', 747)
 * // meta.name, meta.symbol, meta.underlying, meta.underlyingSymbol
 */
export function useVaultMetadata(
  vault: `0x${string}` | undefined,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['vaultMetadata', vault, chainId],
    queryFn: () => getVaultMetadata(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    // Metadata (name, symbol, underlying) changes very rarely — 5 min stale time
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}
