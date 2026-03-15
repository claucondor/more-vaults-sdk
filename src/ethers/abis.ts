/**
 * Human-readable ABI fragments for MoreVaults diamond facets.
 * Extracted from compiled artifacts in out/.
 */

export const VAULT_ABI = [
  // ERC4626 core
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function mint(uint256 shares, address receiver) returns (uint256 assets)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",

  // Multi-asset deposit
  "function deposit(address[] tokens, uint256[] assets, address receiver, uint256 minAmountOut) payable returns (uint256 shares)",

  // Withdrawal queue
  "function requestRedeem(uint256 shares, address onBehalfOf)",
  "function requestWithdraw(uint256 assets, address onBehalfOf)",
  "function clearRequest()",
  "function getWithdrawalRequest(address _owner) view returns (uint256 shares, uint256 timelockEndsAt)",

  // Views
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function asset() view returns (address)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function paused() view returns (bool)",

  // Events
  "event Deposit(address indexed sender, address indexed owner, address[] tokens, uint256[] assets, uint256 shares)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event WithdrawRequestCreated(address requester, uint256 sharesAmount, uint256 endsAt)",
  "event WithdrawRequestFulfilled(address requester, address receiver, uint256 sharesAmount, uint256 assetAmount)",
] as const;

export const BRIDGE_ABI = [
  "function initVaultActionRequest(uint8 actionType, bytes actionCallData, uint256 amountLimit, bytes extraOptions) payable returns (bytes32 guid)",
  "function getRequestInfo(bytes32 guid) view returns (tuple(address initiator, uint64 timestamp, uint8 actionType, bytes actionCallData, bool fulfilled, bool finalized, bool refunded, uint256 totalAssets, uint256 finalizationResult, uint256 amountLimit))",
  "function getFinalizationResult(bytes32 guid) view returns (uint256 result)",
  "function oraclesCrossChainAccounting() view returns (bool)",
  "function quoteAccountingFee(bytes extraOptions) view returns (uint256 nativeFee)",
  "function accountingBridgeFacet() view returns (uint256 sum, bool isPositive)",
] as const;

export const CONFIG_ABI = [
  "function getEscrow() view returns (address escrow)",
  "function getCrossChainAccountingManager() view returns (address)",
  "function isHub() view returns (bool)",
  "function getWithdrawalQueueStatus() view returns (bool)",
  "function getWithdrawalTimelock() view returns (uint64)",
  "function getWithdrawalFee() view returns (uint96)",
  "function getMaxWithdrawalDelay() view returns (uint32)",
  "function getAvailableAssets() view returns (address[])",
  "function getDepositableAssets() view returns (address[])",
  "function depositCapacity() view returns (uint256)",
  "function fee() view returns (uint96)",
  "function feeRecipient() view returns (address)",
  "function paused() view returns (bool)",
  "function maxDeposit(address receiver) view returns (uint256)",
] as const;

export const METADATA_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

export const OFT_ABI = [
  "function send(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable returns (tuple(bytes32 guid, uint64 nonce, uint256 amountSentLD, uint256 amountReceivedLD) receipt, tuple(uint256 nativeFee, uint256 lzTokenFee) fee)",
  "function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns (tuple(uint256 nativeFee, uint256 lzTokenFee))",
] as const;

export const LZ_ENDPOINT_ABI = [
  "function composeQueue(address from, address to, bytes32 guid, uint16 index) view returns (bytes32 messageHash)",
  "function lzCompose(address _from, address _to, bytes32 _guid, uint16 _index, bytes _message, bytes _extraData) payable",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Curator Operations ABIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MulticallFacet ABI — curator action submission and execution with timelock.
 */
export const MULTICALL_ABI = [
  "function submitActions(bytes[] actionsData) returns (uint256 nonce)",
  "function executeActions(uint256 actionsNonce)",
  "function getPendingActions(uint256 actionsNonce) view returns (bytes[] actionsData, uint256 pendingUntil)",
  "function getCurrentNonce() view returns (uint256)",
  "function vetoActions(uint256[] actionsNonces)",
] as const;

/**
 * GenericDexFacet ABI — single and batch token swaps through any DEX aggregator.
 */
export const DEX_ABI = [
  "function executeSwap(tuple(address targetContract, address tokenIn, address tokenOut, uint256 maxAmountIn, uint256 minAmountOut, bytes swapCallData) params) returns (uint256 amountOut)",
  "function executeBatchSwap(tuple(tuple(address targetContract, address tokenIn, address tokenOut, uint256 maxAmountIn, uint256 minAmountOut, bytes swapCallData)[] swaps) params) returns (uint256[] amountsOut)",
] as const;

/**
 * BridgeFacet ABI — curator bridging and cross-chain request initiation.
 */
export const BRIDGE_FACET_ABI = [
  "function executeBridging(address adapter, address token, uint256 amount, bytes bridgeSpecificParams) payable",
  "function initVaultActionRequest(uint8 actionType, bytes actionCallData, uint256 amountLimit, bytes extraOptions) payable returns (bytes32 guid)",
  "function executeRequest(bytes32 guid)",
] as const;

/**
 * ERC7540Facet ABI — async deposit and redeem operations on ERC7540 vaults.
 */
export const ERC7540_FACET_ABI = [
  "function erc7540RequestDeposit(address vault, uint256 assets) returns (uint256 requestId)",
  "function erc7540RequestRedeem(address vault, uint256 shares) returns (uint256 requestId)",
  "function erc7540Deposit(address vault, uint256 assets) returns (uint256 shares)",
  "function erc7540Redeem(address vault, uint256 shares) returns (uint256 assets)",
] as const;

/**
 * ERC4626Facet ABI — synchronous deposit and redeem into whitelisted ERC-4626 vaults.
 */
export const ERC4626_FACET_ABI = [
  "function erc4626Deposit(address vault, uint256 assets) returns (uint256 shares)",
  "function erc4626Redeem(address vault, uint256 shares) returns (uint256 assets)",
] as const;

/**
 * ConfigurationFacet ABI — extended with curator-relevant read functions.
 */
export const CURATOR_CONFIG_ABI = [
  "function curator() view returns (address)",
  "function timeLockPeriod() view returns (uint256)",
  "function getAvailableAssets() view returns (address[])",
  "function getMaxSlippagePercent() view returns (uint256)",
  "function getCrossChainAccountingManager() view returns (address)",
  "function paused() view returns (bool)",
] as const;

/**
 * LzAdapter ABI — fee quoting for bridge and LZ Read operations.
 */
export const LZ_ADAPTER_ABI = [
  "function quoteBridgeFee(bytes bridgeSpecificParams) view returns (uint256 nativeFee)",
  "function quoteReadFee(address[] vaults, uint32[] eids, bytes _extraOptions) view returns (tuple(uint256 nativeFee, uint256 lzTokenFee) fee)",
] as const;

/**
 * Vault analysis ABIs — per-vault whitelist and registry reads.
 */
export const VAULT_ANALYSIS_ABI = [
  "function getAvailableAssets() view returns (address[])",
  "function getDepositableAssets() view returns (address[])",
  "function isAssetAvailable(address asset) view returns (bool)",
  "function isAssetDepositable(address asset) view returns (bool)",
  "function isDepositWhitelistEnabled() view returns (bool)",
  "function getAvailableToDeposit(address depositor) view returns (uint256)",
  "function moreVaultsRegistry() view returns (address)",
] as const;

/**
 * MoreVaultsRegistry ABI — global protocol and bridge whitelist checks.
 */
export const REGISTRY_ABI = [
  "function isWhitelisted(address protocol) view returns (bool)",
  "function isBridgeAllowed(address bridge) view returns (bool)",
  "function getAllowedFacets() view returns (address[])",
] as const;
