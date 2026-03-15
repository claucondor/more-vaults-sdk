// MoreVaults SDK — viem/wagmi
// Provides typed helpers for all deposit, redeem, and cross-chain vault flows.

// --- Chain constants ---
export { CHAIN_IDS, LZ_EIDS, EID_TO_CHAIN_ID, CHAIN_ID_TO_EID, OFT_ROUTES, STARGATE_TAXI_CMD, USDC_STARGATE_OFT, USDC_TOKEN, LZ_TIMEOUTS, UNISWAP_V3_ROUTERS } from './chains'

// --- ABIs ---
export {
  VAULT_ABI,
  BRIDGE_ABI,
  CONFIG_ABI,
  ERC20_ABI,
  OFT_ABI,
  METADATA_ABI,
  LZ_ENDPOINT_ABI,
  MULTICALL_ABI,
  DEX_ABI,
  BRIDGE_FACET_ABI,
  ERC7540_FACET_ABI,
  ERC4626_FACET_ABI,
  CURATOR_CONFIG_ABI,
  LZ_ADAPTER_ABI,
  VAULT_ANALYSIS_ABI,
  REGISTRY_ABI,
} from './abis'

// --- Types ---
export type {
  VaultAddresses,
  DepositResult,
  RedeemResult,
  AsyncRequestResult,
  CrossChainRequestInfo,
  ActionTypeValue,
  ComposeData,
  SpokeDepositResult,
  SwapParams,
  BatchSwapParams,
  BridgeParams,
  PendingAction,
  SubmitActionsResult,
  CuratorAction,
  CuratorVaultStatus,
  AssetInfo,
  AssetBalance,
  VaultAnalysis,
  VaultAssetBreakdown,
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
  waitForCompose,
  quoteComposeFee,
  executeCompose,
} from './crossChainFlows'

// --- Redeem Flows ---
export {
  redeemShares,
  withdrawAssets,
  requestRedeem,
  getWithdrawalRequest,
  redeemAsync,
  smartRedeem,
  bridgeSharesToHub,
  quoteShareBridgeFee,
  bridgeAssetsToSpoke,
  resolveRedeemAddresses,
} from './redeemFlows'
export type { SpokeRedeemRoute } from './redeemFlows'

// --- Utilities ---
export {
  ensureAllowance,
  waitForTx,
  quoteLzFee,
  isAsyncMode,
  getAsyncRequestStatus,
  waitForAsyncRequest,
  getVaultStatus,
} from './utils'
export type { VaultStatus, VaultMode, AsyncRequestFinalResult } from './utils'

// --- Pre-flight validation ---
export { preflightSync, preflightAsync, preflightRedeemLiquidity, preflightSpokeDeposit, preflightSpokeRedeem } from './preflight'

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
  getUserPositionMultiChain,
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
  MultiChainUserPosition,
} from './userHelpers'

// --- Topology ---
export {
  getVaultTopology,
  getFullVaultTopology,
  discoverVaultTopology,
  isOnHubChain,
  getAllVaultChainIds,
  OMNI_FACTORY_ADDRESS,
} from './topology'
export type { VaultTopology } from './topology'

// --- Distribution ---
export { getVaultDistribution, getVaultDistributionWithTopology } from './distribution'
export type { VaultDistribution, SpokeBalance } from './distribution'

// --- Spoke Routes ---
export { getInboundRoutes, getUserBalancesForRoutes, getOutboundRoutes, quoteRouteDepositFee, NATIVE_SYMBOL } from './spokeRoutes'
export type { InboundRoute, InboundRouteWithBalance, OutboundRoute } from './spokeRoutes'

// --- Curator Operations ---
export {
  getCuratorVaultStatus,
  getPendingActions,
  isCurator,
  getVaultAnalysis,
  checkProtocolWhitelist,
  getVaultAssetBreakdown,
} from './curatorStatus'
export {
  encodeCuratorAction,
  buildCuratorBatch,
  submitActions,
  executeActions,
  vetoActions,
} from './curatorMulticall'
export {
  buildUniswapV3Swap,
  encodeUniswapV3SwapCalldata,
} from './curatorSwaps'

// --- wagmi compatibility ---
// Re-export viem's PublicClient type for wagmi compatibility.
// wagmi's usePublicClient() returns a type that is structurally compatible
// with viem's PublicClient but TypeScript may complain without this cast helper.
export type { PublicClient as SdkPublicClient } from 'viem'
export { asSdkClient } from './wagmiCompat'
