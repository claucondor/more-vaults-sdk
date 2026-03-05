/**
 * Pre-flight validation helpers for MoreVaults ethers.js v6 SDK flows.
 *
 * Each function reads on-chain state and throws a descriptive error BEFORE
 * the actual contract call, so developers see a clear, actionable message
 * instead of a raw VM revert.
 */

import { Contract, ZeroAddress } from "ethers";
import type { Provider } from "ethers";
import { CONFIG_ABI, BRIDGE_ABI } from "./abis";

/**
 * Pre-flight checks for async cross-chain flows (D4 / D5 / R5).
 *
 * Validates that:
 * 1. The CCManager is configured on the vault.
 * 2. An escrow is registered in the vault's registry.
 * 3. The vault is a hub (required for async flows).
 * 4. The vault does NOT have oracle-based cross-chain accounting enabled
 *    (oracle-on vaults should use depositSimple / depositCrossChainOracleOn).
 * 5. The vault is not paused.
 *
 * All reads that are independent of each other are executed in parallel via
 * Promise.all to minimise latency.
 *
 * @param provider  Read-only provider for contract reads
 * @param vault     Vault address (diamond proxy)
 * @param escrow    Escrow address from VaultAddresses
 */
export async function preflightAsync(
  provider: Provider,
  vault: string,
  escrow: string
): Promise<void> {
  const config = new Contract(vault, CONFIG_ABI, provider);
  const bridge = new Contract(vault, BRIDGE_ABI, provider);

  // Parallel read: ccManager, escrow, isHub, oraclesCrossChainAccounting, paused
  const [ccManager, registeredEscrow, isHub, oraclesEnabled, isPaused] =
    await Promise.all([
      config.getCrossChainAccountingManager() as Promise<string>,
      config.getEscrow() as Promise<string>,
      config.isHub() as Promise<boolean>,
      bridge.oraclesCrossChainAccounting() as Promise<boolean>,
      config.paused() as Promise<boolean>,
    ]);

  if (ccManager === ZeroAddress) {
    throw new Error(
      `[MoreVaults] CCManager not configured on vault ${vault}. Call setCrossChainAccountingManager(ccManagerAddress) as vault owner first.`
    );
  }

  if (registeredEscrow === ZeroAddress) {
    throw new Error(
      `[MoreVaults] Escrow not configured for vault ${vault}. The registry must have an escrow set for this vault.`
    );
  }

  if (!isHub) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is not a hub vault. Async flows (D4/D5/R5) only work on hub vaults.`
    );
  }

  if (oraclesEnabled) {
    throw new Error(
      `[MoreVaults] Vault ${vault} has oracle-based cross-chain accounting enabled. Use depositSimple/depositCrossChainOracleOn instead of async flows.`
    );
  }

  if (isPaused) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`
    );
  }
}

/**
 * Pre-flight checks for synchronous deposit flows (D1 / D3).
 *
 * Validates that:
 * 1. The vault is not paused.
 * 2. The vault still has deposit capacity (maxDeposit > 0).
 *
 * Both reads are executed in parallel.
 *
 * @param provider  Read-only provider for contract reads
 * @param vault     Vault address (diamond proxy)
 */
export async function preflightSync(
  provider: Provider,
  vault: string
): Promise<void> {
  const config = new Contract(vault, CONFIG_ABI, provider);

  // Parallel read: paused + maxDeposit (zero address is acceptable for cap check)
  const [isPaused, depositCap] = await Promise.all([
    config.paused() as Promise<boolean>,
    config.maxDeposit(ZeroAddress) as Promise<bigint>,
  ]);

  if (isPaused) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`
    );
  }

  if (depositCap === 0n) {
    throw new Error(
      `[MoreVaults] Vault ${vault} has reached deposit capacity. No more deposits accepted.`
    );
  }
}
