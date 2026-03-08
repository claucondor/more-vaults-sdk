import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getAsyncRequestStatusLabel } from '../viem/index.js'
import type { AsyncRequestStatusInfo } from '../viem/index.js'

export type { AsyncRequestStatusInfo }

/**
 * Poll the status of an async cross-chain request (D4/D5/R5) by GUID.
 *
 * Automatically stops polling when status reaches 'completed' or 'refunded'.
 * Polls every 10s while the request is still pending or ready-to-execute.
 *
 * @example
 * const { data } = useAsyncRequestStatus('0xVAULT', guid, 747)
 * // data.status: 'pending' | 'ready-to-execute' | 'completed' | 'refunded'
 * // data.label: human-readable description
 * // data.result: shares minted or assets returned (0n while pending)
 */
export function useAsyncRequestStatus(
  vault: `0x${string}` | undefined,
  guid: `0x${string}` | undefined,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery<AsyncRequestStatusInfo>({
    queryKey: ['asyncRequestStatus', vault, guid, chainId],
    queryFn: () => getAsyncRequestStatusLabel(asSdkClient(publicClient), vault!, guid!),
    enabled: !!vault && !!guid && !!publicClient,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'refunded') return false
      return 10_000
    },
  })
}
