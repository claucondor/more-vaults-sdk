import type { Signer } from 'ethers'
import { WrongChainError } from './errors'

/**
 * Validate that the signer is connected to the expected chain.
 * Only validates if hubChainId is provided — opt-in, non-breaking.
 */
export async function validateWalletChain(signer: Signer, hubChainId?: number): Promise<void> {
  if (!hubChainId) return
  const network = await signer.provider?.getNetwork()
  if (!network) return
  const current = Number(network.chainId)
  if (current !== hubChainId) {
    throw new WrongChainError(current, hubChainId)
  }
}
