# D2 — depositMultiAsset

Deposit multiple ERC-20 tokens into the vault in a single vault call. The vault converts each token to the underlying via oracle pricing and mints shares proportionally.

## When to use

- The user holds multiple tokens and wants to deposit them all in one operation
- The vault must be configured to accept those tokens (`isAssetAvailable(token) = true`)
- Hub chain only — user must be on the same chain as the vault

## What happens on-chain

1. **Approve each token** (parallel loop, skipped if allowances sufficient): approves the vault to spend each token.
2. **Simulate + deposit**: calls `vault.deposit(tokens[], amounts[], receiver, minShares)`. The vault sums the oracle value of all tokens and mints shares.

The `minShares` parameter is your slippage protection — the tx reverts if the vault would mint fewer shares than this amount.

## Transactions the user signs

| # | What | Gas |
|---|------|-----|
| 1…N | `ERC20.approve(vault, amount)` per token | ~46k each (skipped if allowance ok) |
| N+1 | `vault.deposit(tokens[], amounts[], receiver, minShares)` | ~150–300k depending on N |

## Result

Shares are minted to `receiver` in the same transaction. No waiting.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Vault diamond proxy address |
| `tokens` | `Address[]` | Array of token addresses to deposit |
| `amounts` | `bigint[]` | Amounts per token in each token's own decimals |
| `receiver` | `Address` | Address that receives the minted shares |
| `minShares` | `bigint` | Minimum acceptable shares — set to `0n` to skip slippage check, or simulate first to get the expected amount |

## Returns

```ts
{ txHash: Hash, shares: bigint }
```

## Usage

### viem

```ts
import { depositMultiAsset } from '../../src/viem/index.js'
import { parseUnits } from 'viem'

const USDC  = '0x...'
const WFLOW = '0x...'

const { txHash, shares } = await depositMultiAsset(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  [USDC, WFLOW],
  [parseUnits('100', 6), parseUnits('50', 18)],
  account.address,
  0n, // minShares — set after simulating for slippage protection
)
```

### ethers.js

```ts
import { depositMultiAsset } from '../../src/ethers/index.js'
import { parseUnits } from 'ethers'

const { txHash, shares } = await depositMultiAsset(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  [USDC, WFLOW],
  [parseUnits('100', 6), parseUnits('50', 18)],
  signer.address,
  0n,
)
```

## Errors

| Error message | Cause | Fix |
|---------------|-------|-----|
| EVM revert `SlippageExceeded` | Shares minted < `minShares` | Lower `minShares` or retry |
| EVM revert `AssetNotAvailable` | Token not whitelisted in vault | Check `isAssetAvailable(token)` |
| EVM revert `arrays length mismatch` | `tokens.length !== amounts.length` | Fix input arrays |

## See also

- [D1 — depositSimple](./D1-deposit-simple.md) — single token deposit
- [getVaultStatus](../utils.md)
