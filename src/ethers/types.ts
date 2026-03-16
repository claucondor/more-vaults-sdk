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

// ─────────────────────────────────────────────────────────────────────────────
// Sub-vault Types (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single active sub-vault position held by the curator vault.
 * Covers both ERC4626 (synchronous) and ERC7540 (asynchronous) sub-vaults.
 */
export interface SubVaultPosition {
  /** Sub-vault contract address */
  address: string;
  /** Protocol type of the sub-vault */
  type: "erc4626" | "erc7540";
  /** Name of the sub-vault share token */
  name: string;
  /** Symbol of the sub-vault share token */
  symbol: string;
  /** Decimals of the sub-vault share token */
  decimals: number;
  /** Shares of the sub-vault held by the curator vault */
  sharesBalance: bigint;
  /** Current value of the shares in terms of the sub-vault's underlying asset */
  underlyingValue: bigint;
  /** Underlying asset address of the sub-vault */
  underlyingAsset: string;
  /** Symbol of the sub-vault's underlying asset */
  underlyingSymbol: string;
  /** Decimals of the sub-vault's underlying asset */
  underlyingDecimals: number;
}

/**
 * Metadata and capability snapshot for a potential sub-vault investment target.
 */
export interface SubVaultInfo {
  /** Sub-vault contract address */
  address: string;
  /** Protocol type: ERC4626 (sync) or ERC7540 (async) */
  type: "erc4626" | "erc7540";
  /** Sub-vault share token name */
  name: string;
  /** Sub-vault share token symbol */
  symbol: string;
  /** Sub-vault share token decimals */
  decimals: number;
  /** Underlying asset address */
  underlyingAsset: string;
  /** Underlying asset symbol */
  underlyingSymbol: string;
  /** Underlying asset decimals */
  underlyingDecimals: number;
  /** Maximum amount the curator vault can deposit (from maxDeposit(vault)) */
  maxDeposit: bigint;
  /** Whether the sub-vault is whitelisted in the global MoreVaults registry */
  isWhitelisted: boolean;
}

/**
 * Status of pending and claimable ERC7540 async requests for a sub-vault.
 * Uses requestId = 0 (the standard default for non-batch ERC7540 vaults).
 */
export interface ERC7540RequestStatus {
  /** Sub-vault address these statuses belong to */
  subVault: string;
  /** Assets in a pending deposit request (not yet claimable) */
  pendingDeposit: bigint;
  /** Assets ready to be claimed/finalized as shares */
  claimableDeposit: bigint;
  /** Shares in a pending redeem request (not yet claimable) */
  pendingRedeem: bigint;
  /** Assets ready to be claimed after redeem fulfillment */
  claimableRedeem: bigint;
  /** True if claimableDeposit > 0 — vault can call erc7540Deposit to finalize */
  canFinalizeDeposit: boolean;
  /** True if claimableRedeem > 0 — vault can call erc7540Redeem to finalize */
  canFinalizeRedeem: boolean;
}

/**
 * Full portfolio view for a curator vault combining liquid and invested assets.
 */
export interface VaultPortfolio {
  /** Liquid ERC20 asset balances held directly by the vault (excludes sub-vault share tokens) */
  liquidAssets: AssetBalance[];
  /** Active positions in ERC4626/ERC7540 sub-vaults */
  subVaultPositions: SubVaultPosition[];
  /**
   * Approximate total value in underlying terms:
   * liquid underlying balance + sum of sub-vault convertToAssets values.
   */
  totalValue: bigint;
  /** totalAssets() from the vault — authoritative AUM figure */
  totalAssets: bigint;
  /** totalSupply() of vault shares */
  totalSupply: bigint;
  /** Assets locked in pending ERC7540 requests (lockedTokensAmountOfAsset) */
  lockedAssets: bigint;
}

export type { Signer, Provider, ContractTransactionReceipt };
