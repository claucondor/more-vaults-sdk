import type { Address, Hash, PublicClient, WalletClient } from 'viem'

export interface VaultAddresses {
  /** Hub vault address (diamond proxy) */
  vault: Address
  /** MoreVaultsEscrow — holds locked tokens during async cross-chain flows */
  escrow?: Address
  /** OFTAdapter for vault shares (cross-chain redeem only) */
  shareOFT?: Address
  /** OFT for USDC bridging (cross-chain deposits from spoke) */
  usdcOFT?: Address
}

export interface DepositResult {
  txHash: Hash
  shares: bigint
}

export interface RedeemResult {
  txHash: Hash
  assets: bigint
}

export interface AsyncRequestResult {
  txHash: Hash
  /** Cross-chain request GUID to track via getRequestInfo / getFinalizationResult */
  guid: `0x${string}`
}

/**
 * ActionType enum values matching MoreVaultsLib.ActionType on-chain.
 * DEPOSIT=0, MINT=1, WITHDRAW=2, REDEEM=3, MULTI_ASSETS_DEPOSIT=4, ACCRUE_FEES=5
 */
export const ActionType = {
  DEPOSIT: 0,
  MINT: 1,
  WITHDRAW: 2,
  REDEEM: 3,
  MULTI_ASSETS_DEPOSIT: 4,
  ACCRUE_FEES: 5,
} as const

export type ActionTypeValue = (typeof ActionType)[keyof typeof ActionType]

export interface CrossChainRequestInfo {
  initiator: Address
  timestamp: bigint
  actionType: number
  actionCallData: `0x${string}`
  fulfilled: boolean
  finalized: boolean
  refunded: boolean
  totalAssets: bigint
  finalizationResult: bigint
  amountLimit: bigint
}
