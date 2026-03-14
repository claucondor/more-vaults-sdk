/**
 * ABI fragments for MoreVaults SDK.
 * Extracted from compiled contract artifacts — only the selectors used by SDK flows.
 */

export const VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'assets', type: 'uint256[]' },
      { name: 'receiver', type: 'address' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'redeem',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestRedeem',
    inputs: [
      { name: '_shares', type: 'uint256' },
      { name: '_onBehalfOf', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestWithdraw',
    inputs: [
      { name: '_assets', type: 'uint256' },
      { name: '_onBehalfOf', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getWithdrawalRequest',
    inputs: [{ name: '_owner', type: 'address' }],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'timelockEndsAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalAssets',
    inputs: [],
    outputs: [{ name: '_totalAssets', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'asset',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'convertToShares',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'convertToAssets',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'previewDeposit',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'previewRedeem',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const BRIDGE_ABI = [
  {
    type: 'function',
    name: 'initVaultActionRequest',
    inputs: [
      { name: 'actionType', type: 'uint8' },
      { name: 'actionCallData', type: 'bytes' },
      { name: 'amountLimit', type: 'uint256' },
      { name: 'extraOptions', type: 'bytes' },
    ],
    outputs: [{ name: 'guid', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getRequestInfo',
    inputs: [{ name: 'guid', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'initiator', type: 'address' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'actionType', type: 'uint8' },
          { name: 'actionCallData', type: 'bytes' },
          { name: 'fulfilled', type: 'bool' },
          { name: 'finalized', type: 'bool' },
          { name: 'refunded', type: 'bool' },
          { name: 'totalAssets', type: 'uint256' },
          { name: 'finalizationResult', type: 'uint256' },
          { name: 'amountLimit', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFinalizationResult',
    inputs: [{ name: 'guid', type: 'bytes32' }],
    outputs: [{ name: 'result', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteAccountingFee',
    inputs: [{ name: 'extraOptions', type: 'bytes' }],
    outputs: [{ name: 'nativeFee', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'oraclesCrossChainAccounting',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

export const CONFIG_ABI = [
  {
    type: 'function',
    name: 'getEscrow',
    inputs: [],
    outputs: [{ name: 'escrow', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCrossChainAccountingManager',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isHub',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getWithdrawalQueueStatus',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getWithdrawalTimelock',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'maxDeposit',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/**
 * Minimal ABI for reading ERC-20 / ERC-4626 token metadata.
 * Used to read name, symbol, and decimals from any token or vault.
 */
export const METADATA_ABI = [
  { type: 'function', name: 'name',     inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol',   inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ name: '', type: 'uint8'  }], stateMutability: 'view' },
] as const

/**
 * Minimal OFT ABI for cross-chain bridging (LayerZero OFT standard).
 * Used by D6/D7 spoke-to-hub flows and R6 share bridging.
 */
export const OFT_ABI = [
  {
    type: 'function',
    name: 'send',
    inputs: [
      {
        name: '_sendParam',
        type: 'tuple',
        components: [
          { name: 'dstEid', type: 'uint32' },
          { name: 'to', type: 'bytes32' },
          { name: 'amountLD', type: 'uint256' },
          { name: 'minAmountLD', type: 'uint256' },
          { name: 'extraOptions', type: 'bytes' },
          { name: 'composeMsg', type: 'bytes' },
          { name: 'oftCmd', type: 'bytes' },
        ],
      },
      {
        name: '_fee',
        type: 'tuple',
        components: [
          { name: 'nativeFee', type: 'uint256' },
          { name: 'lzTokenFee', type: 'uint256' },
        ],
      },
      { name: '_refundAddress', type: 'address' },
    ],
    outputs: [
      {
        name: 'msgReceipt',
        type: 'tuple',
        components: [
          { name: 'guid', type: 'bytes32' },
          { name: 'nonce', type: 'uint64' },
          {
            name: 'fee',
            type: 'tuple',
            components: [
              { name: 'nativeFee', type: 'uint256' },
              { name: 'lzTokenFee', type: 'uint256' },
            ],
          },
        ],
      },
      {
        name: 'oftReceipt',
        type: 'tuple',
        components: [
          { name: 'amountSentLD', type: 'uint256' },
          { name: 'amountReceivedLD', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'quoteSend',
    inputs: [
      {
        name: '_sendParam',
        type: 'tuple',
        components: [
          { name: 'dstEid', type: 'uint32' },
          { name: 'to', type: 'bytes32' },
          { name: 'amountLD', type: 'uint256' },
          { name: 'minAmountLD', type: 'uint256' },
          { name: 'extraOptions', type: 'bytes' },
          { name: 'composeMsg', type: 'bytes' },
          { name: 'oftCmd', type: 'bytes' },
        ],
      },
      { name: '_payInLzToken', type: 'bool' },
    ],
    outputs: [
      {
        name: 'msgFee',
        type: 'tuple',
        components: [
          { name: 'nativeFee', type: 'uint256' },
          { name: 'lzTokenFee', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'peers',
    inputs: [{ name: '_eid', type: 'uint32' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteOFT',
    inputs: [
      {
        name: '_sendParam',
        type: 'tuple',
        components: [
          { name: 'dstEid', type: 'uint32' },
          { name: 'to', type: 'bytes32' },
          { name: 'amountLD', type: 'uint256' },
          { name: 'minAmountLD', type: 'uint256' },
          { name: 'extraOptions', type: 'bytes' },
          { name: 'composeMsg', type: 'bytes' },
          { name: 'oftCmd', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'oftLimit',
        type: 'tuple',
        components: [
          { name: 'minAmountLD', type: 'uint256' },
          { name: 'maxAmountLD', type: 'uint256' },
        ],
      },
      {
        name: 'oftFeeDetails',
        type: 'tuple[]',
        components: [
          { name: 'feeAmountLD', type: 'int256' },
          { name: 'description', type: 'string' },
        ],
      },
      {
        name: 'oftReceipt',
        type: 'tuple',
        components: [
          { name: 'amountSentLD', type: 'uint256' },
          { name: 'amountReceivedLD', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Curator Operations ABIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MulticallFacet ABI — curator action submission and execution with timelock.
 */
export const MULTICALL_ABI = [
  {
    type: 'function',
    name: 'submitActions',
    inputs: [
      { name: 'actionsData', type: 'bytes[]' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeActions',
    inputs: [
      { name: 'actionsNonce', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getPendingActions',
    inputs: [
      { name: 'actionsNonce', type: 'uint256' },
    ],
    outputs: [
      { name: 'actionsData', type: 'bytes[]' },
      { name: 'pendingUntil', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentNonce',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'vetoActions',
    inputs: [
      { name: 'actionsNonces', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * GenericDexFacet ABI — single and batch token swaps through any DEX aggregator.
 */
export const DEX_ABI = [
  {
    type: 'function',
    name: 'executeSwap',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'targetContract', type: 'address' },
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'maxAmountIn', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
          { name: 'swapCallData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeBatchSwap',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'swaps',
            type: 'tuple[]',
            components: [
              { name: 'targetContract', type: 'address' },
              { name: 'tokenIn', type: 'address' },
              { name: 'tokenOut', type: 'address' },
              { name: 'maxAmountIn', type: 'uint256' },
              { name: 'minAmountOut', type: 'uint256' },
              { name: 'swapCallData', type: 'bytes' },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: 'amountsOut', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * BridgeFacet ABI — curator bridging and cross-chain request initiation.
 * (extends the existing BRIDGE_ABI with curator-specific functions)
 */
export const BRIDGE_FACET_ABI = [
  {
    type: 'function',
    name: 'executeBridging',
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'bridgeSpecificParams', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'initVaultActionRequest',
    inputs: [
      { name: 'actionType', type: 'uint8' },
      { name: 'actionCallData', type: 'bytes' },
      { name: 'amountLimit', type: 'uint256' },
      { name: 'extraOptions', type: 'bytes' },
    ],
    outputs: [{ name: 'guid', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'executeRequest',
    inputs: [
      { name: 'guid', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * ERC7540Facet ABI — async deposit and redeem operations on ERC7540 vaults.
 */
export const ERC7540_FACET_ABI = [
  {
    type: 'function',
    name: 'erc7540RequestDeposit',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'assets', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'erc7540RequestRedeem',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'erc7540Deposit',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'assets', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'erc7540Redeem',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * ConfigurationFacet ABI — extended with curator-relevant read functions.
 * Augments the existing CONFIG_ABI with additional getters needed by curator dashboard.
 */
export const CURATOR_CONFIG_ABI = [
  {
    type: 'function',
    name: 'curator',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'timeLockPeriod',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAvailableAssets',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getMaxSlippagePercent',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCrossChainAccountingManager',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

/**
 * LzAdapter ABI — fee quoting for bridge and LZ Read operations.
 */
export const LZ_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'quoteBridgeFee',
    inputs: [
      { name: 'bridgeSpecificParams', type: 'bytes' },
    ],
    outputs: [{ name: 'nativeFee', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'quoteReadFee',
    inputs: [
      { name: 'vaults', type: 'address[]' },
      { name: 'eids', type: 'uint32[]' },
      { name: '_extraOptions', type: 'bytes' },
    ],
    outputs: [
      {
        name: 'fee',
        type: 'tuple',
        components: [
          { name: 'nativeFee', type: 'uint256' },
          { name: 'lzTokenFee', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

/**
 * ERC4626Facet ABI — synchronous deposit and redeem into whitelisted ERC-4626 vaults.
 */
export const ERC4626_FACET_ABI = [
  {
    type: 'function',
    name: 'erc4626Deposit',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'assets', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'erc4626Redeem',
    inputs: [
      { name: 'vault', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * Vault analysis ABIs — per-vault whitelist and registry reads.
 */
export const VAULT_ANALYSIS_ABI = [
  // Asset management reads
  { type: 'function', name: 'getAvailableAssets', inputs: [], outputs: [{ type: 'address[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getDepositableAssets', inputs: [], outputs: [{ type: 'address[]' }], stateMutability: 'view' },
  { type: 'function', name: 'isAssetAvailable', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'isAssetDepositable', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  // Deposit whitelist
  { type: 'function', name: 'isDepositWhitelistEnabled', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getAvailableToDeposit', inputs: [{ name: 'depositor', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // Registry
  { type: 'function', name: 'moreVaultsRegistry', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

/**
 * MoreVaultsRegistry ABI — global protocol and bridge whitelist checks.
 */
export const REGISTRY_ABI = [
  { type: 'function', name: 'isWhitelisted', inputs: [{ name: 'protocol', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'isBridgeAllowed', inputs: [{ name: 'bridge', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getAllowedFacets', inputs: [], outputs: [{ type: 'address[]' }], stateMutability: 'view' },
] as const

/**
 * Minimal LZ Endpoint V2 ABI for compose queue management.
 * Used by the Stargate 2-TX flow to check compose status and execute pending composes.
 */
export const LZ_ENDPOINT_ABI = [
  {
    type: 'function',
    name: 'composeQueue',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'guid', type: 'bytes32' },
      { name: 'index', type: 'uint16' },
    ],
    outputs: [{ name: 'messageHash', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'lzCompose',
    inputs: [
      { name: '_from', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_guid', type: 'bytes32' },
      { name: '_index', type: 'uint16' },
      { name: '_message', type: 'bytes' },
      { name: '_extraData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const