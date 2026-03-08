import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, quoteLzFee } from '../viem/index.js'

/**
 * Quote the LayerZero fee required for async operations (D4, D5, R5).
 * Refreshes every 60s — fees change with network congestion.
 *
 * @example
 * const { fee, feeWithBuffer } = useLzFee('0xVAULT', 747)
 * // feeWithBuffer adds 1% buffer automatically (fee * 101 / 100)
 */
export function useLzFee(vault: `0x${string}` | undefined, chainId: number) {
  const publicClient = usePublicClient({ chainId })
  const query = useQuery({
    queryKey: ['lzFee', vault, chainId],
    queryFn: () => quoteLzFee(asSdkClient(publicClient), vault!),
    enabled: !!vault && !!publicClient,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  return {
    ...query,
    fee: query.data,
    feeWithBuffer: query.data ? (query.data * 101n) / 100n : undefined,
  }
}
