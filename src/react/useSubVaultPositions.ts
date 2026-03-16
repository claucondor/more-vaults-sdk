import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getSubVaultPositions } from '../viem/index.js'
import type { SubVaultPosition } from '../viem/index.js'

export type { SubVaultPosition }

interface UseSubVaultPositionsOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Read active sub-vault positions held by a curator vault.
 *
 * Returns ERC4626 and ERC7540 positions with share balances and underlying values.
 * Positions with zero share balance are excluded.
 *
 * @example
 * const { data: positions, isLoading } = useSubVaultPositions('0xVAULT', 8453)
 */
export function useSubVaultPositions(
  vault: `0x${string}` | undefined,
  chainId: number,
  options?: UseSubVaultPositionsOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['subVaultPositions', vault, chainId],
    queryFn: () => getSubVaultPositions(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
