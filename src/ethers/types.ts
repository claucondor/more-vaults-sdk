import type { Signer, Provider, ContractTransactionReceipt } from "ethers";

/** Addresses involved in vault operations. */
export interface VaultAddresses {
  /** Hub vault (diamond proxy) address. */
  vault: string;
  /** MoreVaultsEscrow address for cross-chain locking. */
  escrow?: string;
  /** OFTAdapter address for share token bridging (cross-chain only). */
  shareOFT?: string;
  /** OFT address for USDC bridging (cross-chain only). */
  usdcOFT?: string;
}

/** Result of a synchronous deposit or mint. */
export interface DepositResult {
  receipt: ContractTransactionReceipt;
  /** Number of vault shares minted. */
  shares: bigint;
}

/** Result of a synchronous redeem or withdraw. */
export interface RedeemResult {
  receipt: ContractTransactionReceipt;
  /** Number of underlying assets returned. */
  assets: bigint;
}

/** Result of an asynchronous cross-chain request. */
export interface AsyncRequestResult {
  receipt: ContractTransactionReceipt;
  /** bytes32 request GUID for tracking fulfillment. */
  guid: string;
}

/**
 * ActionType enum matching MoreVaultsLib.ActionType on-chain values.
 *
 * DEPOSIT = 0, MINT = 1, WITHDRAW = 2, REDEEM = 3,
 * MULTI_ASSETS_DEPOSIT = 4, ACCRUE_FEES = 5
 */
export const ActionType = {
  DEPOSIT: 0,
  MINT: 1,
  WITHDRAW: 2,
  REDEEM: 3,
  MULTI_ASSETS_DEPOSIT: 4,
  ACCRUE_FEES: 5,
} as const;

export type ActionTypeValue = (typeof ActionType)[keyof typeof ActionType];

/** Cross-chain request info returned by getRequestInfo. */
export interface CrossChainRequestInfo {
  initiator: string;
  timestamp: bigint;
  actionType: number;
  actionCallData: string;
  fulfilled: boolean;
  finalized: boolean;
  refunded: boolean;
  totalAssets: bigint;
  finalizationResult: bigint;
  amountLimit: bigint;
}

export type { Signer, Provider, ContractTransactionReceipt };
