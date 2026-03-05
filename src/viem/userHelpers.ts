import { type Address, type PublicClient, getAddress } from 'viem'
import { BRIDGE_ABI, CONFIG_ABI, VAULT_ABI, METADATA_ABI } from './abis'
import type { CrossChainRequestInfo } from './types'

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

  // First batch: balance, decimals, withdrawal request (all independent)
  const [shares, decimals, withdrawalRequest, block] = await Promise.all([
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'balanceOf', args: [u] }),
    publicClient.readContract({ address: v, abi: METADATA_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'getWithdrawalRequest', args: [u] }),
    publicClient.getBlock(),
  ])

  const [withdrawShares, timelockEndsAt] = withdrawalRequest as [bigint, bigint]

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
  return publicClient.readContract({
    address: getAddress(vault),
    abi: VAULT_ABI,
    functionName: 'previewDeposit',
    args: [assets],
  })
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
  return publicClient.readContract({
    address: getAddress(vault),
    abi: VAULT_ABI,
    functionName: 'previewRedeem',
    args: [shares],
  })
}

// ─────────────────────────────────────────────────────────────────────────────

export type DepositBlockReason = 'paused' | 'capacity-full' | 'not-whitelisted' | 'ok'

export interface DepositEligibility {
  allowed: boolean
  reason: DepositBlockReason
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

  const [isPaused, maxDepositAmount] = await Promise.all([
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'paused' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'maxDeposit', args: [getAddress(user)] }),
  ])

  if (isPaused) {
    return { allowed: false, reason: 'paused' }
  }
  if (maxDepositAmount === 0n) {
    // maxDeposit returns 0 both when capacity is full and when user is not whitelisted
    return { allowed: false, reason: 'capacity-full' }
  }
  return { allowed: true, reason: 'ok' }
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

  // First batch: vault metadata (all independent)
  const [name, symbol, decimals, underlying] = await Promise.all([
    publicClient.readContract({ address: v, abi: METADATA_ABI, functionName: 'name' }),
    publicClient.readContract({ address: v, abi: METADATA_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: v, abi: METADATA_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'asset' }),
  ])

  // Second batch: underlying token metadata (needs underlying address)
  const underlyingAddr = getAddress(underlying)
  const [underlyingSymbol, underlyingDecimals] = await Promise.all([
    publicClient.readContract({ address: underlyingAddr, abi: METADATA_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: underlyingAddr, abi: METADATA_ABI, functionName: 'decimals' }),
  ])

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

  const [info, finalizationResult] = await Promise.all([
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
