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
  /**
   * Expected EVM chain ID of the hub. When provided, SDK functions will
   * throw a clear WrongChainError if the signer is on a different chain.
   * Prevents silent failures when MetaMask is connected to the wrong network.
   */
  hubChainId?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Curator Operations Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SwapParams {
  targetContract: string;
  tokenIn: string;
  tokenOut: string;
  maxAmountIn: bigint;
  minAmountOut: bigint;
  swapCallData: string;
}

export interface BatchSwapParams {
  swaps: SwapParams[];
}

export interface BridgeParams {
  oftToken: string;
  dstEid: number;
  amount: bigint;
  dstVault: string;
  refundAddress: string;
}

export interface PendingAction {
  nonce: bigint;
  actionsData: string[];
  pendingUntil: bigint;
  isExecutable: boolean;
}

export interface SubmitActionsResult {
  receipt: ContractTransactionReceipt;
  nonce: bigint;
}

export type CuratorAction =
  | { type: 'swap'; params: SwapParams }
  | { type: 'batchSwap'; params: BatchSwapParams }
  | { type: 'erc4626Deposit'; vault: string; assets: bigint }
  | { type: 'erc4626Redeem'; vault: string; shares: bigint }
  | { type: 'erc7540RequestDeposit'; vault: string; assets: bigint }
  | { type: 'erc7540Deposit'; vault: string; assets: bigint }
  | { type: 'erc7540RequestRedeem'; vault: string; shares: bigint }
  | { type: 'erc7540Redeem'; vault: string; shares: bigint };

export interface CuratorVaultStatus {
  curator: string;
  timeLockPeriod: bigint;
  maxSlippagePercent: bigint;
  currentNonce: bigint;
  availableAssets: string[];
  lzAdapter: string;
  paused: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault Analysis Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AssetInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface VaultAnalysis {
  /** All tokens the vault can hold/swap (curator-managed) */
  availableAssets: AssetInfo[];
  /** Tokens users can deposit */
  depositableAssets: AssetInfo[];
  /** Whether deposit whitelist is enabled (restricts who can deposit) */
  depositWhitelistEnabled: boolean;
  /** Registry address for global protocol whitelist checks */
  registryAddress: string | null;
}

export interface AssetBalance extends AssetInfo {
  /** Raw balance held by the vault */
  balance: bigint;
}

export interface VaultAssetBreakdown {
  /** Per-asset balances held by the vault on the hub chain */
  assets: AssetBalance[];
  /** totalAssets() as reported by the vault (all positions converted to underlying) */
  totalAssets: bigint;
  /** totalSupply() of vault shares */
  totalSupply: bigint;
  /** Vault underlying token decimals */
  underlyingDecimals: number;
}

export type { Signer, Provider, ContractTransactionReceipt };
