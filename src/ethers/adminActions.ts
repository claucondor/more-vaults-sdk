/**
 * Admin / owner / guardian direct write operations for the MoreVaults ethers.js v6 SDK (Phase 7).
 *
 * @module adminActions
 */

import { Contract } from "ethers";
import type { Signer, ContractTransactionReceipt } from "ethers";
import { ADMIN_WRITE_ABI } from "./abis";
import { parseContractError } from "./errorParser";
import { InvalidInputError } from "./errors";

// ─────────────────────────────────────────────────────────────────────────────
// Curator direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the vault deposit capacity. Curator-only.
 *
 * @param signer    Signer with the curator account attached
 * @param vault     Vault address (diamond proxy)
 * @param capacity  New deposit capacity in underlying token decimals; use MaxUint256 for unlimited
 * @returns         Transaction receipt
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function setDepositCapacity(
  signer: Signer,
  vault: string,
  capacity: bigint,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.setDepositCapacity(capacity);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Add a single available asset to the vault. Curator-only.
 *
 * @param signer  Signer with the curator account attached
 * @param vault   Vault address (diamond proxy)
 * @param asset   ERC-20 token address to add as an available asset
 * @returns       Transaction receipt
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function addAvailableAsset(
  signer: Signer,
  vault: string,
  asset: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.addAvailableAsset(asset);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Add multiple available assets to the vault in a single transaction. Curator-only.
 *
 * @param signer  Signer with the curator account attached
 * @param vault   Vault address (diamond proxy)
 * @param assets  Array of ERC-20 token addresses to add
 * @returns       Transaction receipt
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function addAvailableAssets(
  signer: Signer,
  vault: string,
  assets: string[],
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.addAvailableAssets(assets);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Disable an asset for deposits so users can no longer deposit it. Curator-only.
 *
 * @param signer  Signer with the curator account attached
 * @param vault   Vault address (diamond proxy)
 * @param asset   ERC-20 token address to disable for deposits
 * @returns       Transaction receipt
 * @throws {NotCuratorError} If the caller is not the vault curator
 */
export async function disableAssetToDeposit(
  signer: Signer,
  vault: string,
  asset: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.disableAssetToDeposit(asset);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the fee recipient address where management and performance fees are sent. Owner-only.
 *
 * @param signer     Signer with the owner account attached
 * @param vault      Vault address (diamond proxy)
 * @param recipient  Address that will receive vault fees
 * @returns          Transaction receipt
 * @throws {NotOwnerError} If the caller is not the vault owner
 */
export async function setFeeRecipient(
  signer: Signer,
  vault: string,
  recipient: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.setFeeRecipient(recipient);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Set the deposit whitelist with per-depositor deposit caps. Owner-only.
 *
 * @param signer      Signer with the owner account attached
 * @param vault       Vault address (diamond proxy)
 * @param depositors  Array of addresses to whitelist
 * @param caps        Array of maximum deposit amounts per depositor (parallel to `depositors`)
 * @returns           Transaction receipt
 * @throws {NotOwnerError}     If the caller is not the vault owner
 * @throws {InvalidInputError} If `depositors` and `caps` arrays have different lengths
 */
export async function setDepositWhitelist(
  signer: Signer,
  vault: string,
  depositors: string[],
  caps: bigint[],
): Promise<{ receipt: ContractTransactionReceipt }> {
  if (depositors.length !== caps.length) {
    throw new InvalidInputError('depositors and caps arrays must have the same length')
  }
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.setDepositWhitelist(depositors, caps);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Enable the deposit whitelist so only whitelisted addresses can deposit. Owner-only.
 *
 * @param signer  Signer with the owner account attached
 * @param vault   Vault address (diamond proxy)
 * @returns       Transaction receipt
 * @throws {NotOwnerError} If the caller is not the vault owner
 */
export async function enableDepositWhitelist(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.enableDepositWhitelist();
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Pause the vault, halting all deposits and redeems. Can be called by owner or guardian.
 *
 * @param signer  Signer with the owner or guardian account attached
 * @param vault   Vault address (diamond proxy)
 * @returns       Transaction receipt
 * @throws {NotOwnerError}    If the caller is neither owner nor guardian
 * @throws {VaultPausedError} If the vault is already paused
 */
export async function pauseVault(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.pause();
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

/**
 * Unpause the vault to resume deposits and redeems. Owner-only.
 *
 * @param signer  Signer with the owner account attached
 * @param vault   Vault address (diamond proxy)
 * @returns       Transaction receipt
 * @throws {NotOwnerError} If the caller is not the vault owner
 */
export async function unpauseVault(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.unpause();
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardian direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recover accidentally sent or stuck assets from the vault to a receiver. Guardian-only.
 *
 * @param signer    Signer with the guardian account attached
 * @param vault     Vault address (diamond proxy)
 * @param asset     ERC-20 token address to recover
 * @param receiver  Address that will receive the recovered tokens
 * @param amount    Amount of tokens to recover (in token decimals)
 * @returns         Transaction receipt
 * @throws {NotGuardianError} If the caller is not the vault guardian
 */
export async function recoverAssets(
  signer: Signer,
  vault: string,
  asset: string,
  receiver: string,
  amount: bigint,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.recoverAssets(asset, receiver, amount);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending owner actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accept a pending ownership transfer initiated by the current owner.
 *
 * Must be called by the pending owner (the address designated via `transferOwnership`).
 * After this call, the caller becomes the new owner.
 *
 * @param signer  Signer with the pending owner account attached
 * @param vault   Vault address (diamond proxy)
 * @returns       Transaction receipt
 * @throws {NotOwnerError} If the caller is not the pending owner
 */
export async function acceptOwnership(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  let tx: any
  try {
    tx = await contract.acceptOwnership();
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();
  return { receipt };
}
