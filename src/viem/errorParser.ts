import {
  MoreVaultsError,
  VaultPausedError,
  NotCuratorError,
  NotOwnerError,
  NotGuardianError,
  SlippageExceededError,
  UnsupportedAssetError,
  ActionsStillPendingError,
  NoSuchActionsError,
  CapacityFullError,
  InvalidInputError,
  WithdrawalQueueDisabledError,
  CantProcessWithdrawRequestError,
} from './errors.js'

/**
 * Parse a viem ContractFunctionRevertedError and throw the appropriate typed SDK error.
 *
 * Maps well-known on-chain revert strings to typed SDK errors so callers can
 * use `instanceof` checks instead of parsing raw error messages. If the error
 * is not a recognized revert, the original error is re-thrown unchanged.
 *
 * @param err     The error thrown by viem simulateContract or writeContract
 * @param vault   Vault address string (included in error messages)
 * @param caller  Optional caller address (included in role-error messages)
 * @returns       Never returns — always throws
 * @throws {VaultPausedError}          On EnforcedPause / Pausable: paused
 * @throws {NotCuratorError}           On NotCurator
 * @throws {NotOwnerError}             On OwnableUnauthorizedAccount / UnauthorizedAccess
 * @throws {NotGuardianError}          On NotGuardian
 * @throws {SlippageExceededError}     On SlippageExceeded / SlippageTooHigh
 * @throws {UnsupportedAssetError}     On UnsupportedAsset / AssetNotAvailable
 * @throws {CapacityFullError}         On DepositCapacity / maxDeposit
 * @throws {ActionsStillPendingError}  On ActionsStillPending
 * @throws {NoSuchActionsError}        On NoSuchActions
 * @throws {InvalidInputError}         On FeeIsTooHigh
 */
export function parseContractError(err: unknown, vault: string, caller?: string): never {
  // Already a MoreVaultsError — re-throw as-is
  if (err instanceof MoreVaultsError) throw err

  const msg = err instanceof Error ? err.message : String(err)

  // Pause check
  if (msg.includes('EnforcedPause') || msg.includes('Pausable: paused')) {
    throw new VaultPausedError(vault)
  }

  // Withdrawal queue disabled — caller used requestRedeem/requestWithdraw on a vault
  // where the queue is off. Should use redeemShares/withdrawAssets directly, or smartRedeem.
  // 0xdbb22fbf is the selector for WithdrawalQueueDisabled().
  if (msg.includes('WithdrawalQueueDisabled') || msg.includes('0xdbb22fbf')) {
    throw new WithdrawalQueueDisabledError(vault)
  }

  // CantProcessWithdrawRequest — redeem called without a valid pending request
  // while the withdrawal queue is enabled. Use requestRedeem first, or smartRedeem.
  // 0x8cbe9e8b is the selector for CantProcessWithdrawRequest().
  if (msg.includes('CantProcessWithdrawRequest') || msg.includes('0x8cbe9e8b')) {
    throw new CantProcessWithdrawRequestError(vault)
  }

  // Role checks
  if (msg.includes('NotCurator') || msg.includes('OwnableUnauthorizedAccount')) {
    // Distinguish curator vs owner by checking the specific error
    if (msg.includes('NotCurator')) {
      throw new NotCuratorError(vault, caller ?? 'unknown')
    }
    throw new NotOwnerError(vault, caller ?? 'unknown')
  }
  if (msg.includes('NotGuardian')) {
    throw new NotGuardianError(vault, caller ?? 'unknown')
  }
  if (msg.includes('UnauthorizedAccess')) {
    throw new NotOwnerError(vault, caller ?? 'unknown')
  }

  // Slippage
  if (msg.includes('SlippageExceeded') || msg.includes('SlippageTooHigh')) {
    throw new SlippageExceededError(vault)
  }

  // Asset errors
  if (msg.includes('UnsupportedAsset')) {
    throw new UnsupportedAssetError(vault, 'unknown')
  }
  if (msg.includes('AssetNotAvailable')) {
    throw new UnsupportedAssetError(vault, 'unknown')
  }

  // Capacity
  if (msg.includes('DepositCapacity') || msg.includes('maxDeposit')) {
    throw new CapacityFullError(vault)
  }

  // Timelock
  if (msg.includes('ActionsStillPending')) {
    throw new ActionsStillPendingError(vault, 0n)
  }
  if (msg.includes('NoSuchActions')) {
    throw new NoSuchActionsError(vault, 0n)
  }

  // Fee errors
  if (msg.includes('FeeIsTooHigh')) {
    throw new InvalidInputError('Fee is too high (max 10000 bps)')
  }

  // Re-throw unknown errors
  throw err
}
