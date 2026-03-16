import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, quoteCuratorBridgeFee } from '../viem/index.js'
import type { CuratorBridgeParams } from '../viem/index.js'

export type { CuratorBridgeParams }

/**
 * Quote the native fee required to bridge assets from the hub vault via LzAdapter.
 *
 * Refreshes every 60s — bridge fees fluctuate with LayerZero network demand.
 *
 * @example
 * ```tsx
 * const { fee, isLoading } = useCuratorBridgeQuote('0xVAULT', 8453, {
 *   oftToken: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
 *   dstEid: 30101,
 *   amount: 1_000_000n,
 *   dstVault: '0xSpokeVault...',
 *   refundAddress: '0xCurator...',
 * })
 * ```
 */
export function useCuratorBridgeQuote(
  vault: `0x${string}` | undefined,
  chainId: number,
  params: CuratorBridgeParams | undefined,
) {
  const publicClient = usePublicClient({ chainId })

  const query = useQuery({
    queryKey: ['curatorBridgeQuote', vault, chainId, params],
    queryFn: () => quoteCuratorBridgeFee(asSdkClient(publicClient), vault!, params!),
    enabled: !!vault && !!publicClient && !!params,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  return {
    ...query,
    fee: query.data,
  }
}
