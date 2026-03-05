# D4 — depositAsync

Async deposit for cross-chain hub vaults when oracle accounting is **OFF**. The vault cannot resolve `totalAssets` synchronously, so the deposit is split into two phases: the user locks assets, then a keeper finalizes after a LayerZero Read round-trip resolves the cross-chain accounting.

## When to use

- The vault is a **hub** (cross-chain vault)
- `oraclesCrossChainAccounting = false`
- `status.recommendedDepositFlow === 'depositAsync'`

```ts
const status = await getVaultStatus(publicClient, vault)
// status.mode === 'cross-chain-async'
// status.recommendedDepositFlow === 'depositAsync'
```

## What happens on-chain

```
User                    Hub Vault              LayerZero              Keeper
 |                          |                      |                     |
 |-- approve(escrow) ------>|                      |                     |
 |-- initVaultActionRequest(DEPOSIT, calldata) --->|                     |
 |                          |-- LZ Read request -->|                     |
 |                          |                      |-- query spokes ---->|
 |                          |<-- LZ callback ------| (1-5 min)           |
 |                          |-- executeRequest() <-----------------------|
 |                          |   (mints shares to receiver)               |
```

1. **Pre-flight**: validates CCManager is set, escrow is set, vault is hub, oracle is OFF, vault is not paused. Throws early with descriptive errors.
2. **Approve escrow** (not the vault!): underlying tokens go to the **escrow** contract, not the vault directly.
3. **`initVaultActionRequest(DEPOSIT, calldata, 0, extraOptions)`**: encodes `(assets, receiver)` as calldata and submits. Returns a `guid` for tracking.
4. **LZ Read round-trip** (~1–5 min): LayerZero queries the spoke chains to aggregate cross-chain balances.
5. **`executeRequest(guid)`** (called by keeper): finalizes accounting, mints shares to `receiver`.

> The user only signs steps 2 and 3. Steps 4 and 5 are automated.

## Transactions the user signs

| # | What | To | Gas |
|---|------|----|-----|
| 1 | `ERC20.approve(escrow, assets)` | Escrow address | ~46k (skipped if ok) |
| 2 | `vault.initVaultActionRequest(DEPOSIT, calldata, 0, extraOptions)` + msg.value = lzFee | Vault | ~200–350k |

**Important**: the LZ fee (`lzFee`) must be sent as `msg.value`. Quote it first with `quoteLzFee`.

## Tracking the request

After the tx, you get a `guid`. Use it to poll status:

```ts
const { fulfilled, finalized, result } = await getAsyncRequestStatus(publicClient, vault, guid)
// fulfilled = LZ callback received
// finalized = executeRequest called, shares minted
// result    = shares minted (bigint)
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Hub vault address |
| `addresses.escrow` | `Address` | MoreVaultsEscrow address (from `getVaultStatus().escrow`) |
| `assets` | `bigint` | Amount of underlying to deposit |
| `receiver` | `Address` | Address that will receive shares after resolution |
| `lzFee` | `bigint` | LZ Read fee in native token wei — quote with `quoteLzFee(publicClient, vault)` |
| `extraOptions` | `0x${string}` | Optional LZ extra options (default `'0x'`) |

## Returns

```ts
{ txHash: Hash, guid: `0x${string}` }
```

## Usage

### viem

```ts
import { depositAsync, quoteLzFee, getVaultStatus, getAsyncRequestStatus } from '@oydual31/more-vaults-sdk/viem'

const status = await getVaultStatus(publicClient, VAULT_ADDRESS)
const lzFee = await quoteLzFee(publicClient, VAULT_ADDRESS)

const { txHash, guid } = await depositAsync(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: status.escrow },
  parseUnits('100', 6),
  account.address,
  lzFee,
)

// Poll until finalized (~1-5 min)
let status2 = await getAsyncRequestStatus(publicClient, VAULT_ADDRESS, guid)
while (!status2.finalized) {
  await new Promise(r => setTimeout(r, 10_000))
  status2 = await getAsyncRequestStatus(publicClient, VAULT_ADDRESS, guid)
}
console.log('Shares minted:', status2.result)
```

### ethers.js

```ts
import { depositAsync, quoteLzFee } from '@oydual31/more-vaults-sdk/ethers'

const lzFee = await quoteLzFee(provider, VAULT_ADDRESS)

const { txHash, guid } = await depositAsync(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  parseUnits('100', 6),
  signer.address,
  lzFee,
)
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `CCManager not configured` | `getCrossChainAccountingManager() = address(0)` | Set CCManager via `setCrossChainAccountingManager()` |
| `Escrow not configured` | `getEscrow() = address(0)` | Set escrow in the MoreVaultsRegistry |
| `Vault is not a hub` | `isHub = false` | Use `depositSimple` instead |
| `Oracle accounting enabled` | `oraclesCrossChainAccounting = true` | Use `depositSimple` or `depositCrossChainOracleOn` instead |
| `Vault is paused` | `paused = true` | Wait for vault to unpause |

## See also

- [D5 — mintAsync](./D5-mint-async.md) — same flow but specify exact shares to mint
- [R5 — redeemAsync](./R5-redeem-async.md) — async redeem
- [getVaultStatus](../utils.md)
