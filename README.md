# @oydual31/more-vaults-sdk

> **v1.0.0** — feature-complete SDK for MoreVaults: deposits, redeems, cross-chain flows, curator operations, bridge operations, sub-vault management, and full vault configuration.

TypeScript SDK for the MoreVaults protocol. Supports **viem/wagmi**, **ethers.js v6**, and **React hooks**.

```bash
npm install @oydual31/more-vaults-sdk
```

---

## Table of contents

1. [Installation](#installation)
2. [Quick start](#quick-start)
3. [Module overview](#module-overview)
4. [Feature parity table](#feature-parity-table)
5. [Core concepts](#core-concepts)
6. [Deposit flows (D1–D7)](#deposit-flows)
7. [Redeem flows (R1–R5)](#redeem-flows)
8. [Cross-chain flows](#cross-chain-flows)
9. [Curator operations](#curator-operations)
10. [Vault configuration](#vault-configuration)
11. [Vault topology & distribution](#vault-topology--distribution)
12. [Spoke routes](#spoke-routes)
13. [React hooks reference](#react-hooks-reference)
14. [Stargate vs Standard OFT handling](#stargate-vs-standard-oft-handling)
15. [Supported chains](#supported-chains)
16. [LZ timeouts](#lz-timeouts)
17. [Pre-flight validation](#pre-flight-validation)
18. [Error types](#error-types)

---

## Installation

```bash
npm install @oydual31/more-vaults-sdk
# or
yarn add @oydual31/more-vaults-sdk
# or
pnpm add @oydual31/more-vaults-sdk
```

**Peer dependencies** (install only what you use — all are optional):

| Package | Version |
|---------|---------|
| `viem` | `>=2` |
| `ethers` | `>=6` |
| `react` | `>=18` |
| `wagmi` | `>=2` |
| `@tanstack/react-query` | `>=5` |

---

## Quick start

### viem

```ts
import { smartDeposit, smartRedeem, getVaultStatus, waitForAsyncRequest, LZ_TIMEOUTS } from '@oydual31/more-vaults-sdk/viem'
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'
import { base } from 'viem/chains'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6'
const RPC   = 'https://mainnet.base.org'

const publicClient = createPublicClient({ chain: base, transport: http(RPC) })
const walletClient = createWalletClient({ account, chain: base, transport: http(RPC) })

// --- Deposit 100 USDC ---
const depositResult = await smartDeposit(
  walletClient, publicClient,
  { vault: VAULT },
  parseUnits('100', 6), // 100 USDC
  account.address,
)

if ('guid' in depositResult) {
  // Async vault — wait for LZ Read callback (~5 min)
  const final = await waitForAsyncRequest(publicClient, VAULT, depositResult.guid)
  console.log('Shares minted:', final.result)
} else {
  console.log('Shares minted:', depositResult.shares)
}

// --- Redeem shares ---
const redeemResult = await smartRedeem(
  walletClient, publicClient,
  { vault: VAULT },
  shares,
  account.address,
  account.address,
)

if ('guid' in redeemResult) {
  const final = await waitForAsyncRequest(publicClient, VAULT, redeemResult.guid)
  console.log('Assets received:', final.result)
} else {
  console.log('Assets received:', redeemResult.assets)
}
```

### ethers.js

```ts
import { smartDeposit, smartRedeem, getVaultStatus } from '@oydual31/more-vaults-sdk/ethers'
import { Wallet, JsonRpcProvider, parseUnits } from 'ethers'

const provider = new JsonRpcProvider('https://mainnet.base.org')
const signer   = new Wallet(PRIVATE_KEY, provider)
const VAULT    = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6'

const result = await smartDeposit(signer, { vault: VAULT }, parseUnits('100', 6), signer.address)
```

---

## Module overview

| Import path | Description | Dependencies |
|-------------|-------------|--------------|
| `@oydual31/more-vaults-sdk/viem` | Full-featured SDK — all flows, curator, topology | `viem` |
| `@oydual31/more-vaults-sdk/ethers` | Same feature set, ethers.js v6 API | `ethers` |
| `@oydual31/more-vaults-sdk/react` | React hooks built on wagmi + @tanstack/react-query | `react`, `wagmi`, `@tanstack/react-query` |

All three modules expose the same logical features. Choose based on your stack.

---

## Feature parity table

| Feature | viem | ethers | react |
|---------|------|--------|-------|
| `smartDeposit` / `useSmartDeposit` | Yes | Yes | Yes |
| `smartRedeem` / `useSmartRedeem` | Yes | Yes | Yes |
| `depositSimple` / `useDepositSimple` | Yes | Yes | Yes |
| `redeemShares` / `useRedeemShares` | Yes | Yes | Yes |
| `depositAsync`, `mintAsync` | Yes | Yes | — |
| `redeemAsync` | Yes | Yes | — |
| `depositMultiAsset` | Yes | Yes | — |
| `requestRedeem`, `getWithdrawalRequest` | Yes | Yes | — |
| `withdrawAssets` | Yes | Yes | — |
| `depositFromSpoke`, `depositFromSpokeAsync` | Yes | Yes | — |
| `quoteDepositFromSpokeFee` | Yes | Yes | — |
| `waitForCompose`, `quoteComposeFee`, `executeCompose` | Yes | Yes | — |
| `bridgeSharesToHub`, `bridgeAssetsToSpoke` | Yes | Yes | — |
| `resolveRedeemAddresses`, `quoteShareBridgeFee` | Yes | Yes | — |
| `getVaultStatus` | Yes | Yes | `useVaultStatus` |
| `getVaultMetadata` | Yes | Yes | `useVaultMetadata` |
| `getUserPosition` | Yes | Yes | `useUserPosition` |
| `getUserPositionMultiChain` | Yes | Yes | `useUserPositionMultiChain` |
| `previewDeposit`, `previewRedeem` | Yes | Yes | — |
| `canDeposit` | Yes | Yes | — |
| `getUserBalances`, `getMaxWithdrawable` | Yes | Yes | — |
| `getVaultSummary` | Yes | Yes | — |
| `quoteLzFee` | Yes | Yes | `useLzFee` |
| `getAsyncRequestStatusLabel` | Yes | Yes | `useAsyncRequestStatus` |
| `waitForAsyncRequest` | Yes | — | — |
| `getVaultTopology`, `getFullVaultTopology`, `discoverVaultTopology` | Yes | Yes | `useVaultTopology` |
| `isOnHubChain`, `getAllVaultChainIds` | Yes | Yes | — |
| `getVaultDistribution`, `getVaultDistributionWithTopology` | Yes | Yes | `useVaultDistribution` |
| `getInboundRoutes` | Yes | Yes | `useInboundRoutes` |
| `getUserBalancesForRoutes` | Yes | Yes | — |
| `getOutboundRoutes`, `quoteRouteDepositFee` | Yes | Yes | — |
| `getCuratorVaultStatus` | Yes | Yes | `useCuratorVaultStatus` |
| `getPendingActions` | Yes | Yes | `usePendingActions` |
| `isCurator` | Yes | Yes | `useIsCurator` |
| `getVaultAnalysis` | Yes | Yes | `useVaultAnalysis` |
| `getVaultAssetBreakdown` | Yes | Yes | `useVaultAssetBreakdown` |
| `checkProtocolWhitelist` | Yes | Yes | `useProtocolWhitelist` |
| `encodeCuratorAction`, `buildCuratorBatch` | Yes | Yes | — |
| `submitActions` | Yes | Yes | `useSubmitActions` |
| `executeActions` | Yes | Yes | `useExecuteActions` |
| `vetoActions` | Yes | Yes | `useVetoActions` |
| `buildUniswapV3Swap`, `encodeUniswapV3SwapCalldata` | Yes | Yes | — |
| `quoteCuratorBridgeFee`, `executeCuratorBridge` | Yes | Yes | `useCuratorBridgeQuote`, `useExecuteBridge` |
| `findBridgeRoute`, `encodeBridgeParams` | Yes | Yes | — |
| `getSubVaultPositions`, `getVaultPortfolio` | Yes | Yes | `useSubVaultPositions`, `useVaultPortfolio` |
| `getSubVaultInfo`, `detectSubVaultType` | Yes | Yes | — |
| `getERC7540RequestStatus` | Yes | Yes | `useERC7540RequestStatus` |
| `previewSubVaultDeposit`, `previewSubVaultRedeem` | Yes | Yes | — |
| `getVaultConfiguration` | Yes | Yes | `useVaultConfiguration` |
| `setDepositCapacity`, `addAvailableAsset(s)`, `disableAssetToDeposit` | Yes | Yes | — |
| `setFeeRecipient`, `pauseVault`, `unpauseVault`, `setDepositWhitelist`, `enableDepositWhitelist` | Yes | Yes | — |
| `recoverAssets` (guardian), `acceptOwnership` | Yes | Yes | — |
| 19 timelocked `CuratorAction` types (config + role transfers) | Yes | Yes | — |
| `detectStargateOft` | Yes | Yes | — |
| `preflightSync`, `preflightAsync` | Yes | Yes | — |
| `preflightSpokeDeposit`, `preflightSpokeRedeem` | Yes | Yes | — |
| `preflightRedeemLiquidity` | Yes | Yes | — |
| Chain constants, ABIs, error types | Yes | Yes | — |

---

## Core concepts

### Assets and shares

- **Asset**: the token users deposit (e.g. USDC). Always the same token in and out.
- **Shares**: what the vault mints when you deposit. Represent your ownership percentage. As the vault earns yield, each share becomes worth more assets. Shares are ERC-20 tokens at the vault address.
- **Share price**: how many assets one share is worth. Starts at 1:1 and grows over time.

```
Deposit 100 USDC  →  receive 100 shares  (at launch, price = 1)
Wait 1 year       →  share price = 1.05
Redeem 100 shares →  receive 105 USDC
```

> Vault shares use more decimals than the underlying token. A vault over USDC (6 decimals) will typically have 8 decimals for shares. Always read `vault.decimals()` — never hardcode it.

### Hub and spoke

MoreVaults uses a **hub-and-spoke** model:

- **Hub** (`isHub = true`): the chain where the vault does its accounting — mints/burns shares, accepts deposits and redemptions.
- **Spoke**: a chain where the vault has deployed funds for yield. Users on spoke chains bridge tokens to the hub via LayerZero OFT.

If `isHub = false`, the vault is a single-chain vault — no cross-chain flows apply, use D1/R1.

### Vault modes

Use `getVaultStatus()` to read the current mode:

| Mode | `isHub` | Oracle | Description | Applicable flows |
|------|---------|--------|-------------|-----------------|
| `local` | false | — | Single-chain vault. No cross-chain. | D1, D2, R1, R2 |
| `cross-chain-oracle` | true | ON | Hub with oracle-fed spoke balances. Synchronous like `local`. | D1/D3, D2, R1, R2 |
| `cross-chain-async` | true | OFF | Hub where spoke balances require a LZ Read query. Async deposits/redeems. | D4, D5, R5 |
| `paused` | — | — | No deposits or redeems accepted. | None |
| `full` | — | — | Deposit capacity reached. Redeems still work. | R1, R2 only |

### Oracle ON vs OFF

When `oraclesCrossChainAccounting = true`, the vault has a configured oracle that knows the current value of spoke deployments. `totalAssets()` resolves instantly — flows are synchronous.

When `false`, the vault must query spokes via **LayerZero Read** to calculate share prices. Deposits and redeems are **async** — the user locks funds, waits for the oracle response (~1–5 min), and a keeper finalizes.

### Hub liquidity and repatriation

In a cross-chain vault, the hub typically holds only a fraction of TVL as liquid assets. The rest is deployed to spoke chains.

- `totalAssets()` = hub liquid balance + value of all spoke positions.
- **Redeemable now** = hub liquid balance only. Attempting to redeem more than the hub holds fails.
- For async redeems (R5), a failed `executeRequest` causes the vault to refund shares — no assets are lost.
- **Repatriation** (moving funds from spokes to the hub) is a curator-only operation.

### Withdrawal queue and timelock

Some vaults require shares to be queued before redemption:

- `withdrawalQueueEnabled = true`: users must call `requestRedeem` first, then `redeemShares` separately.
- `withdrawalTimelockSeconds > 0`: mandatory waiting period between `requestRedeem` and `redeemShares`.

### Escrow

The `MoreVaultsEscrow` temporarily holds user funds during async flows (D4, D5, R5). Tokens go to the escrow while the LZ Read resolves. The SDK handles the approve-to-escrow step internally.

```ts
const status = await getVaultStatus(publicClient, VAULT_ADDRESS)
const escrow = status.escrow // address(0) if not configured
```

### VaultAddresses

```ts
interface VaultAddresses {
  vault: Address      // Vault address — same on every chain (CREATE3)
  escrow?: Address    // MoreVaultsEscrow — required for D4, D5, R5 (auto-resolved if omitted)
  hubChainId?: number // Optional chain validation guard
}
```

### LayerZero EID

LayerZero identifies chains by an **Endpoint ID (EID)** — different from the EVM chain ID:

| Chain | Chain ID | LayerZero EID |
|-------|----------|---------------|
| Ethereum | 1 | 30101 |
| Arbitrum | 42161 | 30110 |
| Optimism | 10 | 30111 |
| Base | 8453 | 30184 |
| BNB Chain | 56 | 30102 |
| Sonic | 146 | 30332 |
| Flow EVM | 747 | 30336 |

### GUID (async request ID)

When you call `depositAsync`, `mintAsync`, or `redeemAsync`, the function returns a `guid` — a `bytes32` identifier for that cross-chain request:

```ts
const { guid } = await depositAsync(...)

// Wait for finalization (recommended)
const final = await waitForAsyncRequest(publicClient, VAULT, guid)
// final.status: 'completed' | 'refunded'
// final.result: exact shares minted or assets received (bigint)

// Check status once
const info = await getAsyncRequestStatusLabel(publicClient, VAULT, guid)
// info.label: 'pending' | 'fulfilled' | 'finalized' | 'refunded'
```

### Clients

**viem** uses two separate objects:

| Client | Role |
|--------|------|
| `publicClient` | Read-only. `createPublicClient({ chain, transport: http(RPC_URL) })` |
| `walletClient` | Signs and sends transactions. `createWalletClient({ account, chain, transport: http(RPC_URL) })` |

In React with wagmi:
```ts
import { usePublicClient, useWalletClient } from 'wagmi'
const publicClient = usePublicClient()
const { data: walletClient } = useWalletClient()
```

**ethers.js** uses a single `Signer`:

```ts
// Browser
const signer = await new BrowserProvider(window.ethereum).getSigner()
// Node.js
const signer = new Wallet(PRIVATE_KEY, new JsonRpcProvider(RPC_URL))
```

> The client's chain must match the chain where the vault lives. Hub flows use the hub chain client. Spoke flows (D6/D7) use the spoke chain client.

---

## Deposit flows

### Smart flows (recommended)

`smartDeposit` auto-detects the vault type and routes to the correct flow:

| Vault mode | What `smartDeposit` calls |
|------------|--------------------------|
| `local` or `cross-chain-oracle` | `depositSimple` (synchronous) |
| `cross-chain-async` | `depositAsync` (async, returns `guid`) |

```ts
import { smartDeposit } from '@oydual31/more-vaults-sdk/viem'

const result = await smartDeposit(walletClient, publicClient, { vault: VAULT }, amount, receiver)

if ('guid' in result) {
  // Async vault — poll for finalization
  console.log(result.guid)
} else {
  // Sync vault — shares available immediately
  console.log(result.shares)
}
```

### Hub-chain deposit flows

| ID | Function | When to use |
|----|----------|-------------|
| — | `smartDeposit` | Recommended. Auto-detects vault type. |
| D1 | `depositSimple` | User on hub chain, oracle ON or local vault |
| D2 | `depositMultiAsset` | Deposit multiple tokens in one call |
| D3 | `depositCrossChainOracleOn` | Alias for D1 — hub with oracle ON |
| D4 | `depositAsync` | Hub with oracle OFF — async LZ Read. Returns `guid`. |
| D5 | `mintAsync` | Same as D4 but user specifies exact share amount |

**D1 — Simple deposit:**
```ts
import { depositSimple } from '@oydual31/more-vaults-sdk/viem'

const { txHash, shares } = await depositSimple(
  walletClient, publicClient,
  { vault: VAULT },
  parseUnits('100', 6),
  account.address,
)
```

**D4 — Async deposit (oracle OFF):**
```ts
import { depositAsync, waitForAsyncRequest, quoteLzFee } from '@oydual31/more-vaults-sdk/viem'

const lzFee = await quoteLzFee(publicClient, VAULT)

const { txHash, guid } = await depositAsync(
  walletClient, publicClient,
  { vault: VAULT },
  parseUnits('100', 6),
  account.address,
  lzFee,
)

const final = await waitForAsyncRequest(publicClient, VAULT, guid)
// final.status: 'completed' | 'refunded'
// final.result: shares minted (bigint)
```

---

## Redeem flows

### Smart flows (recommended)

`smartRedeem` auto-detects the vault type and routes to the correct flow:

| Vault mode | What `smartRedeem` calls |
|------------|------------------------|
| `local` or `cross-chain-oracle` | `redeemShares` (synchronous) |
| `cross-chain-async` | `redeemAsync` (async, returns `guid`) |

### Hub-chain redeem flows

| ID | Function | When to use |
|----|----------|-------------|
| — | `smartRedeem` | Recommended. Auto-detects vault type. |
| R1 | `redeemShares` | Standard redeem, hub chain, no queue |
| R2 | `withdrawAssets` | Specify exact asset amount to receive |
| R3 | `requestRedeem` | Withdrawal queue enabled, no timelock |
| R4 | `requestRedeem` | Withdrawal queue + mandatory wait period |
| R5 | `redeemAsync` | Hub with oracle OFF — async LZ Read. Returns `guid`. |

**R1 — Simple redeem:**
```ts
import { redeemShares } from '@oydual31/more-vaults-sdk/viem'

const { txHash, assets } = await redeemShares(
  walletClient, publicClient,
  { vault: VAULT },
  shares,
  account.address, // receiver
  account.address, // owner
)
```

**R3/R4 — Queued redeem:**
```ts
import { requestRedeem, redeemShares, getWithdrawalRequest } from '@oydual31/more-vaults-sdk/viem'

// Step 1: queue the request
await requestRedeem(walletClient, publicClient, { vault: VAULT }, shares, account.address)

// Step 2: wait for timelock to expire (if configured), then redeem
// Check status
const request = await getWithdrawalRequest(publicClient, VAULT, account.address)

// Step 3: execute redeem
await redeemShares(walletClient, publicClient, { vault: VAULT }, shares, account.address, account.address)
```

---

## Cross-chain flows

### Spoke deposit (D6 / D7)

Deposits from a spoke chain to the hub vault via LayerZero OFT Compose:

- **D6 (oracle ON)**: composer calls `_depositAndSend` — shares arrive on spoke in ~1 LZ round-trip.
- **D7 (oracle OFF)**: composer calls `_initDeposit` — requires an additional LZ Read round-trip.

The interface is identical for both. The SDK detects which path the composer takes.

```ts
import {
  getInboundRoutes,
  quoteDepositFromSpokeFee,
  depositFromSpoke,
  waitForCompose,
  quoteComposeFee,
  executeCompose,
} from '@oydual31/more-vaults-sdk/viem'
import { LZ_EIDS } from '@oydual31/more-vaults-sdk/viem'

// 1. Discover available routes
const routes = await getInboundRoutes(hubChainId, VAULT, vaultAsset, userAddress)

// 2. Quote the LZ fee for the chosen route
const lzFee = await quoteDepositFromSpokeFee(
  spokePublicClient,
  VAULT,
  route.spokeOft,
  LZ_EIDS.BASE,   // hubEid
  LZ_EIDS.ETH,    // spokeEid
  amount,
  account.address,
)

// 3. Send from spoke chain
const { txHash, guid, composeData } = await depositFromSpoke(
  spokeWalletClient, spokePublicClient,
  VAULT,
  route.spokeOft,
  LZ_EIDS.BASE,  // hubEid
  LZ_EIDS.ETH,   // spokeEid
  amount,
  account.address,
  lzFee,
)

// 4. For Stargate OFTs: execute the pending compose on the hub (2-TX flow)
if (composeData) {
  const fullComposeData = await waitForCompose(hubPublicClient, composeData, account.address)
  const composeFee = await quoteComposeFee(hubPublicClient, VAULT, LZ_EIDS.ETH, account.address)
  const { txHash: composeTxHash, guid: asyncGuid } = await executeCompose(
    hubWalletClient, hubPublicClient, fullComposeData, composeFee,
  )
  // For D7 vaults, asyncGuid is present — poll finalization
  if (asyncGuid) {
    const final = await waitForAsyncRequest(hubPublicClient, VAULT, asyncGuid)
  }
}
// For standard OFTs: no action needed — compose executes automatically in 1 TX.
```

### Spoke redeem (3-step flow)

Full spoke redeem moves shares from spoke to hub, redeems, then bridges assets back:

```
Step 1 (Spoke):  bridgeSharesToHub()   — bridge shares spoke→hub via SHARE_OFT (~7 min)
Step 2 (Hub):    smartRedeem()         — redeem on hub (auto-detects async, ~5 min callback)
Step 3 (Hub):    bridgeAssetsToSpoke() — bridge assets hub→spoke via Stargate/OFT (~13 min)
```

```ts
import {
  resolveRedeemAddresses,
  preflightSpokeRedeem,
  bridgeSharesToHub,
  quoteShareBridgeFee,
  smartRedeem,
  bridgeAssetsToSpoke,
} from '@oydual31/more-vaults-sdk/viem'

// Pre-step: resolve all contract addresses dynamically
const addresses = await resolveRedeemAddresses(publicClient, VAULT, spokeChainId)

// Pre-step: validate balances and gas
const check = await preflightSpokeRedeem(route, shares, userAddress, shareBridgeFee)

// Step 1: bridge shares to hub
const shareFee = await quoteShareBridgeFee(spokePublicClient, VAULT, hubEid, account.address)
const { txHash } = await bridgeSharesToHub(spokeWalletClient, spokePublicClient, route, shares, account.address, shareFee)

// Step 2: redeem on hub (after shares arrive ~7 min)
const redeemResult = await smartRedeem(hubWalletClient, hubPublicClient, { vault: VAULT }, shares, account.address, account.address)

// Step 3: bridge assets back to spoke
await bridgeAssetsToSpoke(hubWalletClient, hubPublicClient, route, assets, account.address, bridgeFee)
```

### Compose helpers

| Function | Description |
|----------|-------------|
| `waitForCompose` | Poll for pending compose in LZ Endpoint's `composeQueue`. Scans `ComposeSent` events from hub block captured at TX1. |
| `quoteComposeFee` | Quote ETH needed for `executeCompose` (readFee + shareSendFee + 10% buffer) |
| `executeCompose` | Execute pending compose on hub chain. Returns `{ txHash, guid? }` — `guid` present for async D7 vaults |

---

## Curator operations

Curator operations are for vault managers, not end users. All reads are multicall-batched. All writes use the simulate-then-write pattern.

### Status reads

```ts
import { getCuratorVaultStatus, getPendingActions, isCurator, getVaultAnalysis, getVaultAssetBreakdown, checkProtocolWhitelist } from '@oydual31/more-vaults-sdk/viem'

const status = await getCuratorVaultStatus(publicClient, VAULT)
// status.curator         — curator address
// status.timeLockPeriod  — seconds (0 = immediate execution)
// status.maxSlippagePercent — slippage limit for swaps
// status.currentNonce    — latest action nonce
// status.availableAssets — whitelisted token addresses
// status.lzAdapter       — cross-chain accounting manager address
// status.paused          — vault paused state

const isManager = await isCurator(publicClient, VAULT, myAddress)

// Full analysis — available assets with name/symbol/decimals, depositable assets, whitelist config
const analysis = await getVaultAnalysis(publicClient, VAULT)
// analysis.availableAssets    — AssetInfo[] with metadata
// analysis.depositableAssets  — AssetInfo[]
// analysis.depositWhitelistEnabled
// analysis.registryAddress

// Per-asset balance breakdown on the hub
const breakdown = await getVaultAssetBreakdown(publicClient, VAULT)
// breakdown.assets         — AssetBalance[] (address, name, symbol, decimals, balance)
// breakdown.totalAssets
// breakdown.totalSupply

// Check pending actions for a nonce
const pending = await getPendingActions(publicClient, VAULT, nonce)
// pending.actionsData    — raw calldata bytes[]
// pending.pendingUntil   — timestamp when executable
// pending.isExecutable   — boolean (timelock expired)

// Check protocol whitelist
const whitelist = await checkProtocolWhitelist(publicClient, VAULT, [routerAddress])
// { '0xRouter...': true }
```

### Batch actions

Curator actions are encoded and submitted as a batch. When `timeLockPeriod == 0`, actions execute immediately on submission. With a timelock, they queue and must be executed separately.

```ts
import {
  buildUniswapV3Swap,
  encodeCuratorAction,
  buildCuratorBatch,
  submitActions,
  executeActions,
  vetoActions,
} from '@oydual31/more-vaults-sdk/viem'

// Build a Uniswap V3 swap action (router auto-resolved per chainId)
const swapAction = buildUniswapV3Swap({
  chainId: 8453,           // Base — uses SwapRouter02 (no deadline)
  tokenIn:  USDC_ADDRESS,
  tokenOut: WETH_ADDRESS,
  fee: 500,                // 0.05% pool
  amountIn: parseUnits('1000', 6),
  minAmountOut: parseUnits('0.39', 18),
  recipient: VAULT,
})

// Build additional actions using the discriminated union type
const depositAction: CuratorAction = {
  type: 'erc4626Deposit',
  vault: MORPHO_VAULT,
  assets: parseUnits('500', 6),
}

// Encode and submit the batch
const batch = buildCuratorBatch([swapAction, depositAction])
const { txHash, nonce } = await submitActions(walletClient, publicClient, VAULT, batch)

// If timeLockPeriod > 0: wait for timelock, then execute
await executeActions(walletClient, publicClient, VAULT, nonce)

// Guardian: cancel pending actions
await vetoActions(guardianWalletClient, publicClient, VAULT, [nonce])
```

### Supported CuratorAction types

| Type | Description |
|------|-------------|
| `swap` | Single Uniswap V3 exactInputSingle swap |
| `batchSwap` | Multiple swaps in one action |
| `erc4626Deposit` | Deposit assets into an ERC-4626 vault |
| `erc4626Redeem` | Redeem shares from an ERC-4626 vault |
| `erc7540RequestDeposit` | Request deposit into an ERC-7540 async vault |
| `erc7540Deposit` | Finalize ERC-7540 deposit |
| `erc7540RequestRedeem` | Request redeem from an ERC-7540 async vault |
| `erc7540Redeem` | Finalize ERC-7540 redeem |

### Swap helpers

`buildUniswapV3Swap` automatically selects the correct router and ABI variant per chain:

| Chain | Router | ABI variant |
|-------|--------|-------------|
| Base (8453) | SwapRouter02 `0x2626...` | No `deadline` field |
| Ethereum (1) | SwapRouter `0xE592...` | Has `deadline` field |
| Arbitrum (42161) | SwapRouter `0xE592...` | Has `deadline` field |
| Optimism (10) | SwapRouter `0xE592...` | Has `deadline` field |
| Flow EVM (747) | FlowSwap V3 `0xeEDC...` | Has `deadline` field |

To get raw calldata without wrapping in a `CuratorAction`:
```ts
const { targetContract, swapCallData } = encodeUniswapV3SwapCalldata({
  chainId: 8453,
  tokenIn: USDC_ADDRESS,
  tokenOut: WETH_ADDRESS,
  fee: 500,
  amountIn: parseUnits('1000', 6),
  minAmountOut: 0n,
  recipient: VAULT,
})
```

### Bridge operations

Curators can bridge assets between hub and spoke vaults via LayerZero. This is a direct curator call (not via multicall) — the vault pauses during bridging for security.

```ts
import {
  quoteCuratorBridgeFee,
  executeCuratorBridge,
  findBridgeRoute,
} from '@oydual31/more-vaults-sdk/viem'

// Find the OFT route for USDC between Base and Arbitrum
const route = findBridgeRoute(8453, 42161, USDC_ADDRESS)
// route.oftSrc  — OFT on source chain (Stargate USDC on Base)
// route.oftDst  — OFT on destination chain
// route.symbol  — 'stgUSDC'

// Quote the LayerZero fee
const fee = await quoteCuratorBridgeFee(publicClient, VAULT, {
  oftToken: route.oftSrc,
  dstEid: 30110,                    // Arbitrum LZ EID
  amount: parseUnits('1000', 6),    // 1000 USDC
  dstVault: SPOKE_VAULT_ADDRESS,
  refundAddress: curatorAddress,
})

// Execute the bridge (curator only)
const txHash = await executeCuratorBridge(
  walletClient, publicClient, VAULT,
  USDC_ADDRESS,    // underlying ERC-20 token
  {
    oftToken: route.oftSrc,
    dstEid: 30110,
    amount: parseUnits('1000', 6),
    dstVault: SPOKE_VAULT_ADDRESS,
    refundAddress: curatorAddress,
  },
)
```

### Sub-vault operations

Curators invest vault assets into ERC4626/ERC7540 sub-vaults (Aave, Morpho, etc.) to generate yield.

```ts
import {
  getSubVaultPositions,
  getVaultPortfolio,
  getSubVaultInfo,
  detectSubVaultType,
  getERC7540RequestStatus,
  previewSubVaultDeposit,
} from '@oydual31/more-vaults-sdk/viem'

// Full portfolio: liquid assets + sub-vault positions
const portfolio = await getVaultPortfolio(publicClient, VAULT)
// portfolio.liquidAssets       — AssetBalance[] (tokens held directly)
// portfolio.subVaultPositions  — SubVaultPosition[] (shares + underlying value)
// portfolio.totalValue         — total in vault underlying units
// portfolio.lockedAssets       — locked in pending ERC7540 requests

// Active sub-vault positions with current values
const positions = await getSubVaultPositions(publicClient, VAULT)
for (const p of positions) {
  console.log(`${p.symbol}: ${p.sharesBalance} shares = ${p.underlyingValue} ${p.underlyingSymbol}`)
}

// Analyze a target sub-vault before investing
const info = await getSubVaultInfo(publicClient, VAULT, MORPHO_VAULT)
// info.type           — 'erc4626' or 'erc7540'
// info.maxDeposit     — capacity remaining
// info.isWhitelisted  — must be true to invest

// Preview: how many shares would a 1000 USDC deposit yield?
const shares = await previewSubVaultDeposit(publicClient, MORPHO_VAULT, parseUnits('1000', 6))

// For ERC7540 async sub-vaults: check if requests are ready
const status = await getERC7540RequestStatus(publicClient, VAULT, ASYNC_VAULT)
if (status.canFinalizeDeposit) {
  // Curator can now call erc7540Deposit via submitActions
}
```

---

## Vault configuration

Full admin/curator/guardian config reads and writes.

### Reading configuration

`getVaultConfiguration` reads 22+ fields in a single multicall:

```ts
import { getVaultConfiguration } from '@oydual31/more-vaults-sdk/viem'

const config = await getVaultConfiguration(publicClient, VAULT)
// Roles
config.owner              // current owner
config.curator            // current curator
config.guardian           // current guardian
config.pendingOwner       // pending ownership transfer target

// Fees & capacity
config.fee                // management fee (basis points)
config.feeRecipient       // fee recipient address
config.depositCapacity    // max deposit capacity
config.withdrawalFee      // withdrawal fee

// Timelock & withdrawal
config.timeLockPeriod     // seconds before queued actions execute
config.withdrawalTimelockSeconds
config.withdrawalQueueEnabled
config.maxWithdrawalDelay

// Access
config.depositWhitelistEnabled
config.paused

// Assets
config.availableAssets    // address[] — all whitelisted assets
config.depositableAssets  // address[] — assets enabled for deposits

// Cross-chain
config.crossChainAccountingManager
config.gasLimitForAccounting
config.maxSlippagePercent
```

### Direct curator actions

No timelock — execute immediately when called by the curator:

```ts
import {
  setDepositCapacity,
  addAvailableAsset,
  addAvailableAssets,
  disableAssetToDeposit,
} from '@oydual31/more-vaults-sdk/viem'

await setDepositCapacity(walletClient, publicClient, VAULT, parseUnits('1000000', 6))
await addAvailableAsset(walletClient, publicClient, VAULT, TOKEN_ADDRESS)
await addAvailableAssets(walletClient, publicClient, VAULT, [TOKEN_A, TOKEN_B])
await disableAssetToDeposit(walletClient, publicClient, VAULT, TOKEN_ADDRESS)
```

### Direct owner actions

```ts
import {
  setFeeRecipient,
  setDepositWhitelist,
  enableDepositWhitelist,
  pauseVault,
  unpauseVault,
} from '@oydual31/more-vaults-sdk/viem'

await setFeeRecipient(walletClient, publicClient, VAULT, recipientAddress)
await pauseVault(walletClient, publicClient, VAULT)
await unpauseVault(walletClient, publicClient, VAULT)
```

### Guardian and pending owner actions

```ts
import { recoverAssets, acceptOwnership } from '@oydual31/more-vaults-sdk/viem'

// Guardian: recover stuck assets
await recoverAssets(guardianWalletClient, publicClient, VAULT, TOKEN_ADDRESS, amount, recipientAddress)

// Pending owner: accept ownership transfer
await acceptOwnership(newOwnerWalletClient, publicClient, VAULT)
```

### Timelocked actions via submitActions

19 new `CuratorAction` types that go through the timelock queue:

```ts
import { encodeCuratorAction, buildCuratorBatch, submitActions } from '@oydual31/more-vaults-sdk/viem'

// Config changes
const actions: CuratorAction[] = [
  { type: 'setTimeLockPeriod', period: 86400 },
  { type: 'setWithdrawalFee', fee: 50n },          // 0.5%
  { type: 'setFee', fee: 200n },                    // 2% management fee
  { type: 'enableAssetToDeposit', asset: TOKEN },
  { type: 'disableDepositWhitelist' },
  { type: 'updateWithdrawalQueueStatus', enabled: true },
  { type: 'setMaxWithdrawalDelay', delay: 604800 },
  { type: 'setMaxSlippagePercent', percent: 100n },
  { type: 'setCrossChainAccountingManager', manager: LZ_ADAPTER },
  { type: 'setGasLimitForAccounting', gasLimit: 500000n },
  { type: 'setWithdrawalTimelock', timelock: 3600 },
]

// Role transfers
const roleActions: CuratorAction[] = [
  { type: 'transferOwnership', newOwner: NEW_OWNER },
  { type: 'transferCuratorship', newCurator: NEW_CURATOR },
  { type: 'transferGuardian', newGuardian: NEW_GUARDIAN },
]

const batch = buildCuratorBatch(actions)
const { nonce } = await submitActions(walletClient, publicClient, VAULT, batch)
// Wait for timelock, then: executeActions(walletClient, publicClient, VAULT, nonce)
```

---

## Vault topology & distribution

### Topology

Resolve the hub/spoke structure of any vault:

```ts
import {
  getVaultTopology,
  getFullVaultTopology,
  discoverVaultTopology,
  isOnHubChain,
  getAllVaultChainIds,
  OMNI_FACTORY_ADDRESS,
} from '@oydual31/more-vaults-sdk/viem'

// Query from a known chain
const topo = await getVaultTopology(baseClient, VAULT)
// { role: 'hub', hubChainId: 8453, spokeChainIds: [1, 42161] }

// Query from any chain — same vault is a spoke on Ethereum
const topo2 = await getVaultTopology(ethClient, VAULT)
// { role: 'spoke', hubChainId: 8453, spokeChainIds: [1] }

// Auto-discover across all supported chains (no wallet needed)
const topo3 = await discoverVaultTopology(VAULT)
// Iterates all supported chains, finds the hub, returns full topology

// Get full spoke list — must use hub-chain client
const fullTopo = await getFullVaultTopology(baseClient, VAULT)

// Helpers
const onHub = isOnHubChain(walletChainId, topo)  // boolean
const allChains = getAllVaultChainIds(topo)        // [8453, 1, 42161]
```

`VaultTopology` shape:
```ts
interface VaultTopology {
  role: 'hub' | 'spoke' | 'local'
  hubChainId: number
  spokeChainIds: number[]
}
```

### Distribution

Read the cross-chain capital distribution (hub liquid, hub strategies, spoke balances):

```ts
import { getVaultDistribution, getVaultDistributionWithTopology } from '@oydual31/more-vaults-sdk/viem'

// With explicit spoke clients — reads spoke balances in parallel
const dist = await getVaultDistribution(baseClient, VAULT, {
  [1]: ethClient,
  [42161]: arbClient,
})
// dist.hubLiquidBalance      — idle on hub (not deployed)
// dist.hubStrategyBalance    — deployed to hub-side strategies (Morpho, Aave, etc.)
// dist.hubTotalAssets        — hubLiquidBalance + hubStrategyBalance
// dist.spokesDeployedBalance — what hub accounting thinks is on spokes
// dist.spokeBalances         — SpokeBalance[] { chainId, totalAssets, isReachable }
// dist.totalActual           — hub + reachable spoke totals
// dist.oracleAccountingEnabled

// Hub-only — discovers spoke chain IDs but does not read them
const dist2 = await getVaultDistributionWithTopology(baseClient, VAULT)
// dist2.spokeChainIds — list of spoke chain IDs to query if needed
// dist2.spokeBalances === [] (empty — no spoke clients provided)
```

---

## Spoke routes

Discover available deposit and redeem routes across chains:

```ts
import {
  getInboundRoutes,
  getUserBalancesForRoutes,
  getOutboundRoutes,
  quoteRouteDepositFee,
  NATIVE_SYMBOL,
} from '@oydual31/more-vaults-sdk/viem'

// All routes a user can deposit from
const inbound = await getInboundRoutes(hubChainId, VAULT, vaultAsset, userAddress)
// Returns InboundRoute[]:
// - depositType: 'direct' | 'direct-async' | 'oft-compose'
// - spokeChainId, spokeOft, spokeToken, hubOft
// - sourceTokenSymbol — display this to users (e.g. 'USDC', 'weETH')
// - lzFeeEstimate (using 1 USDC placeholder amount)
// - nativeSymbol — gas token for the spoke chain

// Fetch user balances for each route
const withBalances = await getUserBalancesForRoutes(inbound, userAddress)
// Adds userBalance: bigint to each route

// Precise fee quote for a real deposit amount
const fee = await quoteRouteDepositFee(route, hubChainId, amount, userAddress)
// Returns 0n for 'direct' routes (no LZ fee needed)

// All chains a user can receive assets when redeeming
const outbound = await getOutboundRoutes(hubChainId, VAULT)
// Returns OutboundRoute[]:
// - chainId, routeType: 'hub' | 'spoke', eid, nativeSymbol

// Native gas symbol per chain
NATIVE_SYMBOL[8453]  // 'ETH'
NATIVE_SYMBOL[747]   // 'FLOW'
NATIVE_SYMBOL[146]   // 'S'
NATIVE_SYMBOL[56]    // 'BNB'
```

**InboundRoute deposit types:**

| `depositType` | User location | LZ fee | What happens |
|---------------|--------------|--------|--------------|
| `direct` | Hub chain, sync vault | None | Standard ERC-4626 `deposit()` |
| `direct-async` | Hub chain, async vault | Yes | `depositAsync()` with LZ Read |
| `oft-compose` | Spoke chain | Yes | OFT bridge + composer on hub |

---

## React hooks reference

Import from `@oydual31/more-vaults-sdk/react`. Requires wagmi v2 + @tanstack/react-query v5.

### Read hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useVaultStatus(vault)` | `VaultStatus` | Full config snapshot + recommended flow |
| `useVaultMetadata(vault)` | `VaultMetadata` | name, symbol, decimals, underlying, TVL, capacity |
| `useUserPosition(vault, user)` | `UserPosition` | shares, asset value, share price, pending withdrawal |
| `useUserPositionMultiChain(vault, user)` | `MultiChainUserPosition` | shares across hub + all spokes |
| `useLzFee(vault)` | `bigint` | Native fee required for async flows |
| `useAsyncRequestStatus(vault, guid)` | `AsyncRequestStatusInfo` | Status label for async request |
| `useVaultTopology(vault)` | `VaultTopology` | Hub/spoke chain structure |
| `useVaultDistribution(vault)` | `VaultDistribution` | TVL breakdown across chains |
| `useInboundRoutes(hubChainId, vault, asset, user)` | `InboundRoute[]` | Available deposit routes |
| `useVaultPortfolioMultiChain(vault)` | `MultiChainPortfolio` | Cross-chain portfolio aggregation across hub + all spokes |

### Action hooks

| Hook | Description |
|------|-------------|
| `useSmartDeposit()` | Auto-routing deposit (sync or async) |
| `useSmartRedeem()` | Auto-routing redeem (sync or async) |
| `useDepositSimple()` | D1 — simple hub deposit |
| `useRedeemShares()` | R1 — standard hub redeem |
| `useOmniDeposit()` | Full omni-chain deposit with routing |
| `useOmniRedeem()` | Full omni-chain redeem with routing |

### Curator read hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useVaultConfiguration(vault)` | `VaultConfiguration` | Full 22+ field config snapshot (roles, fees, capacity, timelock, assets, cross-chain) |
| `useCuratorVaultStatus(vault)` | `CuratorVaultStatus` | Curator, timelock, nonce, assets, LZ adapter |
| `useVaultAnalysis(vault)` | `VaultAnalysis` | Available/depositable assets with metadata |
| `useVaultAssetBreakdown(vault)` | `VaultAssetBreakdown` | Per-asset balance breakdown |
| `usePendingActions(vault, nonce)` | `PendingAction` | Pending action batch with `isExecutable` flag |
| `useIsCurator(vault, address)` | `boolean` | Whether address is the current curator |
| `useProtocolWhitelist(vault, protocols)` | `Record<string, boolean>` | Protocol whitelist status |

### Curator write hooks

| Hook | Description |
|------|-------------|
| `useSubmitActions()` | Submit a batch of curator actions |
| `useExecuteActions()` | Execute queued actions after timelock |
| `useVetoActions()` | Guardian: cancel pending actions |
| `useCuratorBridgeQuote()` | Quote LayerZero fee for curator bridge |
| `useExecuteBridge()` | Execute curator bridge operation |
| `useSubVaultPositions()` | Active sub-vault positions with values |
| `useVaultPortfolio()` | Full portfolio: liquid + deployed + locked |
| `useERC7540RequestStatus()` | Pending/claimable ERC7540 request status |

### React example

```tsx
import {
  useVaultStatus,
  useUserPosition,
  useSmartDeposit,
} from '@oydual31/more-vaults-sdk/react'
import { parseUnits } from 'viem'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6'

function VaultDashboard() {
  const { data: status } = useVaultStatus(VAULT)
  const { data: position } = useUserPosition(VAULT, userAddress)
  const { deposit, isPending } = useSmartDeposit()

  const handleDeposit = () =>
    deposit({ vault: VAULT }, parseUnits('100', 6), userAddress)

  return (
    <div>
      <p>Mode: {status?.mode}</p>
      <p>Your shares: {position?.shares?.toString()}</p>
      <button onClick={handleDeposit} disabled={isPending}>Deposit 100 USDC</button>
    </div>
  )
}
```

---

## Stargate vs Standard OFT handling

The SDK auto-detects the OFT type via `detectStargateOft()`:

| OFT type | Examples | `extraOptions` | Compose delivery | User action after TX1 |
|----------|----------|---------------|-----------------|----------------------|
| **Stargate OFT** | stgUSDC, USDT, WETH | `'0x'` (empty) | Compose stays pending in LZ Endpoint `composeQueue` | Must execute TX2 on hub: `waitForCompose` → `executeCompose` |
| **Standard OFT** | Custom OFT adapters | LZCOMPOSE type-3 option injected with native ETH | LZ executor forwards ETH, compose auto-executes | No action needed |

Stargate's `TokenMessaging` contract rejects LZCOMPOSE type-3 executor options (`InvalidExecutorOption(3)`). The SDK handles this transparently — `depositFromSpoke` returns `composeData` when a 2nd TX is required.

**Detecting Stargate OFTs:**
```ts
import { detectStargateOft } from '@oydual31/more-vaults-sdk/viem'

const isStargate = await detectStargateOft(publicClient, oftAddress)
```

---

## Supported chains

Chains where the MoreVaults OMNI factory is deployed (`OMNI_FACTORY_ADDRESS = 0x7bDB8B17604b03125eFAED33cA0c55FBf856BB0C`):

| Chain | Chain ID | LZ EID | Native gas |
|-------|----------|--------|------------|
| Ethereum | 1 | 30101 | ETH |
| Arbitrum | 42161 | 30110 | ETH |
| Optimism | 10 | 30111 | ETH |
| Base | 8453 | 30184 | ETH |
| BNB Chain | 56 | 30102 | BNB |
| Sonic | 146 | 30332 | S |
| Flow EVM | 747 | 30336 | FLOW |

```ts
import { CHAIN_IDS, LZ_EIDS, EID_TO_CHAIN_ID, CHAIN_ID_TO_EID } from '@oydual31/more-vaults-sdk/viem'

CHAIN_IDS.BASE       // 8453
LZ_EIDS.BASE         // 30184
EID_TO_CHAIN_ID[30184]  // 8453
CHAIN_ID_TO_EID[8453]   // 30184
```

The `createChainTransport` and `createChainClient` helpers (exported from viem) build public-RPC clients for all supported chains using fallback transports:

```ts
import { createChainTransport } from '@oydual31/more-vaults-sdk/viem'

// Use with your own wallet client — useful for cross-chain flows
const transport = createChainTransport(8453)
const walletClient = createWalletClient({ account, chain: base, transport })
```

---

## LZ timeouts

Use these constants as timeout values in UI progress indicators:

```ts
import { LZ_TIMEOUTS } from '@oydual31/more-vaults-sdk/viem'

LZ_TIMEOUTS.POLL_INTERVAL      // 30 s  — balance poll interval
LZ_TIMEOUTS.OFT_BRIDGE         // 15 min — standard OFT bridge (shares or assets)
LZ_TIMEOUTS.STARGATE_BRIDGE    // 30 min — Stargate bridge
LZ_TIMEOUTS.LZ_READ_CALLBACK   // 15 min — async deposit/redeem LZ Read callback
LZ_TIMEOUTS.COMPOSE_DELIVERY   // 45 min — compose delivery to hub (spoke deposit)
LZ_TIMEOUTS.FULL_SPOKE_REDEEM  // 60 min — full spoke→hub→spoke redeem
```

Do not timeout before these values — cross-chain operations can legitimately take this long under network congestion.

---

## Pre-flight validation

Run pre-flight checks before submitting transactions to surface issues early with clear error messages:

```ts
import {
  preflightSync,
  preflightAsync,
  preflightRedeemLiquidity,
  preflightSpokeDeposit,
  preflightSpokeRedeem,
} from '@oydual31/more-vaults-sdk/viem'

// Before D1/D3 — sync hub deposit
await preflightSync(publicClient, vault, escrow)
// Validates: vault not paused, not full

// Before D4/D5/R5 — async flow
await preflightAsync(publicClient, vault, escrow)
// Validates: CCManager configured, escrow registered, isHub, oracle OFF, not paused

// Before R1/R2 — check hub has enough liquidity
await preflightRedeemLiquidity(publicClient, vault, assets)
// Throws InsufficientLiquidityError if hub liquid balance < assets

// Before spoke deposit
await preflightSpokeDeposit(...)
// Validates: spoke balance, spoke gas (LZ fee), hub composer setup

// Before spoke redeem
const check = await preflightSpokeRedeem(route, shares, userAddress, shareBridgeFee)
// Validates: shares on spoke, spoke gas, hub gas
// Returns: estimatedAssetBridgeFee, hubLiquidBalance
```

---

## Error types

All SDK errors extend `MoreVaultsError`. Import typed errors for `instanceof` checks:

```ts
import {
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
} from '@oydual31/more-vaults-sdk/viem'

try {
  await smartDeposit(...)
} catch (err) {
  if (err instanceof VaultPausedError) {
    // vault is paused
  } else if (err instanceof CapacityFullError) {
    // deposit capacity reached
  } else if (err instanceof InsufficientLiquidityError) {
    // hub doesn't have enough liquid assets to cover the redeem
  } else if (err instanceof WrongChainError) {
    // wallet is on the wrong chain
  }
}
```

---

## User helpers reference

| Function | Returns |
|----------|---------|
| `getUserPosition(publicClient, vault, user)` | `UserPosition` — shares, asset value, share price, pending withdrawal |
| `getUserPositionMultiChain(hubClient, vault, user)` | `MultiChainUserPosition` — shares across hub + all spokes |
| `previewDeposit(publicClient, vault, assets)` | `bigint` — estimated shares |
| `previewRedeem(publicClient, vault, shares)` | `bigint` — estimated assets |
| `canDeposit(publicClient, vault, user)` | `DepositEligibility` — `{ allowed, reason }` |
| `getVaultMetadata(publicClient, vault)` | `VaultMetadata` — name, symbol, decimals, underlying, TVL, capacity |
| `getVaultStatus(publicClient, vault)` | `VaultStatus` — full config + mode + recommended flow |
| `quoteLzFee(publicClient, vault)` | `bigint` — native fee for D4/D5/R5 |
| `getAsyncRequestStatusLabel(publicClient, vault, guid)` | `AsyncRequestStatusInfo` |
| `getUserBalances(publicClient, vault, user)` | `UserBalances` — shares + underlying in one call |
| `getMaxWithdrawable(publicClient, vault, user)` | `MaxWithdrawable` — max assets given hub liquidity |
| `getVaultSummary(publicClient, vault, user)` | `VaultSummary` — metadata + status + position combined |

---

## Repo structure

```
more-vaults-sdk/
├── src/
│   ├── viem/     — viem/wagmi SDK
│   ├── ethers/   — ethers.js v6 SDK
│   └── react/    — React hooks (wagmi)
├── docs/
│   ├── flows/    — per-flow detailed documentation
│   ├── user-helpers.md
│   └── testing.md
├── scripts/      — E2E test scripts (mainnet)
└── tests/        — integration tests (require Foundry + Anvil)
```

Integration tests: `bash tests/run.sh` — runs the full test suite against a forked mainnet.
