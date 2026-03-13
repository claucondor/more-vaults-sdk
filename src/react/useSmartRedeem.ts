import type { AsyncRequestStatusInfo } from '../viem/index.js'
import { useVaultStatus } from './useVaultStatus.js'
import { useOmniRedeem } from './useOmniRedeem.js'
import { useRedeemShares } from './useRedeemShares.js'

interface UseSmartRedeemReturn {
  /**
   * Execute redeem using the correct flow for this vault's mode.
   * For async vaults: wraps redeemAsync (R5) — returns guid for tracking.
   * For local/oracle vaults: wraps redeemShares (R1) — returns assets.
   */
  redeem: (sharesInWei: bigint, receiver: `0x${string}`, owner: `0x${string}`) => Promise<void>
  isLoading: boolean
  txHash: `0x${string}` | undefined
  /** Assets received (available for R1 vaults after confirmation, undefined for R5). */
  assets: bigint | undefined
  /** GUID for cross-chain tracking (R5 vaults only). */
  guid: `0x${string}` | undefined
  /** Cross-chain request status (R5 vaults only). */
  requestStatus: AsyncRequestStatusInfo | undefined
  /** true when the wallet is connected to the wrong chain (R5 vaults only). */
  wrongChain: boolean
  /** Vault mode loaded from getVaultStatus. undefined while loading. */
  vaultMode: 'local' | 'cross-chain-oracle' | 'cross-chain-async' | 'paused' | 'full' | undefined
  error: Error | undefined
  reset: () => void
}

/**
 * Auto-selects the correct redeem flow based on vault mode.
 * Best for frontends that support multiple vault types.
 *
 * Internally uses useVaultStatus to detect the mode, then delegates to:
 * - useOmniRedeem (R5) for 'cross-chain-async' vaults
 * - useRedeemShares (R1) for 'local' and 'cross-chain-oracle' vaults
 *
 * @example
 * const { redeem, isLoading, guid, requestStatus, vaultMode } = useSmartRedeem('0xVAULT', 8453)
 *
 * if (vaultMode === 'paused') return <PausedBadge />
 *
 * await redeem(sharesInWei, userAddress, userAddress)
 * // For async vaults: poll requestStatus until 'completed'
 * // For sync vaults: txHash + assets are available immediately
 */
export function useSmartRedeem(
  vault: `0x${string}` | undefined,
  hubChainId: number,
): UseSmartRedeemReturn {
  const { data: status } = useVaultStatus(vault, hubChainId)
  const omni = useOmniRedeem(vault, hubChainId)
  const simple = useRedeemShares(vault, hubChainId)

  const isAsync = status?.mode === 'cross-chain-async'

  const redeem = isAsync ? omni.redeem : simple.redeem

  return {
    redeem,
    isLoading: isAsync ? omni.isLoading : simple.isLoading,
    txHash: isAsync ? omni.txHash : simple.txHash,
    assets: isAsync ? undefined : simple.assets,
    guid: isAsync ? omni.guid : undefined,
    requestStatus: isAsync ? omni.requestStatus : undefined,
    wrongChain: isAsync ? omni.wrongChain : false,
    vaultMode: status?.mode,
    error: isAsync ? omni.error : simple.error,
    reset: isAsync ? omni.reset : simple.reset,
  }
}
