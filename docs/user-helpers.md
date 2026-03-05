# User Helpers

Read-only functions for reading vault state and user positions. All functions are pure reads — no transactions, no gas, no approvals. Safe to call at any time.

Available in both `src/viem/index.js` and `src/ethers/index.js`.

---

## getUserPosition

Returns a user's current position in a vault: share balance, estimated asset value, share price, and pending withdrawal request.

### Signature

```ts
// viem
getUserPosition(publicClient: PublicClient, vault: Address, user: Address): Promise<UserPosition>

// ethers
getUserPosition(provider: Provider, vault: Address, user: Address): Promise<UserPosition>
```

### Return type

```ts
interface UserPosition {
  shares: bigint            // vault share balance
  estimatedAssets: bigint   // shares converted to underlying (via convertToAssets)
  sharePrice: bigint        // price of 1 whole share in underlying (scaled by 10^decimals)
  underlying: Address       // underlying token address
  decimals: number          // vault share decimals
  pendingWithdrawal: {
    shares: bigint          // shares queued for redemption
    timelockEndsAt: bigint  // unix timestamp when timelock expires (0 = no timelock)
  } | null                  // null if no active withdrawal request
}
```

### Usage — from working test

```ts
// From test-user-helpers.ts — passes on mainnet-equivalent Anvil deployment
import { getUserPosition } from '../../src/viem/index.js'

const pos = await getUserPosition(publicClient, VAULT, userAccount.address)

console.log('Shares:', pos.shares)           // e.g. 50000000000000000000n (50 shares at 18 dec)
console.log('Est. assets:', pos.estimatedAssets)  // underlying value
console.log('Share price:', pos.sharePrice)
console.log('Pending:', pos.pendingWithdrawal) // null or { shares, timelockEndsAt }
```

### React + wagmi

```tsx
import { useReadContracts } from 'wagmi'
import { VAULT_ABI, CONFIG_ABI } from '../../src/viem/abis.js'

// Or just call getUserPosition directly in a useEffect/useMemo with viem publicClient
import { usePublicClient } from 'wagmi'
import { getUserPosition } from '../../src/viem/index.js'

function PositionDisplay({ vault, user }) {
  const publicClient = usePublicClient()
  const [position, setPosition] = useState(null)

  useEffect(() => {
    getUserPosition(publicClient, vault, user).then(setPosition)
  }, [vault, user])

  if (!position) return <p>Loading...</p>

  return (
    <div>
      <p>Shares: {position.shares.toString()}</p>
      <p>Value: {position.estimatedAssets.toString()} underlying</p>
      {position.pendingWithdrawal && (
        <p>Pending: {position.pendingWithdrawal.shares.toString()} shares</p>
      )}
    </div>
  )
}
```

### ethers.js (browser)

```ts
import { BrowserProvider } from 'ethers'
import { getUserPosition } from '../../src/ethers/index.js'

const provider = new BrowserProvider(window.ethereum)
const pos = await getUserPosition(provider, VAULT_ADDRESS, userAddress)
```

---

## previewDeposit

Simulates how many shares a given asset amount would mint at current vault state. Does not account for deposit caps or paused state — use `canDeposit` for eligibility.

### Signature

```ts
previewDeposit(publicClient: PublicClient, vault: Address, assets: bigint): Promise<bigint>
```

### Usage — from working test

```ts
import { previewDeposit } from '../../src/viem/index.js'
import { parseUnits } from 'viem'

// How many shares would I get for 50 USDC?
const estimatedShares = await previewDeposit(publicClient, VAULT, parseUnits('50', 18))
// estimatedShares > 0n ✓ (verified in test suite)
```

### React + wagmi

```tsx
import { useReadContract } from 'wagmi'
import { VAULT_ABI } from '../../src/viem/abis.js'

const { data: estimatedShares } = useReadContract({
  address: VAULT_ADDRESS,
  abi: VAULT_ABI,
  functionName: 'previewDeposit',
  args: [parseUnits(inputAmount, underlyingDecimals)],
  query: { enabled: inputAmount > 0n },
})
```

---

## previewRedeem

Simulates how many underlying assets a given share amount would return.

### Signature

```ts
previewRedeem(publicClient: PublicClient, vault: Address, shares: bigint): Promise<bigint>
```

### Usage

```ts
import { previewRedeem } from '../../src/viem/index.js'

const estimatedAssets = await previewRedeem(publicClient, VAULT, userShares)
```

### React + wagmi

```tsx
const { data: estimatedAssets } = useReadContract({
  address: VAULT_ADDRESS,
  abi: VAULT_ABI,
  functionName: 'previewRedeem',
  args: [shares],
  query: { enabled: shares > 0n },
})
```

---

## canDeposit

Returns whether a user can deposit and the reason if blocked. Reads `paused`, deposit capacity, and whitelist status in a single batch.

### Signature

```ts
canDeposit(publicClient: PublicClient, vault: Address, user: Address): Promise<DepositEligibility>
```

### Return type

```ts
interface DepositEligibility {
  allowed: boolean
  reason: 'ok' | 'paused' | 'cap-reached' | 'not-whitelisted'
}
```

### Usage — from working test

```ts
import { canDeposit } from '../../src/viem/index.js'

// From test-user-helpers.ts — verified passing
const eligibility = await canDeposit(publicClient, VAULT, userAccount.address)
// { allowed: true, reason: 'ok' }

if (!eligibility.allowed) {
  if (eligibility.reason === 'paused')          console.log('Vault is paused')
  if (eligibility.reason === 'cap-reached')     console.log('Deposit capacity full')
  if (eligibility.reason === 'not-whitelisted') console.log('User not in whitelist')
}
```

### React + wagmi

```tsx
import { usePublicClient } from 'wagmi'
import { canDeposit } from '../../src/viem/index.js'

function DepositGate({ vault, user, children }) {
  const publicClient = usePublicClient()
  const [eligibility, setEligibility] = useState(null)

  useEffect(() => {
    canDeposit(publicClient, vault, user).then(setEligibility)
  }, [vault, user])

  if (!eligibility) return null
  if (!eligibility.allowed) return <p>Cannot deposit: {eligibility.reason}</p>
  return children
}
```

---

## getVaultMetadata

Returns static vault information useful for displaying in the UI: name, symbol, decimals, underlying asset, capacity, and current operating mode.

### Signature

```ts
getVaultMetadata(publicClient: PublicClient, vault: Address): Promise<VaultMetadata>
```

### Return type

```ts
interface VaultMetadata {
  name: string
  symbol: string
  decimals: number
  underlying: Address
  underlyingSymbol: string
  underlyingDecimals: number
  totalAssets: bigint
  totalSupply: bigint
  depositCapacity: bigint      // max total deposits (type(uint256).max = unlimited)
  remainingCapacity: bigint    // how much more can be deposited
  isHub: boolean
  isPaused: boolean
}
```

### Usage — from working test

```ts
import { getVaultMetadata } from '../../src/viem/index.js'

// From test-user-helpers.ts — verified passing
const meta = await getVaultMetadata(publicClient, VAULT)

console.log(meta.name)              // 'E2E Vault'  (your vault name)
console.log(meta.symbol)            // 'E2EV'
console.log(meta.decimals)          // 20  (= underlyingDecimals + 2 offset for ERC-4626)
console.log(meta.underlyingSymbol)  // 'USDC'
console.log(meta.underlyingDecimals)// 18 (or 6 for real USDC)
console.log(meta.isHub)             // true/false
console.log(meta.isPaused)          // false
```

### React + wagmi

```tsx
import { usePublicClient } from 'wagmi'
import { getVaultMetadata } from '../../src/viem/index.js'

function VaultHeader({ vault }) {
  const publicClient = usePublicClient()
  const [meta, setMeta] = useState(null)

  useEffect(() => {
    getVaultMetadata(publicClient, vault).then(setMeta)
  }, [vault])

  if (!meta) return <p>Loading...</p>

  return (
    <div>
      <h2>{meta.name} ({meta.symbol})</h2>
      <p>TVL: {meta.totalAssets.toString()} {meta.underlyingSymbol}</p>
      <p>Capacity: {meta.remainingCapacity.toString()} remaining</p>
      {meta.isPaused && <p style={{ color: 'red' }}>Vault is paused</p>}
    </div>
  )
}
```

---

## getVaultStatus

Full vault configuration snapshot. Determines which SDK flow to use and surfaces any misconfiguration issues.

Documented separately in [utils.md](./utils.md).

---

## getAsyncRequestStatusLabel

Human-readable label for an async request state. Useful for UI status indicators.

### Signature

```ts
getAsyncRequestStatusLabel(publicClient: PublicClient, vault: Address, guid: string): Promise<AsyncRequestStatusInfo>
```

### Return type

```ts
interface AsyncRequestStatusInfo {
  label: 'pending' | 'fulfilled' | 'finalized' | 'refunded' | 'unknown'
  result: bigint  // shares minted (deposit) or assets received (redeem), 0 if pending
}
```

### Usage

```ts
import { getAsyncRequestStatusLabel } from '../../src/viem/index.js'

// After depositAsync or redeemAsync
const info = await getAsyncRequestStatusLabel(publicClient, VAULT, guid)

switch (info.label) {
  case 'pending':   // LZ Read in flight
  case 'fulfilled': // LZ callback received, waiting for keeper
  case 'finalized': // Done — info.result is the amount minted/received
  case 'refunded':  // Failed, assets returned
}
```
