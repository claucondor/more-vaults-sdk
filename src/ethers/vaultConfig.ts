/**
 * Vault Configuration reader for the MoreVaults ethers.js v6 SDK (Phase 7).
 *
 * Single Multicall3 batch to fetch the complete admin/curator/guardian configuration.
 *
 * @module vaultConfig
 */

import { Contract, Interface, ZeroAddress } from "ethers";
import type { Provider } from "ethers";
import {
  ADMIN_CONFIG_ABI,
  ACCESS_CONTROL_ABI,
  CURATOR_CONFIG_ABI,
  CONFIG_ABI,
  VAULT_ANALYSIS_ABI,
  MULTICALL_ABI,
} from "./abis";
import type { VaultConfiguration } from "./types";

// Multicall3 -- deployed at the same address on every EVM chain
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI_FRAGMENT = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
] as const;

/**
 * Read the full vault configuration in a single batched Multicall3 call.
 *
 * Uses `allowFailure: true` so that fields not present on older vault
 * deployments fall back to sensible defaults.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy)
 * @returns         Complete VaultConfiguration snapshot
 */
export async function getVaultConfiguration(
  provider: Provider,
  vault: string,
): Promise<VaultConfiguration> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI_FRAGMENT, provider);

  const accessIface = new Interface(ACCESS_CONTROL_ABI as unknown as string[]);
  const curatorIface = new Interface(CURATOR_CONFIG_ABI as unknown as string[]);
  const adminIface = new Interface(ADMIN_CONFIG_ABI as unknown as string[]);
  const configIface = new Interface(CONFIG_ABI as unknown as string[]);
  const analysisIface = new Interface(VAULT_ANALYSIS_ABI as unknown as string[]);
  const multicallIface = new Interface(MULTICALL_ABI as unknown as string[]);

  const calls = [
    // 0: owner
    { target: vault, allowFailure: true, callData: accessIface.encodeFunctionData("owner") },
    // 1: pendingOwner
    { target: vault, allowFailure: true, callData: accessIface.encodeFunctionData("pendingOwner") },
    // 2: curator
    { target: vault, allowFailure: true, callData: curatorIface.encodeFunctionData("curator") },
    // 3: guardian
    { target: vault, allowFailure: true, callData: accessIface.encodeFunctionData("guardian") },
    // 4: fee
    { target: vault, allowFailure: true, callData: adminIface.encodeFunctionData("fee") },
    // 5: withdrawalFee
    { target: vault, allowFailure: true, callData: adminIface.encodeFunctionData("getWithdrawalFee") },
    // 6: feeRecipient
    { target: vault, allowFailure: true, callData: adminIface.encodeFunctionData("feeRecipient") },
    // 7: depositCapacity
    { target: vault, allowFailure: true, callData: adminIface.encodeFunctionData("depositCapacity") },
    // 8: maxSlippagePercent
    { target: vault, allowFailure: true, callData: curatorIface.encodeFunctionData("getMaxSlippagePercent") },
    // 9: timeLockPeriod
    { target: vault, allowFailure: true, callData: curatorIface.encodeFunctionData("timeLockPeriod") },
    // 10: currentNonce
    { target: vault, allowFailure: true, callData: multicallIface.encodeFunctionData("getCurrentNonce") },
    // 11: withdrawalQueueStatus
    { target: vault, allowFailure: true, callData: configIface.encodeFunctionData("getWithdrawalQueueStatus") },
    // 12: withdrawalTimelock
    { target: vault, allowFailure: true, callData: configIface.encodeFunctionData("getWithdrawalTimelock") },
    // 13: maxWithdrawalDelay
    { target: vault, allowFailure: true, callData: adminIface.encodeFunctionData("getMaxWithdrawalDelay") },
    // 14: depositWhitelistEnabled
    { target: vault, allowFailure: true, callData: analysisIface.encodeFunctionData("isDepositWhitelistEnabled") },
    // 15: availableAssets
    { target: vault, allowFailure: true, callData: curatorIface.encodeFunctionData("getAvailableAssets") },
    // 16: depositableAssets
    { target: vault, allowFailure: true, callData: analysisIface.encodeFunctionData("getDepositableAssets") },
    // 17: ccManager
    { target: vault, allowFailure: true, callData: configIface.encodeFunctionData("getCrossChainAccountingManager") },
    // 18: escrow
    { target: vault, allowFailure: true, callData: configIface.encodeFunctionData("getEscrow") },
    // 19: isHub
    { target: vault, allowFailure: true, callData: configIface.encodeFunctionData("isHub") },
    // 20: paused
    { target: vault, allowFailure: true, callData: configIface.encodeFunctionData("paused") },
    // 21: registry
    { target: vault, allowFailure: true, callData: analysisIface.encodeFunctionData("moreVaultsRegistry") },
  ];

  const results: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(calls);

  function decodeAddr(i: number, iface: Interface, fn: string): string {
    if (!results[i].success) return ZeroAddress;
    return iface.decodeFunctionResult(fn, results[i].returnData)[0] as string;
  }
  function decodeBigint(i: number, iface: Interface, fn: string): bigint {
    if (!results[i].success) return 0n;
    return iface.decodeFunctionResult(fn, results[i].returnData)[0] as bigint;
  }
  function decodeBool(i: number, iface: Interface, fn: string): boolean {
    if (!results[i].success) return false;
    return iface.decodeFunctionResult(fn, results[i].returnData)[0] as boolean;
  }
  function decodeNum(i: number, iface: Interface, fn: string): number {
    if (!results[i].success) return 0;
    return Number(iface.decodeFunctionResult(fn, results[i].returnData)[0]);
  }
  function decodeAddrArray(i: number, iface: Interface, fn: string): string[] {
    if (!results[i].success) return [];
    return iface.decodeFunctionResult(fn, results[i].returnData)[0] as string[];
  }

  const ccManager = decodeAddr(17, configIface, "getCrossChainAccountingManager");

  return {
    // Roles
    owner: decodeAddr(0, accessIface, "owner"),
    pendingOwner: decodeAddr(1, accessIface, "pendingOwner"),
    curator: decodeAddr(2, curatorIface, "curator"),
    guardian: decodeAddr(3, accessIface, "guardian"),
    // Fees
    fee: decodeBigint(4, adminIface, "fee"),
    withdrawalFee: decodeBigint(5, adminIface, "getWithdrawalFee"),
    feeRecipient: decodeAddr(6, adminIface, "feeRecipient"),
    // Capacity & limits
    depositCapacity: decodeBigint(7, adminIface, "depositCapacity"),
    maxSlippagePercent: decodeBigint(8, curatorIface, "getMaxSlippagePercent"),
    // Timelock
    timeLockPeriod: decodeBigint(9, curatorIface, "timeLockPeriod"),
    currentNonce: decodeBigint(10, multicallIface, "getCurrentNonce"),
    // Withdrawal config
    withdrawalQueueEnabled: decodeBool(11, configIface, "getWithdrawalQueueStatus"),
    withdrawalTimelock: decodeBigint(12, configIface, "getWithdrawalTimelock"),
    maxWithdrawalDelay: decodeNum(13, adminIface, "getMaxWithdrawalDelay"),
    // Whitelist
    depositWhitelistEnabled: decodeBool(14, analysisIface, "isDepositWhitelistEnabled"),
    // Asset lists
    availableAssets: decodeAddrArray(15, curatorIface, "getAvailableAssets"),
    depositableAssets: decodeAddrArray(16, analysisIface, "getDepositableAssets"),
    // Cross-chain
    ccManager,
    lzAdapter: ccManager,
    escrow: decodeAddr(18, configIface, "getEscrow"),
    isHub: decodeBool(19, configIface, "isHub"),
    // State
    paused: decodeBool(20, configIface, "paused"),
    // Registry
    registry: decodeAddr(21, analysisIface, "moreVaultsRegistry"),
  };
}
