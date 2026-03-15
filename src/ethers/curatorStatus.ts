/**
 * Curator / vault-manager read helpers for the MoreVaults ethers.js v6 SDK.
 *
 * All functions are read-only (no wallet needed) and use Multicall3 for
 * batched RPC efficiency.
 */

import { Contract, Interface } from "ethers";
import type { Provider } from "ethers";
import {
  MULTICALL_ABI,
  CURATOR_CONFIG_ABI,
  VAULT_ANALYSIS_ABI,
  REGISTRY_ABI,
  METADATA_ABI,
  ERC20_ABI,
  VAULT_ABI,
} from "./abis";
import type {
  CuratorVaultStatus,
  PendingAction,
  VaultAnalysis,
  AssetInfo,
  AssetBalance,
  VaultAssetBreakdown,
} from "./types";

// Multicall3 — deployed at the same address on every EVM chain
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
] as const;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a comprehensive status snapshot for the curator dashboard.
 *
 * Fetches in one multicall batch:
 *   curator, timeLockPeriod, getMaxSlippagePercent, getCurrentNonce,
 *   getAvailableAssets, getCrossChainAccountingManager, paused
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy)
 * @returns         CuratorVaultStatus snapshot
 */
export async function getCuratorVaultStatus(
  provider: Provider,
  vault: string
): Promise<CuratorVaultStatus> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const curatorConfigIface = new Interface(CURATOR_CONFIG_ABI as unknown as string[]);
  const multicallIface = new Interface(MULTICALL_ABI as unknown as string[]);

  const calls = [
    { target: vault, allowFailure: false, callData: curatorConfigIface.encodeFunctionData("curator") },
    { target: vault, allowFailure: false, callData: curatorConfigIface.encodeFunctionData("timeLockPeriod") },
    { target: vault, allowFailure: false, callData: curatorConfigIface.encodeFunctionData("getMaxSlippagePercent") },
    { target: vault, allowFailure: false, callData: multicallIface.encodeFunctionData("getCurrentNonce") },
    { target: vault, allowFailure: false, callData: curatorConfigIface.encodeFunctionData("getAvailableAssets") },
    { target: vault, allowFailure: false, callData: curatorConfigIface.encodeFunctionData("getCrossChainAccountingManager") },
    { target: vault, allowFailure: false, callData: curatorConfigIface.encodeFunctionData("paused") },
  ];

  const results: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(calls);

  const curator = curatorConfigIface.decodeFunctionResult("curator", results[0].returnData)[0] as string;
  const timeLockPeriod = curatorConfigIface.decodeFunctionResult("timeLockPeriod", results[1].returnData)[0] as bigint;
  const maxSlippagePercent = curatorConfigIface.decodeFunctionResult("getMaxSlippagePercent", results[2].returnData)[0] as bigint;
  const currentNonce = multicallIface.decodeFunctionResult("getCurrentNonce", results[3].returnData)[0] as bigint;
  const availableAssets = curatorConfigIface.decodeFunctionResult("getAvailableAssets", results[4].returnData)[0] as string[];
  const lzAdapter = curatorConfigIface.decodeFunctionResult("getCrossChainAccountingManager", results[5].returnData)[0] as string;
  const paused = curatorConfigIface.decodeFunctionResult("paused", results[6].returnData)[0] as boolean;

  return {
    curator,
    timeLockPeriod,
    maxSlippagePercent,
    currentNonce,
    availableAssets,
    lzAdapter,
    paused,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch pending actions for a specific nonce and resolve whether they are
 * executable (i.e. the timelock has expired).
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy)
 * @param nonce     Action nonce to query
 * @returns         PendingAction with isExecutable flag set
 */
export async function getPendingActions(
  provider: Provider,
  vault: string,
  nonce: bigint
): Promise<PendingAction> {
  const multicallContract = new Contract(vault, MULTICALL_ABI, provider);

  const [result, block] = await Promise.all([
    multicallContract.getPendingActions(nonce) as Promise<[string[], bigint]>,
    provider.getBlock("latest"),
  ]);

  const [actionsData, pendingUntil] = result;
  const currentTimestamp = BigInt(block!.timestamp);
  const isExecutable = pendingUntil > 0n && currentTimestamp >= pendingUntil;

  return {
    nonce,
    actionsData,
    pendingUntil,
    isExecutable,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a given address is the curator of the vault.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy)
 * @param address   Address to check
 * @returns         true if address is the current curator
 */
export async function isCurator(
  provider: Provider,
  vault: string,
  address: string
): Promise<boolean> {
  const config = new Contract(vault, CURATOR_CONFIG_ABI, provider);
  const curatorAddress = (await config.curator()) as string;
  return curatorAddress.toLowerCase() === address.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full vault analysis — available assets with metadata, depositable assets, whitelist config.
 * Useful for curator dashboards to understand what the vault can do.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy)
 * @returns         VaultAnalysis snapshot
 */
export async function getVaultAnalysis(
  provider: Provider,
  vault: string
): Promise<VaultAnalysis> {
  const analysisContract = new Contract(vault, VAULT_ANALYSIS_ABI, provider);

  // Batch 1: fetch asset lists, whitelist flag, and registry address in parallel
  const [availableRaw, depositableRaw, depositWhitelistEnabled, registryResult] =
    await Promise.all([
      analysisContract.getAvailableAssets() as Promise<string[]>,
      analysisContract.getDepositableAssets() as Promise<string[]>,
      analysisContract.isDepositWhitelistEnabled() as Promise<boolean>,
      (analysisContract.moreVaultsRegistry() as Promise<string>).catch(() => null),
    ]);

  const availableAddresses = availableRaw as string[];
  const depositableAddresses = depositableRaw as string[];

  // Deduplicated set of all asset addresses we need metadata for
  const allAddresses = Array.from(new Set([...availableAddresses, ...depositableAddresses]));

  // Batch 2: multicall for name/symbol/decimals on all unique assets
  const assetInfoMap = new Map<string, AssetInfo>();

  if (allAddresses.length > 0) {
    const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    const metaIface = new Interface(METADATA_ABI as unknown as string[]);

    const metadataCalls = allAddresses.flatMap((addr) => [
      { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("name") },
      { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
      { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
    ]);

    const metadataResults: { success: boolean; returnData: string }[] =
      await mc.aggregate3.staticCall(metadataCalls);

    for (let i = 0; i < allAddresses.length; i++) {
      const addr = allAddresses[i];
      const nameRes    = metadataResults[i * 3];
      const symbolRes  = metadataResults[i * 3 + 1];
      const decimalsRes = metadataResults[i * 3 + 2];

      const name     = nameRes.success     ? (metaIface.decodeFunctionResult("name",     nameRes.returnData)[0] as string)    : '';
      const symbol   = symbolRes.success   ? (metaIface.decodeFunctionResult("symbol",   symbolRes.returnData)[0] as string)  : '';
      const decimals = decimalsRes.success ? (Number(metaIface.decodeFunctionResult("decimals", decimalsRes.returnData)[0]))  : 18;

      assetInfoMap.set(addr.toLowerCase(), { address: addr, name, symbol, decimals });
    }
  }

  const registryAddress = registryResult ? (registryResult as string) : null;

  return {
    availableAssets:        availableAddresses.map((a) => assetInfoMap.get(a.toLowerCase())!),
    depositableAssets:      depositableAddresses.map((a) => assetInfoMap.get(a.toLowerCase())!),
    depositWhitelistEnabled: depositWhitelistEnabled as boolean,
    registryAddress,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if specific protocol addresses are whitelisted in the global registry.
 * Useful for curators to verify DEX routers before building swap calldata.
 *
 * @param provider   Read-only provider (must be on the vault's chain)
 * @param vault      Vault address (diamond proxy)
 * @param protocols  Protocol addresses to check
 * @returns          Record mapping address → whitelisted boolean
 */
export async function checkProtocolWhitelist(
  provider: Provider,
  vault: string,
  protocols: string[]
): Promise<Record<string, boolean>> {
  const analysisContract = new Contract(vault, VAULT_ANALYSIS_ABI, provider);
  const registry = (await analysisContract.moreVaultsRegistry()) as string;

  if (protocols.length === 0) return {};

  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const registryIface = new Interface(REGISTRY_ABI as unknown as string[]);

  const calls = protocols.map((protocol) => ({
    target: registry,
    allowFailure: true,
    callData: registryIface.encodeFunctionData("isWhitelisted", [protocol]),
  }));

  const results: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(calls);

  const out: Record<string, boolean> = {};
  for (let i = 0; i < protocols.length; i++) {
    const r = results[i];
    const whitelisted = r.success
      ? (registryIface.decodeFunctionResult("isWhitelisted", r.returnData)[0] as boolean)
      : false;
    out[protocols[i].toLowerCase()] = whitelisted;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the vault's per-asset balance breakdown on the hub chain.
 *
 * Returns the balance of every available asset held by the vault, plus
 * totalAssets and totalSupply for context. Useful for portfolio views
 * that need to show individual holdings rather than a single USD-denominated total.
 *
 * @param provider  Read-only provider (must be on the vault's hub chain)
 * @param vault     Vault address (diamond proxy)
 * @returns         VaultAssetBreakdown with per-asset balances
 */
export async function getVaultAssetBreakdown(
  provider: Provider,
  vault: string
): Promise<VaultAssetBreakdown> {
  // Step 1: get available assets list
  const analysisContract = new Contract(vault, VAULT_ANALYSIS_ABI, provider);
  const availableRaw = (await analysisContract.getAvailableAssets()) as string[];
  const addresses = availableRaw as string[];

  // Step 2: multicall — balanceOf + metadata for each asset + totalAssets + totalSupply + vault decimals
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const vaultIface  = new Interface(VAULT_ABI as unknown as string[]);
  const metaIface   = new Interface(METADATA_ABI as unknown as string[]);
  const erc20Iface  = new Interface(ERC20_ABI as unknown as string[]);

  const perAssetCalls = addresses.flatMap((addr) => [
    { target: addr, allowFailure: true, callData: erc20Iface.encodeFunctionData("balanceOf", [vault]) },
    { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("name") },
    { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
    { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
  ]);

  const totalCalls = [
    ...perAssetCalls,
    { target: vault, allowFailure: true, callData: vaultIface.encodeFunctionData("totalAssets") },
    { target: vault, allowFailure: true, callData: vaultIface.encodeFunctionData("totalSupply") },
    { target: vault, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
  ];

  const results: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(totalCalls);

  const perAssetFields = 4; // balanceOf, name, symbol, decimals
  const assets: AssetBalance[] = addresses.map((addr, i) => {
    const base = i * perAssetFields;
    const balance  = results[base].success     ? (erc20Iface.decodeFunctionResult("balanceOf", results[base].returnData)[0] as bigint)       : 0n;
    const name     = results[base + 1].success ? (metaIface.decodeFunctionResult("name",     results[base + 1].returnData)[0] as string)      : '';
    const symbol   = results[base + 2].success ? (metaIface.decodeFunctionResult("symbol",   results[base + 2].returnData)[0] as string)      : '';
    const decimals = results[base + 3].success ? (Number(metaIface.decodeFunctionResult("decimals", results[base + 3].returnData)[0]))        : 18;

    return { address: addr, name, symbol, decimals, balance };
  });

  const totalsBase = addresses.length * perAssetFields;
  const totalAssets       = results[totalsBase].success     ? (vaultIface.decodeFunctionResult("totalAssets", results[totalsBase].returnData)[0] as bigint)       : 0n;
  const totalSupply       = results[totalsBase + 1].success ? (vaultIface.decodeFunctionResult("totalSupply", results[totalsBase + 1].returnData)[0] as bigint)   : 0n;
  const underlyingDecimals = results[totalsBase + 2].success ? (Number(metaIface.decodeFunctionResult("decimals", results[totalsBase + 2].returnData)[0]))        : 6;

  return { assets, totalAssets, totalSupply, underlyingDecimals };
}
