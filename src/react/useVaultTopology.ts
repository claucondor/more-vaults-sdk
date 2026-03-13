import { usePublicClient, useChainId } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { asSdkClient } from '../viem/wagmiCompat.js'
import {
  discoverVaultTopology,
  isOnHubChain,
  getAllVaultChainIds,
  OMNI_FACTORY_ADDRESS,
} from '../viem/topology.js'
import type { VaultTopology } from '../viem/topology.js'
import type { Address } from 'viem'

export type { VaultTopology }

interface UseVaultTopologyReturn {
  topology: VaultTopology | undefined
  isLoading: boolean
  /**
   * true when the connected wallet is on the wrong chain to deposit.
   * Show a "Switch to {hubChainId}" prompt when this is true.
   */
  needsNetworkSwitch: boolean
  /**
   * All chain IDs where this vault exists (hub + spokes).
   * Use to build a multi-chain network selector.
   */
  allChainIds: number[]
}

/**
 * Resolve the cross-chain topology of a vault with automatic multi-chain discovery.
 *
 * Uses `discoverVaultTopology` internally: if the wallet's current chain doesn't
 * know the vault, it iterates all supported chains via public RPCs until the hub
 * is found. Works even without a connected wallet.
 *
 * @example
 * // Works regardless of which chain the wallet is on (or if disconnected)
 * const { topology, needsNetworkSwitch, allChainIds } = useVaultTopology('0xVAULT')
 *
 * if (needsNetworkSwitch) {
 *   return <SwitchNetworkButton chainId={topology.hubChainId} />
 * }
 */
export function useVaultTopology(
  vault: Address | undefined,
  factoryAddress: Address = OMNI_FACTORY_ADDRESS,
): UseVaultTopologyReturn {
  const currentChainId = useChainId()
  const publicClient = usePublicClient()

  const { data: topology, isLoading } = useQuery<VaultTopology>({
    // Key does NOT include currentChainId — topology is chain-independent
    queryKey: ['vaultTopology', vault, factoryAddress],
    queryFn: () => discoverVaultTopology(
      vault!,
      publicClient ? asSdkClient(publicClient) : null,
      factoryAddress,
    ),
    enabled: !!vault,
    staleTime: 5 * 60 * 1000, // topology rarely changes — 5 min cache
  })

  const needsNetworkSwitch = topology ? !isOnHubChain(currentChainId, topology) : false
  const allChainIds = topology ? getAllVaultChainIds(topology) : []

  return { topology, isLoading, needsNetworkSwitch, allChainIds }
}
