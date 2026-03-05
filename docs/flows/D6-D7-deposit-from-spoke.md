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

1. **Approve spokeOFT**: underlying tokens are approved to the OFT contract on the spoke chain.
2. **OFT.send()**: sends tokens to the hub chain with a `composeMsg` attached. The composeMsg encodes `abi.encode(SendParam hopSendParam, uint256 minMsgValue)` — `hopSendParam` tells the hub where to send shares back.
3. **Hub composer** (automatic): receives tokens + composeMsg, calls `vault.deposit()` (D6) or `vault.initDeposit()` (D7).
4. **Shares bridged back** (D6): after minting, the hub sends shares back to the receiver on the spoke chain via OFT.

## LZ fee quoting

You must quote the LZ fee before calling this function. The fee covers delivery on the hub side:

```ts
// On the spoke chain, call OFT.quoteSend() with your sendParam
const [nativeFee] = await publicClient.readContract({
  address: SPOKE_OFT,
  abi: OFT_ABI,
  functionName: 'quoteSend',
  args: [sendParam, false],
})
const lzFee = nativeFee
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | Wallet client on the **spoke** chain |
| `publicClient` | `PublicClient` | Public client on the **spoke** chain |
| `spokeOFT` | `Address` | OFT contract for the underlying token on the spoke chain (e.g. USDC OFT on Arbitrum) |
| `hubEid` | `number` | LayerZero Endpoint ID for the hub chain (Flow EVM = **30332**) |
| `spokeEid` | `number` | LayerZero Endpoint ID for the spoke chain — where shares are sent back (Arbitrum = **30110**, Base = **30184**) |
| `amount` | `bigint` | Token amount in spoke-chain decimals |
| `receiver` | `Address` | Address that receives shares on the spoke chain |
| `lzFee` | `bigint` | Native fee from `OFT.quoteSend()`. Must cover both the hub-bound message AND the return (shares back) message. |
| `minMsgValue` | `bigint` | Optional: minimum ETH the hub composer must receive to process the compose and send shares back. Default `0n`. |
| `minSharesOut` | `bigint` | Optional: minimum vault shares to receive (slippage protection on deposit). Default `0n`. |
| `minAmountLD` | `bigint` | Optional: minimum tokens received on hub after bridge slippage. Defaults to `amount` (zero bridge slippage tolerance). |
| `extraOptions` | `0x${string}` | Optional: LZ extra options for the hub-bound message. Default `'0x'`. |

## Returns

```ts
{ txHash: Hash }
```

(No shares returned — they arrive asynchronously via OFT delivery.)

## Usage

### viem

```ts
import { depositFromSpoke } from '../../src/viem/index.js'
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem'
import { arbitrum } from 'viem/chains'

// Clients must be on the SPOKE chain
const spokePublic = createPublicClient({ chain: arbitrum, transport: http(ARB_RPC) })
const spokeWallet = createWalletClient({ account, chain: arbitrum, transport: http(ARB_RPC) })

const HUB_EID   = 30332  // Flow EVM
const SPOKE_EID = 30110  // Arbitrum
const USDC_OFT_ARBITRUM = '0x...' // USDC OFT on Arbitrum

// Quote LZ fee first (call OFT.quoteSend on spoke with compose enabled)
const lzFee = ... // from OFT.quoteSend()

const { txHash } = await depositFromSpoke(
  spokeWallet,
  spokePublic,
  USDC_OFT_ARBITRUM,
  HUB_EID,
  SPOKE_EID,
  parseUnits('100', 6),
  account.address,
  lzFee,
  // minMsgValue, minSharesOut, minAmountLD, extraOptions — all optional
)

// Shares arrive on spoke chain after LayerZero delivery (~1-5 min for D6)
```

### ethers.js

```ts
import { depositFromSpoke } from '../../src/ethers/index.js'
import { JsonRpcProvider, Wallet, parseUnits } from 'ethers'

const spokeProvider = new JsonRpcProvider(ARB_RPC)
const spokeSigner = new Wallet(PRIVATE_KEY, spokeProvider)

const { receipt } = await depositFromSpoke(
  spokeSigner,
  USDC_OFT_ARBITRUM,
  30332,  // hubEid (Flow EVM)
  30110,  // spokeEid (Arbitrum)
  parseUnits('100', 6),
  spokeSigner.address,
  lzFee,
)
```

## Important notes

- **Clients must be on the spoke chain**, not the hub chain.
- The `receiver` gets shares on the **spoke chain** (identified by `spokeEid`). Shares are bridged back automatically by the hub composer after the deposit.
- Bridge slippage is separate from vault slippage. `minAmountLD` controls bridge slippage; `minSharesOut` controls vault slippage (mapped to `hopSendParam.minAmountLD` in the composeMsg).
- If the hub-side composer call fails (e.g. vault paused), the tokens may be stuck in the escrow. Contact the vault admin.

## See also

- [R6 — bridgeSharesToHub](./R6-bridge-shares-to-hub.md) — reverse: bridge shares from spoke to hub for redemption
- [D4 — depositAsync](./D4-deposit-async.md) — deposit from hub when oracle is OFF
