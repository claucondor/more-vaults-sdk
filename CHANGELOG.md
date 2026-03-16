# Changelog

All notable changes to the MoreVaults SDK are documented in this file.

## [1.0.0] - 2026-03-16

### Added
- **Vault Configuration** — complete admin/curator/guardian config read and write operations:
  - `getVaultConfiguration` — single multicall reading 22+ config fields: roles (owner, curator, guardian), fees, capacity, timelock, withdrawal config, whitelist status, asset lists, cross-chain settings
  - **Curator direct actions**: `setDepositCapacity`, `addAvailableAsset`, `addAvailableAssets`, `disableAssetToDeposit`
  - **Owner direct actions**: `setFeeRecipient`, `setDepositWhitelist`, `enableDepositWhitelist`, `pauseVault`, `unpauseVault`
  - **Guardian action**: `recoverAssets`
  - **Pending owner**: `acceptOwnership`
- **19 new `CuratorAction` types** for timelocked operations via `submitActions`:
  - Config: `setTimeLockPeriod`, `setWithdrawalFee`, `setWithdrawalTimelock`, `enableAssetToDeposit`, `disableDepositWhitelist`, `updateWithdrawalQueueStatus`, `setMaxWithdrawalDelay`, `setMaxSlippagePercent`, `setCrossChainAccountingManager`, `setGasLimitForAccounting`, `setFee`
  - Role transfers: `transferOwnership`, `transferCuratorship`, `transferGuardian`
- **New ABIs**: `ADMIN_CONFIG_ABI`, `ACCESS_CONTROL_ABI`, `ADMIN_WRITE_ABI`, `TIMELOCK_CONFIG_ABI`
- **React hook**: `useVaultConfiguration`
- Available in all three modules: viem, ethers, react

### Changed
- **v1.0.0 milestone** — SDK is feature-complete covering deposits, redeems, cross-chain flows, curator operations, bridge operations, sub-vault management, and full vault configuration

---

## [0.6.1] - 2026-03-15

### Added
- **`getVaultPortfolioMultiChain`** — full cross-chain portfolio view that auto-discovers spokes via topology, fetches hub + spoke portfolios in parallel, and aggregates liquid assets, sub-vault positions, and locked assets across all chains
- React hook: `useVaultPortfolioMultiChain`
- Types: `ChainPortfolio`, `MultiChainPortfolio`

---

## [0.6.0] - 2026-03-15

### Added
- **Curator sub-vault operations** — invest, track, and manage positions in ERC4626/ERC7540 sub-vaults:
  - `getSubVaultPositions` — enumerate active sub-vault positions with share balances and underlying values
  - `detectSubVaultType` — probe whether a contract is ERC4626 (sync), ERC7540 (async), or unknown
  - `getSubVaultInfo` — metadata, max deposit capacity, and registry whitelist status for a target sub-vault
  - `getERC7540RequestStatus` — check pending/claimable deposit and redeem amounts for async sub-vaults
  - `previewSubVaultDeposit` / `previewSubVaultRedeem` — preview shares/assets for sub-vault operations
  - `getVaultPortfolio` — full portfolio view: liquid assets + sub-vault positions + locked ERC7540 assets, with double-counting prevention
  - `SUB_VAULT_ABI` — ERC4626/ERC7540 read functions for sub-vault interaction
- React hooks: `useSubVaultPositions`, `useVaultPortfolio`, `useERC7540RequestStatus`
- Available in all three modules: viem, ethers, react

---

## [0.5.0] - 2026-03-15

### Added
- **Curator bridge operations** — quote and execute cross-chain asset bridging via LayerZero:
  - `quoteCuratorBridgeFee` — quote the LayerZero native fee for bridging
  - `executeCuratorBridge` — bridge assets between hub and spoke vaults (curator only, pauses vault during bridging)
  - `findBridgeRoute` — resolve OFT route for a token between two chains
  - `encodeBridgeParams` — encode the 5-field `bridgeSpecificParams` for `BridgeFacet.executeBridging`
- React hooks: `useCuratorBridgeQuote`, `useExecuteBridge`
- Available in all three modules: viem, ethers, react

---

## [0.4.1] - 2026-03-15

### Added
- **React curator hooks** — read and write hooks for curator operations via wagmi/react-query:
  - Read hooks: `useCuratorVaultStatus`, `useVaultAnalysis`, `useVaultAssetBreakdown`, `usePendingActions`, `useIsCurator`, `useProtocolWhitelist`
  - Write hooks: `useSubmitActions`, `useExecuteActions`, `useVetoActions`

---

## [0.4.0] - 2026-03-15

### Added
- **Ethers.js full feature parity** — ported all viem-only features to the ethers.js v6 module:
  - Curator operations: `getCuratorVaultStatus`, `getPendingActions`, `isCurator`, `getVaultAnalysis`, `checkProtocolWhitelist`, `submitActions`, `executeActions`, `vetoActions`, Uniswap V3 swap helpers
  - Vault topology: `getVaultTopology`, `discoverVaultTopology`
  - Cross-chain distribution: `getVaultDistribution`, `getVaultDistributionWithTopology`
  - Spoke routes: `getInboundRoutes`, `getOutboundRoutes`, `quoteRouteDepositFee`, `getUserBalancesForRoutes`
  - Cross-chain helpers: `waitForCompose`, `resolveRedeemAddresses`, `quoteShareBridgeFee`
  - Preflight: `preflightSpokeDeposit`, `preflightSpokeRedeem`
  - User helpers: `getUserPositionMultiChain`
  - On-chain Stargate detection via `stargateType()` (replaces hardcoded asset list)

---

## [0.3.3] - 2026-03-15

### Fixed
- **On-chain Stargate detection** — replaced hardcoded `STARGATE_ASSETS` symbol list with dynamic `stargateType()` contract call. Stargate V2 pools implement `stargateType()` while standard OFTs revert, verified across 33 OFTs on 4 chains (Base, Ethereum, Arbitrum, Optimism) with 100% accuracy. Removes need for manual maintenance of the asset list.

---

## [0.3.2] - 2026-03-14

### Added
- **Uniswap V3 swap helpers** — `buildUniswapV3Swap` and `encodeUniswapV3SwapCalldata` with automatic router selection: SwapRouter02 (Base, no deadline) vs SwapRouter (Ethereum/Arbitrum/Optimism, with deadline)
- **`UNISWAP_V3_ROUTERS`** — per-chain Uniswap V3 router addresses (Base, Ethereum, Arbitrum, Optimism, Flow EVM/FlowSwap)
- **`getVaultAssetBreakdown`** — per-asset balances with metadata plus `totalAssets`/`totalSupply` summary
- **`AssetBalance` and `VaultAssetBreakdown` types**

---

## [0.3.1] - 2026-03-14

### Added
- **Curator multicall batch operations** — `submitActions`, `executeActions`, `vetoActions`, `encodeCuratorAction`, `buildCuratorBatch` for batched on-chain curator workflows
- **`getVaultAnalysis`** — lists available/depositable assets with metadata and registry address
- **`checkProtocolWhitelist`** — verifies DEX/protocol whitelists against the global registry
- **`VAULT_ANALYSIS_ABI`, `REGISTRY_ABI`, `ERC4626_FACET_ABI`**
- **`AssetInfo` and `VaultAnalysis` types**

### Changed
- `canDeposit` now returns `maxDeposit` amount and `whitelistEnabled` fields
- Removed `getDepositAllowance` (functionality merged into `canDeposit`)

---

## [0.3.0] - 2026-03-14

### Added
- **Curator status reads** — `getCuratorVaultStatus`, `getPendingActions`, `isCurator`
- **Extended ABIs** — `MULTICALL_ABI`, `DEX_ABI`, `BRIDGE_FACET_ABI`, `ERC7540_FACET_ABI`, `CURATOR_CONFIG_ABI`, `LZ_ADAPTER_ABI`
- **Curator types** — `SwapParams`, `BatchSwapParams`, `BridgeParams`, `PendingAction`, `CuratorAction`, `CuratorVaultStatus`
- Curator operations exported from `@more-vaults/sdk/viem`

---

## [0.2.9] - 2026-03-14

### Added
- **PYUSD OFT route** — Arbitrum ↔ Flow EVM bridge: locks PYUSD on Arbitrum, mints PYUSD0 on Flow EVM (vault underlying asset). Enables `getInboundRoutes()` to resolve Arbitrum as a deposit network for PYUSD vaults on Flow EVM.
- Renamed the previous misnamed `PYUSD` entry to `USDF` (USD Flow OFT, a distinct token)

---

## [0.2.8] - 2026-03-13

### Added
- **`quoteShareBridgeFee`** — quotes the LayerZero fee for bridging spoke shares hub-ward (`bridgeSharesToHub`), using raw OFT-native share amounts (18 decimals)
- **`rawSpokeShares`** field in `MultiChainUserPosition` — exposes OFT-native balance alongside vault-normalized shares

### Fixed
- `getUserPositionMultiChain` now correctly reads `decimals()` from each spoke SHARE_OFT and scales 18-decimal OFT balances to 8-decimal vault shares before summing and passing to `convertToAssets`

---

## [0.2.7] - 2026-03-13

### Added
- **`executeCompose`** now parses the escrow event from the TX receipt to extract the `initVaultActionRequest` GUID, enabling GUID-based polling for spoke deposits
- **`waitForAsyncRequest`** — polls on-chain async request state by GUID (instead of balance comparison) and returns the exact outcome (shares minted or assets received)
- **`getUserPositionMultiChain`** — reads hub shares, spoke SHARE_OFT balances across all chains, pending withdrawal, and computes totals. Exported as `useUserPositionMultiChain` React hook (wallet-independent)
- **`discoverVaultTopology`** — wallet-independent topology discovery using public RPCs across all supported chains
- **`useVaultDistribution`** hook updated to use `discoverVaultTopology` and a hub-chain client, removing the wallet chain dependency

### Fixed
- `useVaultDistribution` no longer requires the wallet to be connected to the hub chain

---

## [0.2.1] - 2026-03-12

### Added
- **`useSmartRedeem`** React hook — auto-routes to `useOmniRedeem` or `useRedeemShares` based on vault mode
- **`LZ_TIMEOUTS`** constants exported from ethers module for recommended UI polling/timeout values
- **`smartRedeem`** (ethers) — auto-detects sync/async vault mode and dispatches accordingly
- **`bridgeAssetsToSpoke`** (ethers) — R7 hub→spoke asset bridge via OFT

---

## [0.2.0] - 2026-03-12

### Added
- **Stargate 2-TX compose flow** — `depositFromSpoke` auto-detects Stargate vs standard OFT; Stargate path returns `composeData` for the required second transaction
- **Standard OFT 1-TX compose** — injects `LZCOMPOSE` native value into `extraOptions` for single-transaction spoke deposits with standard OFTs
- **`waitForCompose`** — scans `ComposeSent` events and `composeQueue` on the hub to detect pending compose execution
- **`executeCompose`** — executes a pending compose with ETH for `readFee` + `shareSend`
- **`quoteComposeFee`** — quotes `readFee` + SHARE_OFT send fee for compose execution
- **`quoteDepositFromSpokeFee`** — quotes the full LayerZero fee for spoke deposits
- **`smartDeposit`** (viem + ethers) — auto-selects `depositSimple` or `depositAsync` based on vault mode and quotes LayerZero fee automatically
- **`smartRedeem`** (viem) — auto-detects vault mode and dispatches to async or sync redeem
- **`bridgeAssetsToSpoke`** (viem, R7) — bridges underlying assets hub→spoke via OFT
- **`resolveRedeemAddresses`** — dynamically discovers all addresses for spoke redeems (SHARE_OFT via composer, asset OFT via OFT_ROUTES, spoke asset via peers)
- **`preflightSpokeDeposit`** (viem) — validates spoke balance, gas, and hub composer setup
- **`preflightSpokeRedeem`** (viem) — validates shares, spoke gas (LZ fee + buffer), and hub gas (asset bridge fee) with real Stargate/OFT fee quotes
- **`isAsyncMode`** and **`getAsyncRequestStatus`** utility helpers
- **`LZ_ENDPOINT_ABI`**, **`ComposeData`**, **`SpokeDepositResult`** types, **`LZ_TIMEOUTS`** constants
- **`SpokeRedeemRoute`** interface for type-safe route passing
- **`createChainTransport`** exported from `spokeRoutes` for wallet client creation
- Composer resolved via `OMNI_FACTORY.vaultComposer()` instead of the vault directly

### Fixed
- `canDeposit` returns `ok` for cross-chain async vaults instead of `not-whitelisted`
- `spokeRoutes` correctly passes chain config to `createChainClient` so `multicall3` is resolved
- `spokeRoutes` adds `direct-async` deposit type for cross-chain-async hub vaults
- Gas estimation for LZ Read calls uses `publicClient.estimateContractGas` with a 30% buffer

---

## [0.1.15] - 2026-03-10

### Fixed
- Preflight now blocks redeem when hub liquidity is insufficient

---

## [0.1.14] - 2026-03-10

### Added
- `sourceTokenSymbol` field on `InboundRoute`

---

## [0.1.13] - 2026-03-10

### Changed
- Escrow address is now read on-chain if not provided by the caller

---

## [0.1.12] - 2026-03-10

### Fixed
- `useVaultDistribution` uses the shared fallback RPC factory instead of constructing its own transport

---

## [0.1.11] - 2026-03-10

### Fixed
- Fallback transport now rotates across multiple RPC endpoints per chain to improve reliability

---

## [0.1.10] - 2026-03-10

### Fixed
- RPC for Ethereum switched to publicnode; LlamaRPC caused `quoteSend` timeouts

---

## [0.1.9] - 2026-03-09

### Added
- `useInboundRoutes` React hook (wraps `getInboundRoutes` + `getUserBalancesForRoutes`)
- `getOutboundRoutes` — returns chains where the user can receive shares on redeem
- `quoteRouteDepositFee` — real-amount fee quote for a given `InboundRoute`
- `getRouteTokenDecimals` helper (6 for USDC/USDT, 18 for others)

---

## [0.1.8] - 2026-03-09

### Added
- `getVaultDistribution` and `getVaultDistributionWithTopology` — spoke share OFT balances with metadata
- `getInboundRoutes` and `getUserBalancesForRoutes` for cross-chain deposit UX
- `useVaultDistribution` React hook
- BSC (BNB Chain) support: chain ID 56, EID 30102, public RPC, native symbol
- OFT routes expanded with verified on-chain peers: sUSDe, USDe, USR, wstUSR, weETH on BSC; USDe on Optimism
- `OFT_ROUTES`, `STARGATE_TAXI_CMD`, `NATIVE_SYMBOL` exported from `viem/index`

---

## [0.1.2] - 2026-03-10

### Added
- Escrow address read on-chain if not provided (backport of 0.1.13 logic)

---

## [0.1.0] - 2026-03-05

### Added
- Initial release of the MoreVaults SDK
- TypeScript SDK for **viem/wagmi** and **ethers.js v6** with dual ESM + CJS builds via tsup
- Full coverage of deposit flows D1–D7 and redeem flows R1–R5
- Cross-chain spoke→hub deposits via LayerZero OFT (Flow EVM)
- **User helpers**: `getUserPosition`, `previewDeposit`, `getVaultMetadata`, `canDeposit`
- **DX helpers**: `getUserBalances`, `getMaxWithdrawable`, `getVaultSummary`, `quoteDepositFromSpokeFee`, `smartDeposit`
- **Vault status**: `getVaultStatus` with Multicall3 batching (2 HTTP requests instead of 13+), hub liquidity context, and access restriction detection
- **Topology**: `getVaultTopology` and `useVaultTopology` for hub/spoke chain resolution
- **Typed errors** (instanceof-safe): `MoreVaultsError`, `VaultPausedError`, `CapacityFullError`, `NotWhitelistedError`, `InsufficientLiquidityError`, `CCManagerNotConfiguredError`, `EscrowNotConfiguredError`, `NotHubVaultError`, `MissingEscrowAddressError`
- `VaultAddresses.escrow` is optional; async flows throw `MissingEscrowAddressError` at runtime if absent
- Integration tests: 43 tests across 4 suites
- Solidity reference contracts and mocks for local E2E testing
- `depositFromSpoke` with correct `composeMsg` encoding for MoreVaultsComposer
