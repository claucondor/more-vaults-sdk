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
