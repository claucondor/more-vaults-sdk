/**
 * Curator MulticallFacet write operations for the MoreVaults ethers.js v6 SDK.
 *
 * Provides typed helpers to submit, execute, and veto curator action batches
 * on any MoreVaults diamond that has the MulticallFacet installed.
 *
 * @module curatorMulticall
 */

import { Contract, Interface } from "ethers";
import type { Signer, ContractTransactionReceipt } from "ethers";
import {
  MULTICALL_ABI,
  DEX_ABI,
  ERC7540_FACET_ABI,
  ERC4626_FACET_ABI,
  ADMIN_WRITE_ABI,
  TIMELOCK_CONFIG_ABI,
} from "./abis";
import type { CuratorAction, SubmitActionsResult } from "./types";
import { InvalidInputError } from "./errors";
import { parseContractError } from "./errorParser";

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
 * @returns       ABI-encoded calldata hex string
 */
export function encodeCuratorAction(action: CuratorAction): string {
  switch (action.type) {
    case 'swap': {
      const iface = new Interface(DEX_ABI as unknown as string[]);
      return iface.encodeFunctionData("executeSwap", [
        {
          targetContract: action.params.targetContract,
          tokenIn: action.params.tokenIn,
          tokenOut: action.params.tokenOut,
          maxAmountIn: action.params.maxAmountIn,
          minAmountOut: action.params.minAmountOut,
          swapCallData: action.params.swapCallData,
        },
      ]);
    }

    case 'batchSwap': {
      const iface = new Interface(DEX_ABI as unknown as string[]);
      return iface.encodeFunctionData("executeBatchSwap", [
        {
          swaps: action.params.swaps.map((s) => ({
            targetContract: s.targetContract,
            tokenIn: s.tokenIn,
            tokenOut: s.tokenOut,
            maxAmountIn: s.maxAmountIn,
            minAmountOut: s.minAmountOut,
            swapCallData: s.swapCallData,
          })),
        },
      ]);
    }

    case 'erc4626Deposit': {
      const iface = new Interface(ERC4626_FACET_ABI as unknown as string[]);
      return iface.encodeFunctionData("erc4626Deposit", [action.vault, action.assets]);
    }

    case 'erc4626Redeem': {
      const iface = new Interface(ERC4626_FACET_ABI as unknown as string[]);
      return iface.encodeFunctionData("erc4626Redeem", [action.vault, action.shares]);
    }

    case 'erc7540RequestDeposit': {
      const iface = new Interface(ERC7540_FACET_ABI as unknown as string[]);
      return iface.encodeFunctionData("erc7540RequestDeposit", [action.vault, action.assets]);
    }

    case 'erc7540Deposit': {
      const iface = new Interface(ERC7540_FACET_ABI as unknown as string[]);
      return iface.encodeFunctionData("erc7540Deposit", [action.vault, action.assets]);
    }

    case 'erc7540RequestRedeem': {
      const iface = new Interface(ERC7540_FACET_ABI as unknown as string[]);
      return iface.encodeFunctionData("erc7540RequestRedeem", [action.vault, action.shares]);
    }

    case 'erc7540Redeem': {
      const iface = new Interface(ERC7540_FACET_ABI as unknown as string[]);
      return iface.encodeFunctionData("erc7540Redeem", [action.vault, action.shares]);
    }

    // ── Phase 7: Direct curator actions ────────────────────────────────
    case 'addAvailableAsset': {
      const iface = new Interface(ADMIN_WRITE_ABI as unknown as string[]);
      return iface.encodeFunctionData("addAvailableAsset", [action.asset]);
    }

    case 'addAvailableAssets': {
      const iface = new Interface(ADMIN_WRITE_ABI as unknown as string[]);
      return iface.encodeFunctionData("addAvailableAssets", [action.assets]);
    }

    case 'disableAssetToDeposit': {
      const iface = new Interface(ADMIN_WRITE_ABI as unknown as string[]);
      return iface.encodeFunctionData("disableAssetToDeposit", [action.asset]);
    }

    case 'setDepositCapacity': {
      const iface = new Interface(ADMIN_WRITE_ABI as unknown as string[]);
      return iface.encodeFunctionData("setDepositCapacity", [action.capacity]);
    }

    // ── Phase 7: Timelocked owner actions ──────────────────────────────
    case 'setTimeLockPeriod': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setTimeLockPeriod", [action.period]);
    }

    case 'setWithdrawalFee': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setWithdrawalFee", [action.fee]);
    }

    case 'setWithdrawalTimelock': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setWithdrawalTimelock", [action.duration]);
    }

    case 'enableAssetToDeposit': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("enableAssetToDeposit", [action.asset]);
    }

    case 'disableDepositWhitelist': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("disableDepositWhitelist");
    }

    case 'updateWithdrawalQueueStatus': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("updateWithdrawalQueueStatus", [action.status]);
    }

    case 'setMaxWithdrawalDelay': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setMaxWithdrawalDelay", [action.delay]);
    }

    case 'setMaxSlippagePercent': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setMaxSlippagePercent", [action.percent]);
    }

    case 'setCrossChainAccountingManager': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setCrossChainAccountingManager", [action.manager]);
    }

    case 'setGasLimitForAccounting': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setGasLimitForAccounting", [
        action.availableTokenGas,
        action.heldTokenGas,
        action.facetGas,
        action.limit,
      ]);
    }

    case 'setFee': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("setFee", [action.fee]);
    }

    // ── Phase 7: Role transfers ────────────────────────────────────────
    case 'transferOwnership': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("transferOwnership", [action.newOwner]);
    }

    case 'transferCuratorship': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("transferCuratorship", [action.newCurator]);
    }

    case 'transferGuardian': {
      const iface = new Interface(TIMELOCK_CONFIG_ABI as unknown as string[]);
      return iface.encodeFunctionData("transferGuardian", [action.newGuardian]);
    }

    default: {
      // TypeScript exhaustiveness check — this branch is never reached at runtime
      const _exhaustive: never = action;
      throw new Error(`[MoreVaults] Unknown CuratorAction type: ${(_exhaustive as any).type}`);
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
export function buildCuratorBatch(actions: CuratorAction[]): string[] {
  return actions.map(encodeCuratorAction);
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
 * After the write succeeds, reads `getCurrentNonce` to determine which nonce
 * was assigned (nonce - 1 after the submit increments it).
 *
 * @param signer   Signer with curator account attached
 * @param vault    Vault address (diamond proxy)
 * @param actions  Array of raw calldata bytes — use `buildCuratorBatch` to build
 * @returns        Receipt and the nonce assigned to this batch
 */
export async function submitActions(
  signer: Signer,
  vault: string,
  actions: string[]
): Promise<SubmitActionsResult> {
  if (actions.length === 0) throw new InvalidInputError('actions array is empty')

  const multicallContract = new Contract(vault, MULTICALL_ABI, signer);

  let tx: any
  try {
    tx = await multicallContract.submitActions(actions);
  } catch (err) {
    parseContractError(err, vault)
  }
  const receipt: ContractTransactionReceipt = await tx!.wait();

  // Read the nonce that was assigned: the contract increments actionNonce after storing,
  // so getCurrentNonce now returns (assignedNonce + 1). Subtract 1 to recover it.
  const nextNonce = (await multicallContract.getCurrentNonce()) as bigint;
  const nonce = nextNonce - 1n;

  return { receipt, nonce };
}

/**
 * Execute pending actions after their timelock period has expired.
 *
 * Can only be called when `block.timestamp >= pendingUntil`. The contract
 * reverts with `ActionsStillPending` if the timelock has not expired.
 *
 * @param signer  Signer with curator account attached
 * @param vault   Vault address (diamond proxy)
 * @param nonce   The action batch nonce to execute
 * @returns       Transaction receipt
 */
export async function executeActions(
  signer: Signer,
  vault: string,
  nonce: bigint
): Promise<ContractTransactionReceipt> {
  const multicallContract = new Contract(vault, MULTICALL_ABI, signer);

  let tx: any
  try {
    tx = await multicallContract.executeActions(nonce);
  } catch (err) {
    parseContractError(err, vault)
  }
  return tx!.wait() as Promise<ContractTransactionReceipt>;
}

/**
 * Guardian-only: cancel (veto) one or more pending action batches.
 *
 * Deletes the pending actions from storage, preventing them from ever being
 * executed. Only the vault guardian can call this.
 *
 * @param signer   Signer with guardian account attached
 * @param vault    Vault address (diamond proxy)
 * @param nonces   Array of action nonces to cancel
 * @returns        Transaction receipt
 */
export async function vetoActions(
  signer: Signer,
  vault: string,
  nonces: bigint[]
): Promise<ContractTransactionReceipt> {
  if (nonces.length === 0) throw new InvalidInputError('nonces array is empty')

  const multicallContract = new Contract(vault, MULTICALL_ABI, signer);

  let tx: any
  try {
    tx = await multicallContract.vetoActions(nonces);
  } catch (err) {
    parseContractError(err, vault)
  }
  return tx!.wait() as Promise<ContractTransactionReceipt>;
}
