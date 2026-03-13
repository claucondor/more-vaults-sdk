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