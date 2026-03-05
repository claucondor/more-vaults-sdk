/**
 * User-facing helper functions for the MoreVaults ethers.js v6 SDK.
 *
 * All functions use Provider (read-only). None send transactions.
 */

import { Contract, Interface } from "ethers";
import type { Provider } from "ethers";
import { BRIDGE_ABI, CONFIG_ABI, ERC20_ABI, VAULT_ABI, METADATA_ABI } from "./abis";
import type { CrossChainRequestInfo } from "./types";
import { getVaultStatus } from "./utils";
import type { VaultStatus } from "./utils";

// Multicall3 — deployed at the same address on every EVM chain
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export interface UserPosition {
  /** Vault share balance */
  shares: bigint;
  /** convertToAssets(shares) — what they'd get if they redeemed now */
  estimatedAssets: bigint;
  /** Price of 1 full share in underlying (convertToAssets(10n ** decimals)) */
  sharePrice: bigint;
  /** Vault decimals (for display) */
  decimals: number;
  pendingWithdrawal: {
    shares: bigint;
    timelockEndsAt: bigint;
    /** block.timestamp >= timelockEndsAt (or timelockEndsAt === 0n) */
    canRedeemNow: boolean;
  } | null; // null if no pending withdrawal request
}

/**
 * Read the user's current position in the vault.
 *
 * @param provider  Read-only provider for reads
 * @param vault     Vault address (diamond proxy)
 * @param user      User wallet address
 * @returns         Full user position snapshot
 */
export async function getUserPosition(
  provider: Provider,
  vault: string,
  user: string
): Promise<UserPosition> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const vaultIface    = new Interface(VAULT_ABI as unknown as string[]);
  const decimalsIface = new Interface(["function decimals() view returns (uint8)"]);

  // First batch: balance, decimals, withdrawal request — via Multicall3
  const b1Calls = [
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("balanceOf", [user]) },
    { target: vault, allowFailure: false, callData: decimalsIface.encodeFunctionData("decimals") },
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("getWithdrawalRequest", [user]) },
  ];

  const [b1Raw, block] = await Promise.all([
    mc.aggregate3.staticCall(b1Calls) as Promise<{ success: boolean; returnData: string }[]>,
    provider.getBlock("latest"),
  ]);

  const shares           = vaultIface.decodeFunctionResult("balanceOf", b1Raw[0].returnData)[0] as bigint;
  const decimalsRaw      = decimalsIface.decodeFunctionResult("decimals", b1Raw[1].returnData)[0];
  const decimals         = Number(decimalsRaw);
  const withdrawalResult = vaultIface.decodeFunctionResult("getWithdrawalRequest", b1Raw[2].returnData);
  const withdrawalRequest: [bigint, bigint] = [withdrawalResult[0] as bigint, withdrawalResult[1] as bigint];

  const [withdrawShares, timelockEndsAt] = withdrawalRequest;

  // Second batch: convertToAssets calls (need shares and decimals from first batch)
  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  const oneShare = 10n ** BigInt(decimals);
  const [estimatedAssets, sharePrice] = await Promise.all([
    shares === 0n
      ? Promise.resolve(0n)
      : (vaultContract.convertToAssets(shares) as Promise<bigint>),
    vaultContract.convertToAssets(oneShare) as Promise<bigint>,
  ]);

  const currentTimestamp = BigInt(block!.timestamp);

  const pendingWithdrawal =
    withdrawShares === 0n
      ? null
      : {
          shares: withdrawShares,
          timelockEndsAt,
          canRedeemNow:
            timelockEndsAt === 0n || currentTimestamp >= timelockEndsAt,
        };

  return {
    shares,
    estimatedAssets,
    sharePrice,
    decimals,
    pendingWithdrawal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many shares a given asset amount would mint.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param assets    Amount of underlying tokens to deposit
 * @returns         Estimated shares to be minted
 */
export async function previewDeposit(
  provider: Provider,
  vault: string,
  assets: bigint
): Promise<bigint> {
  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  return vaultContract.previewDeposit(assets) as Promise<bigint>;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many underlying assets a given share amount would redeem.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param shares    Amount of vault shares to redeem
 * @returns         Estimated assets to be returned
 */
export async function previewRedeem(
  provider: Provider,
  vault: string,
  shares: bigint
): Promise<bigint> {
  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  return vaultContract.previewRedeem(shares) as Promise<bigint>;
}

// ─────────────────────────────────────────────────────────────────────────────

export type DepositBlockReason =
  | "paused"
  | "capacity-full"
  | "not-whitelisted"
  | "ok";

export interface DepositEligibility {
  allowed: boolean;
  reason: DepositBlockReason;
}

/**
 * Check whether a user is eligible to deposit into the vault right now.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param user      User wallet address
 * @returns         Eligibility result with reason
 */
export async function canDeposit(
  provider: Provider,
  vault: string,
  user: string
): Promise<DepositEligibility> {
  const config = new Contract(vault, CONFIG_ABI, provider);

  const isPaused = await (config.paused() as Promise<boolean>);

  if (isPaused) {
    return { allowed: false, reason: "paused" };
  }

  // maxDeposit(user) can REVERT on vaults with whitelist/ACL
  let maxDepositAmount: bigint;
  try {
    maxDepositAmount = await (config.maxDeposit(user) as Promise<bigint>);
  } catch {
    // Revert means the vault has whitelist/ACL and this user is not approved
    return { allowed: false, reason: "not-whitelisted" };
  }

  if (maxDepositAmount === 0n) {
    return { allowed: false, reason: "capacity-full" };
  }
  return { allowed: true, reason: "ok" };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultMetadata {
  name: string;
  symbol: string;
  decimals: number;
  underlying: string;
  underlyingSymbol: string;
  underlyingDecimals: number;
}

/**
 * Read display metadata for a vault and its underlying token.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @returns         Vault and underlying token metadata
 */
export async function getVaultMetadata(
  provider: Provider,
  vault: string
): Promise<VaultMetadata> {
  const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const MULTICALL3_ABI = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
  ] as const;
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const metaIface  = new Interface(METADATA_ABI as unknown as string[]);
  const vaultIface = new Interface(VAULT_ABI as unknown as string[]);

  // Batch 1: name, symbol, decimals, asset — 1 eth_call via Multicall3
  const b1Calls = [
    { target: vault, allowFailure: false, callData: metaIface.encodeFunctionData("name") },
    { target: vault, allowFailure: false, callData: metaIface.encodeFunctionData("symbol") },
    { target: vault, allowFailure: false, callData: metaIface.encodeFunctionData("decimals") },
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("asset") },
  ];
  const b1: { success: boolean; returnData: string }[] = await mc.aggregate3.staticCall(b1Calls);

  const name       = metaIface.decodeFunctionResult("name",     b1[0].returnData)[0] as string;
  const symbol     = metaIface.decodeFunctionResult("symbol",   b1[1].returnData)[0] as string;
  const decimals   = Number(metaIface.decodeFunctionResult("decimals", b1[2].returnData)[0]);
  const underlying = vaultIface.decodeFunctionResult("asset",   b1[3].returnData)[0] as string;

  // Batch 2: underlying symbol + decimals — 1 eth_call via Multicall3
  const b2Calls = [
    { target: underlying, allowFailure: false, callData: metaIface.encodeFunctionData("symbol") },
    { target: underlying, allowFailure: false, callData: metaIface.encodeFunctionData("decimals") },
  ];
  const b2: { success: boolean; returnData: string }[] = await mc.aggregate3.staticCall(b2Calls);

  const underlyingSymbol   = metaIface.decodeFunctionResult("symbol",   b2[0].returnData)[0] as string;
  const underlyingDecimals = Number(metaIface.decodeFunctionResult("decimals", b2[1].returnData)[0]);

  return {
    name,
    symbol,
    decimals,
    underlying,
    underlyingSymbol,
    underlyingDecimals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export type AsyncRequestStatus =
  | "pending"
  | "ready-to-execute"
  | "completed"
  | "refunded";

export interface AsyncRequestStatusInfo {
  status: AsyncRequestStatus;
  /** Human-readable description */
  label: string;
  /** Shares minted or assets returned (0 if still pending) */
  result: bigint;
}

/**
 * Get the human-readable status of an async cross-chain request.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param guid      Request GUID returned by depositAsync / mintAsync / redeemAsync
 * @returns         Status info with label and result
 */
export async function getAsyncRequestStatusLabel(
  provider: Provider,
  vault: string,
  guid: string
): Promise<AsyncRequestStatusInfo> {
  const bridge = new Contract(vault, BRIDGE_ABI, provider);

  const [info, finalizationResult]: [CrossChainRequestInfo, bigint] =
    await Promise.all([
      bridge.getRequestInfo(guid) as Promise<CrossChainRequestInfo>,
      bridge.getFinalizationResult(guid) as Promise<bigint>,
    ]);

  if (info.refunded) {
    return {
      status: "refunded",
      label: "Request refunded — tokens returned to initiator",
      result: 0n,
    };
  }
  if (info.finalized) {
    return {
      status: "completed",
      label: "Completed",
      result: finalizationResult,
    };
  }
  if (info.fulfilled) {
    return {
      status: "ready-to-execute",
      label: "Oracle responded — ready to execute",
      result: 0n,
    };
  }
  return {
    status: "pending",
    label: "Waiting for cross-chain oracle response...",
    result: 0n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface UserBalances {
  /** Vault shares the user holds */
  shareBalance: bigint;
  /** Underlying token balance in wallet (for deposit input) */
  underlyingBalance: bigint;
  /** convertToAssets(shareBalance) — vault position value */
  estimatedAssets: bigint;
}

/**
 * Read the user's token balances relevant to a vault.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param user      User wallet address
 * @returns         Share balance, underlying wallet balance, and estimated assets
 */
export async function getUserBalances(
  provider: Provider,
  vault: string,
  user: string
): Promise<UserBalances> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const vaultIface    = new Interface(VAULT_ABI as unknown as string[]);
  const decimalsIface = new Interface(["function decimals() view returns (uint8)"]);

  // Batch 1: shareBalance, decimals, underlying address
  const b1Calls = [
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("balanceOf", [user]) },
    { target: vault, allowFailure: false, callData: decimalsIface.encodeFunctionData("decimals") },
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("asset") },
  ];

  const b1: { success: boolean; returnData: string }[] = await mc.aggregate3.staticCall(b1Calls);

  const shareBalance = vaultIface.decodeFunctionResult("balanceOf", b1[0].returnData)[0] as bigint;
  const underlying   = vaultIface.decodeFunctionResult("asset",     b1[2].returnData)[0] as string;

  // Batch 2: underlying wallet balance + estimated assets (skip convertToAssets if no shares)
  const [underlyingBalance, estimatedAssets] = await Promise.all([
    (new Contract(underlying, ERC20_ABI, provider).balanceOf(user) as Promise<bigint>),
    shareBalance === 0n
      ? Promise.resolve(0n)
      : (new Contract(vault, VAULT_ABI, provider).convertToAssets(shareBalance) as Promise<bigint>),
  ]);

  return {
    shareBalance,
    underlyingBalance,
    estimatedAssets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MaxWithdrawable {
  /** How many shares can be redeemed right now */
  shares: bigint;
  /** How many underlying assets that corresponds to */
  assets: bigint;
}

/**
 * Calculate the maximum amount a user can withdraw from a vault right now.
 *
 * For hub vaults without oracle accounting, this is limited by hub liquidity.
 * For local and oracle vaults, all assets are immediately redeemable.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @param user      User wallet address
 * @returns         Maximum withdrawable shares and assets
 */
export async function getMaxWithdrawable(
  provider: Provider,
  vault: string,
  user: string
): Promise<MaxWithdrawable> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const configIface = new Interface(CONFIG_ABI as unknown as string[]);
  const bridgeIface = new Interface(BRIDGE_ABI as unknown as string[]);
  const vaultIface  = new Interface(VAULT_ABI as unknown as string[]);
  const erc20Iface  = new Interface(ERC20_ABI as unknown as string[]);

  // Batch 1: isHub, oraclesCrossChainAccounting, user share balance, underlying
  const b1Calls = [
    { target: vault, allowFailure: false, callData: configIface.encodeFunctionData("isHub") },
    { target: vault, allowFailure: false, callData: bridgeIface.encodeFunctionData("oraclesCrossChainAccounting") },
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("balanceOf", [user]) },
    { target: vault, allowFailure: false, callData: vaultIface.encodeFunctionData("asset") },
  ];

  const b1: { success: boolean; returnData: string }[] = await mc.aggregate3.staticCall(b1Calls);

  const isHub        = configIface.decodeFunctionResult("isHub",                       b1[0].returnData)[0] as boolean;
  const oraclesEnabled = bridgeIface.decodeFunctionResult("oraclesCrossChainAccounting", b1[1].returnData)[0] as boolean;
  const userShares   = vaultIface.decodeFunctionResult("balanceOf", b1[2].returnData)[0] as bigint;
  const underlying   = vaultIface.decodeFunctionResult("asset",     b1[3].returnData)[0] as string;

  if (userShares === 0n) {
    return { shares: 0n, assets: 0n };
  }

  // Batch 2: estimated assets + hub liquid balance
  const b2Calls = [
    { target: vault,      allowFailure: false, callData: vaultIface.encodeFunctionData("convertToAssets", [userShares]) },
    { target: underlying, allowFailure: false, callData: erc20Iface.encodeFunctionData("balanceOf", [vault]) },
  ];

  const b2: { success: boolean; returnData: string }[] = await mc.aggregate3.staticCall(b2Calls);

  const estimatedAssets  = vaultIface.decodeFunctionResult("convertToAssets", b2[0].returnData)[0] as bigint;
  const hubLiquidBalance = erc20Iface.decodeFunctionResult("balanceOf",       b2[1].returnData)[0] as bigint;

  let maxAssets: bigint;
  if (isHub && !oraclesEnabled) {
    maxAssets = estimatedAssets < hubLiquidBalance ? estimatedAssets : hubLiquidBalance;
  } else {
    maxAssets = estimatedAssets;
  }

  let maxShares: bigint;
  if (maxAssets < estimatedAssets) {
    const vaultContract = new Contract(vault, VAULT_ABI, provider);
    maxShares = await (vaultContract.convertToShares(maxAssets) as Promise<bigint>);
  } else {
    maxShares = userShares;
  }

  return {
    shares: maxShares,
    assets: maxAssets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export type VaultSummary = VaultStatus & VaultMetadata;

/**
 * Get a combined snapshot of vault status and metadata in one call.
 *
 * @param provider  Read-only provider
 * @param vault     Vault address
 * @returns         Merged VaultStatus and VaultMetadata
 */
export async function getVaultSummary(
  provider: Provider,
  vault: string
): Promise<VaultSummary> {
  const [status, metadata] = await Promise.all([
    getVaultStatus(provider, vault),
    getVaultMetadata(provider, vault),
  ]);
  return { ...status, ...metadata };
}
