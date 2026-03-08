import type { WalletClient } from 'viem'
import { WrongChainError } from './errors'

/**
 * Validate that the walletClient is connected to the expected chain.
 * Only validates if hubChainId is provided — opt-in, non-breaking.
 */
export function validateWalletChain(walletClient: WalletClient, hubChainId?: number): void {
  if (!hubChainId) return
  const current = walletClient.chain?.id
  if (current !== undefined && current !== hubChainId) {
    throw new WrongChainError(current, hubChainId)
  }
}
