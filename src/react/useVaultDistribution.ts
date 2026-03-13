import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { getVaultDistribution } from '../viem/distribution.js'
import type { VaultDistribution } from '../viem/distribution.js'
import { createChainClient } from '../viem/spokeRoutes.js'
import { discoverVaultTopology } from '../viem/topology.js'
import type { VaultTopology } from '../viem/topology.js'

export type { VaultDistribution }

interface UseVaultDistributionReturn {
  distribution: VaultDistribution | undefined
  isLoading: boolean
}

/**
 * Read the full cross-chain capital distribution of a vault.
 *
 * Discovers the vault topology automatically via `discoverVaultTopology`
 * (works without a connected wallet), then creates hub and spoke clients
 * via public RPCs.
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
  // Step 1: discover topology (wallet-independent)
  const { data: topology } = useQuery<VaultTopology>({
    queryKey: ['vaultTopology', vault],
    queryFn: () => discoverVaultTopology(vault!),
    enabled: !!vault,
    staleTime: 5 * 60 * 1000,
  })

  // Build spoke clients from topology
  const spokeClients = useMemo((): Record<number, PublicClient> => {
    if (!topology) return {}
    const clients: Record<number, PublicClient> = {}
    for (const spokeChainId of topology.spokeChainIds) {
      const client = createChainClient(spokeChainId)
      if (client) clients[spokeChainId] = client as PublicClient
    }
    return clients
  }, [topology])

  // Step 2: fetch distribution using hub-chain client (not wallet client)
  const { data: distribution, isLoading } = useQuery<VaultDistribution>({
    queryKey: ['vaultDistribution', vault, topology?.hubChainId],
    queryFn: () => {
      const hubClient = createChainClient(topology!.hubChainId)
      if (!hubClient) throw new Error(`No public RPC for hub chainId ${topology!.hubChainId}`)
      return getVaultDistribution(hubClient as PublicClient, vault!, spokeClients)
    },
    enabled: !!vault && !!topology && topology.role !== 'local',
    staleTime: 30_000,
  })

  return { distribution, isLoading }
}
