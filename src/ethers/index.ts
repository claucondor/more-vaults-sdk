// MoreVaults SDK -- ethers.js v6
// Barrel export for all flows and utilities.

// --- Chain constants ---
export { CHAIN_IDS, LZ_EIDS, EID_TO_CHAIN_ID, CHAIN_ID_TO_EID, LZ_TIMEOUTS } from "./chains";

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
  // Curator types
  SwapParams,
  BatchSwapParams,
  BridgeParams,
  PendingAction,
  SubmitActionsResult,
  CuratorAction,
  CuratorVaultStatus,
  AssetInfo,
  VaultAnalysis,
  AssetBalance,
  VaultAssetBreakdown,
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
  LZ_ENDPOINT_ABI,
  // Curator ABIs
  MULTICALL_ABI,
  DEX_ABI,
  BRIDGE_FACET_ABI,
  ERC7540_FACET_ABI,
  ERC4626_FACET_ABI,
  CURATOR_CONFIG_ABI,
  LZ_ADAPTER_ABI,
  VAULT_ANALYSIS_ABI,
  REGISTRY_ABI,
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
  WrongChainError,
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
  quoteComposeFee,
  executeCompose,
  waitForCompose,
} from "./crossChainFlows";

// --- Redeem flows ---
export {
  redeemShares,
  withdrawAssets,
  requestRedeem,
  getWithdrawalRequest,
  redeemAsync,
  smartRedeem,
  bridgeSharesToHub,
  bridgeAssetsToSpoke,
  resolveRedeemAddresses,
  quoteShareBridgeFee,
} from "./redeemFlows";
export type { SpokeRedeemRoute } from "./redeemFlows";

// --- Utilities ---
export {
  ensureAllowance,
  quoteLzFee,
  isAsyncMode,
  getAsyncRequestStatus,
  getVaultStatus,
  detectStargateOft,
} from "./utils";
export type { VaultStatus, VaultMode } from "./utils";

// --- Pre-flight validation ---
export {
  preflightSync,
  preflightAsync,
  preflightRedeemLiquidity,
  preflightSpokeDeposit,
  preflightSpokeRedeem,
} from "./preflight";

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
  MultiChainUserPosition,
} from "./userHelpers";

// --- Curator status reads ---
export {
  getCuratorVaultStatus,
  getPendingActions,
  isCurator,
  getVaultAnalysis,
  checkProtocolWhitelist,
  getVaultAssetBreakdown,
} from "./curatorStatus";

// --- Curator multicall writes ---
export {
  encodeCuratorAction,
  buildCuratorBatch,
  submitActions,
  executeActions,
  vetoActions,
} from "./curatorMulticall";

// --- Curator swap helpers ---
export {
  buildUniswapV3Swap,
  encodeUniswapV3SwapCalldata,
} from "./curatorSwaps";

// --- Topology ---
export {
  getVaultTopology,
  getFullVaultTopology,
  discoverVaultTopology,
  isOnHubChain,
  getAllVaultChainIds,
  OMNI_FACTORY_ADDRESS,
} from "./topology";
export type { VaultTopology } from "./topology";

// --- Distribution ---
export {
  getVaultDistribution,
  getVaultDistributionWithTopology,
} from "./distribution";
export type { VaultDistribution, SpokeBalance } from "./distribution";

// --- Spoke routes ---
export {
  getInboundRoutes,
  getUserBalancesForRoutes,
  getOutboundRoutes,
  quoteRouteDepositFee,
  NATIVE_SYMBOL,
} from "./spokeRoutes";
export type {
  InboundRoute,
  InboundRouteWithBalance,
  OutboundRoute,
} from "./spokeRoutes";

// --- Chains ---
export { UNISWAP_V3_ROUTERS, OFT_ROUTES } from "./chains";

// --- wagmi / ethers adapter compatibility ---
export { asSdkSigner } from "./wagmiCompat";
