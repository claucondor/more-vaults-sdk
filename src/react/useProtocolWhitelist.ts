import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, checkProtocolWhitelist } from '../viem/index.js'

interface UseProtocolWhitelistOptions {
  /** Refetch interval in ms. Default: 30_000 (30s) */
  refetchInterval?: number
}

/**
 * Check which protocols are whitelisted for a vault.
 *
 * @example
 * const { data: whitelist, isLoading } = useProtocolWhitelist('0xVAULT', 747, ['0xPROTOCOL'])
 */
export function useProtocolWhitelist(
  vault: `0x${string}` | undefined,
  chainId: number,
  protocols: `0x${string}`[],
  options?: UseProtocolWhitelistOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['protocolWhitelist', vault, chainId, protocols],
    queryFn: () => checkProtocolWhitelist(asSdkClient(publicClient), vault!, protocols),
    enabled: !!vault && !!publicClient,
    refetchInterval: options?.refetchInterval ?? 30_000,
    staleTime: 15_000,
  })
}
