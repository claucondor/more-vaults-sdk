import type { Address, PublicClient } from 'viem'
import { getVaultStatus } from './utils.js'
import { getVaultTopology } from './topology.js'
import { MoreVaultsError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────

export interface SpokeBalance {
  chainId: number
  totalAssets: bigint
  /** false if the RPC call to this spoke failed */
  isReachable: boolean
}

export interface VaultDistribution {
  hubChainId: number
  /** Underlying token balance idle on the hub (not deployed to strategies) */
  hubLiquidBalance: bigint
  /** Hub totalAssets minus hubLiquidBalance (capital in Morpho, Aave, etc.) */
  hubStrategyBalance: bigint
  /** Hub vault totalAssets() */
  hubTotalAssets: bigint
  /** What the hub's accounting thinks is deployed on spokes */
  spokesDeployedBalance: bigint
  /** Actual per-spoke balances read directly from each spoke chain */
  spokeBalances: SpokeBalance[]
  /** hubTotalAssets + sum of reachable spoke totalAssets */
  totalActual: bigint
  oracleAccountingEnabled: boolean
}

/**
 * Read the full cross-chain capital distribution of a vault.
 *
 * Queries the hub for its status, then reads `totalAssets()` on each spoke
 * chain in parallel. Spoke calls are individually wrapped so a single
 * unreachable RPC never fails the entire call.
 *
 * @param hubClient     Public client connected to the hub chain
 * @param vault         Vault address (same on all chains via CREATE3)
 * @param spokeClients  Map of chainId → PublicClient for each spoke chain
 *
 * @example
 * ```ts
 * const dist = await getVaultDistribution(baseClient, VAULT, {
 *   [1]: ethClient,
 *   [42161]: arbClient,
 * })
 * console.log(`Hub liquid: ${dist.hubLiquidBalance}`)
 * console.log(`Total actual: ${dist.totalActual}`)
 * ```
 */
export async function getVaultDistribution(
  hubClient: PublicClient,
  vault: Address,
  spokeClients: Record<number, PublicClient>,
): Promise<VaultDistribution> {
  // Read hub status
  let hubStatus: Awaited<ReturnType<typeof getVaultStatus>>
  try {
    hubStatus = await getVaultStatus(hubClient, vault)
  } catch {
    throw new MoreVaultsError('Failed to read vault status on hub chain')
  }

  const hubChainId = Number(hubClient.chain?.id ?? 0)
  const hubTotalAssets = hubStatus.totalAssets
  const hubLiquidBalance = hubStatus.hubLiquidBalance
  const hubStrategyBalance = hubTotalAssets > hubLiquidBalance
    ? hubTotalAssets - hubLiquidBalance
    : 0n

  // Read each spoke's totalAssets in parallel, never throwing
  const spokeEntries = Object.entries(spokeClients).map(([chainIdStr, client]) => ({
    chainId: Number(chainIdStr),
    client,
  }))

  const spokeBalances: SpokeBalance[] = await Promise.all(
    spokeEntries.map(async ({ chainId, client }): Promise<SpokeBalance> => {
      try {
        const spokeStatus = await getVaultStatus(client, vault)
        return { chainId, totalAssets: spokeStatus.totalAssets, isReachable: true }
      } catch {
        return { chainId, totalAssets: 0n, isReachable: false }
      }
    }),
  )

  // totalActual = hub + reachable spokes
  const reachableSpokeSum = spokeBalances
    .filter(s => s.isReachable)
    .reduce((acc, s) => acc + s.totalAssets, 0n)

  const totalActual = hubTotalAssets + reachableSpokeSum

  return {
    hubChainId,
    hubLiquidBalance,
    hubStrategyBalance,
    hubTotalAssets,
    spokesDeployedBalance: hubStatus.spokesDeployedBalance,
    spokeBalances,
    totalActual,
    oracleAccountingEnabled: hubStatus.oracleAccountingEnabled,
  }
}

/**
 * Hub-only distribution — uses topology to discover spokes but does NOT
 * read spoke chains (no spoke clients needed).
 *
 * Returns hub data plus the list of spoke chainIds from the factory.
 * `spokeBalances` will be empty — callers must provide spoke clients to
 * `getVaultDistribution` for actual spoke reads.
 *
 * @param hubClient  Public client connected to the hub chain
 * @param vault      Vault address
 *
 * @example
 * ```ts
 * const dist = await getVaultDistributionWithTopology(baseClient, VAULT)
 * // dist.spokeBalances === [] (no spoke clients provided)
 * // dist.spokeChainIds tells you which chains to query
 * ```
 */
export async function getVaultDistributionWithTopology(
  hubClient: PublicClient,
  vault: Address,
): Promise<VaultDistribution & { spokeChainIds: number[] }> {
  // Read hub status and topology in parallel
  const [hubStatus, topology] = await Promise.all([
    getVaultStatus(hubClient, vault),
    getVaultTopology(hubClient, vault),
  ])

  const hubChainId = Number(hubClient.chain?.id ?? 0)
  const hubTotalAssets = hubStatus.totalAssets
  const hubLiquidBalance = hubStatus.hubLiquidBalance
  const hubStrategyBalance = hubTotalAssets > hubLiquidBalance
    ? hubTotalAssets - hubLiquidBalance
    : 0n

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
  }
}
