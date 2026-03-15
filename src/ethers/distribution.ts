/**
 * Vault distribution helpers for the MoreVaults ethers.js v6 SDK.
 *
 * Reads the cross-chain capital distribution of a vault: hub balance,
 * spoke balances, and aggregate totals.
 */

import type { Provider } from "ethers";
import { getVaultStatus } from "./utils";
import { getVaultTopology } from "./topology";

// ─────────────────────────────────────────────────────────────────────────────

export interface SpokeBalance {
  chainId: number;
  totalAssets: bigint;
  /** false if the RPC call to this spoke failed */
  isReachable: boolean;
}

export interface VaultDistribution {
  hubChainId: number;
  /** Underlying token balance idle on the hub (not deployed to strategies) */
  hubLiquidBalance: bigint;
  /** Hub totalAssets minus hubLiquidBalance (capital in Morpho, Aave, etc.) */
  hubStrategyBalance: bigint;
  /** Hub vault totalAssets() */
  hubTotalAssets: bigint;
  /** What the hub's accounting thinks is deployed on spokes */
  spokesDeployedBalance: bigint;
  /** Actual per-spoke balances read directly from each spoke chain */
  spokeBalances: SpokeBalance[];
  /** hubTotalAssets + sum of reachable spoke totalAssets */
  totalActual: bigint;
  oracleAccountingEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the full cross-chain capital distribution of a vault.
 *
 * Queries the hub for its status, then reads `totalAssets()` on each spoke
 * chain in parallel. Spoke calls are individually wrapped so a single
 * unreachable RPC never fails the entire call.
 *
 * @param hubProvider     Provider connected to the hub chain
 * @param vault           Vault address (same on all chains via CREATE3)
 * @param spokeProviders  Map of chainId → Provider for each spoke chain
 *
 * @example
 * ```ts
 * const dist = await getVaultDistribution(baseProvider, VAULT, {
 *   [1]: ethProvider,
 *   [42161]: arbProvider,
 * })
 * console.log(`Hub liquid: ${dist.hubLiquidBalance}`)
 * console.log(`Total actual: ${dist.totalActual}`)
 * ```
 */
export async function getVaultDistribution(
  hubProvider: Provider,
  vault: string,
  spokeProviders: Record<number, Provider>,
): Promise<VaultDistribution> {
  // Read hub status
  const hubStatus = await getVaultStatus(hubProvider, vault);

  const hubChainId = Number((await hubProvider.getNetwork()).chainId);
  const hubTotalAssets = hubStatus.totalAssets;
  const hubLiquidBalance = hubStatus.hubLiquidBalance;
  const hubStrategyBalance =
    hubTotalAssets > hubLiquidBalance ? hubTotalAssets - hubLiquidBalance : 0n;

  // Read each spoke's totalAssets in parallel, never throwing
  const spokeEntries = Object.entries(spokeProviders).map(([chainIdStr, provider]) => ({
    chainId: Number(chainIdStr),
    provider,
  }));

  const spokeBalances: SpokeBalance[] = await Promise.all(
    spokeEntries.map(async ({ chainId, provider }): Promise<SpokeBalance> => {
      try {
        const spokeStatus = await getVaultStatus(provider, vault);
        return { chainId, totalAssets: spokeStatus.totalAssets, isReachable: true };
      } catch {
        return { chainId, totalAssets: 0n, isReachable: false };
      }
    }),
  );

  // totalActual = hub + reachable spokes
  const reachableSpokeSum = spokeBalances
    .filter((s) => s.isReachable)
    .reduce((acc, s) => acc + s.totalAssets, 0n);

  const totalActual = hubTotalAssets + reachableSpokeSum;

  return {
    hubChainId,
    hubLiquidBalance,
    hubStrategyBalance,
    hubTotalAssets,
    spokesDeployedBalance: hubStatus.spokesDeployedBalance,
    spokeBalances,
    totalActual,
    oracleAccountingEnabled: hubStatus.oracleAccountingEnabled,
  };
}

/**
 * Hub-only distribution — uses topology to discover spokes but does NOT
 * read spoke chains (no spoke providers needed).
 *
 * Returns hub data plus the list of spoke chainIds from the factory.
 * `spokeBalances` will be empty — callers must provide spoke providers to
 * `getVaultDistribution` for actual spoke reads.
 *
 * @param hubProvider  Provider connected to the hub chain
 * @param vault        Vault address
 *
 * @example
 * ```ts
 * const dist = await getVaultDistributionWithTopology(baseProvider, VAULT)
 * // dist.spokeBalances === [] (no spoke providers provided)
 * // dist.spokeChainIds tells you which chains to query
 * ```
 */
export async function getVaultDistributionWithTopology(
  hubProvider: Provider,
  vault: string,
): Promise<VaultDistribution & { spokeChainIds: number[] }> {
  // Read hub status and topology in parallel
  const [hubStatus, topology] = await Promise.all([
    getVaultStatus(hubProvider, vault),
    getVaultTopology(hubProvider, vault),
  ]);

  const hubChainId = Number((await hubProvider.getNetwork()).chainId);
  const hubTotalAssets = hubStatus.totalAssets;
  const hubLiquidBalance = hubStatus.hubLiquidBalance;
  const hubStrategyBalance =
    hubTotalAssets > hubLiquidBalance ? hubTotalAssets - hubLiquidBalance : 0n;

  return {
    hubChainId,
    hubLiquidBalance,
    hubStrategyBalance,
    hubTotalAssets,
    spokesDeployedBalance: hubStatus.spokesDeployedBalance,
    spokeBalances: [],
    totalActual: hubTotalAssets, // hub-only, no spoke data
    oracleAccountingEnabled: hubStatus.oracleAccountingEnabled,
    spokeChainIds: topology.spokeChainIds,
  };
}
