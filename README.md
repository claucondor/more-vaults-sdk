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

## Covered flows

| ID | Flow | Library |
|----|------|---------|
| D1 | `depositSimple` — ERC-4626 deposit | viem + ethers |
| D2 | `depositMultiAsset` — multi-asset deposit | viem + ethers |
| D3 | `depositCrossChainOracleOn` — oracle ON hub deposit | viem + ethers |
| D4 | `depositAsync` — async deposit (LZ callback sim) | viem + ethers |
| D5 | `mintAsync` — async mint | viem + ethers |
| D6/D7 | `depositFromSpoke` — spoke → hub via OFT | viem + ethers |
| R1 | `redeemShares` — ERC-4626 redeem | viem + ethers |
| R2 | `withdrawAssets` — withdraw by asset amount | viem + ethers |
| R3 | `requestRedeem` — async redeem request | viem + ethers |
| R4 | `requestRedeem` + timelock | viem + ethers |
| R5 | `redeemAsync` — finalize async redeem | viem + ethers |
