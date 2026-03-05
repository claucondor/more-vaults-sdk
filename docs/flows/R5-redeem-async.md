# R5 — redeemAsync

Async redemption for cross-chain hub vaults when oracle accounting is OFF. Shares are locked in the escrow, a LayerZero Read resolves accounting across spokes, and a keeper calls `executeRequest` to transfer assets to the receiver.

## When to use

- Vault is a hub with `oraclesCrossChainAccounting = false`
- `status.recommendedRedeemFlow === 'redeemAsync'`

```ts
const status = await getVaultStatus(publicClient, vault)
// status.mode === 'cross-chain-async'
// status.recommendedRedeemFlow === 'redeemAsync'
```

## What happens on-chain

```
User                     Hub Vault              LayerZero              Keeper
 |                           |                      |                     |
 |-- approve(escrow, shares)->|                      |                     |
 |-- initVaultActionRequest  |                      |                     |
 |   (REDEEM, calldata, 0) ->|                      |                     |
 |                           |-- LZ Read request -->|                     |
 |                           |                      |-- query spokes ---->|
 |                           |<-- LZ callback ------| (1-5 min)           |
 |                           |-- executeRequest() <-----------------------|
 |                           |   (burns shares, sends assets to receiver) |
```

> **Critical**: The vault share token is the vault itself (ERC-4626 shares). The `approve` targets the **escrow**, not the vault.

> **amountLimit must be 0** for REDEEM actions. Setting it to a non-zero value would activate an inverted slippage check (max assets to receive), which is almost never what you want.

## Transactions the user signs

| # | What | To | Gas |
|---|------|----|-----|
| 1 | `vault.approve(escrow, shares)` | Vault address (share token) | ~46k (skipped if ok) |
| 2 | `vault.initVaultActionRequest(REDEEM, calldata, 0, extraOptions)` + msg.value = lzFee | Vault | ~200–350k |

## Tracking

Same as D4: use the returned `guid` with `getAsyncRequestStatus`.

```ts
const { fulfilled, finalized, result } = await getAsyncRequestStatus(publicClient, vault, guid)
// result = assets received (bigint)
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client (hub chain) |
| `addresses.vault` | `Address` | Hub vault address (also the share token) |
| `addresses.escrow` | `Address` | MoreVaultsEscrow address |
| `shares` | `bigint` | Shares to redeem |
| `receiver` | `Address` | Address that receives the underlying assets |
| `owner` | `Address` | Owner of the shares (must match signer) |
| `lzFee` | `bigint` | LZ Read fee — quote with `quoteLzFee(publicClient, vault)` |
| `extraOptions` | `0x${string}` | Optional LZ extra options (default `'0x'`) |

## Returns

```ts
{ txHash: Hash, guid: `0x${string}` }
```

## Usage — from working test

The following is adapted directly from the integration test (`test-flows.ts`) which passes consistently:

### viem (Node.js / script)

```ts
import {
  redeemAsync,
  depositSimple,
  quoteLzFee,
  getAsyncRequestStatus,
  getVaultStatus,
} from '@oydual31/more-vaults-sdk/viem'
import { parseUnits } from 'viem'

// 1. Deposit first to get shares
const { shares } = await depositSimple(
  walletClient, publicClient,
  { vault: VAULT, escrow: ESCROW },
  parseUnits('200', 18),
  account.address,
)

// 2. Quote LZ fee
const lzFee = await quoteLzFee(publicClient, VAULT)

// 3. Submit async redeem
const { txHash, guid } = await redeemAsync(
  walletClient,
  publicClient,
  { vault: VAULT, escrow: ESCROW },
  shares,
  account.address, // receiver
  account.address, // owner
  lzFee,
)

// 4. Poll until finalized (~1-5 min on mainnet)
let status = await getAsyncRequestStatus(publicClient, VAULT, guid)
while (!status.finalized) {
  await new Promise(r => setTimeout(r, 10_000))
  status = await getAsyncRequestStatus(publicClient, VAULT, guid)
}

console.log('Assets received:', status.result)
```

### viem (React + wagmi)

```tsx
import { useWriteContract, useReadContract, useAccount } from 'wagmi'
import { BRIDGE_ABI, VAULT_ABI } from '@oydual31/more-vaults-sdk/viem'
import { encodeAbiParameters, parseUnits } from 'viem'
import { ActionType } from '@oydual31/more-vaults-sdk/viem'

function AsyncRedeemButton({ vault, escrow, shares, lzFee }) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()

  async function handleRedeem() {
    // Approve escrow to spend shares (vault IS the share token)
    await writeContractAsync({
      address: vault,              // vault address = share token address
      abi: VAULT_ABI,
      functionName: 'approve',
      args: [escrow, shares],
    })

    // Encode calldata: (shares, receiver, owner)
    const actionCallData = encodeAbiParameters(
      [
        { type: 'uint256', name: 'shares' },
        { type: 'address', name: 'receiver' },
        { type: 'address', name: 'owner' },
      ],
      [shares, address, address],
    )

    // Submit async redeem
    await writeContractAsync({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.REDEEM, actionCallData, 0n, '0x'],
      value: lzFee,
    })
  }

  return <button onClick={handleRedeem}>Redeem (async)</button>
}
```

### ethers.js (browser — MetaMask)

```ts
import { BrowserProvider } from 'ethers'
import { redeemAsync, quoteLzFee } from '@oydual31/more-vaults-sdk/ethers'

const provider = new BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

const lzFee = await quoteLzFee(provider, VAULT_ADDRESS)

const { txHash, guid } = await redeemAsync(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  await signer.getAddress(),
  await signer.getAddress(),
  lzFee,
)
```

### ethers.js (Node.js / private key)

```ts
import { JsonRpcProvider, Wallet } from 'ethers'
import { redeemAsync, quoteLzFee } from '@oydual31/more-vaults-sdk/ethers'

const provider = new JsonRpcProvider(RPC_URL)
const signer = new Wallet(PRIVATE_KEY, provider)

const lzFee = await quoteLzFee(provider, VAULT_ADDRESS)

const { guid } = await redeemAsync(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  signer.address,
  signer.address,
  lzFee,
)
```

## When the redeem fails — auto-refund

After the LZ Read response arrives, the keeper calls `executeRequest`, which internally calls `vault.redeem(shares, receiver, owner)`. If the hub does not hold enough liquid assets to cover the redemption, this call reverts and the vault automatically **refunds the shares** back to the user. No assets are lost, but the redeem did not complete.

**Why would the hub be short?** Cross-chain vaults deploy most of their TVL to spoke chains where the yield is generated (Morpho, Aave, etc.). The hub typically holds only a small liquidity buffer. If more users redeem than the buffer can cover, the hub runs dry.

**What to do if a redeem is refunded:**
1. Check `getAsyncRequestStatus(publicClient, vault, guid)` — `status = 'refunded'` confirms this.
2. The user's shares are back in their wallet — nothing is lost.
3. Contact the vault curator to repatriate liquidity from the spokes (`executeBridging`). This is a manual, curator-only operation.
4. Retry the redeem once the hub has sufficient liquid assets.

> Note: the withdrawal queue + timelock (R3/R4) does **not** prevent this failure — it only gates when a redeem can be submitted, not whether the hub has liquidity. The root cause is always insufficient hub-side balance at execution time.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `CCManager not configured` | `getCrossChainAccountingManager() = address(0)` | Admin must call `setCrossChainAccountingManager()` |
| `Escrow not configured` | `getEscrow() = address(0)` | Admin must set escrow in MoreVaultsRegistry |
| `Vault is not a hub` | `isHub = false` | Use `redeemShares` instead |
| `Oracle accounting enabled` | Oracle is ON | Use `redeemShares` instead |
| Request refunded | Hub had insufficient liquid assets at execution time | Wait for curator to repatriate from spokes, then retry |

## See also

- [D4 — depositAsync](./D4-deposit-async.md) — async deposit
- [R1 — redeemShares](./R1-redeem-shares.md) — sync redeem for oracle-ON or local vaults
- [R6 — bridgeSharesToHub](./R6-bridge-shares-to-hub.md) — for users on spoke chains
