# @oydual31/more-vaults-sdk

TypeScript SDK for the MoreVaults protocol. Supports **viem/wagmi** and **ethers.js v6**.

```bash
npm install @oydual31/more-vaults-sdk
```

```ts
// viem / wagmi
import { smartDeposit, smartRedeem, getVaultStatus } from '@oydual31/more-vaults-sdk/viem'

// ethers.js v6
import { getVaultStatus, depositSimple } from '@oydual31/more-vaults-sdk/ethers'
```

---

## What is MoreVaults

MoreVaults is a cross-chain yield vault protocol. Users deposit tokens and receive **shares** that represent their proportional stake. The vault deploys those funds across multiple chains to earn yield. When a user redeems their shares, they get back the underlying tokens plus any accrued yield.

Each vault is a **diamond proxy** (EIP-2535) — a single address that routes calls to multiple facets. From the SDK's perspective, it's just an address.

---

## Core concepts

### Assets and shares

- **Asset** (or underlying): the token users deposit — e.g. USDC. Always the same token in and out.
- **Shares**: what the vault mints when you deposit. They represent your ownership percentage. As the vault earns yield, each share becomes worth more assets. Shares are ERC-20 tokens — they live at the vault address itself.
- **Share price**: how many assets one share is worth right now. Starts at 1:1 and grows over time.

```
Deposit 100 USDC  →  receive 100 shares  (at launch, price = 1)
Wait 1 year       →  share price = 1.05
Redeem 100 shares →  receive 105 USDC
```

> Vault shares use more decimals than the underlying token. A vault over USDC (6 decimals) will typically have 8 decimals for shares. Always read `vault.decimals()` — never hardcode it.

### Hub and spoke

MoreVaults uses a **hub-and-spoke** model for cross-chain yield:

- **Hub** (`isHub = true`): the chain where the vault does its accounting — mints/burns shares, accepts deposits and redemptions. All SDK flows target the hub.
- **Spoke**: a position on another chain (Arbitrum, Base, Ethereum, etc.) where the vault has deployed funds for yield. Users on spoke chains bridge tokens to the hub via LayerZero OFT.

If a vault has `isHub = false`, it is a single-chain vault — no cross-chain flows apply, use D1/R1.

### Vault modes

A vault is always in one of these modes. Use `getVaultStatus()` to read it:

| Mode | `isHub` | Oracle | What it means | Which flows |
|------|---------|--------|---------------|-------------|
| `local` | false | — | Single-chain vault. No cross-chain. | D1, D2, R1, R2 |
| `cross-chain-oracle` | true | ON | Hub with cross-chain positions. Oracle feeds aggregate spoke balances synchronously. From the user's perspective, identical to local. | D1/D3, D2, R1, R2 |
| `cross-chain-async` | true | OFF | Hub where spoke balances are NOT available synchronously. Every deposit/redeem triggers a LayerZero Read to query spokes before the vault can calculate share prices. Slower, requires a keeper. | D4, D5, R5 |
| `paused` | — | — | No deposits or redeems accepted. | None |
| `full` | — | — | Deposit capacity reached. Redeems still work. | R1, R2 only |

### Oracle ON vs OFF

When `oraclesCrossChainAccounting = true`, the vault has a configured oracle feed that knows the current value of funds deployed to spoke chains. `totalAssets()` resolves instantly in the same block — flows are synchronous (D1/R1).

When it's `false`, the vault must query the spokes via **LayerZero Read** to get accurate accounting. This takes 1–5 minutes for a round-trip. Deposits and redeems are **async** — the user locks funds, waits for the oracle response, and a keeper finalizes.

### Hub liquidity and repatriation

In a cross-chain vault, the hub typically holds only a **small fraction of TVL as liquid assets**. The rest is deployed to spoke chains where it earns yield — locked in positions on Morpho, Aave, or other protocols.

This means:

- **`totalAssets()`** = hub liquid balance + value of all spoke positions (reported by oracle or LZ Read).
- **Redeemable now** = hub liquid balance only. If a user tries to redeem more than the hub holds, the call fails.
- For async redeems (R5), a failed `executeRequest` causes the vault to **auto-refund shares** back to the user — no assets are lost, but the redeem did not complete.

**Repatriation** is the process of moving funds from spokes back to the hub so they become liquid again. This is a **manual, curator-only operation** (`executeBridging`). There is no automatic mechanism — the protocol does not pull funds from spokes on behalf of users.

### Withdrawal queue and timelock

Some vaults require shares to be "queued" before redemption:

- **`withdrawalQueueEnabled = true`**: users must call `requestRedeem` first, then `redeemShares` separately.
- **`withdrawalTimelockSeconds > 0`**: there is a mandatory waiting period between `requestRedeem` and `redeemShares`. Useful for vaults that need time to rebalance liquidity.

If neither is set, `redeemShares` works in a single call.

### Escrow

The `MoreVaultsEscrow` is a contract that temporarily holds user funds during async flows (D4, D5, R5). When a user calls `depositAsync`, their tokens go to the escrow — not the vault — while the LayerZero Read resolves. After the keeper finalizes, the escrow releases the funds to the vault.

**You never interact with the escrow directly.** The SDK handles the approve-to-escrow step internally. You just need to pass its address in `VaultAddresses.escrow`.

To get the escrow address: read it from the vault itself:
```ts
const status = await getVaultStatus(publicClient, VAULT_ADDRESS)
const escrow = status.escrow // address(0) if not configured
```

### Same address on every chain (CREATE3)

MoreVaults deploys all contracts using **CREATE3**, which means a vault has the **same address on every chain** where it exists. If the hub vault on Base is `0xABC...`, the corresponding escrow and spoke-side contracts are also at predictable, identical addresses across Arbitrum, Ethereum, etc.

### VaultAddresses

Every flow function takes a `VaultAddresses` object:

```ts
interface VaultAddresses {
  vault: Address      // Vault address — same on every chain (CREATE3)
  escrow?: Address    // MoreVaultsEscrow — required for D4, D5, R5 (auto-resolved if omitted)
  hubChainId?: number // Optional chain validation
}
```

For simple hub flows (D1, R1) you only need `vault`. For async flows the SDK auto-resolves the escrow from the vault if not provided.

### LayerZero EID

LayerZero identifies chains by an **Endpoint ID (EID)** — different from the chain's actual chain ID. You need the EID when calling cross-chain flows (D6/D7, R6):

| Chain | Chain ID | LayerZero EID |
|-------|----------|---------------|
| Ethereum | 1 | 30101 |
| Arbitrum | 42161 | 30110 |
| Base | 8453 | 30184 |
| Flow EVM | 747 | 30336 |

### GUID (async request ID)

When you call `depositAsync`, `mintAsync`, or `redeemAsync`, the function returns a `guid` — a `bytes32` identifier for that specific cross-chain request. Use it to track status:

```ts
const { guid } = await depositAsync(...)

// Option 1: Wait for finalization (recommended)
const final = await waitForAsyncRequest(publicClient, vault, guid)
// final.status: 'completed' | 'refunded'
// final.result: exact shares minted or assets received (bigint)

// Option 2: Check status once
const info = await getAsyncRequestStatusLabel(publicClient, vault, guid)
// info.label: 'pending' | 'fulfilled' | 'finalized' | 'refunded'
```

---

## Clients

Every SDK function takes one or two "clients" as its first arguments — the objects that talk to the blockchain.

**viem** uses two separate objects:

| Client | Role | How to create |
|--------|------|--------------|
| `publicClient` | Read-only — calls `eth_call`, reads state, simulates txs. No wallet needed. | `createPublicClient({ chain, transport: http(RPC_URL) })` |
| `walletClient` | Signs and sends transactions. Needs a connected account. | `createWalletClient({ account, chain, transport: http(RPC_URL) })` |

In React with wagmi:
```ts
import { usePublicClient, useWalletClient } from 'wagmi'
const publicClient = usePublicClient()
const { data: walletClient } = useWalletClient()
```

**ethers.js** uses a single `Signer` for both reading and signing:

| How to get it | When to use |
|---------------|-------------|
| `new BrowserProvider(window.ethereum).getSigner()` | Browser — MetaMask or any injected wallet |
| `new Wallet(PRIVATE_KEY, new JsonRpcProvider(RPC_URL))` | Node.js — scripts, bots, backends |

> The client's chain must match the chain where the vault lives. Hub flows → the hub chain. Spoke deposit/redeem (D6/D7/R6) → the spoke chain.

---

## Quick start — Smart flows (recommended)

The simplest way to use the SDK. `smartDeposit` and `smartRedeem` auto-detect the vault type and use the correct flow.

### viem / wagmi

```ts
import { smartDeposit, smartRedeem, waitForAsyncRequest, getVaultStatus, LZ_TIMEOUTS } from '@oydual31/more-vaults-sdk/viem'
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'
import { base } from 'viem/chains'

const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) })

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6'

// --- Deposit ---
const depositResult = await smartDeposit(
  walletClient, publicClient,
  { vault: VAULT },
  parseUnits('100', 6), // 100 USDC
  account.address,
)

// Check if async (LZ Read callback needed)
if ('guid' in depositResult) {
  console.log('Async deposit — waiting for LZ callback (~5 min)')
  console.log('GUID:', depositResult.guid)

  // Wait for finalization by GUID — returns exact shares minted
  const final = await waitForAsyncRequest(publicClient, VAULT, depositResult.guid)
  // final.status: 'completed' | 'refunded'
  // final.result: shares minted (bigint)
  console.log('Shares minted:', final.result)
} else {
  console.log('Sync deposit — shares:', depositResult.shares)
}

// --- Redeem ---
const redeemResult = await smartRedeem(
  walletClient, publicClient,
  { vault: VAULT },
  shares,
  account.address,
  account.address,
)

if ('guid' in redeemResult) {
  console.log('Async redeem — waiting for LZ callback (~5 min)')

  const final = await waitForAsyncRequest(publicClient, VAULT, redeemResult.guid)
  console.log('Assets received:', final.result)
} else {
  console.log('Sync redeem — assets:', redeemResult.assets)
}
```

---

## Flows

### Smart flows (auto-detection)

| Function | Description |
|----------|-------------|
| `smartDeposit` | Auto-detects vault mode → `depositSimple` (sync) or `depositAsync` (async) |
| `smartRedeem` | Auto-detects vault mode → `redeemShares` (sync) or `redeemAsync` (async) |

### Hub-chain deposit

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| — | `smartDeposit` | **Recommended.** Auto-detects vault type. | — |
| D1 | `depositSimple` | User on hub chain, oracle ON or local vault | [->](./docs/flows/D1-deposit-simple.md) |
| D2 | `depositMultiAsset` | Deposit multiple tokens in one call | [->](./docs/flows/D2-deposit-multi-asset.md) |
| D3 | `depositCrossChainOracleOn` | Alias for D1 — hub with oracle ON | [->](./docs/flows/D3-deposit-oracle-on.md) |
| D4 | `depositAsync` | Hub with oracle OFF — async LZ Read | [->](./docs/flows/D4-deposit-async.md) |
| D5 | `mintAsync` | Same as D4 but user specifies exact share amount | [->](./docs/flows/D5-mint-async.md) |

### Cross-chain deposit (spoke -> hub)

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| D6/D7 | `depositFromSpoke` | User on spoke chain — tokens bridge via LZ OFT | [->](./docs/flows/D6-D7-deposit-from-spoke.md) |

For Stargate OFTs (stgUSDC, USDT, WETH), `depositFromSpoke` returns `composeData` — the user must execute a 2nd TX on the hub via `waitForCompose` + `executeCompose`. For standard OFTs, compose auto-executes in 1 TX.

### Hub-chain redeem

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| — | `smartRedeem` | **Recommended.** Auto-detects vault type. | — |
| R1 | `redeemShares` | Standard redeem, hub chain, no queue | [->](./docs/flows/R1-redeem-shares.md) |
| R2 | `withdrawAssets` | Specify exact asset amount to receive | [->](./docs/flows/R2-withdraw-assets.md) |
| R3 | `requestRedeem` | Withdrawal queue enabled, no timelock | [->](./docs/flows/R3-R4-request-redeem.md) |
| R4 | `requestRedeem` | Withdrawal queue + mandatory wait period | [->](./docs/flows/R3-R4-request-redeem.md) |
| R5 | `redeemAsync` | Hub with oracle OFF — async LZ Read | [->](./docs/flows/R5-redeem-async.md) |

### Cross-chain redeem (spoke -> hub -> spoke)

Full spoke redeem is a 3-step flow across two chains:

```
Step 1 (Spoke):  bridgeSharesToHub()       — shares spoke->hub via SHARE_OFT (~7 min)
Step 2 (Hub):    smartRedeem()             — redeem on hub (auto-detects async, ~5 min callback)
Step 3 (Hub):    bridgeAssetsToSpoke()     — assets hub->spoke via Stargate/OFT (~13 min)
```

| Function | Step | Doc |
|----------|------|-----|
| `resolveRedeemAddresses` | Pre-step: discover all addresses dynamically | — |
| `preflightSpokeRedeem` | Pre-step: validate balances + gas on both chains | — |
| `bridgeSharesToHub` | Step 1: bridge shares spoke->hub | [->](./docs/flows/R6-bridge-shares-to-hub.md) |
| `smartRedeem` | Step 2: redeem on hub | — |
| `bridgeAssetsToSpoke` | Step 3: bridge assets hub->spoke | [->](./docs/flows/R7-bridge-assets-to-spoke.md) |

### Compose helpers (Stargate 2-TX flow)

| Function | Description |
|----------|-------------|
| `waitForCompose` | Wait for pending compose in LZ Endpoint's composeQueue |
| `quoteComposeFee` | Quote ETH needed for `executeCompose` (readFee + shareSendFee) |
| `executeCompose` | Execute pending compose on hub chain. Returns `{ txHash, guid? }` — GUID present for async vaults |
| `waitForAsyncRequest` | Poll async request by GUID until finalized. Returns `{ status, result }` with exact amounts |

### User helpers (read-only, no gas)

Full reference: [docs/user-helpers.md](./docs/user-helpers.md)

| Function | What it returns |
|----------|----------------|
| `getUserPosition` | shares, asset value, share price, pending withdrawal (single chain) |
| `getUserPositionMultiChain` | shares across hub + all spokes, total shares, estimated assets |
| `previewDeposit` | estimated shares for a given asset amount |
| `previewRedeem` | estimated assets for a given share amount |
| `canDeposit` | `{ allowed, reason }` — paused / cap-full / ok |
| `getVaultMetadata` | name, symbol, decimals, underlying, TVL, capacity |
| `getVaultStatus` | full config snapshot + recommended flow + issues list |
| `quoteLzFee` | native fee required for D4, D5, R5 |
| `getAsyncRequestStatusLabel` | pending / ready-to-execute / completed / refunded |
| `getUserBalances` | shares + underlying balance in one call |
| `getMaxWithdrawable` | max assets redeemable given hub liquidity |
| `getVaultSummary` | metadata + status + user position combined |

### Spoke route discovery

| Function | Description |
|----------|-------------|
| `getInboundRoutes` | All routes a user can deposit from (which chains/tokens) |
| `getUserBalancesForRoutes` | User balances for all inbound routes |
| `getOutboundRoutes` | All routes for spoke redeem (which chains to bridge back to) |
| `quoteRouteDepositFee` | LZ fee for a specific inbound route |
| `resolveRedeemAddresses` | Discover SHARE_OFT, asset OFT, spoke asset for a redeem route |

### Curator operations (vault manager)

Full reference: [docs/curator-operations.md](./docs/curator-operations.md)

| Function | Description |
|----------|-------------|
| `getCuratorVaultStatus` | Full status snapshot: curator address, timelock, slippage, nonce, available assets, LZ adapter |
| `getPendingActions` | Pending actions for a given nonce, with `isExecutable` flag (timelock check) |
| `isCurator` | Check if an address is the vault's curator |

```ts
import { getCuratorVaultStatus, isCurator } from '@oydual31/more-vaults-sdk/viem'

const status = await getCuratorVaultStatus(publicClient, VAULT)
// status.curator         — curator address
// status.timeLockPeriod  — seconds (0 = immediate execution)
// status.currentNonce    — latest action nonce
// status.availableAssets — whitelisted tokens
// status.lzAdapter       — cross-chain accounting manager
// status.paused          — vault paused state

const isManager = await isCurator(publicClient, VAULT, myAddress)
```

### Topology & distribution

| Function | Description |
|----------|-------------|
| `discoverVaultTopology` | Auto-discover hub/spoke topology across all chains (no wallet needed) |
| `getVaultTopology` | Hub/spoke chain IDs, OFT routes, composer addresses (requires correct chain client) |
| `getFullVaultTopology` | Topology + all on-chain config |
| `getVaultDistribution` | TVL breakdown across hub + all spokes |
| `isOnHubChain` | Check if user is on the hub chain |

---

## LZ Timeouts (for UI integration)

```ts
import { LZ_TIMEOUTS } from '@oydual31/more-vaults-sdk/viem'

LZ_TIMEOUTS.POLL_INTERVAL      // 30s — interval between balance polls
LZ_TIMEOUTS.OFT_BRIDGE         // 15 min — standard OFT bridge (shares or assets)
LZ_TIMEOUTS.STARGATE_BRIDGE    // 30 min — Stargate bridge (slower, pool mechanics)
LZ_TIMEOUTS.LZ_READ_CALLBACK   // 15 min — async deposit/redeem LZ Read callback
LZ_TIMEOUTS.COMPOSE_DELIVERY   // 45 min — compose delivery to hub (spoke deposit)
LZ_TIMEOUTS.FULL_SPOKE_REDEEM  // 60 min — full spoke->hub->spoke redeem
```

Use these as timeout values in UI progress indicators. Do NOT timeout before these values — cross-chain operations can legitimately take this long.

---

## Pre-flight validation

Run pre-flight checks before submitting transactions to catch issues early:

```ts
import { preflightSpokeDeposit, preflightSpokeRedeem } from '@oydual31/more-vaults-sdk/viem'

// Before spoke deposit
const check = await preflightSpokeDeposit(...)
// Validates: spoke balance, gas, hub composer setup

// Before spoke redeem
const check = await preflightSpokeRedeem(route, shares, userAddress, shareBridgeFee)
// Validates: shares on spoke, spoke gas (LZ fee + buffer), hub gas (asset bridge fee)
// Returns: estimatedAssetBridgeFee, hubLiquidBalance, etc.
```

---

## Repo structure

```
more-vaults-sdk/
├── src/
│   ├── viem/     <- viem/wagmi SDK
│   ├── ethers/   <- ethers.js v6 SDK
│   └── react/    <- React hooks (wagmi)
├── docs/
│   ├── flows/    <- one .md per flow with detailed examples
│   ├── user-helpers.md
│   └── testing.md
├── scripts/      <- E2E test scripts (mainnet)
└── tests/        <- integration tests (require Foundry + Anvil)
```

Integration tests: [docs/testing.md](./docs/testing.md) — `bash tests/run.sh` runs all 43 tests.
