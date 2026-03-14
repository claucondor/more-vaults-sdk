/**
 * Curator MulticallFacet write operations for the MoreVaults SDK.
 *
 * Provides typed helpers to submit, execute, and veto curator action batches
 * on any MoreVaults diamond that has the MulticallFacet installed.
 *
 * All write functions use the simulate-then-write pattern:
 *   1. `publicClient.simulateContract` — validates on-chain, catches reverts early
 *   2. `walletClient.writeContract`    — sends the actual transaction
 *
 * @module curatorMulticall
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
  getAddress,
} from 'viem'
import {
  MULTICALL_ABI,
  DEX_ABI,
  ERC7540_FACET_ABI,
  ERC4626_FACET_ABI,
} from './abis.js'
import type {
  CuratorAction,
  SubmitActionsResult,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Encoding helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode a single typed CuratorAction into raw calldata bytes suitable for
 * passing into `submitActions(bytes[] actionsData)`.
 *
 * The encoded bytes are the full ABI-encoded function call (4-byte selector +
 * arguments) targeting the vault diamond itself — the MulticallFacet will
 * call `address(this).call(actionsData[i])` for each entry.
 *
 * @param action  A discriminated-union CuratorAction describing what to do
 * @returns       ABI-encoded calldata bytes (`0x`-prefixed hex string)
 */
export function encodeCuratorAction(action: CuratorAction): `0x${string}` {
  switch (action.type) {
    case 'swap':
      return encodeFunctionData({
        abi: DEX_ABI,
        functionName: 'executeSwap',
        args: [
          {
            targetContract: getAddress(action.params.targetContract),
            tokenIn: getAddress(action.params.tokenIn),
            tokenOut: getAddress(action.params.tokenOut),
            maxAmountIn: action.params.maxAmountIn,
            minAmountOut: action.params.minAmountOut,
            swapCallData: action.params.swapCallData,
          },
        ],
      })

    case 'batchSwap':
      return encodeFunctionData({
        abi: DEX_ABI,
        functionName: 'executeBatchSwap',
        args: [
          {
            swaps: action.params.swaps.map((s) => ({
              targetContract: getAddress(s.targetContract),
              tokenIn: getAddress(s.tokenIn),
              tokenOut: getAddress(s.tokenOut),
              maxAmountIn: s.maxAmountIn,
              minAmountOut: s.minAmountOut,
              swapCallData: s.swapCallData,
            })),
          },
        ],
      })

    case 'erc4626Deposit':
      return encodeFunctionData({
        abi: ERC4626_FACET_ABI,
        functionName: 'erc4626Deposit',
        args: [getAddress(action.vault), action.assets],
      })

    case 'erc4626Redeem':
      return encodeFunctionData({
        abi: ERC4626_FACET_ABI,
        functionName: 'erc4626Redeem',
        args: [getAddress(action.vault), action.shares],
      })

    case 'erc7540RequestDeposit':
      return encodeFunctionData({
        abi: ERC7540_FACET_ABI,
        functionName: 'erc7540RequestDeposit',
        args: [getAddress(action.vault), action.assets],
      })

    case 'erc7540Deposit':
      return encodeFunctionData({
        abi: ERC7540_FACET_ABI,
        functionName: 'erc7540Deposit',
        args: [getAddress(action.vault), action.assets],
      })

    case 'erc7540RequestRedeem':
      return encodeFunctionData({
        abi: ERC7540_FACET_ABI,
        functionName: 'erc7540RequestRedeem',
        args: [getAddress(action.vault), action.shares],
      })

    case 'erc7540Redeem':
      return encodeFunctionData({
        abi: ERC7540_FACET_ABI,
        functionName: 'erc7540Redeem',
        args: [getAddress(action.vault), action.shares],
      })

    default: {
      // TypeScript exhaustiveness check — this branch is never reached at runtime
      const _exhaustive: never = action
      throw new Error(`[MoreVaults] Unknown CuratorAction type: ${(_exhaustive as any).type}`)
    }
  }
}

/**
 * Encode an array of CuratorActions into a calldata array ready for
 * `submitActions`.
 *
 * @param actions  Array of typed CuratorAction objects
 * @returns        Array of ABI-encoded calldata hex strings
 */
export function buildCuratorBatch(actions: CuratorAction[]): `0x${string}`[] {
  return actions.map(encodeCuratorAction)
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a batch of curator actions to the vault's MulticallFacet.
 *
 * When `timeLockPeriod == 0` the contract immediately executes the actions
 * inside `submitActions` itself. When a timelock is configured the actions
 * are queued and must be executed later with `executeActions`.
 *
 * Uses the simulate-then-write pattern: simulation runs first so any on-chain
 * revert (wrong curator, bad selector, slippage limit, etc.) surfaces before
 * any gas is spent on a failing transaction.
 *
 * After the write succeeds, the function reads `getCurrentNonce` to determine
 * which nonce was assigned to this batch (nonce - 1 after the submit increments it).
 *
 * @param walletClient  Wallet client with curator account attached
 * @param publicClient  Public client for reads and simulation
 * @param vault         Vault address (diamond proxy)
 * @param actions       Array of raw calldata bytes — use `buildCuratorBatch` to build
 * @returns             Transaction hash and the nonce assigned to this batch
 * @throws              If the caller is not the curator, or any action selector is
 *                      not allowed, or any action would revert
 */
export async function submitActions(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  actions: `0x${string}`[],
): Promise<SubmitActionsResult> {
  const account = walletClient.account!
  const v = getAddress(vault)

  // Simulate first — catches permission errors and reverts before spending gas
  await publicClient.simulateContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'submitActions',
    args: [actions],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'submitActions',
    args: [actions],
    account,
    chain: walletClient.chain,
  })

  // Read the nonce that was assigned: the contract increments actionNonce after storing,
  // so getCurrentNonce now returns (assignedNonce + 1). Subtract 1 to recover it.
  const nextNonce = await publicClient.readContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'getCurrentNonce',
  })

  const nonce = nextNonce - 1n

  return { txHash, nonce }
}

/**
 * Execute pending actions after their timelock period has expired.
 *
 * Can only be called when `block.timestamp >= pendingUntil`. The contract
 * reverts with `ActionsStillPending` if the timelock has not expired.
 *
 * Caller must be the curator (or any address when timeLockPeriod == 0, since
 * in that case `submitActions` auto-executes and there is nothing to execute here).
 *
 * Uses simulate-then-write to surface on-chain reverts early.
 *
 * @param walletClient  Wallet client with curator account attached
 * @param publicClient  Public client for reads and simulation
 * @param vault         Vault address (diamond proxy)
 * @param nonce         The action batch nonce to execute
 * @returns             Transaction hash
 */
export async function executeActions(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  nonce: bigint,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  // Simulate to surface reverts (NoSuchActions, ActionsStillPending, slippage)
  await publicClient.simulateContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'executeActions',
    args: [nonce],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'executeActions',
    args: [nonce],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Guardian-only: cancel (veto) one or more pending action batches.
 *
 * Deletes the pending actions from storage, preventing them from ever being
 * executed. Only the vault guardian can call this.
 *
 * Uses simulate-then-write to catch `NoSuchActions` and permission errors early.
 *
 * @param walletClient  Wallet client with guardian account attached
 * @param publicClient  Public client for reads and simulation
 * @param vault         Vault address (diamond proxy)
 * @param nonces        Array of action nonces to cancel
 * @returns             Transaction hash
 */
export async function vetoActions(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  nonces: bigint[],
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account!
  const v = getAddress(vault)

  // Simulate to catch NotGuardian, NoSuchActions, etc.
  await publicClient.simulateContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'vetoActions',
    args: [nonces],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: v,
    abi: MULTICALL_ABI,
    functionName: 'vetoActions',
    args: [nonces],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}
