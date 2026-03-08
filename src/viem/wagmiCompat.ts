import type { PublicClient } from 'viem'

/**
 * Cast a wagmi PublicClient to the SDK's expected type.
 * Use this in React components to avoid `as any` casts:
 * ```ts
 * import { usePublicClient } from 'wagmi'
 * import { asSdkClient } from '@oydual31/more-vaults-sdk/viem'
 * const pc = asSdkClient(usePublicClient())
 * ```
 * wagmi v2 uses viem as a peer dependency, so the types are structurally
 * identical — this function validates the client is non-null and applies
 * a documented cast instead of an opaque `as any`.
 */
export function asSdkClient(client: unknown): PublicClient {
  if (!client) throw new Error('[MoreVaults] No public client available. Make sure wagmi is configured correctly.')
  return client as PublicClient
}
