# R6 — bridgeSharesToHub

Step 1 of 3 for redeeming from a spoke chain. Bridges vault shares from the spoke chain to the hub via LayerZero SHARE_OFT.

## Full spoke redeem flow

```
Step 1 (Spoke):  bridgeSharesToHub()     — shares spoke->hub via SHARE_OFT (~5-10 min)
Step 2 (Hub):    smartRedeem()           — redeem on hub (auto-detects sync/async)
Step 3 (Hub):    bridgeAssetsToSpoke()   — assets hub->spoke via Stargate/OFT (~10-15 min)
```

The frontend **must switch the user's chain** between steps. Use `resolveRedeemAddresses()` to discover all addresses dynamically.

## Pre-flight

Before starting, run pre-flight checks:

```ts
import { resolveRedeemAddresses, preflightSpokeRedeem } from '@oydual31/more-vaults-sdk/viem'

// Discover all addresses
const route = await resolveRedeemAddresses(hubClient, VAULT, HUB_CHAIN_ID, SPOKE_CHAIN_ID)
// route.spokeShareOft, route.hubAssetOft, route.spokeAsset, route.isStargate, etc.

// Quote share bridge fee
const shareBridgeFee = await spokeClient.readContract({
  address: route.spokeShareOft,
  abi: OFT_ABI,
  functionName: 'quoteSend',
  args: [sendParam, false],
})

// Validate everything
const preflight = await preflightSpokeRedeem(route, shares, userAddress, shareBridgeFee.nativeFee)
// Checks: shares on spoke, spoke gas, hub gas for TX2+TX3
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | Wallet client on the **spoke** chain |
| `publicClient` | `PublicClient` | Public client on the **spoke** chain |
| `shareOFT` | `Address` | SHARE_OFT address on the spoke chain (from `resolveRedeemAddresses`) |
| `hubChainEid` | `number` | LayerZero EID for the hub chain |
| `shares` | `bigint` | Amount of vault shares to bridge |
| `receiver` | `Address` | Receiver address on the hub chain |
| `lzFee` | `bigint` | OFT send fee — quote via `SHARE_OFT.quoteSend()` on spoke chain |

## Returns

```ts
{ txHash: Hash }
```

## Usage — full spoke redeem (viem)

```ts
import {
  resolveRedeemAddresses,
  preflightSpokeRedeem,
  bridgeSharesToHub,
  smartRedeem,
  bridgeAssetsToSpoke,
  OFT_ABI,
  ERC20_ABI,
  LZ_TIMEOUTS,
} from '@oydual31/more-vaults-sdk/viem'
import { pad, getAddress } from 'viem'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6'
const HUB_CHAIN_ID = 8453   // Base
const SPOKE_CHAIN_ID = 1    // Ethereum

// 0. Resolve route dynamically
const route = await resolveRedeemAddresses(hubClient, VAULT, HUB_CHAIN_ID, SPOKE_CHAIN_ID)

// 1. Step 1: Bridge shares spoke -> hub
const { txHash: tx1 } = await bridgeSharesToHub(
  spokeWallet, spokeClient,
  route.spokeShareOft, route.hubEid,
  shares, account.address, shareBridgeFee,
)

// Wait for shares to arrive on hub (~5-10 min)
// Poll vault share balance on hub using LZ_TIMEOUTS.OFT_BRIDGE

// 2. Step 2: Redeem on hub (auto-detects async)
const redeemResult = await smartRedeem(
  hubWallet, hubClient,
  { vault: VAULT },
  sharesOnHub, account.address, account.address,
)

// For async vaults: wait for LZ Read callback (~5 min)
// Poll USDC balance on hub using LZ_TIMEOUTS.LZ_READ_CALLBACK

// 3. Step 3: Bridge assets back to spoke
const assetBridgeFee = await hubClient.readContract({
  address: route.hubAssetOft,
  abi: OFT_ABI,
  functionName: 'quoteSend',
  args: [/* sendParam */],
})

const { txHash: tx3 } = await bridgeAssetsToSpoke(
  hubWallet, hubClient,
  route.hubAssetOft, route.spokeEid,
  usdcAmount, account.address,
  assetBridgeFee.nativeFee, route.isStargate,
)

// Wait for USDC on spoke (~10-15 min for Stargate)
// Poll using LZ_TIMEOUTS.STARGATE_BRIDGE
```

## Notes

- Shares bridge **1:1** — `minAmountLD = shares` with no bridge slippage.
- **SHARE_OFT `enforcedOptions`** must be configured on both spoke and hub for bidirectional bridging. Missing config causes `LZ_ULN_InvalidWorkerOptions(0)`.
- Total spoke redeem time: ~25-30 min for async vaults with Stargate asset bridge.
- Use `LZ_TIMEOUTS.FULL_SPOKE_REDEEM` (60 min) as the maximum timeout for the full flow.

## See also

- [R7 — bridgeAssetsToSpoke](./R7-bridge-assets-to-spoke.md) — Step 3
- [R5 — redeemAsync](./R5-redeem-async.md) — async redeem on hub
- [D6/D7 — depositFromSpoke](./D6-D7-deposit-from-spoke.md) — reverse direction
