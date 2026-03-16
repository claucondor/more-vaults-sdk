import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { asSdkClient, getERC7540RequestStatus } from '../viem/index.js'
import type { ERC7540RequestStatus } from '../viem/index.js'

export type { ERC7540RequestStatus }

interface UseERC7540RequestStatusOptions {
  /** Refetch interval in ms. Default: 15_000 (15s) — shorter since pending→claimable transitions matter */
  refetchInterval?: number
}

/**
 * Read ERC7540 async request status for a specific sub-vault.
 *
 * Queries pending and claimable deposit/redeem amounts for the vault
 * acting as controller in the given ERC7540 sub-vault (requestId = 0).
 *
 * @example
 * const { data: status } = useERC7540RequestStatus(
 *   '0xVAULT',
 *   8453,
 *   '0xSUB_VAULT'
 * )
 * if (status?.canFinalizeDeposit) {
 *   // curator can call erc7540Deposit to claim shares
 * }
 */
export function useERC7540RequestStatus(
  vault: `0x${string}` | undefined,
  chainId: number,
  subVault: `0x${string}` | undefined,
  options?: UseERC7540RequestStatusOptions,
) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['erc7540RequestStatus', vault, chainId, subVault],
    queryFn: () => getERC7540RequestStatus(asSdkClient(publicClient), vault!, subVault!),
    enabled: !!vault && !!publicClient && !!subVault,
    refetchInterval: options?.refetchInterval ?? 15_000,
    staleTime: 10_000,
  })
}
