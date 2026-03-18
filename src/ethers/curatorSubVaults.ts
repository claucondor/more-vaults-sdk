/**
 * Curator sub-vault read helpers for the MoreVaults ethers.js v6 SDK (Phase 5).
 *
 * Provides portfolio views and sub-vault analysis for curator dashboards.
 * Supports both ERC4626 (synchronous) and ERC7540 (asynchronous) sub-vaults.
 *
 * All functions are read-only (no wallet needed) and use Multicall3 for
 * batched RPC efficiency.
 */

import { Contract, Interface, ethers } from "ethers";
import type { Provider } from "ethers";
import {
  SUB_VAULT_ABI,
  ERC20_ABI,
  METADATA_ABI,
  VAULT_ABI,
  VAULT_ANALYSIS_ABI,
  REGISTRY_ABI,
} from "./abis";
import { MoreVaultsError } from "./errors";
import type {
  SubVaultPosition,
  SubVaultInfo,
  ERC7540RequestStatus,
  VaultPortfolio,
  AssetBalance,
  ChainPortfolio,
  MultiChainPortfolio,
} from "./types";
import { discoverVaultTopology } from "./topology";
import { createChainProvider } from "./chains";

// Multicall3 — deployed at the same address on every EVM chain
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
] as const;

/** keccak256("ERC4626_ID") — type ID for synchronous ERC4626 sub-vaults */
const ERC4626_ID = ethers.keccak256(ethers.toUtf8Bytes("ERC4626_ID"));

/** keccak256("ERC7540_ID") — type ID for asynchronous ERC7540 sub-vaults */
const ERC7540_ID = ethers.keccak256(ethers.toUtf8Bytes("ERC7540_ID"));

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get active sub-vault positions held by the vault.
 *
 * Queries the vault's `tokensHeld` for ERC4626 and ERC7540 type IDs, then
 * fetches balances, underlying values, and token metadata for each sub-vault.
 * Sub-vaults with zero share balance are excluded.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy)
 * @returns         Array of active SubVaultPosition objects
 */
export async function getSubVaultPositions(
  provider: Provider,
  vault: string
): Promise<SubVaultPosition[]> {
  const subVaultIface = new Interface(SUB_VAULT_ABI as unknown as string[]);
  const vaultContract = new Contract(vault, SUB_VAULT_ABI as unknown as string[], provider);

  // Step 1: fetch sub-vault lists by type in parallel
  const [erc4626Raw, erc7540Raw] = await Promise.all([
    (vaultContract.tokensHeld(ERC4626_ID) as Promise<string[]>).catch(() => [] as string[]),
    (vaultContract.tokensHeld(ERC7540_ID) as Promise<string[]>).catch(() => [] as string[]),
  ]);

  const allSubVaults: Array<{ address: string; type: "erc4626" | "erc7540" }> = [
    ...erc4626Raw.map((a) => ({ address: a, type: "erc4626" as const })),
    ...erc7540Raw.map((a) => ({ address: a, type: "erc7540" as const })),
  ];

  if (allSubVaults.length === 0) return [];

  // Step 2: multicall — balanceOf(vault), asset(), name(), symbol(), decimals() per sub-vault
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const erc20Iface = new Interface(ERC20_ABI as unknown as string[]);
  const metaIface  = new Interface(METADATA_ABI as unknown as string[]);
  const vaultIface = new Interface(VAULT_ABI as unknown as string[]);

  const PER_SV = 5;
  const subVaultCalls = allSubVaults.flatMap(({ address: sv }) => [
    { target: sv, allowFailure: true, callData: erc20Iface.encodeFunctionData("balanceOf", [vault]) },
    { target: sv, allowFailure: true, callData: vaultIface.encodeFunctionData("asset") },
    { target: sv, allowFailure: true, callData: metaIface.encodeFunctionData("name") },
    { target: sv, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
    { target: sv, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
  ]);

  const subVaultResults: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(subVaultCalls);

  interface PartialSV {
    address: string;
    type: "erc4626" | "erc7540";
    sharesBalance: bigint;
    underlyingAsset: string;
    name: string;
    symbol: string;
    decimals: number;
  }

  const partials: PartialSV[] = allSubVaults.map(({ address: sv, type }, i) => {
    const base = i * PER_SV;
    const sharesBalance = subVaultResults[base].success
      ? (erc20Iface.decodeFunctionResult("balanceOf", subVaultResults[base].returnData)[0] as bigint)
      : 0n;
    const underlyingAsset = subVaultResults[base + 1].success
      ? (vaultIface.decodeFunctionResult("asset", subVaultResults[base + 1].returnData)[0] as string)
      : ethers.ZeroAddress;
    const name     = subVaultResults[base + 2].success ? (metaIface.decodeFunctionResult("name",     subVaultResults[base + 2].returnData)[0] as string) : "";
    const symbol   = subVaultResults[base + 3].success ? (metaIface.decodeFunctionResult("symbol",   subVaultResults[base + 3].returnData)[0] as string) : "";
    const decimals = subVaultResults[base + 4].success ? (Number(metaIface.decodeFunctionResult("decimals", subVaultResults[base + 4].returnData)[0])) : 18;

    return { address: sv, type, sharesBalance, underlyingAsset, name, symbol, decimals };
  });

  // Filter to positions with non-zero balance
  const active = partials.filter((p) => p.sharesBalance > 0n);
  if (active.length === 0) return [];

  // Step 3: multicall — convertToAssets(shares) + underlying metadata per active position
  const PER_ACTIVE = 4;
  const activeCalls = active.flatMap(({ address: sv, sharesBalance, underlyingAsset }) => [
    { target: sv, allowFailure: true, callData: subVaultIface.encodeFunctionData("convertToAssets", [sharesBalance]) },
    { target: underlyingAsset, allowFailure: true, callData: metaIface.encodeFunctionData("name") },
    { target: underlyingAsset, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
    { target: underlyingAsset, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
  ]);

  const activeResults: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(activeCalls);

  return active.map((p, i): SubVaultPosition => {
    const base = i * PER_ACTIVE;
    const underlyingValue    = activeResults[base].success
      ? (subVaultIface.decodeFunctionResult("convertToAssets", activeResults[base].returnData)[0] as bigint)
      : 0n;
    const underlyingSymbol   = activeResults[base + 2].success ? (metaIface.decodeFunctionResult("symbol",   activeResults[base + 2].returnData)[0] as string) : "";
    const underlyingDecimals = activeResults[base + 3].success ? (Number(metaIface.decodeFunctionResult("decimals", activeResults[base + 3].returnData)[0])) : 18;

    return {
      address: p.address,
      type: p.type,
      name: p.name,
      symbol: p.symbol,
      decimals: p.decimals,
      sharesBalance: p.sharesBalance,
      underlyingValue,
      underlyingAsset: p.underlyingAsset,
      underlyingSymbol,
      underlyingDecimals,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a contract is an ERC7540, ERC4626, or unknown vault type.
 *
 * Tries to call ERC7540-specific functions first (pendingDepositRequest).
 * Falls back to ERC4626 convertToAssets(0). Returns null if neither succeeds.
 *
 * @param provider  Read-only provider (must be on the same chain as subVault)
 * @param subVault  Sub-vault contract address to probe
 * @returns         'erc7540' | 'erc4626' | null
 */
export async function detectSubVaultType(
  provider: Provider,
  subVault: string
): Promise<"erc4626" | "erc7540" | null> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const subVaultIface = new Interface(SUB_VAULT_ABI as unknown as string[]);

  const calls = [
    {
      target: subVault,
      allowFailure: true,
      callData: subVaultIface.encodeFunctionData("pendingDepositRequest", [0n, ethers.ZeroAddress]),
    },
    {
      target: subVault,
      allowFailure: true,
      callData: subVaultIface.encodeFunctionData("convertToAssets", [0n]),
    },
  ];

  const results: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(calls);

  if (results[0].success) return "erc7540";
  if (results[1].success) return "erc4626";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse a specific sub-vault to understand deposit limits, metadata, type,
 * and global-registry whitelist status.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address (diamond proxy) — used to check maxDeposit
 * @param subVault  Sub-vault address to analyse
 * @returns         SubVaultInfo snapshot
 */
export async function getSubVaultInfo(
  provider: Provider,
  vault: string,
  subVault: string
): Promise<SubVaultInfo> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const subVaultIface     = new Interface(SUB_VAULT_ABI as unknown as string[]);
  const metaIface         = new Interface(METADATA_ABI as unknown as string[]);
  const vaultIface        = new Interface(VAULT_ABI as unknown as string[]);
  const registryIface     = new Interface(REGISTRY_ABI as unknown as string[]);
  const vaultAnalysisIface = new Interface(VAULT_ANALYSIS_ABI as unknown as string[]);

  // Detect type and fetch basic metadata in parallel
  const [type, basicResults] = await Promise.all([
    detectSubVaultType(provider, subVault),
    mc.aggregate3.staticCall([
      { target: subVault, allowFailure: true, callData: metaIface.encodeFunctionData("name") },
      { target: subVault, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
      { target: subVault, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
      { target: subVault, allowFailure: true, callData: vaultIface.encodeFunctionData("asset") },
      { target: subVault, allowFailure: true, callData: subVaultIface.encodeFunctionData("maxDeposit", [vault]) },
    ]) as Promise<{ success: boolean; returnData: string }[]>,
  ]);

  const name       = basicResults[0].success ? (metaIface.decodeFunctionResult("name",     basicResults[0].returnData)[0] as string) : "";
  const symbol     = basicResults[1].success ? (metaIface.decodeFunctionResult("symbol",   basicResults[1].returnData)[0] as string) : "";
  const decimals   = basicResults[2].success ? (Number(metaIface.decodeFunctionResult("decimals", basicResults[2].returnData)[0])) : 18;
  const underlying = basicResults[3].success ? (vaultIface.decodeFunctionResult("asset",   basicResults[3].returnData)[0] as string) : ethers.ZeroAddress;
  const maxDeposit = basicResults[4].success ? (subVaultIface.decodeFunctionResult("maxDeposit", basicResults[4].returnData)[0] as bigint) : 0n;

  // Fetch underlying metadata and registry in parallel
  const [underlyingResults, registryRaw] = await Promise.all([
    mc.aggregate3.staticCall([
      { target: underlying, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
      { target: underlying, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
    ]) as Promise<{ success: boolean; returnData: string }[]>,
    new Contract(vault, VAULT_ANALYSIS_ABI as unknown as string[], provider)
      .moreVaultsRegistry()
      .catch(() => null) as Promise<string | null>,
  ]);

  const underlyingSymbol   = underlyingResults[0].success ? (metaIface.decodeFunctionResult("symbol",   underlyingResults[0].returnData)[0] as string) : "";
  const underlyingDecimals = underlyingResults[1].success ? (Number(metaIface.decodeFunctionResult("decimals", underlyingResults[1].returnData)[0])) : 18;

  let isWhitelisted = false;
  if (registryRaw) {
    const whitelistResult = await (new Contract(registryRaw, REGISTRY_ABI as unknown as string[], provider)
      .isWhitelisted(subVault) as Promise<boolean>)
      .catch(() => false);
    isWhitelisted = whitelistResult;
  }

  return {
    address: subVault,
    type: type ?? "erc4626",
    name,
    symbol,
    decimals,
    underlyingAsset: underlying,
    underlyingSymbol,
    underlyingDecimals,
    maxDeposit,
    isWhitelisted,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the ERC7540 async request status for a specific sub-vault and vault controller.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Vault address acting as controller in the sub-vault
 * @param subVault  ERC7540 sub-vault address
 * @returns         ERC7540RequestStatus with canFinalize flags
 */
export async function getERC7540RequestStatus(
  provider: Provider,
  vault: string,
  subVault: string
): Promise<ERC7540RequestStatus> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const subVaultIface = new Interface(SUB_VAULT_ABI as unknown as string[]);

  const calls = [
    { target: subVault, allowFailure: true, callData: subVaultIface.encodeFunctionData("pendingDepositRequest",   [0n, vault]) },
    { target: subVault, allowFailure: true, callData: subVaultIface.encodeFunctionData("claimableDepositRequest", [0n, vault]) },
    { target: subVault, allowFailure: true, callData: subVaultIface.encodeFunctionData("pendingRedeemRequest",    [0n, vault]) },
    { target: subVault, allowFailure: true, callData: subVaultIface.encodeFunctionData("claimableRedeemRequest",  [0n, vault]) },
  ];

  const results: { success: boolean; returnData: string }[] =
    await mc.aggregate3.staticCall(calls);

  const pendingDeposit   = results[0].success ? (subVaultIface.decodeFunctionResult("pendingDepositRequest",   results[0].returnData)[0] as bigint) : 0n;
  const claimableDeposit = results[1].success ? (subVaultIface.decodeFunctionResult("claimableDepositRequest", results[1].returnData)[0] as bigint) : 0n;
  const pendingRedeem    = results[2].success ? (subVaultIface.decodeFunctionResult("pendingRedeemRequest",    results[2].returnData)[0] as bigint) : 0n;
  const claimableRedeem  = results[3].success ? (subVaultIface.decodeFunctionResult("claimableRedeemRequest",  results[3].returnData)[0] as bigint) : 0n;

  return {
    subVault,
    pendingDeposit,
    claimableDeposit,
    pendingRedeem,
    claimableRedeem,
    canFinalizeDeposit: claimableDeposit > 0n,
    canFinalizeRedeem:  claimableRedeem  > 0n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many shares the vault would receive for a given asset deposit.
 *
 * @param provider  Read-only provider
 * @param subVault  Sub-vault address (ERC4626 or ERC7540)
 * @param assets    Amount of underlying assets to preview
 * @returns         Expected shares to be minted
 */
export async function previewSubVaultDeposit(
  provider: Provider,
  subVault: string,
  assets: bigint
): Promise<bigint> {
  const contract = new Contract(subVault, SUB_VAULT_ABI as unknown as string[], provider);
  try {
    return (await contract.previewDeposit(assets)) as bigint;
  } catch (err) {
    throw new MoreVaultsError(`previewSubVaultDeposit failed for ${subVault}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many underlying assets would be returned for redeeming shares.
 *
 * @param provider  Read-only provider
 * @param subVault  Sub-vault address (ERC4626 or ERC7540)
 * @param shares    Number of shares to preview redemption for
 * @returns         Expected underlying assets to be returned
 */
export async function previewSubVaultRedeem(
  provider: Provider,
  subVault: string,
  shares: bigint
): Promise<bigint> {
  const contract = new Contract(subVault, SUB_VAULT_ABI as unknown as string[], provider);
  try {
    return (await contract.previewRedeem(shares)) as bigint;
  } catch (err) {
    throw new MoreVaultsError(`previewSubVaultRedeem failed for ${subVault}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the complete portfolio view for a vault, combining liquid asset balances
 * with active sub-vault positions and locked ERC7540 assets.
 *
 * @param provider  Read-only provider (must be on the vault's hub chain)
 * @param vault     Vault address (diamond proxy)
 * @returns         VaultPortfolio with full breakdown
 */
export async function getVaultPortfolio(
  provider: Provider,
  vault: string
): Promise<VaultPortfolio> {
  const mc = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const subVaultIface      = new Interface(SUB_VAULT_ABI as unknown as string[]);
  const vaultAnalysisIface = new Interface(VAULT_ANALYSIS_ABI as unknown as string[]);
  const vaultIface         = new Interface(VAULT_ABI as unknown as string[]);
  const erc20Iface         = new Interface(ERC20_ABI as unknown as string[]);
  const metaIface          = new Interface(METADATA_ABI as unknown as string[]);

  // Step 1: get available assets, sub-vault positions, and vault totals in parallel
  const [availableRaw, subVaultPositions, vaultTotals] = await Promise.all([
    (new Contract(vault, VAULT_ANALYSIS_ABI as unknown as string[], provider).getAvailableAssets() as Promise<string[]>)
      .catch(() => [] as string[]),
    getSubVaultPositions(provider, vault),
    mc.aggregate3.staticCall([
      { target: vault, allowFailure: true, callData: vaultIface.encodeFunctionData("totalAssets") },
      { target: vault, allowFailure: true, callData: vaultIface.encodeFunctionData("totalSupply") },
      { target: vault, allowFailure: true, callData: vaultIface.encodeFunctionData("asset") },
    ]) as Promise<{ success: boolean; returnData: string }[]>,
  ]);

  const totalAssets     = vaultTotals[0].success ? (vaultIface.decodeFunctionResult("totalAssets", vaultTotals[0].returnData)[0] as bigint) : 0n;
  const totalSupply     = vaultTotals[1].success ? (vaultIface.decodeFunctionResult("totalSupply", vaultTotals[1].returnData)[0] as bigint) : 0n;
  const underlyingAsset = vaultTotals[2].success ? (vaultIface.decodeFunctionResult("asset",       vaultTotals[2].returnData)[0] as string) : ethers.ZeroAddress;

  // Exclude sub-vault share addresses from liquid asset list
  const subVaultAddressSet = new Set(subVaultPositions.map((p) => p.address.toLowerCase()));
  const liquidAddresses = (availableRaw as string[]).filter(
    (addr) => !subVaultAddressSet.has(addr.toLowerCase()),
  );

  // Step 2: fetch balances + metadata for liquid assets
  const PER_ASSET = 4;
  let liquidAssets: AssetBalance[] = [];

  if (liquidAddresses.length > 0) {
    const liquidCalls = liquidAddresses.flatMap((addr) => [
      { target: addr, allowFailure: true, callData: erc20Iface.encodeFunctionData("balanceOf", [vault]) },
      { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("name") },
      { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("symbol") },
      { target: addr, allowFailure: true, callData: metaIface.encodeFunctionData("decimals") },
    ]);

    const liquidResults: { success: boolean; returnData: string }[] =
      await mc.aggregate3.staticCall(liquidCalls);

    liquidAssets = liquidAddresses.map((addr, i): AssetBalance => {
      const base     = i * PER_ASSET;
      const balance  = liquidResults[base].success     ? (erc20Iface.decodeFunctionResult("balanceOf", liquidResults[base].returnData)[0] as bigint)          : 0n;
      const name     = liquidResults[base + 1].success ? (metaIface.decodeFunctionResult("name",       liquidResults[base + 1].returnData)[0] as string)       : "";
      const symbol   = liquidResults[base + 2].success ? (metaIface.decodeFunctionResult("symbol",     liquidResults[base + 2].returnData)[0] as string)       : "";
      const decimals = liquidResults[base + 3].success ? (Number(metaIface.decodeFunctionResult("decimals", liquidResults[base + 3].returnData)[0]))           : 18;
      return { address: addr, name, symbol, decimals, balance };
    });
  }

  // Step 3: locked assets for the vault's underlying (ERC7540 pending requests)
  const lockedAssets = await (new Contract(vault, SUB_VAULT_ABI as unknown as string[], provider)
    .lockedTokensAmountOfAsset(underlyingAsset) as Promise<bigint>)
    .catch(() => 0n);

  // Step 4: compute approximate total value
  const subVaultTotal = subVaultPositions.reduce((sum, p) => sum + p.underlyingValue, 0n);
  const underlyingBalance = liquidAssets.find(
    (a) => a.address.toLowerCase() === underlyingAsset.toLowerCase(),
  )?.balance ?? 0n;
  const totalValue = underlyingBalance + subVaultTotal;

  return {
    liquidAssets,
    subVaultPositions,
    totalValue,
    totalAssets,
    totalSupply,
    lockedAssets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the full portfolio of a vault across its hub chain and all spoke chains.
 *
 * Steps:
 * 1. Discovers topology via `discoverVaultTopology` (hub + spoke chain IDs).
 * 2. Creates providers for each spoke via `createChainProvider`.
 * 3. Calls `getVaultPortfolio()` on the hub and each reachable spoke in parallel.
 * 4. Aggregates totals and flattens sub-vault positions with chainId tags.
 *
 * Because MoreVaults uses CREATE3, the vault address is identical on all chains.
 * Spoke chains where no public RPC is available (createChainProvider returns null)
 * are skipped with a console warning.
 *
 * @param provider    Read-only provider connected to any chain (used as hint for topology discovery)
 * @param vault       Vault address (same on all chains via CREATE3)
 * @param hubChainId  Optional — if known, skips topology discovery for hub client selection
 * @returns           MultiChainPortfolio aggregating hub + all spoke chains
 *
 * @example
 * const provider = new JsonRpcProvider('https://mainnet.base.org')
 * const portfolio = await getVaultPortfolioMultiChain(provider, '0x8f740...')
 * console.log(portfolio.chains.length) // hub + N spokes
 * console.log(portfolio.totalDeployedValue) // sum of sub-vault positions
 */
export async function getVaultPortfolioMultiChain(
  provider: Provider,
  vault: string,
  hubChainId?: number,
): Promise<MultiChainPortfolio> {
  // Step 1: discover topology
  const topology = await discoverVaultTopology(vault, provider);
  const resolvedHubChainId = hubChainId ?? topology.hubChainId;
  const spokeChainIds = topology.spokeChainIds;

  // Step 2: build providers for hub and each spoke
  // Hub: use provided provider if it matches hubChainId, else create one
  let hubProvider: Provider = provider;
  try {
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== resolvedHubChainId) {
      const created = createChainProvider(resolvedHubChainId);
      if (created) hubProvider = created;
    }
  } catch {
    const created = createChainProvider(resolvedHubChainId);
    if (created) hubProvider = created;
  }

  // Spoke providers: create via createChainProvider, skip if unavailable
  const spokeEntries: Array<{ chainId: number; provider: Provider }> = [];
  for (const chainId of spokeChainIds) {
    const spokeProvider = createChainProvider(chainId);
    if (!spokeProvider) {
      console.warn(`[getVaultPortfolioMultiChain] No RPC available for spoke chainId ${chainId} — skipping`);
      continue;
    }
    spokeEntries.push({ chainId, provider: spokeProvider });
  }

  // Step 3: fetch portfolios in parallel
  const [hubPortfolio, ...spokePortfolios] = await Promise.all([
    getVaultPortfolio(hubProvider, vault).catch((err) => {
      console.warn(`[getVaultPortfolioMultiChain] Hub portfolio fetch failed (chainId ${resolvedHubChainId}):`, err);
      return null;
    }),
    ...spokeEntries.map(({ chainId, provider: sp }) =>
      getVaultPortfolio(sp, vault).catch((err) => {
        console.warn(`[getVaultPortfolioMultiChain] Spoke portfolio fetch failed (chainId ${chainId}):`, err);
        return null;
      }),
    ),
  ]);

  // Step 4: build ChainPortfolio array (skip failed chains)
  const chains: ChainPortfolio[] = [];

  if (hubPortfolio) {
    chains.push({ chainId: resolvedHubChainId, vault, role: "hub", portfolio: hubPortfolio });
  }

  for (let i = 0; i < spokeEntries.length; i++) {
    const spokePortfolio = spokePortfolios[i];
    if (spokePortfolio) {
      chains.push({
        chainId: spokeEntries[i].chainId,
        vault,
        role: "spoke",
        portfolio: spokePortfolio,
      });
    }
  }

  // Step 5: aggregate totals
  let totalLiquidValue = 0n;
  let totalDeployedValue = 0n;
  let totalLockedValue = 0n;
  const allSubVaultPositions: Array<SubVaultPosition & { chainId: number }> = [];

  for (const chain of chains) {
    const p = chain.portfolio;
    const deployedValue = p.subVaultPositions.reduce((sum, pos) => sum + pos.underlyingValue, 0n);
    totalDeployedValue += deployedValue;
    totalLiquidValue += p.totalValue > deployedValue ? p.totalValue - deployedValue : 0n;
    totalLockedValue += p.lockedAssets;
    for (const pos of p.subVaultPositions) {
      allSubVaultPositions.push({ ...pos, chainId: chain.chainId });
    }
  }

  return {
    hubChainId: resolvedHubChainId,
    chains,
    totalLiquidValue,
    totalDeployedValue,
    totalLockedValue,
    allSubVaultPositions,
  };
}
