import { JsonRpcProvider } from "ethers";
import type { Provider } from "ethers";

/** EVM Chain IDs for chains supported by MoreVaults */
export const CHAIN_IDS = {
  flowEVMMainnet: 747,
  flowEVMTestnet: 545,
  arbitrum: 42161,
  base: 8453,
  ethereum: 1,
  optimism: 10,
  sonic: 146,
  bsc: 56,
} as const;

/**
 * LayerZero Endpoint IDs (EID) for chains supported by MoreVaults.
 * Verified on-chain via MoreVaults OmniFactory.localEid() on each chain.
 * - flowMainnet: 30336 (0x7680) — confirmed from factory + LZ endpoint on Flow EVM mainnet
 */
export const LZ_EIDS = {
  flowMainnet: 30336,
  flowTestnet: 30333,
  arbitrum: 30110,
  base: 30184,
  ethereum: 30101,
  optimism: 30111,
  sonic: 30332,
  bsc: 30102,
} as const;

/** LayerZero EID → EVM Chain ID */
export const EID_TO_CHAIN_ID: Record<number, number> = {
  [LZ_EIDS.flowMainnet]: CHAIN_IDS.flowEVMMainnet,
  [LZ_EIDS.flowTestnet]: CHAIN_IDS.flowEVMTestnet,
  [LZ_EIDS.arbitrum]: CHAIN_IDS.arbitrum,
  [LZ_EIDS.base]: CHAIN_IDS.base,
  [LZ_EIDS.ethereum]: CHAIN_IDS.ethereum,
  [LZ_EIDS.optimism]: CHAIN_IDS.optimism,
  [LZ_EIDS.sonic]: CHAIN_IDS.sonic,
  [LZ_EIDS.bsc]: CHAIN_IDS.bsc,
};

/** EVM Chain ID → LayerZero EID */
export const CHAIN_ID_TO_EID: Record<number, number> = {
  [CHAIN_IDS.flowEVMMainnet]: LZ_EIDS.flowMainnet,
  [CHAIN_IDS.flowEVMTestnet]: LZ_EIDS.flowTestnet,
  [CHAIN_IDS.arbitrum]: LZ_EIDS.arbitrum,
  [CHAIN_IDS.base]: LZ_EIDS.base,
  [CHAIN_IDS.ethereum]: LZ_EIDS.ethereum,
  [CHAIN_IDS.optimism]: LZ_EIDS.optimism,
  [CHAIN_IDS.sonic]: LZ_EIDS.sonic,
  [CHAIN_IDS.bsc]: LZ_EIDS.bsc,
};

/**
 * LayerZero v2 OFT route config per asset symbol.
 *
 * Each entry maps chainId → { oft, token } where:
 *   - `oft`   = OFT contract to call send() on (pass as `spokeOFT` to depositFromSpoke)
 *   - `token` = underlying ERC-20 the user approves before bridging
 *               (zero address = native ETH, no approval needed)
 *
 * All routes verified on-chain via quoteSend() or peers(). Issuers vary per asset.
 */
export const OFT_ROUTES = {
  /**
   * stgUSDC — USDC bridged via Stargate v2.
   * Underlying on Eth/Arb/Base/Op: native USDC. On Flow: stgUSDC (Stargate's wrapped USDC).
   */
  stgUSDC: {
    [747   /* flowEVMMainnet */]: { oft: '0xAF54BE5B6eEc24d6BFACf1cce4eaF680A8239398', token: '0xF1815bd50389c46847f0Bda824eC8da914045D14' },
    [1     /* ethereum       */]: { oft: '0xc026395860Db2d07ee33e05fE50ed7bD583189C7', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    [42161 /* arbitrum       */]: { oft: '0xe8CDF27AcD73a434D661C84887215F7598e7d0d3', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    [8453  /* base           */]: { oft: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    [10    /* optimism       */]: { oft: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0', token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
    [146   /* sonic          */]: { oft: '0xA272fFe20cFfe769CdFc4b63088DCD2C82a2D8F9', token: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' },
  },
  /**
   * USDT — USDT bridged via Stargate v2.
   */
  USDT: {
    [747   /* flowEVMMainnet */]: { oft: '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6', token: '0x674843C06FF83502ddb4D37c2E09C01cdA38cbc8' },
    [1     /* ethereum       */]: { oft: '0x933597a323Eb81cAe705C5bC29985172fd5A3973', token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    [42161 /* arbitrum       */]: { oft: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0', token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
    [10    /* optimism       */]: { oft: '0x19cFCE47eD54a88614648DC3f19A5980097007dD', token: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' },
  },
  /**
   * USDF — USD Flow OFT. Bridges PYUSD (Ethereum) ↔ USDF (Flow EVM).
   */
  USDF: {
    [747   /* flowEVMMainnet */]: { oft: '0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed', token: '0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed' },
    [1     /* ethereum       */]: { oft: '0xfa0e06b54986ad96de87a8c56fea76fbd8d493f8', token: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8' },
  },
  /**
   * PYUSD — PayPal USD bridged via OFTAdapter (Paxos / LayerZero).
   */
  PYUSD: {
    [747   /* flowEVMMainnet */]: { oft: '0x26d27d5AF2F6f1c14F40013C8619d97aaf015509', token: '0x99aF3EeA856556646C98c8B9b2548Fe815240750' },
    [42161 /* arbitrum       */]: { oft: '0x3CD2b89C49D130C08f1d683225b2e5DeB63ff876', token: '0x46850aD61C2B7d64d08c9C754F45254596696984' },
  },
  /**
   * WFLOW — Wrapped FLOW NativeOFTAdapter (issued by Flow Foundation).
   */
  WFLOW: {
    [747   /* flowEVMMainnet */]: { oft: '0xd296588850bee2770136464ffdddd78c32f2a07c', token: '0xd296588850bee2770136464ffdddd78c32f2a07c' },
    [1     /* ethereum       */]: { oft: '0xc1b45896b5fc9422a8f779653808297bb4f546f9', token: '0x5c147e74D63B1D31AA3Fd78Eb229B65161983B2b' },
  },
  /**
   * WETH — ETH OFT via Stargate v2. underlying = native ETH (no approval needed).
   */
  WETH: {
    [747   /* flowEVMMainnet */]: { oft: '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B', token: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590' },
    [1     /* ethereum       */]: { oft: '0x77b2043768d28E9C9aB44E1aBfC95944bcE57931', token: '0x0000000000000000000000000000000000000000' },
    [42161 /* arbitrum       */]: { oft: '0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F', token: '0x0000000000000000000000000000000000000000' },
    [8453  /* base           */]: { oft: '0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7', token: '0x0000000000000000000000000000000000000000' },
  },
  /**
   * sUSDe — Ethena staked USDe (yield-bearing stablecoin).
   */
  sUSDe: {
    [1     /* ethereum       */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', token: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' },
    [42161 /* arbitrum       */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' },
    [8453  /* base           */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' },
    [10    /* optimism       */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' },
    [56    /* bsc            */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' },
  },
  /**
   * USDe — Ethena USD stablecoin.
   */
  USDe: {
    [1     /* ethereum       */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', token: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3' },
    [42161 /* arbitrum       */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' },
    [8453  /* base           */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' },
    [10    /* optimism       */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' },
    [56    /* bsc            */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' },
  },
  /**
   * weETH — Ether.Fi liquid restaking token.
   */
  weETH: {
    [1     /* ethereum       */]: { oft: '0xcd2eb13d6831d4602d80e5db9230a57596cdca63', token: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee' },
    [8453  /* base           */]: { oft: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', token: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' },
    [10    /* optimism       */]: { oft: '0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff', token: '0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff' },
    [56    /* bsc            */]: { oft: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', token: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' },
    [146   /* sonic          */]: { oft: '0xa3d68b74bf0528fdd07263c60d6488749044914b', token: '0xa3d68b74bf0528fdd07263c60d6488749044914b' },
  },
  /**
   * rsETH — Kelp DAO liquid restaking token.
   */
  rsETH: {
    [1     /* ethereum       */]: { oft: '0x85d456b2dff1fd8245387c0bfb64dfb700e98ef3', token: '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7' },
    [42161 /* arbitrum       */]: { oft: '0x4186bfc76e2e237523cbc30fd220fe055156b41f', token: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' },
    [8453  /* base           */]: { oft: '0x1bc71130a0e39942a7658878169764bbd8a45993', token: '0x1bc71130a0e39942a7658878169764bbd8a45993' },
    [10    /* optimism       */]: { oft: '0x4186bfc76e2e237523cbc30fd220fe055156b41f', token: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' },
    [146   /* sonic          */]: { oft: '0xd75787ba9aba324420d522bda84c08c87e5099b1', token: '0xd75787ba9aba324420d522bda84c08c87e5099b1' },
  },
  /**
   * rswETH — Swell Network liquid restaking token.
   */
  rswETH: {
    [1     /* ethereum       */]: { oft: '0x1486d39646cdee84619bd05997319545a8575079', token: '0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0' },
    [42161 /* arbitrum       */]: { oft: '0xb1fe27b32ffb5ce54e272c096547f1e86c19e72f', token: '0xb1fe27b32ffb5ce54e272c096547f1e86c19e72f' },
    [8453  /* base           */]: { oft: '0x850cdf416668210ed0c36bfff5d21921c7ada3b8', token: '0x850cdf416668210ed0c36bfff5d21921c7ada3b8' },
  },
  /**
   * USR — Resolv Labs USD stablecoin.
   */
  USR: {
    [1     /* ethereum       */]: { oft: '0xd2ee2776f34ef4e7325745b06e6d464b08d4be0e', token: '0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110' },
    [42161 /* arbitrum       */]: { oft: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9', token: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9' },
    [8453  /* base           */]: { oft: '0x35e5db674d8e93a03d814fa0ada70731efe8a4b9', token: '0x35e5db674d8e93a03d814fa0ada70731efe8a4b9' },
    [56    /* bsc            */]: { oft: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9', token: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9' },
  },
  /**
   * wstUSR — Resolv Labs wrapped staked USR (yield-bearing).
   */
  wstUSR: {
    [1     /* ethereum       */]: { oft: '0xab17c1fe647c37ceb9b96d1c27dd189bf8451978', token: '0x1202F5C7b4B9E47a1A484E8B270be34dbbC75055' },
    [42161 /* arbitrum       */]: { oft: '0x66cfbd79257dc5217903a36293120282548e2254', token: '0x66cfbd79257dc5217903a36293120282548e2254' },
    [8453  /* base           */]: { oft: '0xb67675158b412d53fe6b68946483ba920b135ba1', token: '0xb67675158b412d53fe6b68946483ba920b135ba1' },
    [56    /* bsc            */]: { oft: '0x4254813524695def4163a169e901f3d7a1a55429', token: '0x4254813524695def4163a169e901f3d7a1a55429' },
  },
  /**
   * USDtb — Ethena treasury-backed stablecoin.
   */
  USDtb: {
    [1     /* ethereum       */]: { oft: '0xc708b6887db46005da033501f8aebee72d191a5d', token: '0xC139190F447e929f090Edeb554D95AbB8b18aC1C' },
    [42161 /* arbitrum       */]: { oft: '0xc708b6887db46005da033501f8aebee72d191a5d', token: '0xc708b6887db46005da033501f8aebee72d191a5d' },
    [8453  /* base           */]: { oft: '0xc708b6887db46005da033501f8aebee72d191a5d', token: '0xc708b6887db46005da033501f8aebee72d191a5d' },
  },
} as const;

/**
 * Uniswap V3 SwapRouter addresses per chain.
 * Used by curator swap helpers to build calldata for on-chain swaps.
 *
 * Note on struct differences:
 *   - SwapRouter (Eth/Arb/Op, 0xE592...): exactInputSingle struct includes `deadline`
 *   - SwapRouter02 (Base, 0x2626...): exactInputSingle struct does NOT include `deadline`
 *   - FlowSwap V3 (Flow EVM, 0xeEDC...): derived from original UniV3, includes `deadline`
 */
export const UNISWAP_V3_ROUTERS: Record<number, string> = {
  [8453]:  '0x2626664c2603336E57B271c5C0b26F421741e481', // Base — SwapRouter02 (no deadline)
  [1]:     '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Ethereum — SwapRouter
  [42161]: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Arbitrum — SwapRouter
  [10]:    '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Optimism — SwapRouter
  [747]:   '0xeEDC6Ff75e1b10B903D9013c358e446a73d35341',  // Flow EVM — FlowSwap V3 SwapRouter
};

/** Public RPC endpoints per chain for cross-chain reads */
const PUBLIC_RPCS: Record<number, string[]> = {
  1:     ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://eth.llamarpc.com'],
  10:    ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
  42161: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.publicnode.com'],
  8453:  ['https://base-rpc.publicnode.com', 'https://base.llamarpc.com', 'https://mainnet.base.org'],
  747:   ['https://mainnet.evm.nodes.onflow.org'],
  146:   ['https://rpc.soniclabs.com'],
  56:    ['https://bsc-dataseed1.binance.org', 'https://bsc-dataseed2.binance.org'],
};

/**
 * Create a read-only ethers Provider for a given chain ID using public RPCs.
 * Returns null if no public RPC is configured for that chain.
 */
export function createChainProvider(chainId: number): Provider | null {
  const rpcs = PUBLIC_RPCS[chainId];
  if (!rpcs?.length) return null;
  return new JsonRpcProvider(rpcs[0], chainId, { staticNetwork: true });
}

/**
 * Recommended timeouts for cross-chain operations (milliseconds).
 * UIs should show a progress indicator and NOT timeout before these values.
 */
export const LZ_TIMEOUTS = {
  /** Poll interval between balance/event checks */
  POLL_INTERVAL: 30_000,
  /** Standard OFT bridge (shares or assets, non-Stargate) */
  OFT_BRIDGE: 900_000,          // 15 min
  /** Stargate bridge (USDC, USDT, WETH) — slower due to pool mechanics */
  STARGATE_BRIDGE: 1_800_000,   // 30 min
  /** LZ Read callback (async vault actions) */
  LZ_READ_CALLBACK: 900_000,   // 15 min
  /** Compose delivery to hub (deposit from spoke) */
  COMPOSE_DELIVERY: 2_700_000,  // 45 min
  /** Full spoke→hub→spoke redeem (all steps combined) */
  FULL_SPOKE_REDEEM: 3_600_000, // 60 min
} as const;
