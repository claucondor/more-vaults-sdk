# @oydual31/more-vaults-sdk

TypeScript SDK for the MoreVaults protocol. Supports **viem/wagmi** and **ethers.js v6**.

```bash
npm install @oydual31/more-vaults-sdk
```

```ts
// viem / wagmi
import { getVaultStatus, smartDeposit, getUserBalances } from '@oydual31/more-vaults-sdk/viem'

// ethers.js v6
import { getVaultStatus, smartDeposit, getUserBalances } from '@oydual31/more-vaults-sdk/ethers'
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

- **Hub** (`isHub = true`): the chain where the vault does its accounting — mints/burns shares, accepts deposits and redemptions. All SDK flows target the hub. Flow EVM is the current reference deployment, but any EVM chain can be the hub.
- **Spoke**: a position on another chain (Arbitrum, Base, etc.) where the vault has deployed funds for yield. Users on spoke chains bridge tokens to the hub via LayerZero OFT — they never interact with the spoke contracts directly.

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

If a redeem fails because the hub is under-funded:
1. The user's shares are returned automatically (or the tx reverts before any state change for R1).
2. The vault curator must repatriate liquidity from the spokes.
3. The user retries the redeem once sufficient liquidity is available on the hub.

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

MoreVaults deploys all contracts using **CREATE3**, which means a vault has the **same address on every chain** where it exists. If the hub vault on Flow EVM is `0xABC...`, the corresponding escrow and spoke-side contracts are also at predictable, identical addresses across Arbitrum, Base, etc.

This simplifies the frontend significantly — you don't need a separate address map per chain. One address identifies the vault everywhere.

### VaultAddresses

Every flow function takes a `VaultAddresses` object:

```ts
interface VaultAddresses {
  vault: Address      // Vault address — same on every chain (CREATE3)
  escrow: Address     // MoreVaultsEscrow — same address as vault on each chain, required for D4, D5, R5
  shareOFT?: Address  // OFTAdapter for vault shares — required for R6 (spoke redeem)
  usdcOFT?: Address   // OFT for the underlying token on the spoke — required for D6/D7
}
```

For simple hub flows (D1, R1) you only need `vault`. For async flows you also need `escrow` — get it from `getVaultStatus(publicClient, vault).escrow`. For cross-chain flows from a spoke you also need the OFT addresses for that specific spoke chain.

### LayerZero EID

LayerZero identifies chains by an **Endpoint ID (EID)** — different from the chain's actual chain ID. You need the EID when calling cross-chain flows (D6/D7, R6):

| Chain | Chain ID | LayerZero EID |
|-------|----------|---------------|
| Flow EVM | 747 | 30332 |
| Arbitrum | 42161 | 30110 |
| Base | 8453 | 30184 |
| Ethereum | 1 | 30101 |

### GUID (async request ID)

When you call `depositAsync`, `mintAsync`, or `redeemAsync`, the function returns a `guid` — a `bytes32` identifier for that specific cross-chain request. Use it to track status:

```ts
const { guid } = await depositAsync(...)

// Poll status
const info = await getAsyncRequestStatusLabel(publicClient, vault, guid)
// info.status: 'pending' | 'ready-to-execute' | 'completed' | 'refunded'
// info.result: shares minted or assets received once completed
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

Read-only helpers (`getUserPosition`, `previewDeposit`, etc.) accept a bare `Provider` in the ethers version — no signer needed.

> The client's chain must match the chain where the vault lives. Hub flows → the hub chain. Spoke deposit/redeem (D6/D7/R6) → the spoke chain.

---

## Quick start

### viem / wagmi

```ts
import { getVaultStatus, depositSimple, getUserPosition } from '@oydual31/more-vaults-sdk/viem'
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'

const publicClient = createPublicClient({ chain: flowEvm, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: flowEvm, transport: http(RPC_URL) })

// 1. Check vault status to know which flow to use
const status = await getVaultStatus(publicClient, VAULT_ADDRESS)
// status.mode → 'local' | 'cross-chain-oracle' | 'cross-chain-async' | 'paused' | 'full'
// status.recommendedDepositFlow → 'depositSimple' | 'depositAsync' | 'none'
// status.escrow → escrow address (needed for async flows)

const addresses = { vault: VAULT_ADDRESS, escrow: status.escrow }

// 2. Deposit
const { txHash, shares } = await depositSimple(
  walletClient, publicClient, addresses,
  parseUnits('100', 6), // 100 USDC
  account.address,
)

// 3. Read position
const position = await getUserPosition(publicClient, VAULT_ADDRESS, account.address)
console.log('Shares:', position.shares)
console.log('Value:', position.estimatedAssets)
```

### ethers.js

```ts
import { getVaultStatus, depositSimple, getUserPosition } from '@oydual31/more-vaults-sdk/ethers'
import { BrowserProvider, parseUnits } from 'ethers'

const provider = new BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

const status = await getVaultStatus(provider, VAULT_ADDRESS)
const addresses = { vault: VAULT_ADDRESS, escrow: status.escrow }

const { txHash, shares } = await depositSimple(
  signer, addresses,
  parseUnits('100', 6),
  await signer.getAddress(),
)
```

---

## Flows

### Deposit

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| D1 | `depositSimple` | User on hub chain, oracle ON or local vault | [→](./docs/flows/D1-deposit-simple.md) |
| D2 | `depositMultiAsset` | Deposit multiple tokens in one call | [→](./docs/flows/D2-deposit-multi-asset.md) |
| D3 | `depositCrossChainOracleOn` | Alias for D1 — hub with oracle ON, explicit naming | [→](./docs/flows/D3-deposit-oracle-on.md) |
| D4 | `depositAsync` | Hub with oracle OFF — async LZ Read, shares arrive in ~1–5 min | [→](./docs/flows/D4-deposit-async.md) |
| D5 | `mintAsync` | Same as D4 but user specifies exact share amount | [→](./docs/flows/D5-mint-async.md) |
| D6/D7 | `depositFromSpoke` | User on another chain — tokens bridge via LZ OFT | [→](./docs/flows/D6-D7-deposit-from-spoke.md) |

### Redeem

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| R1 | `redeemShares` | Standard redeem, hub chain, no queue | [→](./docs/flows/R1-redeem-shares.md) |
| R2 | `withdrawAssets` | Specify exact asset amount to receive | [→](./docs/flows/R2-withdraw-assets.md) |
| R3 | `requestRedeem` | Withdrawal queue enabled, no timelock | [→](./docs/flows/R3-R4-request-redeem.md) |
| R4 | `requestRedeem` | Withdrawal queue + mandatory wait period | [→](./docs/flows/R3-R4-request-redeem.md) |
| R5 | `redeemAsync` | Hub with oracle OFF — async LZ Read | [→](./docs/flows/R5-redeem-async.md) |
| R6 | `bridgeSharesToHub` | User on spoke — step 1: bridge shares to hub | [→](./docs/flows/R6-bridge-shares-to-hub.md) |

### User helpers (read-only, no gas)

Full reference: [docs/user-helpers.md](./docs/user-helpers.md)

| Function | What it returns |
|----------|----------------|
| `getUserPosition` | shares, asset value, share price, pending withdrawal |
| `previewDeposit` | estimated shares for a given asset amount |
| `previewRedeem` | estimated assets for a given share amount |
| `canDeposit` | `{ allowed, reason }` — paused / cap-full / ok |
| `getVaultMetadata` | name, symbol, decimals, underlying, TVL, capacity |
| `getVaultStatus` | full config snapshot + recommended flow + issues list |
| `quoteLzFee` | native fee required for D4, D5, R5 |
| `getAsyncRequestStatusLabel` | pending / ready-to-execute / completed / refunded |

---

## Repo structure

```
more-vaults-sdk/
├── src/
│   ├── viem/     ← viem/wagmi SDK
│   └── ethers/   ← ethers.js v6 SDK
├── docs/
│   ├── flows/    ← one .md per flow with detailed examples
│   ├── user-helpers.md
│   └── testing.md
├── tests/        ← integration tests (require Foundry + Anvil)
└── contracts/    ← protocol Solidity source + mocks (for running tests)
```

Integration tests: [docs/testing.md](./docs/testing.md) — `bash tests/run.sh` runs all 43 tests.
