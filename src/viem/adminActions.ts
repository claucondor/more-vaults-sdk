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
import { InvalidInputError } from './errors.js'
import { parseContractError } from './errorParser.js'

// ─────────────────────────────────────────────────────────────────────────────
// Curator direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the vault deposit capacity. Curator-only.
 *
 * @param walletClient  Wallet client with curator account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param capacity      New deposit capacity in underlying token decimals; use MaxUint256 for unlimited
 * @returns             Transaction hash
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function setDepositCapacity(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  capacity: bigint,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'setDepositCapacity',
      args: [capacity],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 *
 * @param walletClient  Wallet client with curator account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param asset         ERC-20 token address to add as an available asset
 * @returns             Transaction hash
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function addAvailableAsset(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  asset: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'addAvailableAsset',
      args: [getAddress(asset)],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Add multiple available assets to the vault in a single transaction. Curator-only.
 *
 * @param walletClient  Wallet client with curator account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param assets        Array of ERC-20 token addresses to add
 * @returns             Transaction hash
 * @throws {NotCuratorError} If the caller is not the vault curator
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

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'addAvailableAssets',
      args: [checksummed],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Disable an asset for deposits so users can no longer deposit it. Curator-only.
 *
 * @param walletClient  Wallet client with curator account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param asset         ERC-20 token address to disable for deposits
 * @returns             Transaction hash
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function disableAssetToDeposit(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  asset: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'disableAssetToDeposit',
      args: [getAddress(asset)],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Set the fee recipient address where management and performance fees are sent. Owner-only.
 *
 * @param walletClient  Wallet client with owner account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param recipient     Address that will receive vault fees
 * @returns             Transaction hash
 * @throws {NotOwnerError} If the caller is not the vault owner
 */
export async function setFeeRecipient(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  recipient: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'setFeeRecipient',
      args: [getAddress(recipient)],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Set the deposit whitelist with per-depositor deposit caps. Owner-only.
 *
 * @param walletClient  Wallet client with owner account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param depositors    Array of addresses to whitelist
 * @param caps          Array of maximum deposit amounts per depositor (parallel to `depositors`)
 * @returns             Transaction hash
 * @throws {NotOwnerError}     If the caller is not the vault owner
 * @throws {InvalidInputError} If `depositors` and `caps` arrays have different lengths
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

  if (depositors.length !== caps.length) {
    throw new InvalidInputError('depositors and caps arrays must have the same length')
  }

  const checksummed = depositors.map(getAddress)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'setDepositWhitelist',
      args: [checksummed, caps],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Enable the deposit whitelist so only whitelisted addresses can deposit. Owner-only.
 *
 * @param walletClient  Wallet client with owner account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @returns             Transaction hash
 * @throws {NotOwnerError} If the caller is not the vault owner
 */
export async function enableDepositWhitelist(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'enableDepositWhitelist',
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Pause the vault, halting all deposits and redeems. Can be called by owner or guardian.
 *
 * @param walletClient  Wallet client with owner or guardian account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @returns             Transaction hash
 * @throws {NotOwnerError}    If the caller is neither owner nor guardian
 * @throws {VaultPausedError} If the vault is already paused
 */
export async function pauseVault(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'pause',
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Unpause the vault to resume deposits and redeems. Owner-only.
 *
 * @param walletClient  Wallet client with owner account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @returns             Transaction hash
 * @throws {NotOwnerError} If the caller is not the vault owner
 */
export async function unpauseVault(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'unpause',
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Recover accidentally sent or stuck assets from the vault to a receiver. Guardian-only.
 *
 * @param walletClient  Wallet client with guardian account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @param asset         ERC-20 token address to recover
 * @param receiver      Address that will receive the recovered tokens
 * @param amount        Amount of tokens to recover (in token decimals)
 * @returns             Transaction hash
 * @throws {NotGuardianError} If the caller is not the vault guardian
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

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'recoverAssets',
      args: [getAddress(asset), getAddress(receiver), amount],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

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
 * Accept a pending ownership transfer initiated by the current owner.
 *
 * Must be called by the pending owner (the address that was designated via
 * `transferOwnership`). After this call, the caller becomes the new owner.
 *
 * @param walletClient  Wallet client with the pending owner account attached
 * @param publicClient  Public client for simulation
 * @param vault         Vault address (diamond proxy)
 * @returns             Transaction hash
 * @throws {NotOwnerError} If the caller is not the pending owner
 */
export async function acceptOwnership(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  try {
    await publicClient.simulateContract({
      address: v,
      abi: ADMIN_WRITE_ABI,
      functionName: 'acceptOwnership',
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

  const txHash = await walletClient.writeContract({
    address: v,
    abi: ADMIN_WRITE_ABI,
    functionName: 'acceptOwnership',
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}
