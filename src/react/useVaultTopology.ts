import { usePublicClient, useChainId } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { asSdkClient } from '../viem/wagmiCompat.js'
import {
  getVaultTopology,
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
 * Resolve the cross-chain topology of a vault from the current wallet chain.
 *
 * Returns the hub chain, all spoke chains, and whether the user needs to
 * switch networks to interact with the hub.
 *
 * Since MoreVaults uses CREATE3, the vault address is the same on all chains.
 *
 * @example
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
    queryKey: ['vaultTopology', vault, currentChainId, factoryAddress],
    queryFn: () => getVaultTopology(asSdkClient(publicClient), vault!, factoryAddress),
    enabled: !!vault && !!publicClient,
    staleTime: 5 * 60 * 1000, // topology rarely changes — 5 min cache
  })

  const needsNetworkSwitch = topology ? !isOnHubChain(currentChainId, topology) : false
  const allChainIds = topology ? getAllVaultChainIds(topology) : []

  return { topology, isLoading, needsNetworkSwitch, allChainIds }
}
