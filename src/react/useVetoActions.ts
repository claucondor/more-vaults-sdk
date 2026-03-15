import { useMutation } from '@tanstack/react-query'
import { usePublicClient, useWalletClient } from 'wagmi'
import { asSdkClient, vetoActions } from '../viem/index.js'

/**
 * Guardian-only: cancel (veto) one or more pending curator action batches.
 *
 * @example
 * const { mutateAsync } = useVetoActions('0xVAULT', 747)
 * await mutateAsync({ nonces: [1n, 2n] })
 */
export function useVetoActions(vault: `0x${string}`, chainId: number) {
  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })

  return useMutation({
    mutationFn: async ({ nonces }: { nonces: bigint[] }) => {
      if (!walletClient || !publicClient) throw new Error('Wallet or public client not available')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return vetoActions(walletClient as any, asSdkClient(publicClient), vault, nonces)
    },
  })
}
