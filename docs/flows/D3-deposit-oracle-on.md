# D3 — depositCrossChainOracleOn

Cross-chain hub deposit when oracle accounting is enabled. This is an **alias for `depositSimple`** — the function is identical, only the context differs.

## When to use

- The vault is a **hub** with cross-chain positions (funds deployed to other chains)
- `oraclesCrossChainAccounting = true` — the vault reads cross-chain balances via oracle feeds synchronously
- The user is on the **hub chain**

When oracle accounting is ON, `totalAssets()` is resolved in the same block by querying a configured oracle feed that aggregates the cross-chain positions. From the user's perspective, this is indistinguishable from a local vault.

## How it differs from D1

It doesn't. `depositCrossChainOracleOn` is exported as a named alias:

```ts
export { depositSimple as depositCrossChainOracleOn }
```

The distinction exists for documentation and readability in the front-end codebase — so a developer reading `depositCrossChainOracleOn(...)` immediately understands they are on a hub vault, not a single-chain vault.

## What happens on-chain

Identical to D1. See [D1 — depositSimple](./D1-deposit-simple.md#what-happens-on-chain).

## Usage

### viem

```ts
import { depositCrossChainOracleOn, getVaultStatus } from '../../src/viem/index.js'

// Check oracle is ON before using this flow
const status = await getVaultStatus(publicClient, VAULT_ADDRESS)
if (status.mode !== 'cross-chain-oracle') {
  throw new Error('Use depositAsync instead')
}

const { txHash, shares } = await depositCrossChainOracleOn(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  parseUnits('100', 6),
  account.address,
)
```

### ethers.js

```ts
import { depositCrossChainOracleOn } from '../../src/ethers/index.js'

const { txHash, shares } = await depositCrossChainOracleOn(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  parseUnits('100', 6),
  signer.address,
)
```

## See also

- [D1 — depositSimple](./D1-deposit-simple.md)
- [D4 — depositAsync](./D4-deposit-async.md) — use when oracle is OFF
- [getVaultStatus](../utils.md)
