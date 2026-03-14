/**
 * Curator / vault-manager read helpers for the MoreVaults SDK.
 *
 * All functions are read-only (no wallet needed) and use multicall for
 * batched RPC efficiency.
 */

import { type Address, type PublicClient, getAddress } from 'viem'
import { MULTICALL_ABI, CURATOR_CONFIG_ABI, VAULT_ANALYSIS_ABI, REGISTRY_ABI, METADATA_ABI } from './abis.js'
import type { CuratorVaultStatus, PendingAction, VaultAnalysis, AssetInfo } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a comprehensive status snapshot for the curator dashboard.
 *
 * Fetches in two batches (multicall) to minimise round trips:
 *   Batch 1: curator, timeLockPeriod, getMaxSlippagePercent, getCurrentNonce,
 *            getAvailableAssets, getCrossChainAccountingManager, paused
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @returns             CuratorVaultStatus snapshot
 */
export async function getCuratorVaultStatus(
  publicClient: PublicClient,
  vault: Address,
): Promise<CuratorVaultStatus> {
  const v = getAddress(vault)

  const [
    curator,
    timeLockPeriod,
    maxSlippagePercent,
    currentNonce,
    availableAssets,
    lzAdapter,
    paused,
  ] = await publicClient.multicall({
    contracts: [
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'curator' },
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'timeLockPeriod' },
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'getMaxSlippagePercent' },
      { address: v, abi: MULTICALL_ABI,      functionName: 'getCurrentNonce' },
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'getAvailableAssets' },
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'getCrossChainAccountingManager' },
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'paused' },
    ],
    allowFailure: false,
  })

  return {
    curator: getAddress(curator as Address),
    timeLockPeriod: timeLockPeriod as bigint,
    maxSlippagePercent: maxSlippagePercent as bigint,
    currentNonce: currentNonce as bigint,
    availableAssets: (availableAssets as Address[]).map(getAddress),
    lzAdapter: getAddress(lzAdapter as Address),
    paused: paused as boolean,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch pending actions for a specific nonce and resolve whether they are
 * executable (i.e. the timelock has expired).
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @param nonce         Action nonce to query
 * @returns             PendingAction with isExecutable flag set
 */
export async function getPendingActions(
  publicClient: PublicClient,
  vault: Address,
  nonce: bigint,
): Promise<PendingAction> {
  const v = getAddress(vault)

  const [actionsResult, block] = await Promise.all([
    publicClient.readContract({
      address: v,
      abi: MULTICALL_ABI,
      functionName: 'getPendingActions',
      args: [nonce],
    }),
    publicClient.getBlock(),
  ])

  const [actionsData, pendingUntil] = actionsResult as [`0x${string}`[], bigint]
  const isExecutable = pendingUntil > 0n && block.timestamp >= pendingUntil

  return {
    nonce,
    actionsData,
    pendingUntil,
    isExecutable,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a given address is the curator of the vault.
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @param address       Address to check
 * @returns             true if address is the current curator
 */
export async function isCurator(
  publicClient: PublicClient,
  vault: Address,
  address: Address,
): Promise<boolean> {
  const curatorAddress = await publicClient.readContract({
    address: getAddress(vault),
    abi: CURATOR_CONFIG_ABI,
    functionName: 'curator',
  })

  return getAddress(curatorAddress as Address) === getAddress(address)
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full vault analysis — available assets with metadata, depositable assets, whitelist config.
 * Useful for curator dashboards to understand what the vault can do.
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @returns             VaultAnalysis snapshot
 */
export async function getVaultAnalysis(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultAnalysis> {
  const v = getAddress(vault)

  // Batch 1: fetch asset lists, whitelist flag, and registry address in parallel
  const [availableRaw, depositableRaw, depositWhitelistEnabled, registryResult] =
    await Promise.all([
      publicClient.readContract({
        address: v,
        abi: VAULT_ANALYSIS_ABI,
        functionName: 'getAvailableAssets',
      }),
      publicClient.readContract({
        address: v,
        abi: VAULT_ANALYSIS_ABI,
        functionName: 'getDepositableAssets',
      }),
      publicClient.readContract({
        address: v,
        abi: VAULT_ANALYSIS_ABI,
        functionName: 'isDepositWhitelistEnabled',
      }),
      publicClient.readContract({
        address: v,
        abi: VAULT_ANALYSIS_ABI,
        functionName: 'moreVaultsRegistry',
      }).catch(() => null),
    ])

  const availableAddresses = (availableRaw as Address[]).map(getAddress)
  const depositableAddresses = (depositableRaw as Address[]).map(getAddress)

  // Deduplicated set of all asset addresses we need metadata for
  const allAddresses = Array.from(new Set([...availableAddresses, ...depositableAddresses]))

  // Batch 2: multicall for name/symbol/decimals on all unique assets
  const metadataCalls = allAddresses.flatMap((addr) => [
    { address: addr, abi: METADATA_ABI, functionName: 'name' as const },
    { address: addr, abi: METADATA_ABI, functionName: 'symbol' as const },
    { address: addr, abi: METADATA_ABI, functionName: 'decimals' as const },
  ])

  const metadataResults = allAddresses.length > 0
    ? await publicClient.multicall({ contracts: metadataCalls, allowFailure: true })
    : []

  // Map address → AssetInfo
  const assetInfoMap = new Map<Address, AssetInfo>()
  for (let i = 0; i < allAddresses.length; i++) {
    const addr = allAddresses[i]
    const nameResult    = metadataResults[i * 3]
    const symbolResult  = metadataResults[i * 3 + 1]
    const decimalsResult = metadataResults[i * 3 + 2]

    assetInfoMap.set(addr, {
      address: addr,
      name:     nameResult?.status === 'success'     ? (nameResult.result as string)  : '',
      symbol:   symbolResult?.status === 'success'   ? (symbolResult.result as string) : '',
      decimals: decimalsResult?.status === 'success' ? (decimalsResult.result as number) : 18,
    })
  }

  const registryAddress = registryResult ? getAddress(registryResult as Address) : null

  return {
    availableAssets:       availableAddresses.map((a) => assetInfoMap.get(a)!),
    depositableAssets:     depositableAddresses.map((a) => assetInfoMap.get(a)!),
    depositWhitelistEnabled: depositWhitelistEnabled as boolean,
    registryAddress,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if specific protocol addresses are whitelisted in the global registry.
 * Useful for curators to verify DEX routers before building swap calldata.
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @param protocols     Protocol addresses to check
 * @returns             Record mapping address → whitelisted boolean
 */
export async function checkProtocolWhitelist(
  publicClient: PublicClient,
  vault: Address,
  protocols: Address[],
): Promise<Record<string, boolean>> {
  const v = getAddress(vault)

  const registryRaw = await publicClient.readContract({
    address: v,
    abi: VAULT_ANALYSIS_ABI,
    functionName: 'moreVaultsRegistry',
  })

  const registry = getAddress(registryRaw as Address)

  if (protocols.length === 0) return {}

  const results = await publicClient.multicall({
    contracts: protocols.map((protocol) => ({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: 'isWhitelisted' as const,
      args: [getAddress(protocol)] as [Address],
    })),
    allowFailure: true,
  })

  const out: Record<string, boolean> = {}
  for (let i = 0; i < protocols.length; i++) {
    const r = results[i]
    out[getAddress(protocols[i])] = r?.status === 'success' ? (r.result as boolean) : false
  }
  return out
}

