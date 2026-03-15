/**
 * Vault topology helpers for the MoreVaults ethers.js v6 SDK.
 *
 * Resolves the cross-chain hub/spoke structure of a vault using the
 * MoreVaults OmniFactory contract (same address on every supported chain via CREATE3).
 */

import { Contract } from "ethers";
import type { Provider } from "ethers";
import { EID_TO_CHAIN_ID, CHAIN_IDS, createChainProvider } from "./chains";

// MoreVaults OMNI factory — same address on every supported chain (CREATE3)
export const OMNI_FACTORY_ADDRESS = "0x7bDB8B17604b03125eFAED33cA0c55FBf856BB0C";

const FACTORY_ABI = [
  "function localEid() view returns (uint32)",
  "function isCrossChainVault(uint32 __eid, address _vault) view returns (bool)",
  "function hubToSpokes(uint32 __eid, address _hubVault) view returns (uint32[] eids, address[] vaults)",
  "function spokeToHub(uint32 __eid, address _spokeVault) view returns (uint32 eid, address vault)",
] as const;

export interface VaultTopology {
  /**
   * Role of this vault on the chain you queried:
   * - 'hub'   → this chain holds the TVL, users deposit here
   * - 'spoke' → this chain is a yield deployment; deposits go to the hub
   * - 'local' → single-chain vault, no cross-chain setup
   */
  role: "hub" | "spoke" | "local";

  /** Chain ID where the hub lives. Same as the queried chain when role='hub'. */
  hubChainId: number;

  /**
   * All spoke chain IDs registered under this hub.
   * Empty when role='local'.
   * Since vaults are CREATE3-deployed, the vault address is the same on all chains.
   */
  spokeChainIds: number[];
}

/** All mainnet chain IDs where the OMNI_FACTORY is deployed */
const DISCOVERY_CHAIN_IDS = Object.values(CHAIN_IDS).filter(
  (id) => id !== 545, // exclude testnet
) as number[];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the cross-chain topology of a vault: hub chain + all spoke chains.
 *
 * Works for hub vaults, spoke vaults, and local (single-chain) vaults.
 * Because MoreVaults uses CREATE3, the vault address is identical on every chain —
 * only the chain IDs differ.
 *
 * @param provider       Connected to the chain you want to inspect
 * @param vault          Vault address (same on all chains)
 * @param factoryAddress MoreVaults factory (defaults to OMNI_FACTORY_ADDRESS)
 *
 * @example
 * // Querying from Base — will detect hub + Ethereum/Arbitrum spokes
 * const topo = await getVaultTopology(baseProvider, '0x8f740...')
 * // { role: 'hub', hubChainId: 8453, spokeChainIds: [1, 42161] }
 *
 * // Querying from Ethereum — same vault is a spoke there
 * const topo = await getVaultTopology(ethProvider, '0x8f740...')
 * // { role: 'spoke', hubChainId: 8453, spokeChainIds: [1, 42161] }
 */
export async function getVaultTopology(
  provider: Provider,
  vault: string,
  factoryAddress: string = OMNI_FACTORY_ADDRESS,
): Promise<VaultTopology> {
  const factory = new Contract(factoryAddress, FACTORY_ABI, provider);

  // Get local EID from the factory on the queried chain
  const localEid: number = Number(await factory.localEid());

  // Check if this vault is a hub on the current chain
  const isHub: boolean = await factory.isCrossChainVault(localEid, vault);

  if (isHub) {
    // Hub: get all registered spokes
    const result = await factory.hubToSpokes(localEid, vault);
    const spokeEids: bigint[] = result[0];

    const localChainId = EID_TO_CHAIN_ID[localEid] ?? 0;
    const spokeChainIds = spokeEids
      .map((eid) => EID_TO_CHAIN_ID[Number(eid)])
      .filter((id): id is number => id !== undefined);

    return { role: "hub", hubChainId: localChainId, spokeChainIds };
  }

  // Check if this vault is a spoke on the current chain
  const spokeResult = await factory.spokeToHub(localEid, vault);
  const hubEid: number = Number(spokeResult[0]);
  const hubVault: string = spokeResult[1];

  if (hubEid !== 0 && hubVault !== "0x0000000000000000000000000000000000000000") {
    // Spoke: resolve hub chain
    const hubChainId = EID_TO_CHAIN_ID[hubEid] ?? 0;

    // We only have the current chain's provider — return what we know.
    // The hub's full spoke list requires a separate provider for the hub chain.
    const spokeChainIds: number[] = [];

    // If we happen to know the local chain mapping, include it as a spoke
    const localChainId = EID_TO_CHAIN_ID[localEid];
    if (localChainId !== undefined) spokeChainIds.push(localChainId);

    return { role: "spoke", hubChainId, spokeChainIds };
  }

  // Local vault — no cross-chain setup
  const localChainId = EID_TO_CHAIN_ID[localEid] ?? 0;
  return { role: "local", hubChainId: localChainId, spokeChainIds: [] };
}

/**
 * Resolve the FULL topology of a vault by querying the hub chain directly.
 *
 * Provide a provider connected to the hub chain for complete spoke data.
 * If you don't know which chain is the hub, call `getVaultTopology` first
 * from any chain and use the returned `hubChainId` to create the hub provider.
 *
 * @param hubChainProvider  Provider connected to the hub chain
 * @param vault             Vault address
 * @param factoryAddress    MoreVaults factory (defaults to OMNI_FACTORY_ADDRESS)
 */
export async function getFullVaultTopology(
  hubChainProvider: Provider,
  vault: string,
  factoryAddress: string = OMNI_FACTORY_ADDRESS,
): Promise<VaultTopology> {
  const topo = await getVaultTopology(hubChainProvider, vault, factoryAddress);
  if (topo.role !== "hub") {
    throw new Error(
      `getFullVaultTopology: provider must be connected to the hub chain (${topo.hubChainId}), ` +
        `but got role="${topo.role}". Connect to chainId ${topo.hubChainId} instead.`,
    );
  }
  return topo;
}

/**
 * Discover a vault's topology across all supported chains.
 *
 * Unlike `getVaultTopology` (which queries a single chain), this function
 * automatically iterates all supported chains when the initial query returns
 * `role: "local"`. This handles the case where the caller doesn't know which
 * chain the vault is deployed on, or when no provider is connected.
 *
 * If a `provider` is provided, it's tried first. If that returns "local",
 * every other supported chain is probed via public RPCs.
 * If no `provider` is provided, all chains are probed.
 *
 * Once a hub is found, `getFullVaultTopology` is called to get the complete
 * spoke list.
 *
 * @param vault          Vault address (same on all chains via CREATE3)
 * @param provider       Optional — provider for the "preferred" chain to try first
 * @param factoryAddress MoreVaults factory (defaults to OMNI_FACTORY_ADDRESS)
 *
 * @example
 * // No wallet connected — discovers that 0x8f74... is hub on Base
 * const topo = await discoverVaultTopology('0x8f740...')
 * // { role: 'hub', hubChainId: 8453, spokeChainIds: [1, 42161] }
 */
export async function discoverVaultTopology(
  vault: string,
  provider?: Provider | null,
  factoryAddress: string = OMNI_FACTORY_ADDRESS,
): Promise<VaultTopology> {
  // 1. Try the provided provider first (fast path — avoids extra RPC calls)
  let triedChainId: number | undefined;
  if (provider) {
    try {
      const topo = await getVaultTopology(provider, vault, factoryAddress);
      if (topo.role !== "local") {
        // Found hub or spoke — if spoke, resolve full topology from hub
        if (topo.role === "spoke") {
          const hubProvider = createChainProvider(topo.hubChainId);
          if (hubProvider) {
            try {
              return await getFullVaultTopology(hubProvider, vault, factoryAddress);
            } catch { /* fall through to return partial */ }
          }
        }
        return topo;
      }
      // Determine which chainId we just tried
      const network = await provider.getNetwork();
      triedChainId = Number(network.chainId);
    } catch { /* provider failed — continue with discovery */ }
  }

  // 2. Iterate all supported chains
  for (const chainId of DISCOVERY_CHAIN_IDS) {
    if (chainId === triedChainId) continue;
    const chainProvider = createChainProvider(chainId);
    if (!chainProvider) continue;

    try {
      const topo = await getVaultTopology(chainProvider, vault, factoryAddress);
      if (topo.role === "hub") return topo;
      if (topo.role === "spoke") {
        // Found spoke — get full topology from hub
        const hubProvider = createChainProvider(topo.hubChainId);
        if (hubProvider) {
          try {
            return await getFullVaultTopology(hubProvider, vault, factoryAddress);
          } catch { return topo; }
        }
        return topo;
      }
    } catch { /* this chain doesn't have the factory or vault — skip */ }
  }

  // 3. Not found on any chain — return local with chainId 0
  return { role: "local", hubChainId: 0, spokeChainIds: [] };
}

/**
 * Check if a wallet is connected to the hub chain for a given vault.
 * Useful for showing a "Switch to Base" prompt before deposit.
 *
 * @param currentChainId  Chain ID the wallet is currently connected to
 * @param topology        Result of getVaultTopology
 */
export function isOnHubChain(currentChainId: number, topology: VaultTopology): boolean {
  return currentChainId === topology.hubChainId;
}

/**
 * Get all chain IDs where this vault is deployed (hub + all spokes).
 */
export function getAllVaultChainIds(topology: VaultTopology): number[] {
  return [topology.hubChainId, ...topology.spokeChainIds];
}
