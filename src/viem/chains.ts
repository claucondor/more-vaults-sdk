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
} as const

/**
 * LayerZero Endpoint IDs (EID) for chains supported by MoreVaults.
 * Verified on-chain via MoreVaults OmniFactory.localEid() on each chain.
 * - flowMainnet: 30336 (0x7680) — confirmed from factory + LZ endpoint on Flow EVM mainnet
 * - base:        30184 (0x75e8) — confirmed from factory on Base
 * - arbitrum:    30110 (0x75b6) — confirmed from factory on Arbitrum
 * - ethereum:    30101 (0x75b5) — confirmed from factory on Ethereum
 * - optimism:    30111          — verified via LZ docs and on-chain quoteSend
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
} as const

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
}

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
}

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
   * Routes verified: Eth→Flow ✓  Arb→Flow ✓  Base→Flow ✓  Op→Flow ✓  Op→Base ✓  Op→Arb ✓
   */
  stgUSDC: {
    [747   /* flowEVMMainnet */]: { oft: '0xAF54BE5B6eEc24d6BFACf1cce4eaF680A8239398' as `0x${string}`, token: '0xF1815bd50389c46847f0Bda824eC8da914045D14' as `0x${string}` },
    [1     /* ethereum       */]: { oft: '0xc026395860Db2d07ee33e05fE50ed7bD583189C7' as `0x${string}`, token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0xe8CDF27AcD73a434D661C84887215F7598e7d0d3' as `0x${string}`, token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26' as `0x${string}`, token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}` },
    [10    /* optimism        */]: { oft: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0' as `0x${string}`, token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as `0x${string}` },
    [146   /* sonic           */]: { oft: '0xA272fFe20cFfe769CdFc4b63088DCD2C82a2D8F9' as `0x${string}`, token: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' as `0x${string}` },
  },
  /**
   * USDT — USDT bridged via Stargate v2.
   * Routes verified: Arb→Flow ✓  Eth→Flow ✓  Op→Flow ✓  Op→Base ✓  Op→Arb ✓
   */
  USDT: {
    [747   /* flowEVMMainnet */]: { oft: '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6' as `0x${string}`, token: '0x674843C06FF83502ddb4D37c2E09C01cdA38cbc8' as `0x${string}` },
    [1     /* ethereum       */]: { oft: '0x933597a323Eb81cAe705C5bC29985172fd5A3973' as `0x${string}`, token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0' as `0x${string}`, token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as `0x${string}` },
    [10    /* optimism        */]: { oft: '0x19cFCE47eD54a88614648DC3f19A5980097007dD' as `0x${string}`, token: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' as `0x${string}` },
  },
  /**
   * PYUSD — PayPal USD OFT (issued by PayPal/Flow).
   * Routes verified: Eth→Flow ✓
   */
  PYUSD: {
    [747   /* flowEVMMainnet */]: { oft: '0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed' as `0x${string}`, token: '0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed' as `0x${string}` },
    [1     /* ethereum       */]: { oft: '0xfa0e06b54986ad96de87a8c56fea76fbd8d493f8' as `0x${string}`, token: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8' as `0x${string}` },
  },
  /**
   * WFLOW — Wrapped FLOW NativeOFTAdapter (issued by Flow Foundation).
   * Routes verified: Eth→Flow ✓
   */
  WFLOW: {
    [747   /* flowEVMMainnet */]: { oft: '0xd296588850bee2770136464ffdddd78c32f2a07c' as `0x${string}`, token: '0xd296588850bee2770136464ffdddd78c32f2a07c' as `0x${string}` },
    [1     /* ethereum       */]: { oft: '0xc1b45896b5fc9422a8f779653808297bb4f546f9' as `0x${string}`, token: '0x5c147e74D63B1D31AA3Fd78Eb229B65161983B2b' as `0x${string}` },
  },
  /**
   * WETH — ETH OFT via Stargate v2. underlying = native ETH (no approval needed).
   * Warning: Flow and Optimism routes error on quoteSend — do not use with those chains.
   */
  WETH: {
    [747   /* flowEVMMainnet */]: { oft: '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B' as `0x${string}`, token: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590' as `0x${string}` },
    [1     /* ethereum       */]: { oft: '0x77b2043768d28E9C9aB44E1aBfC95944bcE57931' as `0x${string}`, token: '0x0000000000000000000000000000000000000000' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F' as `0x${string}`, token: '0x0000000000000000000000000000000000000000' as `0x${string}` },
    [8453  /* base           */]: { oft: '0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7' as `0x${string}`, token: '0x0000000000000000000000000000000000000000' as `0x${string}` },
  },
  /**
   * sUSDe — Ethena staked USDe (yield-bearing stablecoin).
   * Pure OFT on Op/Arb/Base, OFTAdapter on Eth (wraps real sUSDe ERC4626).
   * Routes verified via peers(): Op↔Arb ✓  Op↔Eth ✓  Op↔Base ✓
   * No Flow peer.
   */
  sUSDe: {
    [1     /* ethereum       */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}`, token: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}`, token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}`, token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}` },
    [10    /* optimism        */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}`, token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}` },
    [56    /* bsc             */]: { oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}`, token: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as `0x${string}` },
  },
  /**
   * USDe — Ethena USD stablecoin.
   * Pure OFT on Arb/Base/Op/BSC, OFTAdapter on Eth (wraps real USDe).
   * Routes verified via peers(): Arb↔Eth ✓  Arb↔Base ✓  BSC↔Op ✓  BSC↔Eth ✓  BSC↔Arb ✓
   * No Flow peer.
   */
  USDe: {
    [1     /* ethereum       */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}`, token: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}`, token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}`, token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}` },
    [10    /* optimism        */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}`, token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}` },
    [56    /* bsc             */]: { oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}`, token: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34' as `0x${string}` },
  },
  /**
   * weETH — Ether.Fi liquid restaking token.
   * Pure OFT on Op/Base, OFTAdapter on Eth (wraps real weETH).
   * Routes verified via peers(): Op↔Eth ✓  Op↔Base ✓
   * No Flow or Arbitrum peer from Optimism.
   */
  weETH: {
    [1     /* ethereum       */]: { oft: '0xcd2eb13d6831d4602d80e5db9230a57596cdca63' as `0x${string}`, token: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' as `0x${string}`, token: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' as `0x${string}` },
    [10    /* optimism        */]: { oft: '0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff' as `0x${string}`, token: '0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff' as `0x${string}` },
    [56    /* bsc             */]: { oft: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' as `0x${string}`, token: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' as `0x${string}` },
    [146   /* sonic           */]: { oft: '0xa3d68b74bf0528fdd07263c60d6488749044914b' as `0x${string}`, token: '0xa3d68b74bf0528fdd07263c60d6488749044914b' as `0x${string}` },
  },
  /**
   * rsETH — Kelp DAO liquid restaking token.
   * Pure OFT on Op/Arb/Base, OFTAdapter on Eth (wraps real rsETH).
   * Routes verified via peers(): Op↔Eth ✓  Op↔Arb ✓  Op↔Base ✓
   * No Flow peer.
   */
  rsETH: {
    [1     /* ethereum       */]: { oft: '0x85d456b2dff1fd8245387c0bfb64dfb700e98ef3' as `0x${string}`, token: '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' as `0x${string}`, token: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x1bc71130a0e39942a7658878169764bbd8a45993' as `0x${string}`, token: '0x1bc71130a0e39942a7658878169764bbd8a45993' as `0x${string}` },
    [10    /* optimism        */]: { oft: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' as `0x${string}`, token: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' as `0x${string}` },
    [146   /* sonic           */]: { oft: '0xd75787ba9aba324420d522bda84c08c87e5099b1' as `0x${string}`, token: '0xd75787ba9aba324420d522bda84c08c87e5099b1' as `0x${string}` },
  },
  /**
   * rswETH — Swell Network liquid restaking token.
   * Pure OFT on Arb/Base, OFTAdapter on Eth (wraps real rswETH).
   * Routes verified via peers(): Arb↔Eth ✓  Arb↔Base ✓
   * No Flow or Optimism peer.
   */
  rswETH: {
    [1     /* ethereum       */]: { oft: '0x1486d39646cdee84619bd05997319545a8575079' as `0x${string}`, token: '0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0xb1fe27b32ffb5ce54e272c096547f1e86c19e72f' as `0x${string}`, token: '0xb1fe27b32ffb5ce54e272c096547f1e86c19e72f' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x850cdf416668210ed0c36bfff5d21921c7ada3b8' as `0x${string}`, token: '0x850cdf416668210ed0c36bfff5d21921c7ada3b8' as `0x${string}` },
  },
  /**
   * USR — Resolv Labs USD stablecoin.
   * Pure OFT on Arb/Base, OFTAdapter on Eth.
   * Routes verified via peers(): Arb↔Eth ✓  Arb↔Base ✓
   * No Flow or Optimism peer.
   */
  USR: {
    [1     /* ethereum       */]: { oft: '0xd2ee2776f34ef4e7325745b06e6d464b08d4be0e' as `0x${string}`, token: '0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9' as `0x${string}`, token: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9' as `0x${string}` },
    [8453  /* base           */]: { oft: '0x35e5db674d8e93a03d814fa0ada70731efe8a4b9' as `0x${string}`, token: '0x35e5db674d8e93a03d814fa0ada70731efe8a4b9' as `0x${string}` },
    [56    /* bsc             */]: { oft: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9' as `0x${string}`, token: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9' as `0x${string}` },
  },
  /**
   * wstUSR — Resolv Labs wrapped staked USR (yield-bearing).
   * Pure OFT on Arb/Base, OFTAdapter on Eth.
   * Routes verified via peers(): Arb↔Eth ✓  Arb↔Base ✓
   * No Flow or Optimism peer.
   */
  wstUSR: {
    [1     /* ethereum       */]: { oft: '0xab17c1fe647c37ceb9b96d1c27dd189bf8451978' as `0x${string}`, token: '0x1202F5C7b4B9E47a1A484E8B270be34dbbC75055' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0x66cfbd79257dc5217903a36293120282548e2254' as `0x${string}`, token: '0x66cfbd79257dc5217903a36293120282548e2254' as `0x${string}` },
    [8453  /* base           */]: { oft: '0xb67675158b412d53fe6b68946483ba920b135ba1' as `0x${string}`, token: '0xb67675158b412d53fe6b68946483ba920b135ba1' as `0x${string}` },
    [56    /* bsc             */]: { oft: '0x4254813524695def4163a169e901f3d7a1a55429' as `0x${string}`, token: '0x4254813524695def4163a169e901f3d7a1a55429' as `0x${string}` },
  },
  /**
   * USDtb — Ethena treasury-backed stablecoin.
   * Pure OFT on Arb/Base, OFTAdapter on Eth.
   * Routes verified via peers(): Arb↔Eth ✓  Arb↔Base ✓
   * No Flow or Optimism peer.
   */
  USDtb: {
    [1     /* ethereum       */]: { oft: '0xc708b6887db46005da033501f8aebee72d191a5d' as `0x${string}`, token: '0xC139190F447e929f090Edeb554D95AbB8b18aC1C' as `0x${string}` },
    [42161 /* arbitrum       */]: { oft: '0xc708b6887db46005da033501f8aebee72d191a5d' as `0x${string}`, token: '0xc708b6887db46005da033501f8aebee72d191a5d' as `0x${string}` },
    [8453  /* base           */]: { oft: '0xc708b6887db46005da033501f8aebee72d191a5d' as `0x${string}`, token: '0xc708b6887db46005da033501f8aebee72d191a5d' as `0x${string}` },
  },
} as const

/**
 * oftCmd for Stargate v2 taxi mode (immediate per-message delivery).
 * Pass as `oftCmd` in SendParam when using stgUSDC, USDT, or WETH OFT_ROUTES entries.
 * Non-Stargate OFTs (PYUSD, WFLOW, sUSDe, USDe, weETH, rsETH) use empty bytes — pass `'0x'` instead.
 */
export const STARGATE_TAXI_CMD = '0x01' as const

/**
 * Recommended timeouts for cross-chain operations (milliseconds).
 *
 * Based on real E2E tests:
 * - Standard OFT bridge (non-Stargate): ~5-10 min
 * - Stargate bridge: ~10-15 min, can reach 20 min under load
 * - LZ Read callback (async deposit/redeem): ~5-10 min
 * - Full spoke deposit (compose + oracle + share bridge): ~10-15 min
 * - Full spoke redeem (share bridge + async redeem + asset bridge): ~25-30 min
 *
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
} as const

// ---------------------------------------------------------------------------
// Legacy flat exports — kept for backwards compat, prefer OFT_ROUTES
// ---------------------------------------------------------------------------

/** @deprecated Use OFT_ROUTES.stgUSDC instead */
export const USDC_STARGATE_OFT: Partial<Record<number, `0x${string}`>> = Object.fromEntries(
  Object.entries(OFT_ROUTES.stgUSDC).map(([k, v]) => [k, v.oft])
)
/** @deprecated Use OFT_ROUTES.stgUSDC[chainId].token instead */
export const USDC_TOKEN: Partial<Record<number, `0x${string}`>> = Object.fromEntries(
  Object.entries(OFT_ROUTES.stgUSDC).map(([k, v]) => [k, v.token])
)
