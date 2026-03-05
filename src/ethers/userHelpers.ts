/**
 * User-facing helper functions for the MoreVaults ethers.js v6 SDK.
 *
 * All functions use Provider (read-only). None send transactions.
 */

import { Contract } from "ethers";
import type { Provider } from "ethers";
import { BRIDGE_ABI, CONFIG_ABI, VAULT_ABI, METADATA_ABI } from "./abis";
import type { CrossChainRequestInfo } from "./types";

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
  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  const metadataContract = new Contract(vault, METADATA_ABI, provider);

  // First batch: balance, decimals, withdrawal request (all independent)
  const [shares, decimals, withdrawalRequest, block] = await Promise.all([
    vaultContract.balanceOf(user) as Promise<bigint>,
    metadataContract.decimals() as Promise<number>,
    vaultContract.getWithdrawalRequest(user) as Promise<[bigint, bigint]>,
    provider.getBlock("latest"),
  ]);

  const [withdrawShares, timelockEndsAt] = withdrawalRequest;

  // Second batch: convertToAssets calls (need shares and decimals from first batch)
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

  const [isPaused, maxDepositAmount] = await Promise.all([
    config.paused() as Promise<boolean>,
    config.maxDeposit(user) as Promise<bigint>,
  ]);

  if (isPaused) {
    return { allowed: false, reason: "paused" };
  }
  if (maxDepositAmount === 0n) {
    // maxDeposit returns 0 both when capacity is full and when user is not whitelisted
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
  const metadata = new Contract(vault, METADATA_ABI, provider);
  const vaultContract = new Contract(vault, VAULT_ABI, provider);

  // First batch: vault metadata (all independent)
  const [name, symbol, rawDecimals, underlying] = await Promise.all([
    metadata.name() as Promise<string>,
    metadata.symbol() as Promise<string>,
    metadata.decimals() as Promise<bigint>,
    vaultContract.asset() as Promise<string>,
  ]);
  const decimals = Number(rawDecimals);

  // Second batch: underlying token metadata (needs underlying address)
  const underlyingMetadata = new Contract(underlying, METADATA_ABI, provider);
  const [underlyingSymbol, rawUnderlyingDecimals] = await Promise.all([
    underlyingMetadata.symbol() as Promise<string>,
    underlyingMetadata.decimals() as Promise<bigint>,
  ]);
  const underlyingDecimals = Number(rawUnderlyingDecimals);

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
