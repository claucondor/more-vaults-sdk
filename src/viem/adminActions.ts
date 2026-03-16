/**
 * Admin / owner / guardian direct write operations for the MoreVaults SDK (Phase 7).
 *
 * All write functions use the simulate-then-write pattern:
 *   1. `publicClient.simulateContract` -- validates on-chain, catches reverts early
 *   2. `walletClient.writeContract`    -- sends the actual transaction
 *
 * @module adminActions
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  getAddress,
} from 'viem'
import { ADMIN_WRITE_ABI } from './abis.js'

// ─────────────────────────────────────────────────────────────────────────────
// Curator direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the vault deposit capacity. Curator-only.
 */
export async function setDepositCapacity(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  capacity: bigint,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'setDepositCapacity',
    args: [capacity],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'setDepositCapacity',
    args: [capacity],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Add a single available asset to the vault. Curator-only.
 */
export async function addAvailableAsset(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  asset: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'addAvailableAsset',
    args: [getAddress(asset)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'addAvailableAsset',
    args: [getAddress(asset)],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Add multiple available assets to the vault. Curator-only.
 */
export async function addAvailableAssets(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  assets: Address[],
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)
  const checksummed = assets.map(getAddress)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'addAvailableAssets',
    args: [checksummed],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'addAvailableAssets',
    args: [checksummed],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Disable an asset for deposits. Curator-only.
 */
export async function disableAssetToDeposit(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  asset: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'disableAssetToDeposit',
    args: [getAddress(asset)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'disableAssetToDeposit',
    args: [getAddress(asset)],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the fee recipient address. Owner-only.
 */
export async function setFeeRecipient(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  recipient: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'setFeeRecipient',
    args: [getAddress(recipient)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'setFeeRecipient',
    args: [getAddress(recipient)],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Set the deposit whitelist with per-depositor caps. Owner-only.
 */
export async function setDepositWhitelist(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  depositors: Address[],
  caps: bigint[],
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)
  const checksummed = depositors.map(getAddress)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'setDepositWhitelist',
    args: [checksummed, caps],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'setDepositWhitelist',
    args: [checksummed, caps],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Enable the deposit whitelist. Owner-only.
 */
export async function enableDepositWhitelist(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'enableDepositWhitelist',
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'enableDepositWhitelist',
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Pause the vault. Owner/guardian.
 */
export async function pauseVault(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'pause',
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'pause',
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Unpause the vault. Owner-only.
 */
export async function unpauseVault(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'unpause',
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'unpause',
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardian direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recover assets from the vault to a receiver. Guardian-only.
 */
export async function recoverAssets(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  asset: Address,
  receiver: Address,
  amount: bigint,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'recoverAssets',
    args: [getAddress(asset), getAddress(receiver), amount],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'recoverAssets',
    args: [getAddress(asset), getAddress(receiver), amount],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending owner actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accept pending ownership transfer. Must be called by the pending owner.
 */
export async function acceptOwnership(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  await publicClient.simulateContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'acceptOwnership',
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'acceptOwnership',
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}
