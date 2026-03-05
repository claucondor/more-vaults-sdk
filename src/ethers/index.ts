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

// --- Deposit flows ---
export {
  depositSimple,
  depositMultiAsset,
  depositCrossChainOracleOn,
  depositAsync,
  mintAsync,
} from "./depositFlows";

// --- Cross-chain flows ---
export { depositFromSpoke, depositFromSpokeAsync } from "./crossChainFlows";

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
export { preflightSync, preflightAsync } from "./preflight";

// --- User Helpers ---
export {
  getUserPosition,
  previewDeposit,
  previewRedeem,
  canDeposit,
  getVaultMetadata,
  getAsyncRequestStatusLabel,
} from "./userHelpers";
export type {
  UserPosition,
  DepositEligibility,
  DepositBlockReason,
  VaultMetadata,
  AsyncRequestStatus,
  AsyncRequestStatusInfo,
} from "./userHelpers";
