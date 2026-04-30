/**
 * Curator sub-vault read helpers for the MoreVaults SDK (Phase 5).
 *
 * Provides portfolio views and sub-vault analysis for curator dashboards.
 * Supports both ERC4626 (synchronous) and ERC7540 (asynchronous) sub-vaults.
 *
 * All functions are read-only (no wallet needed) and use multicall for
 * batched RPC efficiency.
 */

import {
  type Address,
  type PublicClient,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
} from 'viem'
import {
  SUB_VAULT_ABI,
  ERC20_ABI,
  METADATA_ABI,
  VAULT_ABI,
  VAULT_ANALYSIS_ABI,
  REGISTRY_ABI,
} from './abis.js'
import { MoreVaultsError } from './errors.js'
import type {
  SubVaultPosition,
  SubVaultInfo,
  ERC7540RequestStatus,
  VaultPortfolio,
  ChainPortfolio,
  MultiChainPortfolio,
} from './types.js'
import type { AssetBalance } from './types.js'
import { discoverVaultTopology } from './topology.js'
import { createChainClient } from './spokeRoutes.js'

// ─────────────────────────────────────────────────────────────────────────────
// Internal constants
// ─────────────────────────────────────────────────────────────────────────────

/** keccak256("ERC4626_ID") — type ID for synchronous ERC4626 sub-vaults */
const ERC4626_ID = keccak256(toHex('ERC4626_ID')) as `0x${string}`

/** keccak256("ERC7540_ID") — type ID for asynchronous ERC7540 sub-vaults */
const ERC7540_ID = keccak256(toHex('ERC7540_ID')) as `0x${string}`

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get active sub-vault positions held by the vault.
 *
 * Queries the vault's `tokensHeld` for ERC4626 and ERC7540 type IDs, then
 * fetches balances, underlying values, and token metadata for each sub-vault
 * in a single multicall round. Sub-vaults with zero share balance are excluded.
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @returns             Array of active SubVaultPosition objects
 */
export async function getSubVaultPositions(
  publicClient: PublicClient,
  vault: Address,
): Promise<SubVaultPosition[]> {
  const v = getAddress(vault)

  // Step 1: fetch the list of sub-vaults by type in parallel
  const [erc4626Raw, erc7540Raw] = await Promise.all([
    publicClient
      .readContract({
        address: v,
        abi: SUB_VAULT_ABI,
        functionName: 'tokensHeld',
        args: [ERC4626_ID],
      })
      .catch(() => [] as Address[]),
    publicClient
      .readContract({
        address: v,
        abi: SUB_VAULT_ABI,
        functionName: 'tokensHeld',
        args: [ERC7540_ID],
      })
      .catch(() => [] as Address[]),
  ])

  const erc4626Vaults = (erc4626Raw as Address[]).map(a => getAddress(a))
  const erc7540Vaults = (erc7540Raw as Address[]).map(a => getAddress(a))

  const allSubVaults: Array<{ address: Address; type: 'erc4626' | 'erc7540' }> = [
    ...erc4626Vaults.map((a) => ({ address: a, type: 'erc4626' as const })),
    ...erc7540Vaults.map((a) => ({ address: a, type: 'erc7540' as const })),
  ]

  if (allSubVaults.length === 0) return []

  // Step 2: multicall — for each sub-vault:
  //   balanceOf(vault), asset(), name(), symbol(), decimals()
  // That's 5 calls per sub-vault = slots 0..4, 5..9, etc.
  const PER_SV = 5
  const subVaultCalls = allSubVaults.flatMap(({ address: sv }) => [
    { address: sv, abi: ERC20_ABI,   functionName: 'balanceOf' as const, args: [v] as [Address] },
    { address: sv, abi: VAULT_ABI,   functionName: 'asset' as const },
    { address: sv, abi: METADATA_ABI, functionName: 'name' as const },
    { address: sv, abi: METADATA_ABI, functionName: 'symbol' as const },
    { address: sv, abi: METADATA_ABI, functionName: 'decimals' as const },
  ])

  const subVaultResults = await publicClient.multicall({
    contracts: subVaultCalls,
    allowFailure: true,
  })

  // Parse per-sub-vault results and collect underlying asset addresses
  interface PartialSV {
    address: Address
    type: 'erc4626' | 'erc7540'
    sharesBalance: bigint
    underlyingAsset: Address
    name: string
    symbol: string
    decimals: number
  }

  const partials: PartialSV[] = allSubVaults.map(({ address: sv, type }, i) => {
    const base = i * PER_SV
    const sharesBalance = subVaultResults[base]?.status === 'success'
      ? (subVaultResults[base].result as bigint)
      : 0n
    const underlyingAsset = subVaultResults[base + 1]?.status === 'success'
      ? getAddress(subVaultResults[base + 1].result as Address)
      : zeroAddress
    const name     = subVaultResults[base + 2]?.status === 'success' ? (subVaultResults[base + 2].result as string) : ''
    const symbol   = subVaultResults[base + 3]?.status === 'success' ? (subVaultResults[base + 3].result as string) : ''
    const decimals = subVaultResults[base + 4]?.status === 'success' ? (subVaultResults[base + 4].result as number) : 18

    return { address: sv, type, sharesBalance, underlyingAsset, name, symbol, decimals }
  })

  // Filter out sub-vaults with no position
  const active = partials.filter((p) => p.sharesBalance > 0n)
  if (active.length === 0) return []

  // Step 3: multicall — for each active sub-vault:
  //   convertToAssets(sharesBalance) on the sub-vault
  //   name(), symbol(), decimals() on the underlying asset
  // That's 4 calls per active sub-vault = slots 0..3, 4..7, etc.
  const PER_ACTIVE = 4
  const activeCalls = active.flatMap(({ address: sv, sharesBalance, underlyingAsset }) => [
    { address: sv, abi: SUB_VAULT_ABI, functionName: 'convertToAssets' as const, args: [sharesBalance] as [bigint] },
    { address: underlyingAsset, abi: METADATA_ABI, functionName: 'name' as const },
    { address: underlyingAsset, abi: METADATA_ABI, functionName: 'symbol' as const },
    { address: underlyingAsset, abi: METADATA_ABI, functionName: 'decimals' as const },
  ])

  const activeResults = await publicClient.multicall({
    contracts: activeCalls,
    allowFailure: true,
  })

  return active.map((p, i) => {
    const base = i * PER_ACTIVE
    const underlyingValue    = activeResults[base]?.status === 'success'     ? (activeResults[base].result as bigint)   : 0n
    const underlyingSymbol   = activeResults[base + 2]?.status === 'success' ? (activeResults[base + 2].result as string) : ''
    const underlyingDecimals = activeResults[base + 3]?.status === 'success' ? (activeResults[base + 3].result as number) : 18

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
    } satisfies SubVaultPosition
  })
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a contract is an ERC7540, ERC4626, or unknown vault type.
 *
 * Tries to call ERC7540-specific functions first (pendingDepositRequest /
 * claimableDepositRequest). If those revert, falls back to ERC4626
 * convertToAssets(0). Returns null if neither succeeds.
 *
 * @param publicClient  Viem public client (must be on the same chain as subVault)
 * @param subVault      Sub-vault contract address to probe
 * @returns             'erc7540' | 'erc4626' | null
 */
export async function detectSubVaultType(
  publicClient: PublicClient,
  subVault: Address,
): Promise<'erc4626' | 'erc7540' | null> {
  const sv = getAddress(subVault)

  const [erc7540Result, erc4626Result] = await publicClient.multicall({
    contracts: [
      {
        address: sv,
        abi: SUB_VAULT_ABI,
        functionName: 'pendingDepositRequest',
        args: [0n, zeroAddress],
      },
      {
        address: sv,
        abi: SUB_VAULT_ABI,
        functionName: 'convertToAssets',
        args: [0n],
      },
    ],
    allowFailure: true,
  })

  if (erc7540Result?.status === 'success') return 'erc7540'
  if (erc4626Result?.status === 'success') return 'erc4626'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse a specific sub-vault to understand deposit limits, metadata, type,
 * and global-registry whitelist status.
 *
 * Useful for curators deciding whether to invest vault funds into a given
 * ERC4626 or ERC7540 protocol.
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy) — used to check maxDeposit
 * @param subVault      Sub-vault address to analyse
 * @returns             SubVaultInfo snapshot
 */
export async function getSubVaultInfo(
  publicClient: PublicClient,
  vault: Address,
  subVault: Address,
): Promise<SubVaultInfo> {
  const v  = getAddress(vault)
  const sv = getAddress(subVault)

  // Detect type and fetch basic metadata in parallel
  const [type, basicResults] = await Promise.all([
    detectSubVaultType(publicClient, sv),
    publicClient.multicall({
      contracts: [
        { address: sv, abi: METADATA_ABI,  functionName: 'name' as const },
        { address: sv, abi: METADATA_ABI,  functionName: 'symbol' as const },
        { address: sv, abi: METADATA_ABI,  functionName: 'decimals' as const },
        { address: sv, abi: VAULT_ABI,     functionName: 'asset' as const },
        { address: sv, abi: SUB_VAULT_ABI, functionName: 'maxDeposit' as const, args: [v] as [Address] },
      ],
      allowFailure: true,
    }),
  ])

  const name       = basicResults[0]?.status === 'success' ? (basicResults[0].result as string) : ''
  const symbol     = basicResults[1]?.status === 'success' ? (basicResults[1].result as string) : ''
  const decimals   = basicResults[2]?.status === 'success' ? (basicResults[2].result as number) : 18
  const underlying = basicResults[3]?.status === 'success'
    ? getAddress(basicResults[3].result as Address)
    : zeroAddress
  const maxDeposit = basicResults[4]?.status === 'success' ? (basicResults[4].result as bigint) : 0n

  // Fetch underlying asset metadata and whitelist status in parallel
  const [underlyingResults, registryRaw] = await Promise.all([
    publicClient.multicall({
      contracts: [
        { address: underlying, abi: METADATA_ABI, functionName: 'name' as const },
        { address: underlying, abi: METADATA_ABI, functionName: 'symbol' as const },
        { address: underlying, abi: METADATA_ABI, functionName: 'decimals' as const },
      ],
      allowFailure: true,
    }),
    publicClient
      .readContract({ address: v, abi: VAULT_ANALYSIS_ABI, functionName: 'moreVaultsRegistry' })
      .catch(() => null),
  ])

  const underlyingSymbol   = underlyingResults[1]?.status === 'success' ? (underlyingResults[1].result as string) : ''
  const underlyingDecimals = underlyingResults[2]?.status === 'success' ? (underlyingResults[2].result as number) : 18

  let isWhitelisted = false
  if (registryRaw) {
    const registry = getAddress(registryRaw as Address)
    const whitelistResult = await publicClient
      .readContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: 'isWhitelisted',
        args: [sv],
      })
      .catch(() => false)
    isWhitelisted = whitelistResult as boolean
  }

  return {
    address: sv,
    type: type ?? 'erc4626',
    name,
    symbol,
    decimals,
    underlyingAsset: underlying,
    underlyingSymbol,
    underlyingDecimals,
    maxDeposit,
    isWhitelisted,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the ERC7540 async request status for a specific sub-vault and vault controller.
 *
 * Queries pendingDepositRequest, claimableDepositRequest, pendingRedeemRequest,
 * and claimableRedeemRequest using requestId = 0 (the standard default).
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address acting as controller in the sub-vault
 * @param subVault      ERC7540 sub-vault address
 * @returns             ERC7540RequestStatus with canFinalize flags
 */
export async function getERC7540RequestStatus(
  publicClient: PublicClient,
  vault: Address,
  subVault: Address,
): Promise<ERC7540RequestStatus> {
  const v  = getAddress(vault)
  const sv = getAddress(subVault)

  const results = await publicClient.multicall({
    contracts: [
      { address: sv, abi: SUB_VAULT_ABI, functionName: 'pendingDepositRequest'   as const, args: [0n, v] as [bigint, Address] },
      { address: sv, abi: SUB_VAULT_ABI, functionName: 'claimableDepositRequest' as const, args: [0n, v] as [bigint, Address] },
      { address: sv, abi: SUB_VAULT_ABI, functionName: 'pendingRedeemRequest'    as const, args: [0n, v] as [bigint, Address] },
      { address: sv, abi: SUB_VAULT_ABI, functionName: 'claimableRedeemRequest'  as const, args: [0n, v] as [bigint, Address] },
    ],
    allowFailure: true,
  })

  const pendingDeposit    = results[0]?.status === 'success' ? (results[0].result as bigint) : 0n
  const claimableDeposit  = results[1]?.status === 'success' ? (results[1].result as bigint) : 0n
  const pendingRedeem     = results[2]?.status === 'success' ? (results[2].result as bigint) : 0n
  const claimableRedeem   = results[3]?.status === 'success' ? (results[3].result as bigint) : 0n

  return {
    subVault: sv,
    pendingDeposit,
    claimableDeposit,
    pendingRedeem,
    claimableRedeem,
    canFinalizeDeposit: claimableDeposit > 0n,
    canFinalizeRedeem:  claimableRedeem  > 0n,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many shares the vault would receive for a given asset deposit
 * into a sub-vault.
 *
 * Calls `previewDeposit(assets)` on the sub-vault contract.
 *
 * @param publicClient  Viem public client
 * @param subVault      Sub-vault address (ERC4626 or ERC7540)
 * @param assets        Amount of underlying assets to preview
 * @returns             Expected shares to be minted
 */
export async function previewSubVaultDeposit(
  publicClient: PublicClient,
  subVault: Address,
  assets: bigint,
): Promise<bigint> {
  try {
    const result = await publicClient.readContract({
      address: getAddress(subVault),
      abi: SUB_VAULT_ABI,
      functionName: 'previewDeposit',
      args: [assets],
    })
    return result as bigint
  } catch {
    throw new MoreVaultsError('Failed to preview sub-vault operation. The sub-vault may not support this.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many underlying assets the vault would receive for redeeming
 * a given number of shares from a sub-vault.
 *
 * Calls `previewRedeem(shares)` on the sub-vault contract.
 *
 * @param publicClient  Viem public client
 * @param subVault      Sub-vault address (ERC4626 or ERC7540)
 * @param shares        Number of shares to preview redemption for
 * @returns             Expected underlying assets to be returned
 */
export async function previewSubVaultRedeem(
  publicClient: PublicClient,
  subVault: Address,
  shares: bigint,
): Promise<bigint> {
  try {
    const result = await publicClient.readContract({
      address: getAddress(subVault),
      abi: SUB_VAULT_ABI,
      functionName: 'previewRedeem',
      args: [shares],
    })
    return result as bigint
  } catch {
    throw new MoreVaultsError('Failed to preview sub-vault operation. The sub-vault may not support this.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the complete portfolio view for a vault, combining liquid asset balances
 * with active sub-vault positions and locked ERC7540 assets.
 *
 * Liquid assets that are also sub-vault share tokens are deduplicated to avoid
 * double-counting (the sub-vault's underlying value is already captured via
 * convertToAssets).
 *
 * @param publicClient  Viem public client (must be on the vault's hub chain)
 * @param vault         Vault address (diamond proxy)
 * @returns             VaultPortfolio with full breakdown
 */
export async function getVaultPortfolio(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultPortfolio> {
  const v = getAddress(vault)

  // Step 1: get available assets, sub-vault positions, totalAssets, totalSupply, underlying in parallel
  const [availableRaw, subVaultPositions, vaultTotals] = await Promise.all([
    publicClient
      .readContract({ address: v, abi: VAULT_ANALYSIS_ABI, functionName: 'getAvailableAssets' })
      .catch(() => [] as Address[]),
    getSubVaultPositions(publicClient, v),
    publicClient.multicall({
      contracts: [
        { address: v, abi: VAULT_ABI,   functionName: 'totalAssets' as const },
        { address: v, abi: VAULT_ABI,   functionName: 'totalSupply' as const },
        { address: v, abi: VAULT_ABI,   functionName: 'asset' as const },
      ],
      allowFailure: true,
    }),
  ])

  const totalAssets = vaultTotals[0]?.status === 'success' ? (vaultTotals[0].result as bigint) : 0n
  const totalSupply = vaultTotals[1]?.status === 'success' ? (vaultTotals[1].result as bigint) : 0n
  const underlyingAsset = vaultTotals[2]?.status === 'success'
    ? getAddress(vaultTotals[2].result as Address)
    : zeroAddress

  const availableAddresses = (availableRaw as Address[]).map(a => getAddress(a))

  // Sub-vault share addresses to exclude from liquid assets (avoid double-counting)
  const subVaultAddressSet = new Set(subVaultPositions.map((p) => p.address.toLowerCase()))

  // Filter liquid asset addresses: exclude sub-vault share tokens
  const liquidAddresses = availableAddresses.filter(
    (addr) => !subVaultAddressSet.has(addr.toLowerCase()),
  )

  // Step 2: fetch balances + metadata for liquid assets in one multicall
  const PER_ASSET = 4 // balanceOf, name, symbol, decimals
  const liquidCalls = liquidAddresses.flatMap((addr) => [
    { address: addr, abi: ERC20_ABI,    functionName: 'balanceOf' as const, args: [v] as [Address] },
    { address: addr, abi: METADATA_ABI, functionName: 'name' as const },
    { address: addr, abi: METADATA_ABI, functionName: 'symbol' as const },
    { address: addr, abi: METADATA_ABI, functionName: 'decimals' as const },
  ])

  const liquidResults = liquidAddresses.length > 0
    ? await publicClient.multicall({ contracts: liquidCalls, allowFailure: true })
    : []

  const liquidAssets: AssetBalance[] = liquidAddresses.map((addr, i) => {
    const base     = i * PER_ASSET
    const balance  = liquidResults[base]?.status === 'success'     ? (liquidResults[base].result as bigint)     : 0n
    const name     = liquidResults[base + 1]?.status === 'success' ? (liquidResults[base + 1].result as string) : ''
    const symbol   = liquidResults[base + 2]?.status === 'success' ? (liquidResults[base + 2].result as string) : ''
    const decimals = liquidResults[base + 3]?.status === 'success' ? (liquidResults[base + 3].result as number) : 18
    return { address: addr, name, symbol, decimals, balance }
  })

  // Step 3: fetch locked assets for the vault's underlying (ERC7540 pending requests)
  const lockedAssets = await publicClient
    .readContract({
      address: v,
      abi: SUB_VAULT_ABI,
      functionName: 'lockedTokensAmountOfAsset',
      args: [underlyingAsset],
    })
    .catch(() => 0n) as bigint

  // Step 4: compute total value = liquid assets (underlying only) + sub-vault underlying values
  // totalAssets from the vault already accounts for all positions, so we use it directly.
  // We also provide a manual sum of sub-vault values for reference.
  const subVaultTotal = subVaultPositions.reduce((sum, p) => sum + p.underlyingValue, 0n)
  const underlyingBalance = liquidAssets.find(
    (a) => a.address.toLowerCase() === underlyingAsset.toLowerCase(),
  )?.balance ?? 0n
  const totalValue = underlyingBalance + subVaultTotal

  return {
    liquidAssets,
    subVaultPositions,
    totalValue,
    totalAssets,
    totalSupply,
    lockedAssets,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the full portfolio of a vault across its hub chain and all spoke chains.
 *
 * Steps:
 * 1. Discovers topology via `discoverVaultTopology` (hub + spoke chain IDs).
 * 2. Creates public clients for each spoke via `createChainClient`.
 * 3. Calls `getVaultPortfolio()` on the hub and each reachable spoke in parallel.
 * 4. Aggregates totals and flattens sub-vault positions with chainId tags.
 *
 * Because MoreVaults uses CREATE3, the vault address is identical on all chains.
 * Spoke chains where no public RPC is available (createChainClient returns null)
 * are skipped with a console warning.
 *
 * Note on totals: All bigint sums are in raw token units. MoreVaults vaults
 * typically use the same underlying token on all chains, so summing is
 * meaningful. The hub's `totalAssets` already accounts for spoke values via
 * LZ Read and is the authoritative AUM figure.
 *
 * @param publicClient  Public client connected to any chain (used as hint for topology discovery)
 * @param vault         Vault address (same on all chains via CREATE3)
 * @param hubChainId    Optional — if known, skips topology discovery and uses hub client directly
 * @returns             MultiChainPortfolio aggregating hub + all spoke chains
 *
 * @example
 * const client = createPublicClient({ chain: base, transport: http() })
 * const portfolio = await getVaultPortfolioMultiChain(client, '0x8f740...')
 * console.log(portfolio.chains.length) // hub + N spokes
 * console.log(portfolio.totalDeployedValue) // sum of sub-vault positions
 */
export async function getVaultPortfolioMultiChain(
  publicClient: PublicClient,
  vault: Address,
  hubChainId?: number,
): Promise<MultiChainPortfolio> {
  const v = getAddress(vault)

  // Step 1: discover topology
  const topology = await discoverVaultTopology(v, publicClient)

  const resolvedHubChainId = hubChainId ?? topology.hubChainId
  const spokeChainIds = topology.spokeChainIds

  // Step 2: build clients for hub and each spoke
  // Hub: use the provided publicClient if it matches hubChainId, else create one
  const hubChainFromClient = publicClient.chain?.id
  const hubClient: PublicClient =
    hubChainFromClient === resolvedHubChainId
      ? publicClient
      : (createChainClient(resolvedHubChainId) ?? publicClient)

  // Spoke clients: create via createChainClient, skip if unavailable
  const spokeEntries: Array<{ chainId: number; client: PublicClient }> = []
  for (const chainId of spokeChainIds) {
    const client = createChainClient(chainId)
    if (!client) {
      console.warn(`[getVaultPortfolioMultiChain] No RPC available for spoke chainId ${chainId} — skipping`)
      continue
    }
    spokeEntries.push({ chainId, client })
  }

  // Step 3: fetch portfolios in parallel
  const [hubPortfolio, ...spokePortfolios] = await Promise.all([
    getVaultPortfolio(hubClient, v).catch((err) => {
      console.warn(`[getVaultPortfolioMultiChain] Hub portfolio fetch failed (chainId ${resolvedHubChainId}):`, err)
      return null
    }),
    ...spokeEntries.map(({ chainId, client }) =>
      getVaultPortfolio(client, v).catch((err) => {
        console.warn(`[getVaultPortfolioMultiChain] Spoke portfolio fetch failed (chainId ${chainId}):`, err)
        return null
      }),
    ),
  ])

  // Step 4: build ChainPortfolio array (skip failed chains)
  const chains: ChainPortfolio[] = []

  if (hubPortfolio) {
    chains.push({ chainId: resolvedHubChainId, vault: v, role: 'hub', portfolio: hubPortfolio })
  }

  for (let i = 0; i < spokeEntries.length; i++) {
    const spokePortfolio = spokePortfolios[i]
    if (spokePortfolio) {
      chains.push({
        chainId: spokeEntries[i].chainId,
        vault: v,
        role: 'spoke',
        portfolio: spokePortfolio,
      })
    }
  }

  // Step 5: aggregate totals
  let totalLiquidValue = 0n
  let totalDeployedValue = 0n
  let totalLockedValue = 0n
  const allSubVaultPositions: Array<SubVaultPosition & { chainId: number }> = []

  for (const chain of chains) {
    const p = chain.portfolio
    // Sub-vault deployed value
    const deployedValue = p.subVaultPositions.reduce((sum, pos) => sum + pos.underlyingValue, 0n)
    totalDeployedValue += deployedValue
    // Liquid value = totalValue minus deployed (totalValue = liquid underlying + deployed)
    totalLiquidValue += p.totalValue > deployedValue ? p.totalValue - deployedValue : 0n
    totalLockedValue += p.lockedAssets
    for (const pos of p.subVaultPositions) {
      allSubVaultPositions.push({ ...pos, chainId: chain.chainId })
    }
  }

  return {
    hubChainId: resolvedHubChainId,
    chains,
    totalLiquidValue,
    totalDeployedValue,
    totalLockedValue,
    allSubVaultPositions,
  }
}
