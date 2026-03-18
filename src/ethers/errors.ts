/**
 * Typed error classes for the MoreVaults SDK.
 *
 * Frontend code can use instanceof checks to handle errors programmatically:
 *   catch (e) {
 *     if (e instanceof InsufficientLiquidityError) { ... }
 *   }
 */

export class MoreVaultsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoreVaultsError'
  }
}

export class VaultPausedError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`)
    this.name = 'VaultPausedError'
  }
}

export class CapacityFullError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] Vault ${vault} has reached deposit capacity. No more deposits accepted.`)
    this.name = 'CapacityFullError'
  }
}

export class NotWhitelistedError extends MoreVaultsError {
  constructor(vault: string, user: string) {
    super(`[MoreVaults] Address ${user} is not whitelisted to deposit in vault ${vault}.`)
    this.name = 'NotWhitelistedError'
  }
}

export class InsufficientLiquidityError extends MoreVaultsError {
  hubLiquid: bigint
  required: bigint
  constructor(vault: string, hubLiquid: bigint, required: bigint) {
    super(
      `[MoreVaults] Insufficient hub liquidity for redeem.\n` +
      `  Hub liquid balance : ${hubLiquid}\n` +
      `  Estimated required : ${required}\n` +
      `Submitting this redeem will waste the LayerZero fee — the request will be auto-refunded.\n` +
      `Ask the vault curator to repatriate liquidity from spoke chains first.`
    )
    this.name = 'InsufficientLiquidityError'
    this.hubLiquid = hubLiquid
    this.required = required
  }
}

export class CCManagerNotConfiguredError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] CCManager not configured on vault ${vault}. Call setCrossChainAccountingManager(ccManagerAddress) as vault owner first.`)
    this.name = 'CCManagerNotConfiguredError'
  }
}

export class EscrowNotConfiguredError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] Escrow not configured for vault ${vault}. The registry must have an escrow set for this vault.`)
    this.name = 'EscrowNotConfiguredError'
  }
}

export class NotHubVaultError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] Vault ${vault} is not a hub vault. Async flows (D4/D5/R5) only work on hub vaults.`)
    this.name = 'NotHubVaultError'
  }
}

export class MissingEscrowAddressError extends MoreVaultsError {
  constructor() {
    super(`[MoreVaults] This flow requires an escrow address. Set VaultAddresses.escrow before calling async deposit/redeem flows.`)
    this.name = 'MissingEscrowAddressError'
  }
}

export class WrongChainError extends MoreVaultsError {
  constructor(currentChainId: number, expectedChainId: number) {
    super(
      `Wrong network: wallet is on chain ${currentChainId}, but the vault hub requires chain ${expectedChainId}. Switch networks before proceeding.`,
    )
    this.name = 'WrongChainError'
  }
}

export class NotCuratorError extends MoreVaultsError {
  constructor(vault: string, caller: string) {
    super(`[MoreVaults] Address ${caller} is not the curator of vault ${vault}.`)
    this.name = 'NotCuratorError'
  }
}

export class NotOwnerError extends MoreVaultsError {
  constructor(vault: string, caller: string) {
    super(`[MoreVaults] Address ${caller} is not the owner of vault ${vault}.`)
    this.name = 'NotOwnerError'
  }
}

export class NotGuardianError extends MoreVaultsError {
  constructor(vault: string, caller: string) {
    super(`[MoreVaults] Address ${caller} is not the guardian of vault ${vault}.`)
    this.name = 'NotGuardianError'
  }
}

export class InvalidInputError extends MoreVaultsError {
  constructor(message: string) {
    super(`[MoreVaults] Invalid input: ${message}`)
    this.name = 'InvalidInputError'
  }
}

export class ActionsStillPendingError extends MoreVaultsError {
  nonce: bigint
  constructor(vault: string, nonce: bigint) {
    super(`[MoreVaults] Actions nonce ${nonce} on vault ${vault} are still pending (timelock not expired).`)
    this.name = 'ActionsStillPendingError'
    this.nonce = nonce
  }
}

export class NoSuchActionsError extends MoreVaultsError {
  nonce: bigint
  constructor(vault: string, nonce: bigint) {
    super(`[MoreVaults] No actions found for nonce ${nonce} on vault ${vault}.`)
    this.name = 'NoSuchActionsError'
    this.nonce = nonce
  }
}

export class SlippageExceededError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] Slippage exceeded on vault ${vault}. Try increasing slippage tolerance or reducing amount.`)
    this.name = 'SlippageExceededError'
  }
}

export class UnsupportedAssetError extends MoreVaultsError {
  asset: string
  constructor(vault: string, asset: string) {
    super(`[MoreVaults] Asset ${asset} is not supported by vault ${vault}.`)
    this.name = 'UnsupportedAssetError'
    this.asset = asset
  }
}

export class ComposerNotConfiguredError extends MoreVaultsError {
  constructor(vault: string) {
    super(`[MoreVaults] Composer not configured for vault ${vault}. The vault must have a MoreVaultsComposer deployed.`)
    this.name = 'ComposerNotConfiguredError'
  }
}

export class UnsupportedChainError extends MoreVaultsError {
  chainId: number
  constructor(chainId: number) {
    super(`[MoreVaults] Chain ${chainId} is not supported. No RPC configuration found.`)
    this.name = 'UnsupportedChainError'
    this.chainId = chainId
  }
}

export class InsufficientBalanceError extends MoreVaultsError {
  available: bigint
  required: bigint
  constructor(token: string, available: bigint, required: bigint) {
    super(`[MoreVaults] Insufficient ${token} balance: have ${available}, need ${required}.`)
    this.name = 'InsufficientBalanceError'
    this.available = available
    this.required = required
  }
}

export class AsyncRequestTimeoutError extends MoreVaultsError {
  guid: string
  constructor(guid: string) {
    super(`[MoreVaults] Async request ${guid} did not finalize within the timeout period.`)
    this.name = 'AsyncRequestTimeoutError'
    this.guid = guid
  }
}

export class ComposeTimeoutError extends MoreVaultsError {
  guid: string
  constructor(guid: string) {
    super(`[MoreVaults] Compose for GUID ${guid} was not delivered within the timeout period.`)
    this.name = 'ComposeTimeoutError'
    this.guid = guid
  }
}
