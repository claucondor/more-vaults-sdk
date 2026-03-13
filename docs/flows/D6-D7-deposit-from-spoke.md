# D6 / D7 — depositFromSpoke

Deposit from a spoke chain (e.g. Arbitrum, Base, Ethereum) into the hub vault via LayerZero OFT Compose. The user never leaves their native chain — tokens are bridged and deposited atomically from the hub's perspective.

## D6 vs D7

| | D6 | D7 |
|--|--|--|
| Oracle accounting | ON on hub | OFF on hub |
| Composer action | `_depositAndSend` — shares arrive on spoke automatically | `_initDeposit` — extra LZ Read round-trip needed |
| User experience | Identical | Identical |
| Time to shares | ~1–5 min (1 LZ message) | ~5–15 min (2 LZ messages) |
| SDK function | `depositFromSpoke` | `depositFromSpoke` (same function) |

The difference is handled server-side by the hub's MoreVaultsComposer contract. The user calls the same function either way.

## Stargate OFT vs Standard OFT

The SDK auto-detects the OFT type via `isStargateOft()` and handles them differently:

| | Stargate OFT (stgUSDC, USDT, WETH) | Standard OFT |
|--|--|--|
| `extraOptions` | `'0x'` — Stargate rejects LZCOMPOSE type-3 options | LZCOMPOSE option injected with native ETH value |
| Compose execution | Stays **pending** in LZ Endpoint's `composeQueue` | Auto-executed by LZ executor in **1 TX** |
| User transactions | **2 TX** — spoke `OFT.send()` + hub `executeCompose()` | **1 TX** — spoke `OFT.send()` only |
| `composeData` returned | Yes — caller must handle | `undefined` — no retry needed |

### Stargate 2-TX flow

```
TX1 (Spoke):  depositFromSpoke()       → returns { txHash, guid, composeData }
Wait:         waitForCompose()          → polls ComposeSent events (~5-15 min)
TX2 (Hub):    executeCompose()          → returns { txHash, guid? } — GUID for async vaults
Wait:         waitForAsyncRequest()     → polls by GUID until finalized (~5 min)
Wait:         Shares arrive on spoke via SHARE_OFT (~5-10 min)
```

### Standard OFT 1-TX flow

```
TX1 (Spoke):  depositFromSpoke()       → returns { txHash, guid, composeData: undefined }
Wait:         Shares arrive on spoke   (~5-15 min, automatic)
```

## What happens on-chain

```
Spoke chain                         LayerZero                Hub chain
     |                                  |                          |
     |-- approve(spokeOFT, amount) ---->|                          |
     |-- OFT.send(sendParam, fee) ----->|                          |
     |   (with composeMsg attached)     |-- deliver tokens ------->|
     |                                  |-- call composer -------->|
     |                                  |   vault.deposit()/       |
     |                                  |   initDeposit()          |
     |<-- shares arrive via OFT --------|  (D6: shares sent back)  |
     |   (~1-5 min)                     |                          |
```

## LZ fee quoting

Use the SDK helper to quote the LZ fee:

```ts
import { quoteDepositFromSpokeFee } from '@oydual31/more-vaults-sdk/viem'

const lzFee = await quoteDepositFromSpokeFee(
  spokePublicClient,
  VAULT_ADDRESS,
  SPOKE_OFT,
  hubEid,
  spokeEid,
  amount,
  receiver,
)
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | Wallet client on the **spoke** chain |
| `publicClient` | `PublicClient` | Public client on the **spoke** chain |
| `vault` | `Address` | Vault address (used to resolve hub-side composer) |
| `spokeOFT` | `Address` | OFT contract for the underlying token on the spoke chain |
| `hubEid` | `number` | LayerZero Endpoint ID for the hub chain |
| `spokeEid` | `number` | LayerZero Endpoint ID for the spoke chain — where shares are sent back |
| `amount` | `bigint` | Token amount in spoke-chain decimals |
| `receiver` | `Address` | Address that receives shares on the spoke chain |
| `lzFee` | `bigint` | Native fee from `quoteDepositFromSpokeFee()` |
| `minMsgValue` | `bigint` | Optional: minimum ETH the hub composer must receive. Default `0n`. |
| `minSharesOut` | `bigint` | Optional: minimum vault shares to receive (slippage). Default `0n`. |
| `minAmountLD` | `bigint` | Optional: minimum tokens on hub after bridge. Auto-resolved via `quoteOFT`. |
| `extraOptions` | `0x${string}` | Optional: LZ extra options. Auto-resolved by SDK. Default `'0x'`. |

## Returns

```ts
interface SpokeDepositResult {
  txHash: Hash
  guid: `0x${string}`
  composeData?: ComposeData  // present only for Stargate OFTs (2-TX flow)
}
```

## Usage

### viem — Stargate OFT (2-TX flow)

```ts
import {
  depositFromSpoke,
  quoteDepositFromSpokeFee,
  waitForCompose,
  quoteComposeFee,
  executeCompose,
  waitForAsyncRequest,
  LZ_TIMEOUTS,
} from '@oydual31/more-vaults-sdk/viem'

// TX1: Deposit from spoke
const lzFee = await quoteDepositFromSpokeFee(
  spokePublic, VAULT, USDC_OFT_ETH, HUB_EID, SPOKE_EID, amount, receiver,
)

const result = await depositFromSpoke(
  spokeWallet, spokePublic, VAULT, USDC_OFT_ETH,
  HUB_EID, SPOKE_EID, amount, receiver, lzFee,
)

if (result.composeData) {
  // Stargate: need TX2 on hub
  // Wait for compose to arrive (~5 min)
  const compose = await waitForCompose(
    hubPublic, result.composeData, receiver,
    LZ_TIMEOUTS.POLL_INTERVAL, LZ_TIMEOUTS.COMPOSE_DELIVERY,
  )

  // Quote and execute compose
  const fee = await quoteComposeFee(hubPublic, VAULT, SPOKE_EID, receiver)
  const composeResult = await executeCompose(hubWallet, hubPublic, compose, fee)
  // composeResult.guid is present for async vaults (oracle OFF)

  // Wait for async finalization by GUID (~5 min)
  if (composeResult.guid) {
    const final = await waitForAsyncRequest(
      hubPublic, VAULT, composeResult.guid,
      LZ_TIMEOUTS.POLL_INTERVAL, LZ_TIMEOUTS.LZ_READ_CALLBACK,
    )
    console.log('Status:', final.status)   // 'completed' | 'refunded'
    console.log('Shares:', final.result)
  }

  // Shares arrive on spoke via SHARE_OFT automatically
} else {
  // Standard OFT: compose auto-executed, just wait for shares
}
```

### viem — Standard OFT (1-TX flow)

```ts
import { depositFromSpoke, quoteDepositFromSpokeFee } from '@oydual31/more-vaults-sdk/viem'

const lzFee = await quoteDepositFromSpokeFee(
  spokePublic, VAULT, CUSTOM_OFT, HUB_EID, SPOKE_EID, amount, receiver,
)

const { txHash, guid } = await depositFromSpoke(
  spokeWallet, spokePublic, VAULT, CUSTOM_OFT,
  HUB_EID, SPOKE_EID, amount, receiver, lzFee,
)

// composeData is undefined — compose auto-executes
// Just wait for shares to arrive on spoke
```

### ethers.js

```ts
import { depositFromSpoke, quoteDepositFromSpokeFee } from '@oydual31/more-vaults-sdk/ethers'
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers'

const spokeProvider = new JsonRpcProvider(ARB_RPC)
const spokeSigner = new Wallet(PRIVATE_KEY, spokeProvider)

const lzFee = await quoteDepositFromSpokeFee(
  spokeProvider, VAULT, USDC_OFT, HUB_EID, SPOKE_EID, amount, receiver,
)

const { receipt } = await depositFromSpoke(
  spokeSigner, VAULT, USDC_OFT, HUB_EID, SPOKE_EID, amount, receiver, lzFee,
)
```

## Important notes

- **Clients must be on the spoke chain**, not the hub chain.
- The `receiver` gets shares on the **spoke chain** (identified by `spokeEid`).
- The SDK auto-resolves the composer address via `OMNI_FACTORY.vaultComposer(vault)`.
- For Stargate OFTs, the hub-side compose requires ETH for `readFee` + `SHARE_OFT.send()` fee. Use `quoteComposeFee()` to estimate.
- Bridge slippage (`minAmountLD`) is auto-resolved via `quoteOFT` if not provided.

## See also

- [R6 — bridgeSharesToHub](./R6-bridge-shares-to-hub.md) — reverse: bridge shares from spoke to hub
- [R7 — bridgeAssetsToSpoke](./R7-bridge-assets-to-spoke.md) — bridge assets back to spoke
- [D4 — depositAsync](./D4-deposit-async.md) — deposit from hub when oracle is OFF
- [Cross-chain async deposit architecture](../cross-chain-async-deposit-flow.md)
