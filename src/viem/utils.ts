import {
  type Address,
  type PublicClient,
  type WalletClient,
  getAddress,
  zeroAddress,
} from 'viem'
import { BRIDGE_ABI, CONFIG_ABI, ERC20_ABI, VAULT_ABI } from './abis'
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
  /** Remaining deposit capacity in underlying token decimals (type(uint256).max = unlimited) */
  remainingDepositCapacity: bigint

  // ── Vault metrics ────────────────────────────────────────────────────────
  underlying: Address
  totalAssets: bigint
  totalSupply: bigint

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

  // All reads fire in parallel
  const [
    isHub,
    isPaused,
    oraclesEnabled,
    ccManager,
    escrow,
    withdrawalQueueEnabled,
    withdrawalTimelockSeconds,
    remainingDepositCapacity,
    underlying,
    totalAssets,
    totalSupply,
  ] = await Promise.all([
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'isHub' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'paused' }),
    publicClient.readContract({ address: v, abi: BRIDGE_ABI, functionName: 'oraclesCrossChainAccounting' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'getCrossChainAccountingManager' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'getEscrow' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'getWithdrawalQueueStatus' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'getWithdrawalTimelock' }),
    publicClient.readContract({ address: v, abi: CONFIG_ABI, functionName: 'maxDeposit', args: [zeroAddress] }),
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'asset' }),
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'totalAssets' }),
    publicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'totalSupply' }),
  ])

  // ── Derive mode ────────────────────────────────────────────────────────────
  let mode: VaultMode
  if (isPaused) {
    mode = 'paused'
  } else if (remainingDepositCapacity === 0n) {
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

  // ── Issues ─────────────────────────────────────────────────────────────────
  const issues: string[] = []

  if (isPaused) {
    issues.push('Vault is paused — no deposits or redeems are possible.')
  }
  if (remainingDepositCapacity === 0n && !isPaused) {
    issues.push('Deposit capacity is full — increase depositCapacity via setDepositCapacity().')
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
    remainingDepositCapacity,
    underlying,
    totalAssets,
    totalSupply,
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
