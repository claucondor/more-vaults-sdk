# R6 — bridgeSharesToHub

Step 1 of 2 for redeeming from a spoke chain. Bridges vault shares from the spoke chain to the hub via LayerZero OFT. Once shares arrive on the hub, the user calls `redeemShares` (R1) or `redeemAsync` (R5) on the hub.

## When to use

- User is on a **spoke chain** and holds vault shares (OFT-wrapped)
- User wants to redeem and receive assets on the hub or back on the spoke

## Two-step flow

```
Step 1: Spoke chain                    Step 2: Hub chain
─────────────────────                  ─────────────────────────────
bridgeSharesToHub()       →  (LZ)  →  redeemShares() or redeemAsync()
  approve shareOFT                       burns shares, sends assets
  OFT.send()
  (~1–5 min delivery)
```

The frontend **must switch the user's chain** between steps. The two steps cannot be combined.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletClient` | `WalletClient` | Wallet client on the **spoke** chain |
| `publicClient` | `PublicClient` | Public client on the **spoke** chain |
| `shareOFT` | `Address` | OFTAdapter address for vault shares on the spoke chain |
| `hubChainEid` | `number` | LayerZero EID for the hub chain (e.g. Flow EVM = **30332**) |
| `shares` | `bigint` | Amount of vault shares to bridge |
| `receiver` | `Address` | Address that will receive shares on the hub chain |
| `lzFee` | `bigint` | OFT send fee — quote via `OFT.quoteSend()` on spoke chain |

## Returns

```ts
{ txHash: Hash }
```

## Usage

### viem

```ts
import { bridgeSharesToHub, redeemShares } from '../../src/viem/index.js'
import { createWalletClient, createPublicClient, http } from 'viem'
import { arbitrum, flowMainnet } from 'viem/chains'

const FLOW_EVM_EID  = 30332
const SHARE_OFT_ARB = '0x...' // OFTAdapter for vault shares on Arbitrum

// ── Step 1: on Arbitrum ──
const arbPublic = createPublicClient({ chain: arbitrum, transport: http(ARB_RPC) })
const arbWallet = createWalletClient({ account, chain: arbitrum, transport: http(ARB_RPC) })

// Quote LZ fee on spoke
const lzFee = ... // from SHARE_OFT_ARB.quoteSend()

const { txHash } = await bridgeSharesToHub(
  arbWallet,
  arbPublic,
  SHARE_OFT_ARB,
  FLOW_EVM_EID,
  shares,
  account.address, // receiver on hub
  lzFee,
)

// Wait for LayerZero delivery (~1-5 min), then switch to Flow EVM

// ── Step 2: on Flow EVM ──
const flowPublic = createPublicClient({ chain: flowMainnet, transport: http(FLOW_RPC) })
const flowWallet = createWalletClient({ account, chain: flowMainnet, transport: http(FLOW_RPC) })

const { assets } = await redeemShares(
  flowWallet,
  flowPublic,
  { vault: HUB_VAULT, escrow: HUB_ESCROW },
  shares,
  account.address,
  account.address,
)
```

### viem (React + wagmi — chain switching)

```tsx
import { useSwitchChain, useWriteContract, useChainId } from 'wagmi'
import { arbitrum, flowMainnet } from 'wagmi/chains'

function SpokeRedeemFlow({ shares, lzFee }) {
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  async function step1Bridge() {
    // Ensure user is on spoke chain
    if (chainId !== arbitrum.id) await switchChainAsync({ chainId: arbitrum.id })

    // Approve OFT for shares
    await writeContractAsync({
      address: SHARE_OFT_ARB,
      abi: OFT_ABI,
      functionName: 'approve',
      args: [SHARE_OFT_ARB, shares],
    })

    // Send via OFT
    await writeContractAsync({
      address: SHARE_OFT_ARB,
      abi: OFT_ABI,
      functionName: 'send',
      args: [sendParam, { nativeFee: lzFee, lzTokenFee: 0n }, account],
      value: lzFee,
    })
  }

  async function step2Redeem() {
    // Switch to hub chain
    if (chainId !== flowMainnet.id) await switchChainAsync({ chainId: flowMainnet.id })

    await writeContractAsync({
      address: HUB_VAULT,
      abi: VAULT_ABI,
      functionName: 'redeem',
      args: [shares, account, account],
    })
  }

  return (
    <div>
      <button onClick={step1Bridge}>Step 1: Bridge shares to hub</button>
      <button onClick={step2Redeem}>Step 2: Redeem on Flow EVM</button>
    </div>
  )
}
```

### ethers.js (browser — MetaMask)

```ts
import { BrowserProvider } from 'ethers'
import { bridgeSharesToHub, redeemShares } from '../../src/ethers/index.js'

// Step 1 — user on Arbitrum
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0xa4b1' }], // Arbitrum
})
const arbProvider = new BrowserProvider(window.ethereum)
const arbSigner = await arbProvider.getSigner()

await bridgeSharesToHub(arbSigner, SHARE_OFT_ARB, 30332, shares, await arbSigner.getAddress(), lzFee)

// Step 2 — user switches to Flow EVM
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x2eb' }], // Flow EVM (747)
})
const flowProvider = new BrowserProvider(window.ethereum)
const flowSigner = await flowProvider.getSigner()

await redeemShares(flowSigner, { vault: HUB_VAULT, escrow: HUB_ESCROW }, shares, await flowSigner.getAddress(), await flowSigner.getAddress())
```

## Notes

- Shares bridge **1:1** — `minAmountLD` is set to `shares` with no bridge slippage tolerance. This is intentional since vault shares should not suffer any bridge slippage in a properly configured OFT.
- The frontend must track LayerZero delivery before enabling Step 2. Use the [LayerZero Scan API](https://layerzeroscan.com) or poll for the share balance on the hub.

## See also

- [R1 — redeemShares](./R1-redeem-shares.md)
- [R5 — redeemAsync](./R5-redeem-async.md)
- [D6/D7 — depositFromSpoke](./D6-D7-deposit-from-spoke.md) — reverse direction
