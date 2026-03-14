/**
 * Curator / vault-manager read helpers for the MoreVaults SDK.
 *
 * All functions are read-only (no wallet needed) and use multicall for
 * batched RPC efficiency.
 */

import { type Address, type PublicClient, getAddress } from 'viem'
import { MULTICALL_ABI, CURATOR_CONFIG_ABI } from './abis.js'
import type { CuratorVaultStatus, PendingAction } from './types.js'

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
