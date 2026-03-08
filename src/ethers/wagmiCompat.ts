import type { Signer } from 'ethers'

/**
 * Cast an ethers Signer (e.g. from wagmi's useEthersSigner adapter) to
 * the SDK's expected type. Use this to avoid `as any` casts:
 * ```ts
 * import { useEthersSigner } from './wagmi-ethers-adapter'
 * import { asSdkSigner } from '@oydual31/more-vaults-sdk/ethers'
 * const signer = asSdkSigner(useEthersSigner())
 * ```
 * This function validates the signer is non-null and applies a documented
 * cast instead of an opaque `as any`.
 */
export function asSdkSigner(signer: unknown): Signer {
  if (!signer) throw new Error('[MoreVaults] No signer available. Make sure the wallet is connected and wagmi is configured correctly.')
  return signer as Signer
}
