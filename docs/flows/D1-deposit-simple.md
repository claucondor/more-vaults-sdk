# D1 — depositSimple

Standard ERC-4626 deposit for users on the hub chain when accounting resolves synchronously.

## When to use

- The user is on the **same chain as the vault** (the hub chain)
- The vault is a **single-chain vault** (not a hub), or
- The vault is a hub with **oracle accounting ON** (`oraclesCrossChainAccounting = true`)

When the oracle is ON, the vault can resolve `totalAssets` in the same block by querying cross-chain positions via an oracle feed — the user experience is identical to a local vault.

Use `getVaultStatus` to determine whether this flow applies:

```ts
const status = await getVaultStatus(publicClient, vault)
// status.recommendedDepositFlow === 'depositSimple'
// status.mode === 'local' | 'cross-chain-oracle'
```

## What happens on-chain

1. **Pre-flight check**: reads `paused` and `maxDeposit` in parallel. Throws before any tx if the vault is paused or at capacity.
2. **Resolves underlying asset**: reads `asset()` from the vault.
3. **Approve** (skipped if allowance sufficient): approves the **vault** to spend `assets` of the underlying token.
4. **Simulate + deposit**: calls `vault.deposit(assets, receiver)`. Returns shares minted.

## Transactions the user signs

| # | What | Gas |
|---|------|-----|
| 1 | `ERC20.approve(vault, assets)` | ~46k (skipped if allowance ok) |
| 2 | `vault.deposit(assets, receiver)` | ~120–200k |

## Result

Shares are minted to `receiver` in the same transaction. No waiting.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client with account attached (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Vault diamond proxy address |
| `assets` | `bigint` | Amount of underlying token in token decimals (e.g. `parseUnits('100', 6)` for 100 USDC) |
| `receiver` | `Address` | Address that receives the minted shares |

## Returns

```ts
{ txHash: Hash, shares: bigint }
```

## Usage

### viem

```ts
import { depositSimple, getVaultStatus } from '@oydual31/more-vaults-sdk/viem'
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { flowMainnet } from 'viem/chains'

const account = privateKeyToAccount(PRIVATE_KEY)
const publicClient = createPublicClient({ chain: flowMainnet, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: flowMainnet, transport: http(RPC_URL) })

const addresses = { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS }

const { txHash, shares } = await depositSimple(
  walletClient,
  publicClient,
  addresses,
  parseUnits('100', 6), // 100 USDC
  account.address,
)

console.log('Shares minted:', shares)
```

### ethers.js

```ts
import { depositSimple } from '@oydual31/more-vaults-sdk/ethers'
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers'

const provider = new JsonRpcProvider(RPC_URL)
const signer = new Wallet(PRIVATE_KEY, provider)

const { txHash, shares } = await depositSimple(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  parseUnits('100', 6),
  signer.address,
)
```

## Errors

| Error message | Cause | Fix |
|---------------|-------|-----|
| `Vault is paused` | `paused = true` | Wait for vault to unpause |
| `Vault has reached deposit capacity` | `maxDeposit = 0` | Wait for capacity to increase |
| EVM revert on simulate | Insufficient balance, wrong token, etc. | Check token balance and vault configuration |

## See also

- [D3 — depositCrossChainOracleOn](./D3-deposit-oracle-on.md) — same function, hub context
- [D4 — depositAsync](./D4-deposit-async.md) — use when oracle is OFF
- [getVaultStatus](../utils.md) — determine which flow to use
