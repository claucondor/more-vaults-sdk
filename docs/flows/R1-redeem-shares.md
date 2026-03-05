# R1 — redeemShares

Standard ERC-4626 redemption. Burns vault shares and returns the proportional amount of underlying assets immediately.

## When to use

- User is on the **hub chain**
- Vault has sufficient **liquid assets on the hub** to cover the redemption (spoke-deployed funds are not automatically repatriated — see [Hub liquidity and repatriation](../../README.md#hub-liquidity-and-repatriation))
- No withdrawal queue required (or queue has already been fulfilled and timelock expired)
- `status.recommendedRedeemFlow === 'redeemShares'`

## What happens on-chain

1. **Simulate**: calls `vault.redeem(shares, receiver, owner)` via `eth_call` to get the expected assets and validate the call won't revert.
2. **Send**: submits the actual transaction. Shares are burned, assets transferred to `receiver`.

No pre-flight check beyond the simulation — the simulation catches paused state, insufficient balance, and other issues.

## Withdrawal queue note

If the vault has a withdrawal queue enabled, you may need to call `requestRedeem` first and wait for the timelock to expire before calling `redeemShares`. See [R3/R4 — requestRedeem](./R3-R4-request-redeem.md).

Call `getWithdrawalRequest(publicClient, vault, owner)` to check if there's an active queued request and when the timelock expires.

## Transactions the user signs

| # | What | Gas |
|---|------|-----|
| 1 | `vault.redeem(shares, receiver, owner)` | ~100–180k |

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Vault diamond proxy address |
| `shares` | `bigint` | Amount of vault shares to burn |
| `receiver` | `Address` | Address that receives the underlying assets |
| `owner` | `Address` | Owner of the shares being burned (usually `account.address`) |

## Returns

```ts
{ txHash: Hash, assets: bigint }
```

## Usage

### viem

```ts
import { redeemShares, getUserPosition } from '@oydual31/more-vaults-sdk/viem'

// Get current share balance
const position = await getUserPosition(publicClient, VAULT_ADDRESS, account.address)

const { txHash, assets } = await redeemShares(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  position.shares,       // redeem all shares
  account.address,       // receiver
  account.address,       // owner
)

console.log('Assets received:', assets)
```

### ethers.js

```ts
import { redeemShares } from '@oydual31/more-vaults-sdk/ethers'

const { txHash, assets } = await redeemShares(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  signer.address,
  signer.address,
)
```

## See also

- [R2 — withdrawAssets](./R2-withdraw-assets.md) — specify exact assets to receive instead of shares to burn
- [R3/R4 — requestRedeem](./R3-R4-request-redeem.md) — queue shares if withdrawal queue is enabled
- [R5 — redeemAsync](./R5-redeem-async.md) — use when vault is cross-chain async mode
