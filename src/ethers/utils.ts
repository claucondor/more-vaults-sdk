/**
 * Utility helpers for the MoreVaults ethers.js v6 SDK.
 *
 * All reads use Provider (read-only). Writes use Signer.
 */

import { Contract, ZeroAddress } from "ethers";
import type { Provider, Signer } from "ethers";
import { BRIDGE_ABI, CONFIG_ABI, ERC20_ABI, VAULT_ABI } from "./abis";
import type { CrossChainRequestInfo } from "./types";

// ─────────────────────────────────────────────────────────────────────────────

export type VaultMode =
  | "local"               // single-chain vault, no cross-chain
  | "cross-chain-oracle"  // hub with oracle-based accounting (sync)
  | "cross-chain-async"   // hub with off-chain accounting (async, D4/D5/R5)
  | "paused"              // vault is paused
  | "full";               // deposit capacity reached

export interface VaultStatus {
  /** Vault operating mode — determines which SDK flow to use */
  mode: VaultMode;
  /** Which deposit function to call given the current configuration */
  recommendedDepositFlow: "depositSimple" | "depositAsync" | "mintAsync" | "none";
  /** Which redeem function to call given the current configuration */
  recommendedRedeemFlow: "redeemShares" | "redeemAsync" | "none";

  // ── Configuration ──────────────────────────────────────────────────────────
  isHub: boolean;
  isPaused: boolean;
  oracleAccountingEnabled: boolean;

  /** address(0) means CCManager is not set — async flows will fail */
  ccManager: string;
  /** address(0) means escrow is not configured in the registry */
  escrow: string;

  // ── Withdrawal queue ───────────────────────────────────────────────────────
  withdrawalQueueEnabled: boolean;
  /** Timelock duration in seconds (0 = no timelock) */
  withdrawalTimelockSeconds: bigint;

  // ── Capacity ───────────────────────────────────────────────────────────────
  /**
   * Remaining deposit capacity in underlying token decimals.
   * `type(uint256).max` = no cap configured (unlimited).
   * `0n` = vault is full — no more deposits accepted.
   * If `depositAccessRestricted = true`, this value is `type(uint256).max` but
   * deposits are still gated by whitelist or other access control.
   */
  remainingDepositCapacity: bigint;
  /**
   * True when `maxDeposit(address(0))` reverted, indicating the vault uses
   * whitelist or other access control to restrict who can deposit.
   */
  depositAccessRestricted: boolean;

  // ── Vault metrics ──────────────────────────────────────────────────────────
  underlying: string;
  totalAssets: bigint;
  totalSupply: bigint;
  /**
   * Underlying token balance held directly on the hub chain.
   * This is the only portion that can be paid out to redeeming users immediately.
   * (= ERC-20.balanceOf(vault) on the hub)
   */
  hubLiquidBalance: bigint;
  /**
   * Approximate value deployed to spoke chains (totalAssets − hubLiquidBalance).
   * These funds are NOT immediately redeemable — the vault curator must
   * call executeBridging to repatriate them before large redeems can succeed.
   */
  spokesDeployedBalance: bigint;
  /**
   * Maximum assets that can be redeemed right now without curator intervention.
   * - For hub vaults: equals `hubLiquidBalance`.
   * - For local/oracle vaults: equals `totalAssets`.
   */
  maxImmediateRedeemAssets: bigint;

  // ── Issues — empty when everything is correctly configured ─────────────────
  /**
   * Human-readable list of configuration problems that would cause transactions
   * to fail. Empty array = vault is ready to use.
   */
  issues: string[];
}

/**
 * Ensure the spender has sufficient ERC-20 allowance; approve if not.
 *
 * @param signer    Wallet signer with account attached
 * @param provider  Read-only provider for allowance checks
 * @param token     ERC-20 token address
 * @param spender   Address to approve
 * @param amount    Minimum required allowance
 */
export async function ensureAllowance(
  signer: Signer,
  provider: Provider,
  token: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const owner = await signer.getAddress();
  const erc20Read = new Contract(token, ERC20_ABI, provider);
  const current: bigint = await erc20Read.allowance(owner, spender);
  if (current < amount) {
    const erc20Write = new Contract(token, ERC20_ABI, signer);
    const tx = await erc20Write.approve(spender, amount);
    await tx.wait();
  }
}

/**
 * Quote the LayerZero native fee required for async vault actions.
 *
 * @param provider      Read-only provider
 * @param vault         Vault address (diamond proxy)
 * @param extraOptions  Optional LZ extra options bytes (default 0x)
 * @returns             Required native fee in wei
 */
export async function quoteLzFee(
  provider: Provider,
  vault: string,
  extraOptions: string = "0x"
): Promise<bigint> {
  const bridge = new Contract(vault, BRIDGE_ABI, provider);
  const fee: bigint = await bridge.quoteAccountingFee(extraOptions);
  return fee;
}

/**
 * Check if a vault is operating in async mode (cross-chain hub with oracle OFF).
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @returns         true if the vault requires async cross-chain flows
 */
export async function isAsyncMode(
  provider: Provider,
  vault: string
): Promise<boolean> {
  const config = new Contract(vault, CONFIG_ABI, provider);
  const bridge = new Contract(vault, BRIDGE_ABI, provider);

  const [isHub, oraclesEnabled]: [boolean, boolean] = await Promise.all([
    config.isHub(),
    bridge.oraclesCrossChainAccounting(),
  ]);

  if (!isHub) return false;
  return !oraclesEnabled;
}

/**
 * Poll for async request completion status.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param guid      Request GUID returned by the async flow
 * @returns         Whether the request is fulfilled, finalized, and the result
 */
export async function getAsyncRequestStatus(
  provider: Provider,
  vault: string,
  guid: string
): Promise<{ fulfilled: boolean; finalized: boolean; result: bigint }> {
  const bridge = new Contract(vault, BRIDGE_ABI, provider);

  const [info, finalizationResult]: [CrossChainRequestInfo, bigint] =
    await Promise.all([
      bridge.getRequestInfo(guid),
      bridge.getFinalizationResult(guid),
    ]);

  return {
    fulfilled: info.fulfilled,
    finalized: info.finalized,
    result: finalizationResult,
  };
}

/**
 * Read the full configuration and operational status of a vault.
 *
 * All independent reads are fired in parallel.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address (diamond proxy)
 * @returns         Full vault status snapshot
 */
export async function getVaultStatus(
  provider: Provider,
  vault: string
): Promise<VaultStatus> {
  const config = new Contract(vault, CONFIG_ABI, provider);
  const bridge = new Contract(vault, BRIDGE_ABI, provider);
  const vaultContract = new Contract(vault, VAULT_ABI, provider);

  // First batch: all reads that don't depend on other results
  const [
    isHub,
    isPaused,
    oraclesEnabled,
    ccManager,
    escrow,
    withdrawalQueueEnabled,
    withdrawalTimelockSeconds,
    remainingDepositCapacity,
    underlying,
    totalAssets,
    totalSupply,
  ] = await Promise.all([
    config.isHub() as Promise<boolean>,
    config.paused() as Promise<boolean>,
    bridge.oraclesCrossChainAccounting() as Promise<boolean>,
    config.getCrossChainAccountingManager() as Promise<string>,
    config.getEscrow() as Promise<string>,
    config.getWithdrawalQueueStatus() as Promise<boolean>,
    config.getWithdrawalTimelock() as Promise<bigint>,
    // maxDeposit may revert on whitelisted vaults when called with address(0).
    // Use null as sentinel to distinguish "reverted" from "returned 0 (full)".
    (config.maxDeposit(ZeroAddress) as Promise<bigint>).catch(() => null),
    vaultContract.asset() as Promise<string>,
    vaultContract.totalAssets() as Promise<bigint>,
    vaultContract.totalSupply() as Promise<bigint>,
  ]);

  // Second batch: needs underlying address from first batch
  const underlyingContract = new Contract(underlying as string, ERC20_ABI, provider);
  const hubLiquidBalance: bigint = await underlyingContract.balanceOf(vault);
  const spokesDeployedBalance: bigint =
    (totalAssets as bigint) > hubLiquidBalance
      ? (totalAssets as bigint) - hubLiquidBalance
      : 0n;

  // null sentinel means maxDeposit reverted (whitelisted / access-controlled vault)
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const depositAccessRestricted = remainingDepositCapacity === null;
  const effectiveCapacity: bigint = depositAccessRestricted ? MAX_UINT256 : (remainingDepositCapacity as bigint);

  // ── Derive mode ────────────────────────────────────────────────────────────
  let mode: VaultMode;
  if (isPaused) {
    mode = "paused";
  } else if (effectiveCapacity === 0n) {
    mode = "full";
  } else if (!isHub) {
    mode = "local";
  } else if (oraclesEnabled) {
    mode = "cross-chain-oracle";
  } else {
    mode = "cross-chain-async";
  }

  // ── Recommended flows ──────────────────────────────────────────────────────
  let recommendedDepositFlow: VaultStatus["recommendedDepositFlow"];
  let recommendedRedeemFlow: VaultStatus["recommendedRedeemFlow"];

  if (mode === "paused" || mode === "full") {
    recommendedDepositFlow = "none";
    recommendedRedeemFlow = mode === "paused" ? "none" : "redeemShares";
  } else if (mode === "cross-chain-async") {
    recommendedDepositFlow = "depositAsync";
    recommendedRedeemFlow = "redeemAsync";
  } else {
    // local or cross-chain-oracle
    recommendedDepositFlow = "depositSimple";
    recommendedRedeemFlow = "redeemShares";
  }

  // ── Issues ─────────────────────────────────────────────────────────────────
  const issues: string[] = [];

  if (isPaused) {
    issues.push("Vault is paused — no deposits or redeems are possible.");
  }
  if (effectiveCapacity === 0n && !isPaused) {
    issues.push(
      "Deposit capacity is full — increase depositCapacity via setDepositCapacity()."
    );
  }
  if (isHub && !oraclesEnabled && ccManager === ZeroAddress) {
    issues.push(
      "CCManager not configured — async flows will revert. Call setCrossChainAccountingManager(address) as vault owner."
    );
  }
  if (isHub && !oraclesEnabled && escrow === ZeroAddress) {
    issues.push(
      "Escrow not configured in registry — async flows will revert. Set the escrow via the MoreVaultsRegistry."
    );
  }
  if (depositAccessRestricted) {
    issues.push("Deposit access is restricted (whitelist or other access control). Only approved addresses can deposit.");
  }

  // ── maxImmediateRedeemAssets ────────────────────────────────────────────────
  const maxImmediateRedeemAssets: bigint = isHub && !oraclesEnabled ? hubLiquidBalance : totalAssets as bigint;

  if (isHub) {
    if (hubLiquidBalance === 0n) {
      issues.push(
        `Hub has no liquid assets (hubLiquidBalance = 0). All redeems will be auto-refunded until the curator repatriates funds from spokes via executeBridging().`
      );
    } else if ((totalAssets as bigint) > 0n && hubLiquidBalance * 10n < (totalAssets as bigint)) {
      const pct = Number((hubLiquidBalance * 10000n) / (totalAssets as bigint)) / 100;
      issues.push(
        `Low hub liquidity: ${hubLiquidBalance} units liquid on hub (${pct.toFixed(1)}% of TVL). ` +
        `Redeems above ${hubLiquidBalance} underlying units will be auto-refunded. ` +
        `Curator must call executeBridging() to repatriate from spokes.`
      );
    }
    if (spokesDeployedBalance > 0n) {
      const total = totalAssets as bigint;
      issues.push(
        `${spokesDeployedBalance} units (~${((Number(spokesDeployedBalance) / Number(total || 1n)) * 100).toFixed(1)}% of TVL) ` +
        `are deployed on spoke chains earning yield. These are NOT immediately redeemable — ` +
        `they require a curator repatriation (executeBridging) before users can withdraw them.`
      );
    }
  }

  return {
    mode,
    recommendedDepositFlow,
    recommendedRedeemFlow,
    isHub,
    isPaused,
    oracleAccountingEnabled: oraclesEnabled,
    ccManager,
    escrow,
    withdrawalQueueEnabled,
    withdrawalTimelockSeconds: BigInt(withdrawalTimelockSeconds),
    remainingDepositCapacity: effectiveCapacity,
    depositAccessRestricted,
    underlying,
    totalAssets,
    totalSupply,
    hubLiquidBalance,
    spokesDeployedBalance,
    maxImmediateRedeemAssets,
    issues,
  };
}
