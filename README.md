# @more-vaults/sdk

TypeScript SDK for the MoreVaults protocol. Supports both **viem/wagmi** and **ethers.js v6**.

## Structure

```
more-vaults-sdk/
├── src/
│   ├── viem/     ← viem/wagmi SDK
│   └── ethers/   ← ethers.js v6 SDK
├── tests/        ← integration tests (require Foundry + Anvil)
│   ├── test-flows.ts
│   ├── test-ethers-flows.ts
│   ├── test-user-helpers.ts
│   ├── test-ethers-user-helpers.ts
│   └── run.sh
└── contracts/    ← Solidity source + mocks for running tests
    ├── src/      ← protocol contracts
    ├── test/
    │   ├── mocks/
    │   └── e2e/
    └── scripts/  ← DeployLocalE2E.s.sol
```

## Install

```bash
npm install
```

## Usage (viem)

```typescript
import { depositSimple, redeemShares, getUserPosition } from './src/viem/index.js'
import { createPublicClient, createWalletClient, http } from 'viem'

const publicClient = createPublicClient({ chain: flowEvm, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: flowEvm, transport: http(RPC_URL) })

const addresses = {
  vault: '0x...hub vault address...',
  escrow: '0x...escrow address...',
}

// Deposit
await depositSimple(walletClient, publicClient, addresses, parseUnits('100', 6), account.address)

// Read position
const position = await getUserPosition(publicClient, addresses.vault, account.address)
```

## Usage (ethers.js)

```typescript
import { depositSimple, getUserPosition } from './src/ethers/index.js'
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers'

const provider = new JsonRpcProvider(RPC_URL)
const signer = new Wallet(PRIVATE_KEY, provider)

const addresses = { vault: '0x...', escrow: '0x...' }

await depositSimple(signer, addresses, parseUnits('100', 6), signer.address)
```

## Cross-chain: spoke → hub (Flow EVM)

```typescript
import { depositFromSpoke } from './src/viem/index.js'

// walletClient on the SPOKE chain (e.g. Arbitrum)
await depositFromSpoke(
  spokeWalletClient,
  spokePublicClient,
  USDC_OFT_ON_SPOKE,   // OFT address on spoke
  30332,               // Flow EVM LayerZero EID
  HUB_VAULT_ADDRESS,
  parseUnits('100', 6),
  account.address,
  lzFee,               // quote via OFT.quoteSend()
)
```

## Running integration tests

The tests require Foundry (forge + anvil) and the Solidity dependencies.

### 1. Install Solidity dependencies

```bash
cd contracts
git init
git submodule update --init --recursive
# or install manually:
forge install foundry-rs/forge-std
forge install openzeppelin/openzeppelin-contracts
forge install openzeppelin/openzeppelin-contracts-upgradeable
forge install vectorized/solady
forge install LayerZero-Labs/LayerZero-v2
forge install layerzero-labs/devtools
forge install uniswap/v2-periphery
forge install GNSPS/solidity-bytes-utils
```

### 2. Run all tests

```bash
bash tests/run.sh
```

This will:
1. Start Anvil
2. Build and deploy all contracts
3. Run all 4 TypeScript test suites (43 tests)
4. Stop Anvil

## Flows reference

### Deposit flows

| ID | Function | When to use | Chain | Txs | Result |
|----|----------|-------------|-------|-----|--------|
| D1 | `depositSimple` | User is on the hub chain (Flow EVM). Oracle accounting is ON or vault is local. Standard ERC-4626. | Hub | approve + deposit | Shares minted immediately |
| D2 | `depositMultiAsset` | User wants to deposit multiple tokens in one call. Hub only. | Hub | approve × N + deposit | Shares minted immediately |
| D3 | `depositCrossChainOracleOn` | Hub vault has cross-chain positions but oracle is ON — totalAssets resolves synchronously. Same UX as D1. | Hub | approve + deposit | Shares minted immediately |
| D4 | `depositAsync` | Oracle is OFF. Hub cannot resolve totalAssets synchronously. Uses ERC-7540 async flow. | Hub | approve + requestDeposit | Shares arrive after a LayerZero Read round-trip (~1-5 min) |
| D5 | `mintAsync` | Same as D4 but user specifies exact shares to mint instead of assets to deposit. | Hub | approve + requestMint | Shares arrive after LZ Read round-trip |
| D6 | `depositFromSpoke` | User is on a spoke chain (e.g. Arbitrum, Base). Oracle is ON. | Spoke | approve + OFT.send | Shares arrive on spoke after LZ delivery (~1-5 min) |
| D7 | `depositFromSpoke` | User is on a spoke chain. Oracle is OFF. Same function as D6 — composer handles the difference. | Spoke | approve + OFT.send | Shares arrive on spoke after 2 LZ messages (~5-10 min) |

### Redeem flows

| ID | Function | When to use | Chain | Txs | Result |
|----|----------|-------------|-------|-----|--------|
| R1 | `redeemShares` | Standard ERC-4626 redeem. Vault has enough liquid assets. | Hub | approve + redeem | Assets transferred immediately |
| R2 | `withdrawAssets` | User specifies exact asset amount to withdraw instead of shares to burn. | Hub | approve + withdraw | Assets transferred immediately |
| R3 | `requestRedeem` | Vault uses async redeem (ERC-7540). No timelock configured. | Hub | approve + requestRedeem | Must call `redeemAsync` after fulfillment |
| R4 | `requestRedeem` | Same as R3 but vault has a withdrawal timelock. Must wait before finalizing. | Hub | approve + requestRedeem | Must wait timelock period, then call `redeemAsync` |
| R5 | `redeemAsync` | Finalize a previously submitted async redeem request (R3/R4) after it is fulfilled. | Hub | redeemAsync | Assets transferred |

### User helpers (read-only)

| Function | Description |
|----------|-------------|
| `getUserPosition` | Returns user shares, share value in assets, and underlying asset address |
| `previewDeposit` | Simulates how many shares a given asset amount would mint |
| `previewRedeem` | Simulates how many assets a given share amount would return |
| `canDeposit` | Returns whether a user can deposit and the reason if blocked (cap, whitelist, paused) |
| `getVaultMetadata` | Returns vault name, symbol, decimals, asset, capacity, and current mode |
| `getAsyncRequestStatusLabel` | Human-readable label for an async request state (pending / fulfilled / finalized / refunded) |
