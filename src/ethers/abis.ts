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
