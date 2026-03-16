import { useMutation } from '@tanstack/react-query'
import { usePublicClient, useWalletClient } from 'wagmi'
import { asSdkClient, executeCuratorBridge } from '../viem/index.js'
import type { CuratorBridgeParams } from '../viem/index.js'
import type { Address } from 'viem'

export type { CuratorBridgeParams }

/**
 * Execute a curator bridge operation via BridgeFacet.executeBridging.
 *
 * This is a direct curator call (NOT via multicall). The vault pauses during
 * bridging for security. Automatically quotes and includes the required
 * LayerZero fee as msg.value.
 *
 * @param vault    Hub vault address (diamond proxy)
 * @param token    Underlying ERC-20 token address to bridge (NOT the OFT address)
 * @param chainId  Chain ID of the hub vault
 *
 * @example
 * ```tsx
 * const { mutateAsync, isPending } = useExecuteBridge('0xVAULT', USDC_ADDRESS, 8453)
 *
 * await mutateAsync({
 *   oftToken: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
 *   dstEid: 30101,
 *   amount: 1_000_000n,
 *   dstVault: '0xSpokeVault...',
 *   refundAddress: curatorAddress,
 * })
 * ```
 */
export function useExecuteBridge(
  vault: `0x${string}`,
  token: Address,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })

  return useMutation({
    mutationFn: async (params: CuratorBridgeParams) => {
      if (!walletClient || !publicClient) {
        throw new Error('Wallet or public client not available')
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return executeCuratorBridge(walletClient as any, asSdkClient(publicClient), vault, token, params)
    },
  })
}
