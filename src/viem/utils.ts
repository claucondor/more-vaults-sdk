import {
  type Address,
  type PublicClient,
  type WalletClient,
  getAddress,
  zeroAddress,
} from 'viem'
import { BRIDGE_ABI, CONFIG_ABI, ERC20_ABI, VAULT_ABI, METADATA_ABI } from './abis'
import type { CrossChainRequestInfo } from './types'

// ─────────────────────────────────────────────────────────────────────────────

export type VaultMode =
  | 'local'                 // single-chain vault, no cross-chain
  | 'cross-chain-oracle'    // hub with oracle-based accounting (sync)
  | 'cross-chain-async'     // hub with off-chain accounting (async, D4/D5/R5)
  | 'paused'                // vault is paused
  | 'full'                  // deposit capacity reached

export interface VaultStatus {
  /** Vault operating mode — determines which SDK flow to use */
  mode: VaultMode
  /** Which deposit function to call given the current configuration */
  recommendedDepositFlow: 'depositSimple' | 'depositAsync' | 'mintAsync' | 'none'
  /** Which redeem function to call given the current configuration */
  recommendedRedeemFlow: 'redeemShares' | 'redeemAsync' | 'none'

  // ── Configuration ────────────────────────────────────────────────────────
  isHub: boolean
  isPaused: boolean
  oracleAccountingEnabled: boolean

  /** address(0) means CCManager is not set — async flows will fail */
  ccManager: Address
  /** address(0) means escrow is not configured in the registry */
  escrow: Address

  // ── Withdrawal queue ─────────────────────────────────────────────────────
  withdrawalQueueEnabled: boolean
  /** Timelock duration in seconds (0 = no timelock) */
  withdrawalTimelockSeconds: bigint

  // ── Capacity ─────────────────────────────────────────────────────────────
  /**
   * Remaining deposit capacity in underlying token decimals.
   * `type(uint256).max` = no cap configured (unlimited).
   * `0n` = vault is full — no more deposits accepted.
   * If `depositAccessRestricted = true`, this value is `type(uint256).max` but
   * deposits are still gated by whitelist or other access control.
   */
  remainingDepositCapacity: bigint
  /**
   * True when `maxDeposit(address(0))` reverted, indicating the vault uses
   * whitelist or other access control to restrict who can deposit.
   * Deposit flows will succeed only for addresses the vault operator has approved.
   */
  depositAccessRestricted: boolean

  // ── Vault metrics ────────────────────────────────────────────────────────
  underlying: Address
  totalAssets: bigint
  totalSupply: bigint
  /** Vault share token decimals. Use this for display — never hardcode 18. */
  decimals: number
  /**
   * Price of 1 full share expressed in underlying token units.
   * = convertToAssets(10^decimals). Grows over time as the vault earns yield.
   */
  sharePrice: bigint
  /**
   * Underlying token balance held directly on the hub chain.
   * This is the only portion that can be paid out to redeeming users immediately.
   * (= ERC-20.balanceOf(vault) on the hub)
   */
  hubLiquidBalance: bigint
  /**
   * Approximate value deployed to spoke chains (totalAssets − hubLiquidBalance).
   * These funds are NOT immediately redeemable — the vault curator must
   * call executeBridging to repatriate them before large redeems can succeed.
   */
  spokesDeployedBalance: bigint
  /**
   * Maximum assets that can be redeemed right now without curator intervention.
   * - For hub vaults: equals `hubLiquidBalance` (only what the hub holds).
   * - For local/oracle vaults: equals `totalAssets` (all assets are local).
   * Attempting to redeem more than this will revert (R1) or be auto-refunded (R5).
   */
  maxImmediateRedeemAssets: bigint

  // ── Issues — empty when everything is correctly configured ───────────────
  /**
   * Human-readable list of configuration problems that would cause transactions
   * to fail.  Empty array = vault is ready to use.
   */
  issues: string[]
}

/**
 * Read the full configuration and operational status of a vault in a single
 * multicall-friendly batch.
 *
 * Use this to:
 * - Determine which SDK flow to use (`recommendedDepositFlow`)
 * - Show a configuration checklist in an admin dashboard
 * - Surface `issues` to the developer before any transaction
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address (diamond proxy)
 * @returns             Full vault status snapshot
 *
 * @example
 * ```ts
 * const status = await getVaultStatus(publicClient, VAULT)
 * if (status.issues.length) {
 *   console.warn('Vault misconfigured:', status.issues)
 * }
 * // Use recommended flow:
 * if (status.recommendedDepositFlow === 'depositAsync') {
 *   await depositAsync(walletClient, publicClient, { vault: VAULT, escrow: status.escrow }, ...)
 * }
 * ```
 */
export async function getVaultStatus(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultStatus> {
  const v = getAddress(vault)

  // ── Batch 1: single multicall — 12 reads, 1 HTTP request ─────────────────
  // maxDeposit(address(0)) may revert on whitelisted vaults — allowFailure handles it.
  const b1 = await publicClient.multicall({
    contracts: [
      { address: v, abi: CONFIG_ABI,  functionName: 'isHub' },
      { address: v, abi: CONFIG_ABI,  functionName: 'paused' },
      { address: v, abi: BRIDGE_ABI,  functionName: 'oraclesCrossChainAccounting' },
      { address: v, abi: CONFIG_ABI,  functionName: 'getCrossChainAccountingManager' },
      { address: v, abi: CONFIG_ABI,  functionName: 'getEscrow' },
      { address: v, abi: CONFIG_ABI,  functionName: 'getWithdrawalQueueStatus' },
      { address: v, abi: CONFIG_ABI,  functionName: 'getWithdrawalTimelock' },
      { address: v, abi: CONFIG_ABI,  functionName: 'maxDeposit', args: [zeroAddress] },
      { address: v, abi: VAULT_ABI,   functionName: 'asset' },
      { address: v, abi: VAULT_ABI,   functionName: 'totalAssets' },
      { address: v, abi: VAULT_ABI,   functionName: 'totalSupply' },
      { address: v, abi: METADATA_ABI, functionName: 'decimals' },
    ] as const,
    allowFailure: true,
  })

  const isHub               = b1[0].status  === 'success' ? b1[0].result  as boolean : false
  const isPaused            = b1[1].status  === 'success' ? b1[1].result  as boolean : false
  const oraclesEnabled      = b1[2].status  === 'success' ? b1[2].result  as boolean : false
  const ccManager           = b1[3].status  === 'success' ? b1[3].result  as Address : zeroAddress
  const escrow              = b1[4].status  === 'success' ? b1[4].result  as Address : zeroAddress
  const withdrawalQueueEnabled     = b1[5].status === 'success' ? b1[5].result as boolean : false
  const withdrawalTimelockSeconds  = b1[6].status === 'success' ? b1[6].result as bigint  : 0n
  // null = reverted (whitelist/ACL), bigint = normal return
  const maxDepositRaw       = b1[7].status  === 'success' ? b1[7].result  as bigint  : null
  const underlying          = b1[8].status  === 'success' ? b1[8].result  as Address : zeroAddress
  const totalAssets         = b1[9].status  === 'success' ? b1[9].result  as bigint  : 0n
  const totalSupply         = b1[10].status === 'success' ? b1[10].result as bigint  : 0n
  const decimals            = b1[11].status === 'success' ? Number(b1[11].result)    : 18

  // ── Batch 2: depends on underlying + decimals from batch 1 ────────────────
  const oneShare = 10n ** BigInt(decimals)
  const b2 = await publicClient.multicall({
    contracts: [
      { address: getAddress(underlying), abi: ERC20_ABI,  functionName: 'balanceOf',      args: [v] },
      { address: v,                      abi: VAULT_ABI,  functionName: 'convertToAssets', args: [oneShare] },
    ] as const,
    allowFailure: true,
  })

  const hubLiquidBalance = b2[0].status === 'success' ? b2[0].result as bigint : 0n
  const sharePrice       = b2[1].status === 'success' ? b2[1].result as bigint : 0n

  const spokesDeployedBalance = totalAssets > hubLiquidBalance ? totalAssets - hubLiquidBalance : 0n

  // null = maxDeposit reverted.
  // For cross-chain-async hubs this is expected — the contract reverts with
  // NotAnERC4626CompatibleVault because maxDeposit is not meaningful in async mode.
  // Only treat the revert as "whitelist/ACL" when the vault is NOT a hub.
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
  const isCrossChainAsync = isHub && !oraclesEnabled
  const depositAccessRestricted = maxDepositRaw === null && !isCrossChainAsync
  const effectiveCapacity: bigint = (maxDepositRaw === null) ? MAX_UINT256 : maxDepositRaw

  // ── Derive mode ────────────────────────────────────────────────────────────
  let mode: VaultMode
  if (isPaused) {
    mode = 'paused'
  } else if (effectiveCapacity === 0n) {
    mode = 'full'
  } else if (!isHub) {
    mode = 'local'
  } else if (oraclesEnabled) {
    mode = 'cross-chain-oracle'
  } else {
    mode = 'cross-chain-async'
  }

  // ── Recommended flows ──────────────────────────────────────────────────────
  let recommendedDepositFlow: VaultStatus['recommendedDepositFlow']
  let recommendedRedeemFlow: VaultStatus['recommendedRedeemFlow']

  if (mode === 'paused' || mode === 'full') {
    recommendedDepositFlow = 'none'
    recommendedRedeemFlow = mode === 'paused' ? 'none' : 'redeemShares'
  } else if (mode === 'cross-chain-async') {
    recommendedDepositFlow = 'depositAsync'
    recommendedRedeemFlow = 'redeemAsync'
  } else {
    // local or cross-chain-oracle
    recommendedDepositFlow = 'depositSimple'
    recommendedRedeemFlow = 'redeemShares'
  }

  // ── maxImmediateRedeemAssets ───────────────────────────────────────────────
  const maxImmediateRedeemAssets = isHub && !oraclesEnabled ? hubLiquidBalance : totalAssets

  // ── Issues ─────────────────────────────────────────────────────────────────
  const issues: string[] = []

  if (isPaused) {
    issues.push('Vault is paused — no deposits or redeems are possible.')
  }
  if (effectiveCapacity === 0n && !isPaused) {
    issues.push('Deposit capacity is full — increase depositCapacity via setDepositCapacity().')
  }
  if (depositAccessRestricted) {
    issues.push('Deposit access is restricted (whitelist or other access control). Only approved addresses can deposit.')
  }
  if (isHub && !oraclesEnabled && ccManager === zeroAddress) {
    issues.push(
      'CCManager not configured — async flows will revert. Call setCrossChainAccountingManager(address) as vault owner.',
    )
  }
  if (isHub && !oraclesEnabled && escrow === zeroAddress) {
    issues.push(
      'Escrow not configured in registry — async flows will revert. Set the escrow via the MoreVaultsRegistry.',
    )
  }
  if (isHub) {
    if (hubLiquidBalance === 0n) {
      issues.push(
        `Hub has no liquid assets (hubLiquidBalance = 0). All redeems will be auto-refunded until the curator repatriates funds from spokes via executeBridging().`,
      )
    } else if (totalAssets > 0n && hubLiquidBalance * 10n < totalAssets) {
      const pct = Number((hubLiquidBalance * 10000n) / totalAssets) / 100
      issues.push(
        `Low hub liquidity: ${hubLiquidBalance} units liquid on hub (${pct.toFixed(1)}% of TVL). ` +
        `Redeems above ${hubLiquidBalance} underlying units will be auto-refunded. ` +
        `Curator must call executeBridging() to repatriate from spokes.`,
      )
    }
    if (spokesDeployedBalance > 0n) {
      const pct = ((Number(spokesDeployedBalance) / Number(totalAssets || 1n)) * 100).toFixed(1)
      issues.push(
        `${spokesDeployedBalance} units (~${pct}% of TVL) are deployed on spoke chains earning yield. ` +
        `These are NOT immediately redeemable — they require a curator repatriation (executeBridging) before users can withdraw them.`,
      )
    }
  }

  return {
    mode,
    recommendedDepositFlow,
    recommendedRedeemFlow,
    isHub,
    isPaused,
    oracleAccountingEnabled: oraclesEnabled,
    ccManager,
    escrow,
    withdrawalQueueEnabled,
    withdrawalTimelockSeconds: BigInt(withdrawalTimelockSeconds),
    remainingDepositCapacity: effectiveCapacity,
    depositAccessRestricted,
    underlying,
    totalAssets,
    totalSupply,
    decimals,
    sharePrice,
    hubLiquidBalance,
    spokesDeployedBalance,
    maxImmediateRedeemAssets,
    issues,
  }
}

/**
 * Ensure the spender has sufficient ERC-20 allowance; approve if not.
 *
 * Checks the current allowance and only sends an approve transaction if
 * the existing allowance is less than the required amount.
 *
 * @param walletClient  Wallet client with account attached
 * @param publicClient  Public client for reads
 * @param token         ERC-20 token address
 * @param spender       Address to approve
 * @param amount        Minimum required allowance
 */
export async function ensureAllowance(
  walletClient: WalletClient,
  publicClient: PublicClient,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<void> {
  const account = walletClient.account!

  const allowance = await publicClient.readContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, getAddress(spender)],
  })

  if (allowance < amount) {
    const hash = await walletClient.writeContract({
      address: getAddress(token),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [getAddress(spender), amount],
      account,
      chain: walletClient.chain,
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }
}

/**
 * Quote the LayerZero native fee required for async vault actions.
 *
 * Call this before `depositAsync`, `mintAsync`, or `redeemAsync` to get the
 * exact `lzFee` (msg.value) needed.
 *
 * @param publicClient   Public client for reads
 * @param vault          Vault address (diamond proxy)
 * @param extraOptions   Optional LZ extra options bytes (default 0x)
 * @returns              Required native fee in wei
 */
export async function quoteLzFee(
  publicClient: PublicClient,
  vault: Address,
  extraOptions: `0x${string}` = '0x',
): Promise<bigint> {
  return publicClient.readContract({
    address: getAddress(vault),
    abi: BRIDGE_ABI,
    functionName: 'quoteAccountingFee',
    args: [extraOptions],
  })
}

/**
 * Check if a vault is operating in async mode (cross-chain hub with oracle OFF).
 *
 * When this returns `true`, deposits and redeems must use the async flows
 * (D4/D5/R5) which go through `initVaultActionRequest`.
 * When `false`, the vault either uses oracle-based accounting (sync) or is
 * a single-chain vault.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @returns             `true` if the vault requires async cross-chain flows
 */
export async function isAsyncMode(
  publicClient: PublicClient,
  vault: Address,
): Promise<boolean> {
  const v = getAddress(vault)

  // A vault is async if it's a hub AND oracle accounting is OFF
  const isHub = await publicClient.readContract({
    address: v,
    abi: CONFIG_ABI,
    functionName: 'isHub',
  })

  if (!isHub) return false

  const oraclesEnabled = await publicClient.readContract({
    address: v,
    abi: BRIDGE_ABI,
    functionName: 'oraclesCrossChainAccounting',
  })

  return !oraclesEnabled
}

/**
 * Poll for async request completion status.
 *
 * After calling an async flow (D4/D5/R5), use this to check whether the
 * LZ callback has resolved and `executeRequest` has been called.
 *
 * @param publicClient  Public client for reads
 * @param vault         Vault address
 * @param guid          Request GUID returned by the async flow
 * @returns             Whether the request is fulfilled and the finalization result
 */
export async function getAsyncRequestStatus(
  publicClient: PublicClient,
  vault: Address,
  guid: `0x${string}`,
): Promise<{ fulfilled: boolean; finalized: boolean; result: bigint }> {
  const info = (await publicClient.readContract({
    address: getAddress(vault),
    abi: BRIDGE_ABI,
    functionName: 'getRequestInfo',
    args: [guid],
  })) as unknown as CrossChainRequestInfo

  const finalizationResult = await publicClient.readContract({
    address: getAddress(vault),
    abi: BRIDGE_ABI,
    functionName: 'getFinalizationResult',
    args: [guid],
  })

  return {
    fulfilled: info.fulfilled,
    finalized: info.finalized,
    result: finalizationResult,
  }
}
