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
} from './errors.js'

/**
 * Parse an ethers.js v6 contract error and throw the appropriate typed SDK error.
 * If the error is not a known revert, re-throws the original error.
 *
 * Ethers v6 errors can surface the revert reason in multiple places:
 *   - err.message        — top-level message, may contain the revert string
 *   - err.reason         — decoded revert reason (ethers v6 shortError)
 *   - err.info.error.message — nested RPC error message
 *
 * @param err     The caught error from an ethers contract call
 * @param vault   Vault address — included in the thrown typed error for context
 * @param caller  Optional caller address — included in role-related errors
 * @returns       Never — always throws either a typed MoreVaultsError or the original error
 */
export function parseContractError(err: unknown, vault: string, caller?: string): never {
  // Already a MoreVaultsError — re-throw as-is
  if (err instanceof MoreVaultsError) throw err

  // Collect all error text into a single string for matching
  let msg = ''
  if (err instanceof Error) {
    msg = err.message
    const anyErr = err as any
    if (anyErr.reason) msg += ' ' + anyErr.reason
    if (anyErr.info?.error?.message) msg += ' ' + anyErr.info.error.message
  } else {
    msg = String(err)
  }

  // Pause check
  if (msg.includes('EnforcedPause') || msg.includes('Pausable: paused')) {
    throw new VaultPausedError(vault)
  }

  // Role checks
  if (msg.includes('NotCurator') || msg.includes('OwnableUnauthorizedAccount')) {
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
