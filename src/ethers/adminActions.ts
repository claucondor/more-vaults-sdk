/**
 * Admin / owner / guardian direct write operations for the MoreVaults ethers.js v6 SDK (Phase 7).
 *
 * @module adminActions
 */

import { Contract } from "ethers";
import type { Signer, ContractTransactionReceipt } from "ethers";
import { ADMIN_WRITE_ABI } from "./abis";

// ─────────────────────────────────────────────────────────────────────────────
// Curator direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the vault deposit capacity. Curator-only.
 */
export async function setDepositCapacity(
  signer: Signer,
  vault: string,
  capacity: bigint,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.setDepositCapacity(capacity);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Add a single available asset to the vault. Curator-only.
 */
export async function addAvailableAsset(
  signer: Signer,
  vault: string,
  asset: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.addAvailableAsset(asset);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Add multiple available assets to the vault. Curator-only.
 */
export async function addAvailableAssets(
  signer: Signer,
  vault: string,
  assets: string[],
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.addAvailableAssets(assets);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Disable an asset for deposits. Curator-only.
 */
export async function disableAssetToDeposit(
  signer: Signer,
  vault: string,
  asset: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.disableAssetToDeposit(asset);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the fee recipient address. Owner-only.
 */
export async function setFeeRecipient(
  signer: Signer,
  vault: string,
  recipient: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.setFeeRecipient(recipient);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Set the deposit whitelist with per-depositor caps. Owner-only.
 */
export async function setDepositWhitelist(
  signer: Signer,
  vault: string,
  depositors: string[],
  caps: bigint[],
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.setDepositWhitelist(depositors, caps);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Enable the deposit whitelist. Owner-only.
 */
export async function enableDepositWhitelist(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.enableDepositWhitelist();
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Pause the vault. Owner/guardian.
 */
export async function pauseVault(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.pause();
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

/**
 * Unpause the vault. Owner-only.
 */
export async function unpauseVault(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.unpause();
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardian direct actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recover assets from the vault to a receiver. Guardian-only.
 */
export async function recoverAssets(
  signer: Signer,
  vault: string,
  asset: string,
  receiver: string,
  amount: bigint,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.recoverAssets(asset, receiver, amount);
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending owner actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accept pending ownership transfer. Must be called by the pending owner.
 */
export async function acceptOwnership(
  signer: Signer,
  vault: string,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const contract = new Contract(vault, ADMIN_WRITE_ABI, signer);
  const tx = await contract.acceptOwnership();
  const receipt: ContractTransactionReceipt = await tx.wait();
  return { receipt };
}
