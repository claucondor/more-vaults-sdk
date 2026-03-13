/** EVM Chain IDs for chains supported by MoreVaults */
export const CHAIN_IDS = {
  flowEVMMainnet: 747,
  flowEVMTestnet: 545,
  arbitrum: 42161,
  base: 8453,
  ethereum: 1,
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
} as const;

/** LayerZero EID → EVM Chain ID */
export const EID_TO_CHAIN_ID: Record<number, number> = {
  [LZ_EIDS.flowMainnet]: CHAIN_IDS.flowEVMMainnet,
  [LZ_EIDS.flowTestnet]: CHAIN_IDS.flowEVMTestnet,
  [LZ_EIDS.arbitrum]: CHAIN_IDS.arbitrum,
  [LZ_EIDS.base]: CHAIN_IDS.base,
  [LZ_EIDS.ethereum]: CHAIN_IDS.ethereum,
};

/** EVM Chain ID → LayerZero EID */
export const CHAIN_ID_TO_EID: Record<number, number> = {
  [CHAIN_IDS.flowEVMMainnet]: LZ_EIDS.flowMainnet,
  [CHAIN_IDS.flowEVMTestnet]: LZ_EIDS.flowTestnet,
  [CHAIN_IDS.arbitrum]: LZ_EIDS.arbitrum,
  [CHAIN_IDS.base]: LZ_EIDS.base,
  [CHAIN_IDS.ethereum]: LZ_EIDS.ethereum,
};

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
