// MoreVaults SDK — viem/wagmi
// Provides typed helpers for all deposit, redeem, and cross-chain vault flows.

// --- Chain constants ---
export { CHAIN_IDS, LZ_EIDS, EID_TO_CHAIN_ID, CHAIN_ID_TO_EID, OFT_ROUTES, STARGATE_TAXI_CMD, USDC_STARGATE_OFT, USDC_TOKEN } from './chains'

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
  WrongChainError,
} from './errors'

// --- Deposit Flows ---
export {
  depositSimple,
  depositCrossChainOracleOn,
  depositMultiAsset,
  depositAsync,
  mintAsync,
  smartDeposit,
} from './depositFlows'

// --- Cross-Chain Flows ---
export {
  depositFromSpoke,
  depositFromSpokeAsync,
  quoteDepositFromSpokeFee,
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
export { preflightSync, preflightAsync, preflightRedeemLiquidity } from './preflight'

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
} from './userHelpers'
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
} from './userHelpers'

// --- Topology ---
export {
  getVaultTopology,
  getFullVaultTopology,
  isOnHubChain,
  getAllVaultChainIds,
  OMNI_FACTORY_ADDRESS,
} from './topology'
export type { VaultTopology } from './topology'

// --- Distribution ---
export { getVaultDistribution, getVaultDistributionWithTopology } from './distribution'
export type { VaultDistribution, SpokeBalance } from './distribution'

// --- Spoke Routes ---
export { getInboundRoutes, getUserBalancesForRoutes, NATIVE_SYMBOL } from './spokeRoutes'
export type { InboundRoute, InboundRouteWithBalance } from './spokeRoutes'

// --- wagmi compatibility ---
// Re-export viem's PublicClient type for wagmi compatibility.
// wagmi's usePublicClient() returns a type that is structurally compatible
// with viem's PublicClient but TypeScript may complain without this cast helper.
export type { PublicClient as SdkPublicClient } from 'viem'
export { asSdkClient } from './wagmiCompat'
