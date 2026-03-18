import { type Address, type PublicClient, getAddress } from 'viem'
import { BRIDGE_ABI, CONFIG_ABI, ERC20_ABI, VAULT_ABI, METADATA_ABI, OFT_ABI, VAULT_ANALYSIS_ABI } from './abis'
import type { CrossChainRequestInfo } from './types'
import { getVaultStatus } from './utils'
import type { VaultStatus } from './utils'
import { discoverVaultTopology, OMNI_FACTORY_ADDRESS } from './topology'
import { createChainClient } from './spokeRoutes'
import { CHAIN_ID_TO_EID } from './chains'
import { MoreVaultsError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────

export interface UserPosition {
  /** Vault share balance */
  shares: bigint
  /** convertToAssets(shares) — what they'd get if they redeemed now */
  estimatedAssets: bigint
  /** Price of 1 full share in underlying (convertToAssets(10n ** decimals)) */
  sharePrice: bigint
  /** Vault decimals (for display) */
  decimals: number
  pendingWithdrawal: {
    shares: bigint
    timelockEndsAt: bigint
    /** block.timestamp >= timelockEndsAt (or timelockEndsAt === 0n) */
    canRedeemNow: boolean
  } | null  // null if no pending withdrawal request
}

/**
 * Read the user's current position in the vault.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address (diamond proxy)
 * @param user          User wallet address
 * @returns             Full user position snapshot
 */
export async function getUserPosition(
  publicClient: PublicClient,
  vault: Address,
  user: Address,
): Promise<UserPosition> {
  const v = getAddress(vault)
  const u = getAddress(user)

  // First batch: balance, decimals, withdrawal request — via multicall
  const [sharesResult, decimalsResult, withdrawalRequestResult] = await publicClient.multicall({
    contracts: [
      { address: v, abi: VAULT_ABI, functionName: 'balanceOf', args: [u] },
      { address: v, abi: METADATA_ABI, functionName: 'decimals' },
      { address: v, abi: VAULT_ABI, functionName: 'getWithdrawalRequest', args: [u] },
    ],
    allowFailure: true,
  })
  const block = await publicClient.getBlock()

  if (
    sharesResult.status === 'failure' &&
    decimalsResult.status === 'failure' &&
    withdrawalRequestResult.status === 'failure'
  ) {
    throw new MoreVaultsError('Failed to read user position')
  }

  const shares = sharesResult.status === 'success' ? (sharesResult.result as bigint) : 0n
  const decimals = decimalsResult.status === 'success' ? (decimalsResult.result as number) : 18
  const withdrawalRequest = withdrawalRequestResult.status === 'success'
    ? withdrawalRequestResult.result
    : [0n, 0n]

  const [withdrawShares, timelockEndsAt] = withdrawalRequest as unknown as [bigint, bigint]

  // Second batch: convertToAssets calls (need shares and decimals from first batch)
  const oneShare = 10n ** BigInt(decimals)
  const [estimatedAssets, sharePrice] = await Promise.all([
    shares === 0n
      ? Promise.resolve(0n)
      : publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'convertToAssets', args: [shares] }),
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'convertToAssets', args: [oneShare] }),
  ])

  const currentTimestamp = block.timestamp

  const pendingWithdrawal =
    withdrawShares === 0n
      ? null
      : {
          shares: withdrawShares,
          timelockEndsAt,
          canRedeemNow: timelockEndsAt === 0n || currentTimestamp >= timelockEndsAt,
        }

  return {
    shares,
    estimatedAssets,
    sharePrice,
    decimals,
    pendingWithdrawal,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many shares a given asset amount would mint.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param assets        Amount of underlying tokens to deposit
 * @returns             Estimated shares to be minted
 */
export async function previewDeposit(
  publicClient: PublicClient,
  vault: Address,
  assets: bigint,
): Promise<bigint> {
  try {
    return await publicClient.readContract({
      address: getAddress(vault),
      abi: VAULT_ABI,
      functionName: 'previewDeposit',
      args: [assets],
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (
      msg.includes('revert') ||
      msg.includes('NotAnERC4626') ||
      msg.includes('async') ||
      msg.includes('previewDeposit')
    ) {
      throw new MoreVaultsError('Vault does not support sync preview. It may be in async mode.')
    }
    throw e
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview how many underlying assets a given share amount would redeem.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param shares        Amount of vault shares to redeem
 * @returns             Estimated assets to be returned
 */
export async function previewRedeem(
  publicClient: PublicClient,
  vault: Address,
  shares: bigint,
): Promise<bigint> {
  try {
    return await publicClient.readContract({
      address: getAddress(vault),
      abi: VAULT_ABI,
      functionName: 'previewRedeem',
      args: [shares],
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (
      msg.includes('revert') ||
      msg.includes('NotAnERC4626') ||
      msg.includes('async') ||
      msg.includes('previewRedeem')
    ) {
      throw new MoreVaultsError('Vault does not support sync preview. It may be in async mode.')
    }
    throw e
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export type DepositBlockReason = 'paused' | 'capacity-full' | 'not-whitelisted' | 'ok'

export interface DepositEligibility {
  allowed: boolean
  reason: DepositBlockReason
  /** Max deposit amount for this user (0n if capacity full or not whitelisted) */
  maxDeposit?: bigint
  /** Whether the vault restricts deposits to whitelisted addresses */
  whitelistEnabled?: boolean
}

/**
 * Check whether a user is eligible to deposit into the vault right now.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param user          User wallet address
 * @returns             Eligibility result with reason
 */
export async function canDeposit(
  publicClient: PublicClient,
  vault: Address,
  user: Address,
): Promise<DepositEligibility> {
  const v = getAddress(vault)

  // Fetch paused + isHub + oraclesCrossChainAccounting in one batch
  const [isPaused, isHub, oraclesEnabled] = await publicClient.multicall({
    contracts: [
      { address: v, abi: CONFIG_ABI,  functionName: 'paused' },
      { address: v, abi: CONFIG_ABI,  functionName: 'isHub' },
      { address: v, abi: BRIDGE_ABI,  functionName: 'oraclesCrossChainAccounting' },
    ],
    allowFailure: false,
  })

  // Read whitelist status (may revert on older vaults — default to false)
  let whitelistEnabled = false
  try {
    whitelistEnabled = await publicClient.readContract({
      address: v,
      abi: VAULT_ANALYSIS_ABI,
      functionName: 'isDepositWhitelistEnabled',
    }) as boolean
  } catch {
    // Older vaults may not have this function
  }

  if (isPaused) {
    return { allowed: false, reason: 'paused', whitelistEnabled }
  }

  // Cross-chain async hubs revert on maxDeposit — this is expected, not a whitelist block.
  // The vault accepts deposits via initVaultActionRequest instead of the standard ERC-4626 path.
  const isCrossChainAsync = isHub && !oraclesEnabled
  if (isCrossChainAsync) {
    return { allowed: true, reason: 'ok', whitelistEnabled }
  }

  // maxDeposit(user) can REVERT on vaults with whitelist/ACL
  let maxDepositAmount: bigint
  try {
    maxDepositAmount = await publicClient.readContract({
      address: v,
      abi: CONFIG_ABI,
      functionName: 'maxDeposit',
      args: [getAddress(user)],
    })
  } catch {
    // Revert means the vault has whitelist/ACL and this user is not approved
    return { allowed: false, reason: 'not-whitelisted', maxDeposit: 0n, whitelistEnabled }
  }

  if (maxDepositAmount === 0n) {
    return { allowed: false, reason: 'capacity-full', maxDeposit: 0n, whitelistEnabled }
  }
  return { allowed: true, reason: 'ok', maxDeposit: maxDepositAmount, whitelistEnabled }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultMetadata {
  name: string
  symbol: string
  decimals: number
  underlying: Address
  underlyingSymbol: string
  underlyingDecimals: number
}

/**
 * Read display metadata for a vault and its underlying token.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @returns             Vault and underlying token metadata
 */
export async function getVaultMetadata(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultMetadata> {
  const v = getAddress(vault)

  // Batch 1: vault name, symbol, decimals, underlying — 1 eth_call via multicall
  const b1 = await publicClient.multicall({
    contracts: [
      { address: v, abi: METADATA_ABI, functionName: 'name' },
      { address: v, abi: METADATA_ABI, functionName: 'symbol' },
      { address: v, abi: METADATA_ABI, functionName: 'decimals' },
      { address: v, abi: VAULT_ABI,    functionName: 'asset' },
    ] as const,
    allowFailure: true,
  })

  const assetResult   = b1[3]
  const decimalsResult1 = b1[2]

  if (assetResult.status === 'failure' || decimalsResult1.status === 'failure') {
    throw new MoreVaultsError('Failed to read vault metadata')
  }

  const name     = b1[0].status === 'success' ? (b1[0].result as string)  : ''
  const symbol   = b1[1].status === 'success' ? (b1[1].result as string)  : ''
  const decimals = b1[2].result as number
  const underlying = b1[3].result as Address
  const underlyingAddr = getAddress(underlying)

  // Batch 2: underlying symbol + decimals — 1 eth_call via multicall
  const b2 = await publicClient.multicall({
    contracts: [
      { address: underlyingAddr, abi: METADATA_ABI, functionName: 'symbol' },
      { address: underlyingAddr, abi: METADATA_ABI, functionName: 'decimals' },
    ] as const,
    allowFailure: true,
  })

  const underlyingSymbol   = b2[0].status === 'success' ? (b2[0].result as string)  : ''
  const underlyingDecimals = b2[1].status === 'success' ? (b2[1].result as number)  : 18

  return {
    name,
    symbol,
    decimals,
    underlying: underlyingAddr,
    underlyingSymbol,
    underlyingDecimals,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export type AsyncRequestStatus = 'pending' | 'ready-to-execute' | 'completed' | 'refunded'

export interface AsyncRequestStatusInfo {
  status: AsyncRequestStatus
  /** Human-readable description */
  label: string
  /** Shares minted or assets returned (0 if still pending) */
  result: bigint
}

/**
 * Get the human-readable status of an async cross-chain request.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param guid          Request GUID returned by depositAsync / mintAsync / redeemAsync
 * @returns             Status info with label and result
 */
export async function getAsyncRequestStatusLabel(
  publicClient: PublicClient,
  vault: Address,
  guid: `0x${string}`,
): Promise<AsyncRequestStatusInfo> {
  const v = getAddress(vault)

  let info: CrossChainRequestInfo
  let finalizationResult: bigint
  try {
    const [rawInfo, rawResult] = await Promise.all([
      publicClient.readContract({
        address: v,
        abi: BRIDGE_ABI,
        functionName: 'getRequestInfo',
        args: [guid],
      }) as Promise<CrossChainRequestInfo>,
      publicClient.readContract({
        address: v,
        abi: BRIDGE_ABI,
        functionName: 'getFinalizationResult',
        args: [guid],
      }),
    ])
    info = rawInfo
    finalizationResult = rawResult as bigint
  } catch {
    throw new MoreVaultsError('Failed to read async request status. Vault may not support cross-chain flows.')
  }

  if (info.refunded) {
    return {
      status: 'refunded',
      label: 'Request refunded — tokens returned to initiator',
      result: 0n,
    }
  }
  if (info.finalized) {
    return {
      status: 'completed',
      label: 'Completed',
      result: finalizationResult,
    }
  }
  if (info.fulfilled) {
    return {
      status: 'ready-to-execute',
      label: 'Oracle responded — ready to execute',
      result: 0n,
    }
  }
  return {
    status: 'pending',
    label: 'Waiting for cross-chain oracle response...',
    result: 0n,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface UserBalances {
  /** Vault shares the user holds */
  shareBalance: bigint
  /** Underlying token balance in wallet (for deposit input) */
  underlyingBalance: bigint
  /** convertToAssets(shareBalance) — vault position value */
  estimatedAssets: bigint
}

/**
 * Read the user's token balances relevant to a vault.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param user          User wallet address
 * @returns             Share balance, underlying wallet balance, and estimated assets
 */
export async function getUserBalances(
  publicClient: PublicClient,
  vault: Address,
  user: Address,
): Promise<UserBalances> {
  const v = getAddress(vault)
  const u = getAddress(user)

  // Batch 1: get underlying address, share balance, decimals
  const b1Results = await publicClient.multicall({
    contracts: [
      { address: v, abi: VAULT_ABI,   functionName: 'balanceOf', args: [u] },
      { address: v, abi: METADATA_ABI, functionName: 'decimals' },
      { address: v, abi: VAULT_ABI,   functionName: 'asset' },
    ],
    allowFailure: true,
  })
  const shareBalance = b1Results[0].status === 'success' ? (b1Results[0].result as bigint) : 0n
  const underlying   = b1Results[2].status === 'success' ? (b1Results[2].result as Address) : '0x0000000000000000000000000000000000000000' as Address

  const underlyingAddr = getAddress(underlying)

  // Batch 2: underlying balance + estimated assets (skip convertToAssets if no shares)
  const [underlyingBalance, estimatedAssets] = await Promise.all([
    publicClient.readContract({
      address: underlyingAddr,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [u],
    }),
    shareBalance === 0n
      ? Promise.resolve(0n)
      : publicClient.readContract({
          address: v,
          abi: VAULT_ABI,
          functionName: 'convertToAssets',
          args: [shareBalance],
        }),
  ])

  return {
    shareBalance,
    underlyingBalance,
    estimatedAssets,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MaxWithdrawable {
  /** How many shares can be redeemed right now */
  shares: bigint
  /** How many underlying assets that corresponds to */
  assets: bigint
}

/**
 * Calculate the maximum amount a user can withdraw from a vault right now.
 *
 * For hub vaults without oracle accounting, this is limited by hub liquidity.
 * For local and oracle vaults, all assets are immediately redeemable.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param user          User wallet address
 * @returns             Maximum withdrawable shares and assets
 */
export async function getMaxWithdrawable(
  publicClient: PublicClient,
  vault: Address,
  user: Address,
): Promise<MaxWithdrawable> {
  const v = getAddress(vault)
  const u = getAddress(user)

  // Batch 1: isHub, oraclesCrossChainAccounting, user share balance, underlying address
  const b1Mw = await publicClient.multicall({
    contracts: [
      { address: v, abi: CONFIG_ABI, functionName: 'isHub' },
      { address: v, abi: BRIDGE_ABI, functionName: 'oraclesCrossChainAccounting' },
      { address: v, abi: VAULT_ABI,  functionName: 'balanceOf', args: [u] },
      { address: v, abi: VAULT_ABI,  functionName: 'asset' },
    ],
    allowFailure: true,
  })
  const isHub        = b1Mw[0].status === 'success' ? (b1Mw[0].result as boolean) : false
  const oraclesEnabled = b1Mw[1].status === 'success' ? (b1Mw[1].result as boolean) : false
  const userShares   = b1Mw[2].status === 'success' ? (b1Mw[2].result as bigint)  : 0n
  const underlying   = b1Mw[3].status === 'success' ? (b1Mw[3].result as Address) : '0x0000000000000000000000000000000000000000' as Address

  if (userShares === 0n) {
    return { shares: 0n, assets: 0n }
  }

  const underlyingAddr = getAddress(underlying)

  // Batch 2: estimated assets for user shares + hub liquid balance
  const [estimatedAssets, hubLiquidBalance] = await Promise.all([
    publicClient.readContract({
      address: v,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [userShares],
    }),
    publicClient.readContract({
      address: underlyingAddr,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [v],
    }),
  ])

  let maxAssets: bigint
  if (isHub && !oraclesEnabled) {
    // Hub vault: limited by hub liquidity
    maxAssets = estimatedAssets < hubLiquidBalance ? estimatedAssets : hubLiquidBalance
  } else {
    // Local or oracle vault: all assets redeemable
    maxAssets = estimatedAssets
  }

  // Convert back to shares if limited by hub liquidity
  let maxShares: bigint
  if (maxAssets < estimatedAssets) {
    maxShares = await publicClient.readContract({
      address: v,
      abi: VAULT_ABI,
      functionName: 'convertToShares',
      args: [maxAssets],
    })
  } else {
    maxShares = userShares
  }

  return {
    shares: maxShares,
    assets: maxAssets,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export type VaultSummary = VaultStatus & VaultMetadata

/**
 * Get a combined snapshot of vault status and metadata in one call.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @returns             Merged VaultStatus and VaultMetadata
 */
export async function getVaultSummary(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultSummary> {
  const [status, metadata] = await Promise.all([
    getVaultStatus(publicClient, vault),
    getVaultMetadata(publicClient, vault),
  ])
  return { ...status, ...metadata }
}

// ─────────────────────────────────────────────────────────────────────────────

const FACTORY_COMPOSER_ABI = [
  {
    type: 'function' as const,
    name: 'vaultComposer',
    inputs: [{ name: '_vault', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view' as const,
  },
] as const

const COMPOSER_SHARE_OFT_ABI = [
  {
    type: 'function' as const,
    name: 'SHARE_OFT',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view' as const,
  },
] as const

export interface MultiChainUserPosition {
  /** Shares held directly on the hub vault (vault.balanceOf) */
  hubShares: bigint
  /** Per-spoke SHARE_OFT balances normalized to vault decimals: { [chainId]: bigint } */
  spokeShares: Record<number, bigint>
  /** Per-spoke SHARE_OFT raw balances in OFT native decimals: { [chainId]: bigint }
   *  Use these for bridgeSharesToHub() and quoteShareBridgeFee() */
  rawSpokeShares: Record<number, bigint>
  /** hubShares + sum of all spokeShares (in vault decimals) */
  totalShares: bigint
  /** convertToAssets(totalShares) on the hub */
  estimatedAssets: bigint
  /** Share price: convertToAssets(10^decimals) */
  sharePrice: bigint
  /** Vault decimals */
  decimals: number
  /** Pending async withdrawal request on hub, or null */
  pendingWithdrawal: {
    shares: bigint
    timelockEndsAt: bigint
    canRedeemNow: boolean
  } | null
}

/**
 * Read the user's position across all chains of an omni vault.
 *
 * Discovers topology automatically, reads hub shares + pending withdrawal,
 * then reads SHARE_OFT balances on each spoke chain in parallel.
 *
 * For local (single-chain) vaults, spokeShares will be empty and this
 * behaves identically to getUserPosition.
 *
 * @param vault  Vault address (same on all chains via CREATE3)
 * @param user   User wallet address
 * @returns      Aggregated position across all chains
 */
export async function getUserPositionMultiChain(
  vault: Address,
  user: Address,
): Promise<MultiChainUserPosition> {
  const v = getAddress(vault)
  const u = getAddress(user)

  // Step 1: discover topology
  const topo = await discoverVaultTopology(vault)
  const hubClient = createChainClient(topo.hubChainId)
  if (!hubClient) throw new MoreVaultsError(`No RPC available for hub chain ${topo.hubChainId}`)

  // Step 2: read hub data (shares, decimals, withdrawal request)
  const hubMcResults = await (hubClient as PublicClient).multicall({
    contracts: [
      { address: v, abi: VAULT_ABI, functionName: 'balanceOf', args: [u] },
      { address: v, abi: METADATA_ABI, functionName: 'decimals' },
      { address: v, abi: VAULT_ABI, functionName: 'getWithdrawalRequest', args: [u] },
    ],
    allowFailure: true,
  })
  const hubShares       = hubMcResults[0].status === 'success' ? (hubMcResults[0].result as bigint) : 0n
  const decimals        = hubMcResults[1].status === 'success' ? (hubMcResults[1].result as number) : 18
  const withdrawalRequest = hubMcResults[2].status === 'success' ? hubMcResults[2].result : [0n, 0n]

  const [withdrawShares, timelockEndsAt] = withdrawalRequest as unknown as [bigint, bigint]

  // Step 3: resolve SHARE_OFT addresses for spokes (if any)
  const spokeShares: Record<number, bigint> = {}
  const rawSpokeShares: Record<number, bigint> = {}

  if (topo.spokeChainIds.length > 0) {
    // Get hub SHARE_OFT via factory → composer → SHARE_OFT
    let hubShareOft: Address | null = null
    try {
      const composerAddress = await (hubClient as PublicClient).readContract({
        address: OMNI_FACTORY_ADDRESS,
        abi: FACTORY_COMPOSER_ABI,
        functionName: 'vaultComposer',
        args: [v],
      }) as Address

      if (composerAddress !== '0x0000000000000000000000000000000000000000') {
        hubShareOft = await (hubClient as PublicClient).readContract({
          address: composerAddress,
          abi: COMPOSER_SHARE_OFT_ABI,
          functionName: 'SHARE_OFT',
        }) as Address
      }
    } catch { /* no composer — skip spoke reads */ }

    if (hubShareOft) {
      // Read spoke SHARE_OFT addresses via peers() and balances in parallel
      const spokePromises = topo.spokeChainIds.map(async (spokeChainId) => {
        try {
          const spokeEid = CHAIN_ID_TO_EID[spokeChainId]
          if (!spokeEid) return { chainId: spokeChainId, balance: 0n, rawBalance: 0n }

          // Get spoke SHARE_OFT address from hub peers()
          const spokeOftBytes32 = await (hubClient as PublicClient).readContract({
            address: hubShareOft!,
            abi: OFT_ABI,
            functionName: 'peers',
            args: [spokeEid],
          }) as `0x${string}`

          const spokeOft = getAddress(`0x${spokeOftBytes32.slice(-40)}`) as Address
          if (spokeOft === '0x0000000000000000000000000000000000000000') {
            return { chainId: spokeChainId, balance: 0n, rawBalance: 0n }
          }

          // Read balance + decimals on spoke chain
          const spokeClient = createChainClient(spokeChainId)
          if (!spokeClient) return { chainId: spokeChainId, balance: 0n, rawBalance: 0n }

          const [rawBalance, spokeOftDecimals] = await (spokeClient as PublicClient).multicall({
            contracts: [
              { address: spokeOft, abi: ERC20_ABI, functionName: 'balanceOf', args: [u] },
              { address: spokeOft, abi: METADATA_ABI, functionName: 'decimals' },
            ],
            allowFailure: false,
          })

          // Normalize SHARE_OFT balance to vault decimals
          // Spoke OFTs may use different decimals (e.g. 18) than the vault shares (e.g. 8)
          let balance: bigint
          if (spokeOftDecimals > decimals) {
            balance = rawBalance / (10n ** BigInt(spokeOftDecimals - decimals))
          } else if (spokeOftDecimals < decimals) {
            balance = rawBalance * (10n ** BigInt(decimals - spokeOftDecimals))
          } else {
            balance = rawBalance
          }

          return { chainId: spokeChainId, balance, rawBalance }
        } catch {
          return { chainId: spokeChainId, balance: 0n, rawBalance: 0n }
        }
      })

      const results = await Promise.all(spokePromises)
      for (const { chainId, balance, rawBalance } of results) {
        spokeShares[chainId] = balance
        rawSpokeShares[chainId] = rawBalance
      }
    }
  }

  // Step 4: compute totals
  const totalSpokeShares = Object.values(spokeShares).reduce((sum, b) => sum + b, 0n)
  const totalShares = hubShares + totalSpokeShares

  const oneShare = 10n ** BigInt(decimals)
  const [estimatedAssets, sharePrice] = await Promise.all([
    totalShares === 0n
      ? Promise.resolve(0n)
      : (hubClient as PublicClient).readContract({ address: v, abi: VAULT_ABI, functionName: 'convertToAssets', args: [totalShares] }),
    (hubClient as PublicClient).readContract({ address: v, abi: VAULT_ABI, functionName: 'convertToAssets', args: [oneShare] }),
  ])

  // Step 5: pending withdrawal
  const block = await (hubClient as PublicClient).getBlock()
  const pendingWithdrawal = withdrawShares === 0n
    ? null
    : {
        shares: withdrawShares,
        timelockEndsAt,
        canRedeemNow: timelockEndsAt === 0n || block.timestamp >= timelockEndsAt,
      }

  return {
    hubShares,
    spokeShares,
    rawSpokeShares,
    totalShares,
    estimatedAssets,
    sharePrice,
    decimals,
    pendingWithdrawal,
  }
}
