# R2 — withdrawAssets

ERC-4626 withdrawal specifying the **exact asset amount** to receive. The vault calculates how many shares to burn and returns exactly `assets` of underlying.

## When to use

Same conditions as [R1 — redeemShares](./R1-redeem-shares.md), but when the user knows the exact dollar/token amount they want to receive rather than the shares to burn.

## R1 vs R2

| | R1 `redeemShares` | R2 `withdrawAssets` |
|--|--|--|
| User specifies | shares to burn | assets to receive |
| Shares burned | returned in result | calculated by vault |
| Use when | user knows their share balance | user wants a specific asset amount |

Both call the same ERC-4626 `withdraw` and `redeem` functions under the hood.

## What happens on-chain

1. **Simulate**: calls `vault.withdraw(assets, receiver, owner)` to calculate shares burned and validate.
2. **Send**: submits the transaction. The vault calculates `sharesToBurn = previewWithdraw(assets)`, burns them, and sends exactly `assets` to `receiver`.

## Transactions the user signs

| # | What | Gas |
|---|------|-----|
| 1 | `vault.withdraw(assets, receiver, owner)` | ~100–180k |

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Vault diamond proxy address |
| `assets` | `bigint` | Exact amount of underlying assets to withdraw |
| `receiver` | `Address` | Address that receives the assets |
| `owner` | `Address` | Owner of the shares being burned |

## Returns

```ts
{ txHash: Hash, assets: bigint }
```

(The `assets` in the return is the same value you passed in — it confirms the tx went through.)

## Usage

### viem

```ts
import { withdrawAssets } from '../../src/viem/index.js'
import { parseUnits } from 'viem'

// Withdraw exactly 100 USDC
const { txHash, assets } = await withdrawAssets(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  parseUnits('100', 6),
  account.address,
  account.address,
)
```

### ethers.js

```ts
import { withdrawAssets } from '../../src/ethers/index.js'
import { parseUnits } from 'ethers'

const { txHash } = await withdrawAssets(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  parseUnits('100', 6),
  signer.address,
  signer.address,
)
```

## See also

- [R1 — redeemShares](./R1-redeem-shares.md)
- [R3/R4 — requestRedeem](./R3-R4-request-redeem.md)
