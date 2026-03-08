/** EVM Chain IDs for chains supported by MoreVaults */
export const CHAIN_IDS = {
  flowEVMMainnet: 747,
  flowEVMTestnet: 545,
  arbitrum: 42161,
  base: 8453,
  ethereum: 1,
} as const;

/** LayerZero Endpoint IDs (EID) for chains supported by MoreVaults */
export const LZ_EIDS = {
  flowMainnet: 30332,
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
