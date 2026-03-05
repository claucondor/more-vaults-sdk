// MoreVaults SDK -- ethers.js v6
// Barrel export for all flows and utilities.

// --- Types ---
export type {
  VaultAddresses,
  DepositResult,
  RedeemResult,
  AsyncRequestResult,
  CrossChainRequestInfo,
  ActionTypeValue,
  Signer,
  Provider,
  ContractTransactionReceipt,
} from "./types";
export { ActionType } from "./types";

// --- ABIs ---
export {
  VAULT_ABI,
  BRIDGE_ABI,
  CONFIG_ABI,
  ERC20_ABI,
  OFT_ABI,
  METADATA_ABI,
} from "./abis";

// --- Errors ---
export {
  MoreVaultsError,
  VaultPausedError,
  CapacityFullError,
  NotWhitelistedError,
  InsufficientLiquidityError,
  CCManagerNotConfiguredError,
  EscrowNotConfiguredError,
  NotHubVaultError,
  MissingEscrowAddressError,
} from "./errors";

// --- Deposit flows ---
export {
  depositSimple,
  depositMultiAsset,
  depositCrossChainOracleOn,
  depositAsync,
  mintAsync,
  smartDeposit,
} from "./depositFlows";

// --- Cross-chain flows ---
export {
  depositFromSpoke,
  depositFromSpokeAsync,
  quoteDepositFromSpokeFee,
} from "./crossChainFlows";

// --- Redeem flows ---
export {
  redeemShares,
  withdrawAssets,
  requestRedeem,
  getWithdrawalRequest,
  redeemAsync,
  bridgeSharesToHub,
} from "./redeemFlows";

// --- Utilities ---
export {
  ensureAllowance,
  quoteLzFee,
  isAsyncMode,
  getAsyncRequestStatus,
  getVaultStatus,
} from "./utils";
export type { VaultStatus, VaultMode } from "./utils";

// --- Pre-flight validation ---
export { preflightSync, preflightAsync, preflightRedeemLiquidity } from "./preflight";

// --- User Helpers ---
export {
  getUserPosition,
  previewDeposit,
  previewRedeem,
  canDeposit,
  getVaultMetadata,
  getAsyncRequestStatusLabel,
  getUserBalances,
  getMaxWithdrawable,
  getVaultSummary,
} from "./userHelpers";
export type {
  UserPosition,
  DepositEligibility,
  DepositBlockReason,
  VaultMetadata,
  AsyncRequestStatus,
  AsyncRequestStatusInfo,
  UserBalances,
  MaxWithdrawable,
  VaultSummary,
} from "./userHelpers";
