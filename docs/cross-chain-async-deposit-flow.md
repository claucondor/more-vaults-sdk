# Cross-Chain Async Deposit Flow (D7) — Architecture & Known Issues

## Flow Diagram

```
SPOKE (Ethereum)                          HUB (Base)
═══════════════                           ═════════

┌──────────┐
│   User   │
│  Wallet  │
└────┬─────┘
     │
     │ OFT.send{value: lzFee}(sendParam)
     │   - to: composerAddress
     │   - composeMsg: abi.encode(hopSendParam, minMsgValue)
     │   - extraOptions: LZCOMPOSE option (standard OFT) or '0x' (Stargate)
     │   - oftCmd: '0x' (taxi)
     │
     │  ⚠️  PROBLEM 1: Stargate bus vs taxi
     │  │   oftCmd='0x' → TAXI (compose supported) ✓
     │  │   oftCmd='0x01' → BUS (NO compose) ✗
     │  │   Standard OFTs: always supports compose ✓
     │
     │  ⚠️  PROBLEM 2: Stargate rejects LZCOMPOSE extraOptions
     │  │   Standard OFTs accept type-3 LZCOMPOSE option → executor
     │  │   forwards ETH to lzCompose as msg.value ✓
     │  │   Stargate rejects type-3 → InvalidExecutorOption(3) ✗
     │  │   Forces extraOptions='0x' → msg.value=0 on compose
     │
     ▼
┌──────────────────┐
│  Stargate Pool   │         LZ Network
│  or OFT Contract │    ═══════════════════
│  (Ethereum)      │──────────────────────────────────┐
└──────────────────┘                                  │
                                                      ▼
                                          ┌───────────────────────┐
                                          │  TokenMessaging (SG)  │
                                          │  or OFT (standard)    │
                                          │  _lzReceive()         │
                                          └───────────┬───────────┘
                                                      │
                                          ┌───────────▼───────────┐
                                          │  receiveTokenTaxi()   │
                                          │  1. Transfer tokens   │
                                          │     to composer       │
                                          │  2. endpoint          │
                                          │     .sendCompose()    │
                                          └───────────┬───────────┘
                                                      │
                                                      │ ComposeSent event
                                                      │ composeQueue[from][to][guid][idx] = hash
                                                      ▼
                                          ┌───────────────────────┐
                                          │   LZ Endpoint         │
                                          │   composeQueue        │
                                          │   (pending)           │
                                          └───────────┬───────────┘
                                                      │
                                                      │ Executor calls:
                                                      │ endpoint.lzCompose{value: ???}(...)
                                                      │
                                          ⚠️  PROBLEM 3: msg.value = 0 (Stargate)
                                          │   Executor has no LZCOMPOSE instruction
                                          │   → calls with msg.value = 0
                                          │   Standard OFTs: msg.value = readFee + shareSendFee ✓
                                                      │
                                                      ▼
                                          ┌───────────────────────┐
                                          │  MoreVaultsComposer   │
                                          │  lzCompose()          │
                                          │                       │
                                          │  try handleCompose    │
                                          │  {value: msg.value}   │
                                          └───────────┬───────────┘
                                                      │
                                                      │ decode composeMsg
                                                      │ check msg.value >= minMsgValue
                                                      │ check vault not paused
                                                      │ isCrossChainVault && !oracleAccounting → D7
                                                      ▼
                                          ┌───────────────────────┐
                                          │  _initDeposit()       │
                                          │                       │
                                          │  readFee = vault      │
                                          │    .quoteAccountingFee│
                                          │                       │
                                          │  require(msg.value    │
                                          │    >= readFee)        │◄── ⚠️  PROBLEM 4: REVERTS
                                          │                       │    msg.value=0 < readFee
                                          │  vault                │    compose stays pending
                                          │  .initVaultAction     │    in endpoint queue
                                          │  Request{value:       │
                                          │    readFee}(...)      │    Standard OFTs: passes ✓
                                          │                       │
                                          │  store pendingDeposit │
                                          │    msgValue =         │
                                          │    msg.value - readFee│
                                          └───────────┬───────────┘
                                                      │
                                                      │ (async: LZ Read oracle
                                                      │  processes the request)
                                                      │
                                                      ▼
                                          ┌───────────────────────┐
                                          │  LzAdapter            │
                                          │  _callbackToComposer()│
                                          │                       │
                                          │  composer             │
                                          │  .sendDepositShares() │
                                          └───────────┬───────────┘
                                                      │
                                                      ▼
                                          ┌───────────────────────┐
                                          │  sendDepositShares()  │
                                          │                       │
                                          │  shares = vault       │
                                          │  .getFinalizationResult│
                                          │                       │
                                          │  SHARE_OFT.send       │
                                          │  {value: deposit      │
                                          │   .msgValue}          │
                                          │  (sendParam to spoke) │
                                          └───────────┬───────────┘
                                                      │
                                          ⚠️  PROBLEM 5: SHARE_OFT no peers
                                          │   peers[30101] = bytes32(0)
                                          │   → reverts NoPeer(30101)
                                          │   This is a deployment issue,
                                          │   affects ALL OFT types equally.
                                                      │
                                                      ▼
                                          ┌───────────────────────┐
SPOKE (Ethereum)                          │  Shares sent via LZ   │
┌──────────────┐                          │  hub → spoke          │
│  User gets   │◄─────────────────────────│                       │
│  vault shares│                          │  (blocked until peers │
│  on spoke    │                          │   are configured)     │
└──────────────┘                          └───────────────────────┘
```

## Revert Behavior Detail

```
lzCompose() {
    try handleCompose{value: msg.value}(...) {
        emit Sent(guid);                          ← happy path
    } catch (bytes memory err) {
        if (err == InsufficientMsgValue) {
            revert(err);                          ← RE-THROWS → compose stays pending
        }                                            (retryable with more ETH)
        _refund(oft, message, amount, tx.origin); ← refunds tokens to spoke
        emit Refunded(guid);                         (only for non-ETH errors)
    }
}
```

## Problem Summary

| #  | Problem | Stargate V2 | Standard OFT | Impact |
|----|---------|-------------|--------------|--------|
| P1 | Bus mode has no compose support | oftCmd must be '0x' (taxi) | N/A — always immediate | Tokens stuck in composer, no action |
| P2 | LZCOMPOSE extraOptions rejected | InvalidExecutorOption(3) | Accepted ✓ | Cannot instruct executor to forward ETH |
| P3 | msg.value = 0 on lzCompose | Consequence of P2 | msg.value > 0 ✓ | Composer cannot pay for readFee or share return |
| P4 | _initDeposit reverts | Consequence of P3 | Passes ✓ | Compose pending indefinitely in endpoint |
| P5 | SHARE_OFT has no peers | Affects all OFTs equally | Affects all OFTs equally | Shares cannot travel hub → spoke |

## Recovery Matrix

| State | Recoverable | Method |
|-------|------------|--------|
| Compose pending in endpoint (P4) | ✅ Yes | Call `endpoint.lzCompose{value: ethNeeded}(from, to, guid, index, message, '0x')` |
| Tokens stuck — BUS mode (P1) | ✅ Yes | Vault owner calls `composer.rescue(token, to, amount)` |
| SHARE_OFT no peers (P5) | ✅ Yes | Deploy adapter + `setPeer()` on both chains |
| Refund triggered (other revert) | ✅ Yes | Automatic — tokens sent back to spoke via `_refund()` |

## Prerequisites for End-to-End Success

1. **SHARE_OFT peers**: Deploy adapter on Ethereum, call `setPeer()` on both Base and Ethereum
2. **For Stargate OFTs**: Either pre-fund composer with ETH + modify contract to use `address(this).balance`, or retry composes manually with ETH via `endpoint.lzCompose`
3. **For standard OFTs**: SDK auto-resolves `extraOptions` with LZCOMPOSE native value — works out of the box
