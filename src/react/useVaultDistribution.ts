import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useChainId, usePublicClient } from 'wagmi'
import type { Address, PublicClient } from 'viem'
import { asSdkClient } from '../viem/wagmiCompat.js'
import { getVaultDistribution } from '../viem/distribution.js'
import type { VaultDistribution } from '../viem/distribution.js'
import { createChainClient } from '../viem/spokeRoutes.js'
import { useVaultTopology } from './useVaultTopology.js'

export type { VaultDistribution }

interface UseVaultDistributionReturn {
  distribution: VaultDistribution | undefined
  isLoading: boolean
}

/**
 * Read the full cross-chain capital distribution of a vault.
 *
 * Uses the connected wallet's chain as the hub client (via wagmi),
 * discovers spoke chains via topology, and creates ephemeral public
 * clients with fallback RPCs for spoke reads (all supported chains covered).
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

  // Build spoke clients using the shared fallback-RPC factory from spokeRoutes.
  // Covers all supported chains (Eth, Arb, Op, BSC, Sonic, Flow) with multiple
  // fallback endpoints each — spokes without a known RPC degrade to isReachable: false.
  const spokeClients = useMemo((): Record<number, PublicClient> => {
    if (!topology) return {}
    const clients: Record<number, PublicClient> = {}
    for (const spokeChainId of topology.spokeChainIds) {
      const client = createChainClient(spokeChainId)
      if (client) clients[spokeChainId] = client as PublicClient
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
