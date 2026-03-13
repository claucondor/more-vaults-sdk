# R7 — bridgeAssetsToSpoke

Step 3 of the full spoke redeem flow. Bridges underlying assets (e.g. USDC) from the hub chain back to the spoke chain via OFT.

## When to use

After `smartRedeem()` (Step 2) completes on the hub and the user has USDC in their wallet on the hub chain. This function sends it back to the spoke chain where the user originally held shares.

## Stargate vs Standard OFT

| | Stargate OFT (stgUSDC, USDT, WETH) | Standard OFT |
|--|--|--|
| `oftCmd` | `'0x01'` (TAXI mode) | `'0x'` |
| Delivery time | ~10-15 min | ~5-10 min |
| Slippage | 1% tolerance (`amount * 99 / 100`) | Usually 1:1 |

The SDK auto-detects via `resolveRedeemAddresses().isStargate`.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | Wallet client on the **hub** chain |
| `publicClient` | `PublicClient` | Public client on the **hub** chain |
| `assetOFT` | `Address` | OFT address for the underlying asset on the hub (from `route.hubAssetOft`) |
| `spokeChainEid` | `number` | LayerZero EID for the spoke (destination) chain |
| `amount` | `bigint` | Amount of underlying assets to bridge |
| `receiver` | `Address` | Receiver address on the spoke chain |
| `lzFee` | `bigint` | OFT send fee — quote via `OFT.quoteSend()` on hub |
| `isStargate` | `boolean` | Whether this is a Stargate OFT (from `route.isStargate`) |

## Returns

```ts
{ txHash: Hash }
```

## Usage

```ts
import { bridgeAssetsToSpoke, OFT_ABI } from '@oydual31/more-vaults-sdk/viem'
import { pad, getAddress } from 'viem'

// Quote fee
const toBytes32 = pad(getAddress(receiver), { size: 32 })
const fee = await hubClient.readContract({
  address: route.hubAssetOft,
  abi: OFT_ABI,
  functionName: 'quoteSend',
  args: [{
    dstEid: route.spokeEid,
    to: toBytes32,
    amountLD: amount,
    minAmountLD: amount * 99n / 100n, // 1% slippage for Stargate
    extraOptions: '0x',
    composeMsg: '0x',
    oftCmd: route.isStargate ? '0x01' : '0x',
  }, false],
})

// Bridge
const { txHash } = await bridgeAssetsToSpoke(
  hubWallet, hubClient,
  route.hubAssetOft, route.spokeEid,
  amount, receiver,
  fee.nativeFee, route.isStargate,
)

// Wait for USDC on spoke (~10-15 min for Stargate)
```

## Notes

- Requires native token (ETH) on the hub chain for the LZ fee.
- For Stargate, TAXI mode (`0x01`) is used for immediate delivery with compose support.
- The `preflightSpokeRedeem` function estimates this fee in advance so the UI can show the total cost before starting.

## See also

- [R6 — bridgeSharesToHub](./R6-bridge-shares-to-hub.md) — Step 1
- [R5 — redeemAsync](./R5-redeem-async.md) — Step 2 (async vault)
- [D6/D7 — depositFromSpoke](./D6-D7-deposit-from-spoke.md) — reverse direction
