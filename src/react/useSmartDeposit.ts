import type { DepositResult, AsyncRequestResult, AsyncRequestStatusInfo } from '../viem/index.js'
import { useVaultStatus } from './useVaultStatus.js'
import { useOmniDeposit } from './useOmniDeposit.js'
import { useDepositSimple } from './useDepositSimple.js'

interface UseSmartDepositReturn {
  /**
   * Execute deposit using the correct flow for this vault's mode.
   * For async vaults: wraps depositAsync (D4) — returns guid for tracking.
   * For local/oracle vaults: wraps depositSimple (D1/D3) — returns shares.
   */
  deposit: (amountInWei: bigint, receiver: `0x${string}`) => Promise<void>
  isLoading: boolean
  txHash: `0x${string}` | undefined
  /** Shares minted (available for D1/D3 vaults after confirmation, undefined for D4). */
  shares: bigint | undefined
  /** GUID for cross-chain tracking (D4 vaults only). */
  guid: `0x${string}` | undefined
  /** Cross-chain request status (D4 vaults only). */
  requestStatus: AsyncRequestStatusInfo | undefined
  /** true when the wallet is connected to the wrong chain (D4 vaults only). */
  wrongChain: boolean
  /** Vault mode loaded from getVaultStatus. undefined while loading. */
  vaultMode: 'local' | 'cross-chain-oracle' | 'cross-chain-async' | 'paused' | 'full' | undefined
  error: Error | undefined
  reset: () => void
}

/**
 * Auto-selects the correct deposit flow based on vault mode.
 * Best for frontends that support multiple vault types.
 *
 * Internally uses useVaultStatus to detect the mode, then delegates to:
 * - useOmniDeposit (D4) for 'cross-chain-async' vaults
 * - useDepositSimple (D1/D3) for 'local' and 'cross-chain-oracle' vaults
 *
 * @example
 * const { deposit, isLoading, guid, requestStatus, vaultMode } = useSmartDeposit('0xVAULT', 747)
 *
 * if (vaultMode === 'paused') return <PausedBadge />
 *
 * await deposit(parseUnits('100', 6), userAddress)
 * // For async vaults: poll requestStatus until 'completed'
 * // For sync vaults: txHash + shares are available immediately
 */
export function useSmartDeposit(
  vault: `0x${string}` | undefined,
  hubChainId: number,
): UseSmartDepositReturn {
  const { data: status } = useVaultStatus(vault, hubChainId)
  const omni = useOmniDeposit(vault, hubChainId)
  const simple = useDepositSimple(vault, hubChainId)

  const isAsync = status?.mode === 'cross-chain-async'

  const deposit = isAsync ? omni.deposit : simple.deposit

  return {
    deposit,
    isLoading: isAsync ? omni.isLoading : simple.isLoading,
    txHash: isAsync ? omni.txHash : simple.txHash,
    shares: isAsync ? undefined : simple.shares,
    guid: isAsync ? omni.guid : undefined,
    requestStatus: isAsync ? omni.requestStatus : undefined,
    wrongChain: isAsync ? omni.wrongChain : false,
    vaultMode: status?.mode,
    error: isAsync ? omni.error : simple.error,
    reset: isAsync ? omni.reset : simple.reset,
  }
}
