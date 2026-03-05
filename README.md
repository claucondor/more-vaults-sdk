# @more-vaults/sdk

TypeScript SDK for the MoreVaults protocol. Supports **viem/wagmi** and **ethers.js v6**.

## Install

```bash
npm install
```

## Clients: publicClient vs walletClient

Every SDK function takes one or two "clients" as its first arguments. These are the objects that talk to the blockchain.

**viem** splits this into two separate objects:

| Client | What it does | How to create it |
|--------|-------------|-----------------|
| `publicClient` | Read-only. Calls `eth_call`, reads balances, simulates transactions. No wallet needed. | `createPublicClient({ chain, transport: http(RPC_URL) })` |
| `walletClient` | Signs and sends transactions. Needs a connected account (MetaMask, private key, etc). | `createWalletClient({ account, chain, transport: http(RPC_URL) })` |

In a React/wagmi app you get both from hooks:
```ts
import { usePublicClient, useWalletClient } from 'wagmi'
const publicClient = usePublicClient()
const { data: walletClient } = useWalletClient()
```

**ethers.js** uses a single `Signer` object that can both read and sign. The SDK's ethers version always takes a `Signer` (never a bare `Provider`):

| Object | What it does | How to get it |
|--------|-------------|---------------|
| `Signer` (browser) | Connected MetaMask or other wallet | `new BrowserProvider(window.ethereum).getSigner()` |
| `Signer` (Node.js) | Private key wallet for scripts/bots | `new Wallet(PRIVATE_KEY, new JsonRpcProvider(RPC_URL))` |

Read-only helpers (`getUserPosition`, `previewDeposit`, etc.) take a `Provider` in the ethers version — you can pass the provider directly without needing a wallet.

> In all flow docs, `publicClient` = read-only viem client, `walletClient` = signing viem client, `signer` = ethers Signer. The chain they point to must match the chain where the vault lives (Flow EVM for hub flows, spoke chain for D6/D7/R6).

## Quick start

### viem / wagmi

```ts
import { depositSimple, redeemShares, getUserPosition, getVaultStatus } from './src/viem/index.js'
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'

const publicClient = createPublicClient({ chain: flowEvm, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: flowEvm, transport: http(RPC_URL) })

const addresses = { vault: '0x...', escrow: '0x...' }

// Check which flow to use
const status = await getVaultStatus(publicClient, addresses.vault)
// status.recommendedDepositFlow → 'depositSimple' | 'depositAsync' | 'none'

// Deposit
const { txHash, shares } = await depositSimple(walletClient, publicClient, addresses, parseUnits('100', 6), account.address)

// Read user position
const position = await getUserPosition(publicClient, addresses.vault, account.address)
```

### ethers.js

```ts
import { depositSimple, getUserPosition } from './src/ethers/index.js'
import { BrowserProvider } from 'ethers'  // or JsonRpcProvider for Node.js

const provider = new BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

const { txHash, shares } = await depositSimple(signer, { vault: '0x...', escrow: '0x...' }, parseUnits('100', 6), signer.address)
```

## Flows

### Deposit

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| D1 | `depositSimple` | User on hub (Flow EVM), oracle ON or local vault | [D1](./docs/flows/D1-deposit-simple.md) |
| D2 | `depositMultiAsset` | Deposit multiple tokens in one call | [D2](./docs/flows/D2-deposit-multi-asset.md) |
| D3 | `depositCrossChainOracleOn` | Alias for D1 — hub with oracle ON, hub chain only | [D3](./docs/flows/D3-deposit-oracle-on.md) |
| D4 | `depositAsync` | Hub with oracle OFF — async LZ Read flow | [D4](./docs/flows/D4-deposit-async.md) |
| D5 | `mintAsync` | Same as D4 but specify exact shares | [D5](./docs/flows/D5-mint-async.md) |
| D6/D7 | `depositFromSpoke` | User on another chain — bridge via LZ OFT | [D6/D7](./docs/flows/D6-D7-deposit-from-spoke.md) |

### Redeem

| ID | Function | When to use | Doc |
|----|----------|-------------|-----|
| R1 | `redeemShares` | Standard ERC-4626 redeem, hub chain | [R1](./docs/flows/R1-redeem-shares.md) |
| R2 | `withdrawAssets` | Specify exact asset amount instead of shares | [R2](./docs/flows/R2-withdraw-assets.md) |
| R3 | `requestRedeem` | Withdrawal queue, no timelock | [R3/R4](./docs/flows/R3-R4-request-redeem.md) |
| R4 | `requestRedeem` | Withdrawal queue + timelock | [R3/R4](./docs/flows/R3-R4-request-redeem.md) |
| R5 | `redeemAsync` | Hub with oracle OFF — async LZ Read flow | [R5](./docs/flows/R5-redeem-async.md) |
| R6 | `bridgeSharesToHub` | Bridge shares from spoke to hub (step 1 of spoke redeem) | [R6](./docs/flows/R6-bridge-shares-to-hub.md) |

### User helpers (read-only)

Full reference: [docs/user-helpers.md](./docs/user-helpers.md)

| Function | Returns |
|----------|---------|
| `getUserPosition` | shares, estimatedAssets, sharePrice, pendingWithdrawal |
| `previewDeposit` | estimated shares for a given asset amount |
| `previewRedeem` | estimated assets for a given share amount |
| `canDeposit` | `{ allowed, reason }` — paused / cap / whitelist check |
| `getVaultMetadata` | name, symbol, decimals, underlying, TVL, capacity, mode |
| `getVaultStatus` | full config snapshot + `recommendedDepositFlow` / `recommendedRedeemFlow` |
| `quoteLzFee` | LZ Read fee for async flows (D4, D5, R5) |
| `getAsyncRequestStatusLabel` | pending / fulfilled / finalized / refunded |

## Repo structure

```
more-vaults-sdk/
├── src/
│   ├── viem/     ← viem/wagmi SDK
│   └── ethers/   ← ethers.js v6 SDK
├── docs/
│   ├── flows/    ← one .md per flow with code examples
│   ├── user-helpers.md
│   └── testing.md
├── tests/        ← integration tests (require Foundry + Anvil)
└── contracts/    ← protocol Solidity source + mocks (for running tests)
```

## Integration tests

See [docs/testing.md](./docs/testing.md) for full setup and run instructions.

```bash
bash tests/run.sh  # runs all 43 tests
```
