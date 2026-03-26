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
  SUB_VAULT_ABI,
  ADMIN_CONFIG_ABI,
  ACCESS_CONTROL_ABI,
  ADMIN_WRITE_ABI,
  TIMELOCK_CONFIG_ABI,
} from './abis'

// --- Types ---
export type {
  VaultAddresses,
  DepositResult,
  RedeemResult,
  AsyncRequestResult,
  RedeemCostEstimate,
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
  VaultConfiguration,
  CuratorVaultStatus,
  AssetInfo,
  AssetBalance,
  VaultAnalysis,
  VaultAssetBreakdown,
  SubVaultPosition,
  SubVaultInfo,
  ERC7540RequestStatus,
  VaultPortfolio,
  ChainPortfolio,
  MultiChainPortfolio,
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
  NotCuratorError,
  NotOwnerError,
  NotGuardianError,
  InvalidInputError,
  ActionsStillPendingError,
  NoSuchActionsError,
  SlippageExceededError,
  UnsupportedAssetError,
  ComposerNotConfiguredError,
  UnsupportedChainError,
  InsufficientBalanceError,
  AsyncRequestTimeoutError,
  ComposeTimeoutError,
  ComposeAlreadyExecutedError,
  WithdrawalTimelockActiveError,
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
  estimateRedeemCost,
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
  detectStargateOft,
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
export {
  encodeBridgeParams,
  quoteCuratorBridgeFee,
  executeCuratorBridge,
  findBridgeRoute,
} from './curatorBridge'
export type { CuratorBridgeParams } from './curatorBridge'

// --- Vault Configuration (Phase 7) ---
export { getVaultConfiguration } from './vaultConfig'

// --- Admin Actions (Phase 7) ---
export {
  setDepositCapacity,
  addAvailableAsset,
  addAvailableAssets,
  disableAssetToDeposit,
  setFeeRecipient,
  setDepositWhitelist,
  enableDepositWhitelist,
  pauseVault,
  unpauseVault,
  recoverAssets,
  acceptOwnership,
} from './adminActions'

// --- Curator Sub-Vault Operations ---
export {
  getSubVaultPositions,
  detectSubVaultType,
  getSubVaultInfo,
  getERC7540RequestStatus,
  previewSubVaultDeposit,
  previewSubVaultRedeem,
  getVaultPortfolio,
  getVaultPortfolioMultiChain,
} from './curatorSubVaults'

// --- wagmi compatibility ---
// Re-export viem's PublicClient type for wagmi compatibility.
// wagmi's usePublicClient() returns a type that is structurally compatible
// with viem's PublicClient but TypeScript may complain without this cast helper.
export type { PublicClient as SdkPublicClient } from 'viem'
export { asSdkClient } from './wagmiCompat'

// --- Flow persistence ---
export type { FlowStorage, DepositFlowState } from './flowStorage'
export { LocalStorageAdapter, getDefaultStorage, saveDepositFlow, loadDepositFlow, clearDepositFlow } from './flowStorage'
