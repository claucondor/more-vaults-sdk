// MoreVaults SDK — viem/wagmi
// Provides typed helpers for all deposit, redeem, and cross-chain vault flows.

// --- ABIs ---
export {
  VAULT_ABI,
  BRIDGE_ABI,
  CONFIG_ABI,
  ERC20_ABI,
  OFT_ABI,
  METADATA_ABI,
} from './abis'

// --- Types ---
export type {
  VaultAddresses,
  DepositResult,
  RedeemResult,
  AsyncRequestResult,
  CrossChainRequestInfo,
  ActionTypeValue,
} from './types'
export { ActionType } from './types'

// --- Deposit Flows ---
export {
  depositSimple,
  depositCrossChainOracleOn,
  depositMultiAsset,
  depositAsync,
  mintAsync,
} from './depositFlows'

// --- Cross-Chain Flows ---
export {
  depositFromSpoke,
  depositFromSpokeAsync,
} from './crossChainFlows'

// --- Redeem Flows ---
export {
  redeemShares,
  withdrawAssets,
  requestRedeem,
  getWithdrawalRequest,
  redeemAsync,
  bridgeSharesToHub,
} from './redeemFlows'

// --- Utilities ---
export {
  ensureAllowance,
  quoteLzFee,
  isAsyncMode,
  getAsyncRequestStatus,
  getVaultStatus,
} from './utils'
export type { VaultStatus, VaultMode } from './utils'

// --- Pre-flight validation ---
export { preflightSync, preflightAsync } from './preflight'

// --- User Helpers ---
export {
  getUserPosition,
  previewDeposit,
  previewRedeem,
  canDeposit,
  getVaultMetadata,
  getAsyncRequestStatusLabel,
} from './userHelpers'
export type {
  UserPosition,
  DepositEligibility,
  DepositBlockReason,
  VaultMetadata,
  AsyncRequestStatus,
  AsyncRequestStatusInfo,
} from './userHelpers'
