/**
 * Pre-flight validation helpers for MoreVaults SDK flows.
 *
 * Each function reads on-chain state and throws a descriptive error BEFORE
 * the actual contract call, so developers see a clear, actionable message
 * instead of a raw VM revert.
 */

import { type Address, type PublicClient, getAddress, zeroAddress } from 'viem'
import { CONFIG_ABI, BRIDGE_ABI, VAULT_ABI, ERC20_ABI } from './abis'

/**
 * Pre-flight checks for async cross-chain flows (D4 / D5 / R5).
 *
 * Validates that:
 * 1. The CCManager is configured on the vault.
 * 2. An escrow is registered in the vault's registry.
 * 3. The vault is a hub (required for async flows).
 * 4. The vault does NOT have oracle-based cross-chain accounting enabled
 *    (oracle-on vaults should use depositSimple / depositCrossChainOracleOn).
 * 5. The vault is not paused.
 *
 * All reads that are independent of each other are executed in parallel via
 * Promise.all to minimise latency.
 *
 * @param publicClient  Public client for contract reads
 * @param vault         Vault address (diamond proxy)
 * @param escrow        Escrow address from VaultAddresses
 */
export async function preflightAsync(
  publicClient: PublicClient,
  vault: Address,
  escrow: Address,
): Promise<void> {
  const v = getAddress(vault)

  // Parallel read: ccManager, escrow, isHub, oraclesCrossChainAccounting, paused
  const [ccManager, registeredEscrow, isHub, oraclesEnabled, isPaused] =
    await Promise.all([
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'getCrossChainAccountingManager',
      }),
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'getEscrow',
      }),
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'isHub',
      }),
      publicClient.readContract({
        address: v,
        abi: BRIDGE_ABI,
        functionName: 'oraclesCrossChainAccounting',
      }),
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'paused',
      }),
    ])

  if (ccManager === zeroAddress) {
    throw new Error(
      `[MoreVaults] CCManager not configured on vault ${vault}. Call setCrossChainAccountingManager(ccManagerAddress) as vault owner first.`,
    )
  }

  if (registeredEscrow === zeroAddress) {
    throw new Error(
      `[MoreVaults] Escrow not configured for vault ${vault}. The registry must have an escrow set for this vault.`,
    )
  }

  if (!isHub) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is not a hub vault. Async flows (D4/D5/R5) only work on hub vaults.`,
    )
  }

  if (oraclesEnabled) {
    throw new Error(
      `[MoreVaults] Vault ${vault} has oracle-based cross-chain accounting enabled. Use depositSimple/depositCrossChainOracleOn instead of async flows.`,
    )
  }

  if (isPaused) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`,
    )
  }
}

/**
 * Pre-flight liquidity check for async redeem (R5).
 *
 * Reads the hub's liquid balance of the underlying token and compares it
 * against the assets the user expects to receive. If the hub does not hold
 * enough liquid assets the redeem will be auto-refunded after the LZ round-trip,
 * wasting the LayerZero fee.
 *
 * This check is best-effort: liquidity could change in the 1-5 minutes between
 * submission and execution. But it catches the common case where the hub is
 * already under-funded at the time of submission.
 *
 * @param publicClient  Public client for contract reads
 * @param vault         Vault address (diamond proxy)
 * @param shares        Shares the user intends to redeem
 */
export async function preflightRedeemLiquidity(
  publicClient: PublicClient,
  vault: Address,
  shares: bigint,
): Promise<void> {
  const v = getAddress(vault)

  // Need underlying address first
  const underlying = await publicClient.readContract({
    address: v,
    abi: VAULT_ABI,
    functionName: 'asset',
  })

  // Parallel: hub liquid balance + estimated assets for these shares
  const [hubLiquid, assetsNeeded] = await Promise.all([
    publicClient.readContract({
      address: getAddress(underlying as Address),
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [v],
    }),
    publicClient.readContract({
      address: v,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [shares],
    }),
  ])

  if ((hubLiquid as bigint) < (assetsNeeded as bigint)) {
    throw new Error(
      `[MoreVaults] Insufficient hub liquidity for redeem.\n` +
      `  Hub liquid balance : ${hubLiquid}\n` +
      `  Estimated required : ${assetsNeeded}\n` +
      `Submitting this redeem will waste the LayerZero fee — the request will be auto-refunded.\n` +
      `Ask the vault curator to repatriate liquidity from spoke chains first.`,
    )
  }
}

/**
 * Pre-flight checks for synchronous deposit flows (D1 / D3).
 *
 * Validates that:
 * 1. The vault is not paused.
 * 2. The vault still has deposit capacity (maxDeposit > 0).
 *
 * Both reads are executed in parallel.
 *
 * @param publicClient  Public client for contract reads
 * @param vault         Vault address (diamond proxy)
 */
export async function preflightSync(
  publicClient: PublicClient,
  vault: Address,
): Promise<void> {
  const v = getAddress(vault)

  // Run paused and maxDeposit in parallel.
  // maxDeposit(address(0)) may REVERT on whitelisted vaults — catch separately.
  const [isPaused, depositCapResult] = await Promise.all([
    publicClient.readContract({
      address: v,
      abi: CONFIG_ABI,
      functionName: 'paused',
    }),
    publicClient
      .readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'maxDeposit',
        args: [zeroAddress],
      })
      .catch(() => null as null),
  ])

  if (isPaused) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`,
    )
  }

  // null means maxDeposit reverted → whitelist vault — skip capacity check
  // (the user may still be whitelisted; canDeposit will do user-specific check)
  if (depositCapResult !== null && depositCapResult === 0n) {
    throw new Error(
      `[MoreVaults] Vault ${vault} has reached deposit capacity. No more deposits accepted.`,
    )
  }
}
