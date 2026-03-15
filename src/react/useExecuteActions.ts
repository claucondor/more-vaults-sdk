import { useMutation } from '@tanstack/react-query'
import { usePublicClient, useWalletClient } from 'wagmi'
import { asSdkClient, executeActions } from '../viem/index.js'

/**
 * Execute a pending curator action batch by nonce.
 *
 * @example
 * const { mutateAsync } = useExecuteActions('0xVAULT', 747)
 * await mutateAsync({ nonce: 1n })
 */
export function useExecuteActions(vault: `0x${string}`, chainId: number) {
  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })

  return useMutation({
    mutationFn: async ({ nonce }: { nonce: bigint }) => {
      if (!walletClient || !publicClient) throw new Error('Wallet or public client not available')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return executeActions(walletClient as any, asSdkClient(publicClient), vault, nonce)
    },
  })
}
