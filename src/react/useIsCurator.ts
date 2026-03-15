import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, isCurator } from '../viem/index.js'

interface UseIsCuratorOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Check whether an address is a curator of a vault.
 *
 * @example
 * const { data: curator, isLoading } = useIsCurator('0xVAULT', 747, '0xADDR')
 */
export function useIsCurator(
  vault: `0x${string}` | undefined,
  chainId: number,
  address: `0x${string}` | undefined,
  options?: UseIsCuratorOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['isCurator', vault, chainId, address],
    queryFn: () => isCurator(asSdkClient(publicClient), vault!, address!),
    enabled: !!vault && !!publicClient && !!address,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
