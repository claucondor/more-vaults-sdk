/**
 * Vault Configuration reader for the MoreVaults SDK (Phase 7).
 *
 * Single multicall to fetch the complete admin/curator/guardian configuration
 * of a MoreVaults diamond vault.
 *
 * @module vaultConfig
 */

import { type Address, type PublicClient, getAddress, zeroAddress } from 'viem'
import {
  ADMIN_CONFIG_ABI,
  ACCESS_CONTROL_ABI,
  CURATOR_CONFIG_ABI,
  CONFIG_ABI,
  VAULT_ANALYSIS_ABI,
  MULTICALL_ABI,
} from './abis.js'
import type { VaultConfiguration } from './types.js'

/**
 * Read the full vault configuration in a single batched multicall.
 *
 * Uses `allowFailure: true` so that fields not present on older vault
 * deployments fall back to sensible defaults (zero address, 0n, false, etc.).
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Vault address (diamond proxy)
 * @returns             Complete VaultConfiguration snapshot
 */
export async function getVaultConfiguration(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultConfiguration> {
  const v = getAddress(vault)

  const results = await publicClient.multicall({
    contracts: [
      // 0: owner
      { address: v, abi: ACCESS_CONTROL_ABI, functionName: 'owner' },
      // 1: pendingOwner
      { address: v, abi: ACCESS_CONTROL_ABI, functionName: 'pendingOwner' },
      // 2: curator
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'curator' },
      // 3: guardian
      { address: v, abi: ACCESS_CONTROL_ABI, functionName: 'guardian' },
      // 4: fee
      { address: v, abi: ADMIN_CONFIG_ABI, functionName: 'fee' },
      // 5: withdrawalFee
      { address: v, abi: ADMIN_CONFIG_ABI, functionName: 'getWithdrawalFee' },
      // 6: feeRecipient
      { address: v, abi: ADMIN_CONFIG_ABI, functionName: 'feeRecipient' },
      // 7: depositCapacity
      { address: v, abi: ADMIN_CONFIG_ABI, functionName: 'depositCapacity' },
      // 8: maxSlippagePercent
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'getMaxSlippagePercent' },
      // 9: timeLockPeriod
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'timeLockPeriod' },
      // 10: currentNonce
      { address: v, abi: MULTICALL_ABI, functionName: 'getCurrentNonce' },
      // 11: withdrawalQueueStatus
      { address: v, abi: CONFIG_ABI, functionName: 'getWithdrawalQueueStatus' },
      // 12: withdrawalTimelock
      { address: v, abi: CONFIG_ABI, functionName: 'getWithdrawalTimelock' },
      // 13: maxWithdrawalDelay
      { address: v, abi: ADMIN_CONFIG_ABI, functionName: 'getMaxWithdrawalDelay' },
      // 14: depositWhitelistEnabled
      { address: v, abi: VAULT_ANALYSIS_ABI, functionName: 'isDepositWhitelistEnabled' },
      // 15: availableAssets
      { address: v, abi: CURATOR_CONFIG_ABI, functionName: 'getAvailableAssets' },
      // 16: depositableAssets
      { address: v, abi: VAULT_ANALYSIS_ABI, functionName: 'getDepositableAssets' },
      // 17: ccManager
      { address: v, abi: CONFIG_ABI, functionName: 'getCrossChainAccountingManager' },
      // 18: escrow
      { address: v, abi: CONFIG_ABI, functionName: 'getEscrow' },
      // 19: isHub
      { address: v, abi: CONFIG_ABI, functionName: 'isHub' },
      // 20: paused
      { address: v, abi: CONFIG_ABI, functionName: 'paused' },
      // 21: registry
      { address: v, abi: VAULT_ANALYSIS_ABI, functionName: 'moreVaultsRegistry' },
    ],
    allowFailure: true,
  })

  const addr = (i: number): Address =>
    results[i].status === 'success' ? getAddress(results[i].result as Address) : zeroAddress
  const bigint_ = (i: number): bigint =>
    results[i].status === 'success' ? (results[i].result as bigint) : 0n
  const bool_ = (i: number): boolean =>
    results[i].status === 'success' ? (results[i].result as boolean) : false
  const num_ = (i: number): number =>
    results[i].status === 'success' ? Number(results[i].result) : 0
  const addrArray = (i: number): Address[] =>
    results[i].status === 'success' ? (results[i].result as Address[]).map(getAddress) : []

  return {
    // Roles
    owner: addr(0),
    pendingOwner: addr(1),
    curator: addr(2),
    guardian: addr(3),
    // Fees
    fee: bigint_(4),
    withdrawalFee: bigint_(5),
    feeRecipient: addr(6),
    // Capacity & limits
    depositCapacity: bigint_(7),
    maxSlippagePercent: bigint_(8),
    // Timelock
    timeLockPeriod: bigint_(9),
    currentNonce: bigint_(10),
    // Withdrawal config
    withdrawalQueueEnabled: bool_(11),
    withdrawalTimelock: bigint_(12),
    maxWithdrawalDelay: num_(13),
    // Whitelist
    depositWhitelistEnabled: bool_(14),
    // Asset lists
    availableAssets: addrArray(15),
    depositableAssets: addrArray(16),
    // Cross-chain
    ccManager: addr(17),
    lzAdapter: addr(17), // same as ccManager for compatibility
    escrow: addr(18),
    isHub: bool_(19),
    // State
    paused: bool_(20),
    // Registry
    registry: addr(21),
  }
}
