# R3 / R4 — requestRedeem

Places shares into the vault's withdrawal queue. If a timelock is configured (R4), the user must wait before finalizing the redemption. If no timelock (R3), `redeemShares` can be called immediately after.

## R3 vs R4

| | R3 | R4 |
|--|--|--|
| Timelock | None (`withdrawalTimelockSeconds = 0`) | Configured (e.g. 24h) |
| After requestRedeem | Call `redeemShares` immediately | Wait until `timelockEndsAt`, then `redeemShares` |
| Same function? | Yes — `requestRedeem` | Yes — `requestRedeem` |

## When to use

- `withdrawalQueueEnabled = true` on the vault (check via `getVaultStatus`)
- Vault is single-chain or hub with oracle ON (sync mode)
- For async mode, use [R5 — redeemAsync](./R5-redeem-async.md) instead

## What happens on-chain

```
User                     Vault
 |                          |
 |-- requestRedeem(shares) ->|  (locks shares in queue)
 |                          |
 |  [wait timelock if R4]   |
 |                          |
 |-- redeemShares(shares) -->|  (burns shares, sends assets)
```

1. **`requestRedeem(shares, owner)`**: locks shares in the withdrawal queue. Records `timelockEndsAt = block.timestamp + withdrawalTimelockSeconds`.
2. **Wait** (R4 only): user must wait until the timelock expires. Check with `getWithdrawalRequest`.
3. **`redeemShares`**: finalize. See [R1](./R1-redeem-shares.md).

## Transactions the user signs

| # | What | Gas |
|---|------|-----|
| 1 | `vault.requestRedeem(shares, owner)` | ~80–120k |
| (wait) | — | — |
| 2 | `vault.redeem(shares, receiver, owner)` | ~100–180k |

## Parameters — requestRedeem

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | viem wallet client (hub chain) |
| `publicClient` | `PublicClient` | viem public client |
| `addresses.vault` | `Address` | Vault address |
| `shares` | `bigint` | Shares to queue for redemption |
| `owner` | `Address` | Owner of the shares (usually `account.address`) |

## Returns

```ts
{ txHash: Hash }
```

## Checking timelock status

```ts
import { getWithdrawalRequest } from '../../src/viem/index.js'

const request = await getWithdrawalRequest(publicClient, VAULT_ADDRESS, account.address)

if (request === null) {
  // No active request
} else {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const canRedeem = now >= request.timelockEndsAt
  const secondsLeft = canRedeem ? 0n : request.timelockEndsAt - now
  console.log('Queued shares:', request.shares)
  console.log('Seconds until unlock:', secondsLeft)
}
```

## Usage

### viem (script / Node.js)

```ts
import { requestRedeem, getWithdrawalRequest, redeemShares } from '../../src/viem/index.js'

// Step 1: queue
const { txHash } = await requestRedeem(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  account.address,
)

// Step 2: poll timelock (R4 only)
let request = await getWithdrawalRequest(publicClient, VAULT_ADDRESS, account.address)
while (request && BigInt(Math.floor(Date.now() / 1000)) < request.timelockEndsAt) {
  await new Promise(r => setTimeout(r, 30_000))
  request = await getWithdrawalRequest(publicClient, VAULT_ADDRESS, account.address)
}

// Step 3: finalize
const { txHash: redeemHash, assets } = await redeemShares(
  walletClient,
  publicClient,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  account.address,
  account.address,
)
```

### viem (React + wagmi)

```tsx
import { useWriteContract, useReadContract, useAccount } from 'wagmi'
import { VAULT_ABI } from '../../src/viem/abis.js'

function WithdrawPanel() {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()

  // Read timelock status
  const { data: request } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'getWithdrawalRequest',
    args: [address],
    query: { refetchInterval: 10_000 },
  })

  const queued = request?.[0] ?? 0n
  const timelockEndsAt = request?.[1] ?? 0n
  const now = BigInt(Math.floor(Date.now() / 1000))
  const canRedeem = queued > 0n && now >= timelockEndsAt

  async function handleRequest() {
    await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'requestRedeem',
      args: [shares, address],
    })
  }

  async function handleRedeem() {
    await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'redeem',
      args: [queued, address, address],
    })
  }

  return (
    <div>
      {queued === 0n && <button onClick={handleRequest}>Request Redeem</button>}
      {queued > 0n && !canRedeem && <p>Unlocks in {String(timelockEndsAt - now)}s</p>}
      {canRedeem && <button onClick={handleRedeem}>Finalize Redeem</button>}
    </div>
  )
}
```

### ethers.js (browser wallet — MetaMask)

```ts
import { BrowserProvider } from 'ethers'
import { requestRedeem, redeemShares } from '../../src/ethers/index.js'

// Connect MetaMask
const provider = new BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

// Step 1: queue
await requestRedeem(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  await signer.getAddress(),
)

// Step 2: finalize (after timelock)
await redeemShares(
  signer,
  { vault: VAULT_ADDRESS, escrow: ESCROW_ADDRESS },
  shares,
  await signer.getAddress(),
  await signer.getAddress(),
)
```

## See also

- [R1 — redeemShares](./R1-redeem-shares.md) — step 2 of this flow
- [R5 — redeemAsync](./R5-redeem-async.md) — for cross-chain async vaults
- [getVaultStatus](../utils.md) — check `withdrawalQueueEnabled` and `withdrawalTimelockSeconds`
