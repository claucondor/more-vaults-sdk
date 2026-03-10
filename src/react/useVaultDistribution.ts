import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useChainId, usePublicClient } from 'wagmi'
import { createPublicClient, http } from 'viem'
import type { Address, PublicClient } from 'viem'
import { asSdkClient } from '../viem/wagmiCompat.js'
import { getVaultDistribution } from '../viem/distribution.js'
import type { VaultDistribution } from '../viem/distribution.js'
import { useVaultTopology } from './useVaultTopology.js'

export type { VaultDistribution }

/**
 * Public RPCs for spoke chain reads.
 * These are free, rate-limited endpoints — suitable for occasional reads
 * but not for high-frequency polling.
 */
const SPOKE_RPCS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  42161: 'https://arbitrum.public.blockpi.network/v1/rpc/public',
}

interface UseVaultDistributionReturn {
  distribution: VaultDistribution | undefined
  isLoading: boolean
}

/**
 * Read the full cross-chain capital distribution of a vault.
 *
 * Uses the connected wallet's chain as the hub client (via wagmi),
 * discovers spoke chains via topology, and creates ephemeral public
 * clients with hardcoded public RPCs for spoke reads.
 *
 * Spoke reads that fail (bad RPC, timeout) degrade gracefully —
 * those spokes will appear with `isReachable: false`.
 *
 * @example
 * ```tsx
 * const { distribution, isLoading } = useVaultDistribution('0xVAULT')
 * if (distribution) {
 *   console.log(`Hub liquid: ${distribution.hubLiquidBalance}`)
 *   console.log(`Total actual: ${distribution.totalActual}`)
 * }
 * ```
 */
export function useVaultDistribution(
  vault: Address | undefined,
): UseVaultDistributionReturn {
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { topology } = useVaultTopology(vault)

  // Build spoke clients from hardcoded public RPCs.
  // Only create clients for chains we have an RPC URL for.
  const spokeClients = useMemo((): Record<number, PublicClient> => {
    if (!topology) return {}
    const clients: Record<number, PublicClient> = {}
    for (const spokeChainId of topology.spokeChainIds) {
      const rpcUrl = SPOKE_RPCS[spokeChainId]
      if (rpcUrl) {
        clients[spokeChainId] = createPublicClient({
          transport: http(rpcUrl),
        }) as PublicClient
      }
    }
    return clients
  }, [topology])

  const { data: distribution, isLoading } = useQuery<VaultDistribution>({
    queryKey: ['vaultDistribution', vault, chainId],
    queryFn: () =>
      getVaultDistribution(
        asSdkClient(publicClient),
        vault!,
        spokeClients,
      ),
    enabled: !!vault && !!publicClient,
    staleTime: 30_000,
  })

  return { distribution, isLoading }
}
