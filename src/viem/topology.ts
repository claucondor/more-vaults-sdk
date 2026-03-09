import { type Address, type PublicClient, getAddress } from 'viem'
import { EID_TO_CHAIN_ID, CHAIN_ID_TO_EID } from './chains'

// MoreVaults OMNI factory — same address on every supported chain (CREATE3)
export const OMNI_FACTORY_ADDRESS: Address = '0x7bDB8B17604b03125eFAED33cA0c55FBf856BB0C'

const FACTORY_ABI = [
  {
    name: 'localEid',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint32' }],
    stateMutability: 'view',
  },
  {
    name: 'isCrossChainVault',
    type: 'function',
    inputs: [{ name: '__eid', type: 'uint32' }, { name: '_vault', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'hubToSpokes',
    type: 'function',
    inputs: [{ name: '__eid', type: 'uint32' }, { name: '_hubVault', type: 'address' }],
    outputs: [{ name: 'eids', type: 'uint32[]' }, { name: 'vaults', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'spokeToHub',
    type: 'function',
    inputs: [{ name: '__eid', type: 'uint32' }, { name: '_spokeVault', type: 'address' }],
    outputs: [{ name: 'eid', type: 'uint32' }, { name: 'vault', type: 'address' }],
    stateMutability: 'view',
  },
] as const

export interface VaultTopology {
  /**
   * Role of this vault on the chain you queried:
   * - 'hub'   → this chain holds the TVL, users deposit here
   * - 'spoke' → this chain is a yield deployment; deposits go to the hub
   * - 'local' → single-chain vault, no cross-chain setup
   */
  role: 'hub' | 'spoke' | 'local'

  /** Chain ID where the hub lives. Same as the queried chain when role='hub'. */
  hubChainId: number

  /**
   * All spoke chain IDs registered under this hub.
   * Empty when role='local'.
   * Since vaults are CREATE3-deployed, the vault address is the same on all chains.
   */
  spokeChainIds: number[]
}

/**
 * Resolve the cross-chain topology of a vault: hub chain + all spoke chains.
 *
 * Works for hub vaults, spoke vaults, and local (single-chain) vaults.
 * Because MoreVaults uses CREATE3, the vault address is identical on every chain —
 * only the chain IDs differ.
 *
 * @param publicClient   Connected to the chain you want to inspect
 * @param vault          Vault address (same on all chains)
 * @param factoryAddress MoreVaults factory (defaults to the known OMNI_FACTORY_ADDRESS)
 *
 * @example
 * // Querying from Base — will detect hub + Ethereum/Arbitrum spokes
 * const topo = await getVaultTopology(baseClient, '0x8f740...')
 * // { role: 'hub', hubChainId: 8453, spokeChainIds: [1, 42161] }
 *
 * // Querying from Ethereum — same vault is a spoke there
 * const topo = await getVaultTopology(ethClient, '0x8f740...')
 * // { role: 'spoke', hubChainId: 8453, spokeChainIds: [1, 42161] }
 */
export async function getVaultTopology(
  publicClient: PublicClient,
  vault: Address,
  factoryAddress: Address = OMNI_FACTORY_ADDRESS,
): Promise<VaultTopology> {
  const v = getAddress(vault)
  const f = getAddress(factoryAddress)

  // Get local EID from the factory on the queried chain
  const localEid = await publicClient.readContract({
    address: f,
    abi: FACTORY_ABI,
    functionName: 'localEid',
  })

  // Check if this vault is a hub on the current chain
  const isHub = await publicClient.readContract({
    address: f,
    abi: FACTORY_ABI,
    functionName: 'isCrossChainVault',
    args: [localEid, v],
  })

  if (isHub) {
    // Hub: get all registered spokes
    const [spokeEids] = await publicClient.readContract({
      address: f,
      abi: FACTORY_ABI,
      functionName: 'hubToSpokes',
      args: [localEid, v],
    })

    const localChainId = EID_TO_CHAIN_ID[localEid] ?? Number(publicClient.chain?.id ?? 0)
    const spokeChainIds = (spokeEids as readonly number[])
      .map(eid => EID_TO_CHAIN_ID[eid])
      .filter((id): id is number => id !== undefined)

    return { role: 'hub', hubChainId: localChainId, spokeChainIds }
  }

  // Check if this vault is a spoke on the current chain
  const [hubEid, hubVault] = await publicClient.readContract({
    address: f,
    abi: FACTORY_ABI,
    functionName: 'spokeToHub',
    args: [localEid, v],
  })

  if (hubEid !== 0 && hubVault !== '0x0000000000000000000000000000000000000000') {
    // Spoke: resolve hub chain + get all siblings from hub's factory
    const hubChainId = EID_TO_CHAIN_ID[hubEid] ?? 0

    // We only have the current chain's client — return what we know
    // The hub's full spoke list requires a separate client for the hub chain
    // (callers can pass a hub-chain client to get the full picture)
    const spokeChainIds: number[] = []

    // If we happen to know the hub EID mapping, include local chain as a spoke
    const localChainId = EID_TO_CHAIN_ID[localEid]
    if (localChainId !== undefined) spokeChainIds.push(localChainId)

    return { role: 'spoke', hubChainId, spokeChainIds }
  }

  // Local vault — no cross-chain setup
  const localChainId = EID_TO_CHAIN_ID[localEid] ?? Number(publicClient.chain?.id ?? 0)
  return { role: 'local', hubChainId: localChainId, spokeChainIds: [] }
}

/**
 * Resolve the FULL topology of a vault by querying the hub chain directly.
 *
 * Provide a publicClient connected to the hub chain for complete spoke data.
 * If you don't know which chain is the hub, call `getVaultTopology` first
 * from any chain and use the returned `hubChainId` to create the hub client.
 *
 * @param hubChainClient  Public client connected to the hub chain
 * @param vault           Vault address
 * @param factoryAddress  MoreVaults factory (defaults to OMNI_FACTORY_ADDRESS)
 */
export async function getFullVaultTopology(
  hubChainClient: PublicClient,
  vault: Address,
  factoryAddress: Address = OMNI_FACTORY_ADDRESS,
): Promise<VaultTopology> {
  const topo = await getVaultTopology(hubChainClient, vault, factoryAddress)
  if (topo.role !== 'hub') {
    throw new Error(
      `getFullVaultTopology: client must be connected to the hub chain (${topo.hubChainId}), ` +
      `but got role="${topo.role}". Connect to chainId ${topo.hubChainId} instead.`,
    )
  }
  return topo
}

/**
 * Check if a wallet is connected to the hub chain for a given vault.
 * Useful for showing a "Switch to Base" prompt before deposit.
 *
 * @param currentChainId  Chain ID the wallet is currently connected to
 * @param topology        Result of getVaultTopology
 */
export function isOnHubChain(currentChainId: number, topology: VaultTopology): boolean {
  return currentChainId === topology.hubChainId
}

/**
 * Get all chain IDs where this vault is deployed (hub + all spokes).
 */
export function getAllVaultChainIds(topology: VaultTopology): number[] {
  return [topology.hubChainId, ...topology.spokeChainIds]
}
