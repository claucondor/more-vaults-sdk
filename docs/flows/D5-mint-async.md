# D5 — mintAsync

Async mint for cross-chain hub vaults when oracle accounting is OFF. The user specifies the **exact number of shares** to receive, and the vault burns up to `maxAssets` of underlying to mint them. Same async flow as D4 but with inverted input — shares in, assets out at resolution.

## When to use

Same conditions as [D4 — depositAsync](./D4-deposit-async.md), when the user wants to target a precise share count rather than depositing a fixed asset amount.

## D4 vs D5

| | D4 `depositAsync` | D5 `mintAsync` |
|--|--|--|
| User specifies | assets to deposit | shares to receive |
| Slippage protection | none (fixed input) | `maxAssets` cap on underlying spent |
| Approve amount | `assets` | `maxAssets` |
| Approve target | escrow | escrow |

## What happens on-chain

Identical to D4 with `ActionType.MINT` instead of `ActionType.DEPOSIT`. The calldata encodes `(shares, receiver)`. The `amountLimit` parameter is set to `maxAssets` — the contract will revert at execution time if the actual assets needed exceed this value.

```
User                    Hub Vault              LayerZero              Keeper
 |                          |                      |                     |
 |-- approve(escrow, maxAssets) ----------------->|                     |
 |-- initVaultActionRequest(MINT, calldata, maxAssets) ---------------->|
 |                          |-- LZ Read request -->|                     |
 |                          |<-- LZ callback ------| (1-5 min)           |
 |                          |-- executeRequest() <-----------------------|
 |                          |   (mints exactly `shares` to receiver,     |
 |                          |    returns excess assets if any)            |
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Hub vault address |
| `addresses.escrow` | `Address` | MoreVaultsEscrow address |
| `shares` | `bigint` | Exact number of shares to mint |
| `maxAssets` | `bigint` | Maximum underlying to spend (slippage protection) |
| `receiver` | `Address` | Address that will receive the minted shares |
| `lzFee` | `bigint` | LZ Read fee — quote with `quoteLzFee(publicClient, vault)` |
| `extraOptions` | `0x${string}` | Optional LZ extra options (default `'0x'`) |

## Returns

```ts
{ txHash: Hash, guid: `0x${string}` }
```

## Usage

### viem

```ts
import { mintAsync, quoteLzFee, previewDeposit } from '@oydual31/more-vaults-sdk/viem'

// Get a rough maxAssets estimate from previewDeposit then add slippage
const expectedAssets = await previewDeposit(publicClient, VAULT_ADDRESS, TARGET_SHARES)
const maxAssets = expectedAssets * 101n / 100n // 1% slippage tolerance

const lzFee = await quoteLzFee(publicClient, VAULT_ADDRESS)

const { txHash, guid } = await mintAsync(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  TARGET_SHARES,
  maxAssets,
  account.address,
  lzFee,
)
```

### ethers.js

```ts
import { mintAsync, quoteLzFee } from '@oydual31/more-vaults-sdk/ethers'

const lzFee = await quoteLzFee(provider, VAULT_ADDRESS)

const { txHash, guid } = await mintAsync(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  TARGET_SHARES,
  maxAssets,
  signer.address,
  lzFee,
)
```

## See also

- [D4 — depositAsync](./D4-deposit-async.md)
- [R5 — redeemAsync](./R5-redeem-async.md)
