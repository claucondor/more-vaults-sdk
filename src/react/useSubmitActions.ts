import { useMutation } from '@tanstack/react-query'
import { usePublicClient, useWalletClient } from 'wagmi'
import { asSdkClient, submitActions, buildCuratorBatch } from '../viem/index.js'
import type { CuratorAction } from '../viem/index.js'

export type { CuratorAction }

/**
 * Submit a batch of curator actions to the vault.
 *
 * @example
 * const { mutateAsync } = useSubmitActions('0xVAULT', 747)
 * await mutateAsync({ actions: [{ type: 'erc4626Deposit', vault: '0x...', assets: 100n }] })
 */
export function useSubmitActions(vault: `0x${string}`, chainId: number) {
  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })

  return useMutation({
    mutationFn: async ({ actions }: { actions: CuratorAction[] }) => {
      if (!walletClient || !publicClient) throw new Error('Wallet or public client not available')
      const encodedActions = buildCuratorBatch(actions)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return submitActions(walletClient as any, asSdkClient(publicClient), vault, encodedActions)
    },
  })
}
