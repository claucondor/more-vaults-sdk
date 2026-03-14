# Curator Operations

Read-only helpers for vault curators (vault managers) to query vault configuration and pending actions.

## getCuratorVaultStatus

Returns a comprehensive status snapshot in a single multicall:

```ts
import { getCuratorVaultStatus } from '@oydual31/more-vaults-sdk/viem'

const status = await getCuratorVaultStatus(publicClient, VAULT_ADDRESS)
```

**Returns `CuratorVaultStatus`:**

| Field | Type | Description |
|-------|------|-------------|
| `curator` | `Address` | Current curator address |
| `timeLockPeriod` | `bigint` | Seconds between `submitActions` and `executeActions`. `0n` = immediate execution |
| `maxSlippagePercent` | `bigint` | Max allowed slippage for swap operations (in basis points) |
| `currentNonce` | `bigint` | Latest action nonce (increments per `submitActions` call) |
| `availableAssets` | `Address[]` | Whitelisted token addresses the vault can hold/swap |
| `lzAdapter` | `Address` | LayerZero adapter (cross-chain accounting manager) |
| `paused` | `boolean` | Whether the vault is currently paused |

## getPendingActions

Fetch pending actions for a specific nonce and check if they are ready to execute:

```ts
import { getPendingActions } from '@oydual31/more-vaults-sdk/viem'

const pending = await getPendingActions(publicClient, VAULT_ADDRESS, 42n)
// pending.nonce         — the queried nonce
// pending.actionsData   — array of encoded calldata
// pending.pendingUntil  — timestamp when timelock expires
// pending.isExecutable  — true if current time >= pendingUntil
```

**How timelock works:**

When `timeLockPeriod > 0`, calling `submitActions` does NOT execute immediately. Instead:

1. `submitActions(actions)` — queues actions, starts timelock countdown
2. Wait for `timeLockPeriod` seconds
3. `executeActions(nonce)` — executes the queued actions

When `timeLockPeriod = 0`, `submitActions` executes immediately in the same transaction.

The guardian can veto pending actions before execution via `vetoActions(nonces)`.

## isCurator

Simple check if an address is the vault's curator:

```ts
import { isCurator } from '@oydual31/more-vaults-sdk/viem'

const isManager = await isCurator(publicClient, VAULT_ADDRESS, walletAddress)
// true or false
```

## ABIs

The following ABI constants are exported for direct contract interaction:

| ABI | Facet | Functions |
|-----|-------|-----------|
| `MULTICALL_ABI` | MulticallFacet | `submitActions`, `executeActions`, `getPendingActions`, `getCurrentNonce`, `vetoActions` |
| `DEX_ABI` | GenericDexFacet | `executeSwap`, `executeBatchSwap` |
| `BRIDGE_FACET_ABI` | BridgeFacet | `executeBridging`, `initVaultActionRequest`, `executeRequest` |
| `ERC7540_FACET_ABI` | ERC7540Facet | `erc7540RequestDeposit`, `erc7540RequestRedeem`, `erc7540Deposit`, `erc7540Redeem` |
| `CURATOR_CONFIG_ABI` | ConfigurationFacet | `curator`, `timeLockPeriod`, `getAvailableAssets`, `getMaxSlippagePercent`, `getCrossChainAccountingManager`, `paused` |
| `LZ_ADAPTER_ABI` | LzAdapter | `quoteBridgeFee`, `quoteReadFee` |

## Types

```ts
import type {
  SwapParams,
  BatchSwapParams,
  BridgeParams,
  PendingAction,
  SubmitActionsResult,
  CuratorAction,
  CuratorVaultStatus,
} from '@oydual31/more-vaults-sdk/viem'
```

## Upcoming phases

The following curator write operations are planned for future releases:

- **Phase 2 — MulticallFacet**: `submitActions`, `executeActions`, `buildCuratorBatch`
- **Phase 3 — Swaps**: `encodeSwapAction`, `encodeBatchSwapAction`
- **Phase 4 — Bridge**: `executeBridging`, `smartBridge`, `quoteCuratorBridgeFee`
- **Phase 5 — Sub-vault operations**: `encodeERC4626Deposit`, `encodeERC7540RequestDeposit`, etc.
- **Phase 6 — Configuration**: `encodeSetDepositCapacity`, `encodeAddAvailableAsset`, etc.
