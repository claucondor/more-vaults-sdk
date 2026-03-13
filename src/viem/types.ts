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
  /**
   * Expected EVM chain ID of the hub. When provided, SDK functions will
   * throw a clear WrongChainError if the walletClient is on a different chain.
   * Prevents silent failures when MetaMask is connected to the wrong network.
   */
  hubChainId?: number
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

/**
 * Data needed to execute a pending LZ compose on the hub chain.
 * Returned by `depositFromSpoke` when the OFT is a Stargate V2 pool,
 * because Stargate cannot forward ETH to the compose executor.
 * The SDK user must call `executeCompose()` with this data as a second TX on the hub.
 */
export interface ComposeData {
  /** LZ Endpoint address on the hub chain */
  endpoint: Address
  /** The OFT/pool address that sent the compose (Stargate pool on hub) */
  from: Address
  /** MoreVaultsComposer address on the hub */
  to: Address
  /** LayerZero GUID from the original OFT.send() */
  guid: `0x${string}`
  /** Compose index (always 0 for single-compose messages) */
  index: number
  /** The full compose message bytes (reconstructed from composeMsg + OFT header) */
  message: `0x${string}`
  /** Whether this is a Stargate OFT that requires a 2-TX flow */
  isStargate: boolean
  /** Hub chain ID for creating the hub wallet/public client */
  hubChainId: number
  /** Hub block number just before TX1 was sent — used as search start for ComposeSent events */
  hubBlockStart: bigint
}

/**
 * Result from `depositFromSpoke`.
 * When `composeData` is present, the user must call `executeCompose()` on the hub chain.
 */
export interface SpokeDepositResult {
  txHash: Hash
  guid: `0x${string}`
  /** Present when OFT is Stargate V2 — user must execute compose on hub as TX2 */
  composeData?: ComposeData
}

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
