import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  encodeAbiParameters,
  getAddress,
  pad,
  zeroAddress,
} from 'viem'
import { OFT_ABI, BRIDGE_ABI, LZ_ENDPOINT_ABI } from './abis'
import type { ComposeData, SpokeDepositResult } from './types'
import { ensureAllowance } from './utils'
import { OFT_ROUTES, EID_TO_CHAIN_ID } from './chains'
import { OMNI_FACTORY_ADDRESS } from './topology'
import { createChainClient } from './spokeRoutes'

/** LZ Endpoint V2 address — same on all EVM chains */
const LZ_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c' as const

const FACTORY_COMPOSER_ABI = [
  {
    type: 'function',
    name: 'vaultComposer',
    inputs: [{ name: '_vault', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

const COMPOSER_ABI = [
  {
    type: 'function',
    name: 'SHARE_OFT',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

const STARGATE_ASSETS = new Set(['stgUSDC', 'USDT', 'WETH'])

/**
 * Build a LZ V2 TYPE_3 executor option that forwards native ETH to the lzCompose call.
 *
 * NOTE: Stargate V2's TokenMessaging rejects LZCOMPOSE (type 3) options from users —
 * they raise `InvalidExecutorOption(3)`. Only standard OFTs (non-Stargate) accept these.
 * For Stargate OFTs, extraOptions must be '0x' (empty).
 *
 * For non-Stargate OFTs:
 *   MoreVaultsComposer needs native ETH in lzCompose for:
 *   - D6 (oracle ON):  `SHARE_OFT.send{value: msg.value}(...)` — hub→spoke share return
 *   - D7 (oracle OFF): `initVaultActionRequest{value: readFee}(...)` + stored for share return
 *
 * Encoding (LZ V2 executor options spec):
 *   [uint16 TYPE_3=3][uint8 type=3][uint16 length=34][uint16 index=0][uint128 gas][uint128 value]
 */
function buildLzComposeOption(gas: bigint, nativeValue: bigint): `0x${string}` {
  const gasHex = gas.toString(16).padStart(32, '0')
  const valueHex = nativeValue.toString(16).padStart(32, '0')
  return `0x00030300220000${gasHex}${valueHex}` as `0x${string}`
}

/** Returns true if the OFT is a Stargate V2 pool (bus/taxi architecture). */
function isStargateOft(oft: Address): boolean {
  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    if (!STARGATE_ASSETS.has(symbol)) continue
    for (const entry of Object.values(chainMap as Record<number, { oft: string; token: string }>)) {
      if (getAddress(entry.oft) === oft) return true
    }
  }
  return false
}

/**
 * Resolve the native ETH value that MoreVaultsComposer needs to receive via lzCompose.
 *
 * Fetches readFee from the hub vault and quotes the share return OFT.send fee.
 * Returns readFee + shareSendFee, which must be forwarded as compose native value.
 * Falls back to readFee * 5 if SHARE_OFT can't be queried.
 */
async function resolveComposeNativeValue(
  hubClient: NonNullable<ReturnType<typeof createChainClient>>,
  vault: Address,
  composerAddress: Address,
  spokeEid: number,
  receiverBytes32: `0x${string}`,
): Promise<bigint> {
  const [readFeeResult, shareOftResult] = await Promise.allSettled([
    hubClient.readContract({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'quoteAccountingFee',
      args: ['0x'],
    }),
    hubClient.readContract({
      address: composerAddress,
      abi: COMPOSER_ABI,
      functionName: 'SHARE_OFT',
    }),
  ])

  const readFee = readFeeResult.status === 'fulfilled' ? readFeeResult.value as bigint : 0n

  if (shareOftResult.status === 'fulfilled') {
    try {
      const shareOft = shareOftResult.value as Address
      const feeQuote = await hubClient.readContract({
        address: shareOft,
        abi: OFT_ABI,
        functionName: 'quoteSend',
        args: [{
          dstEid: spokeEid,
          to: receiverBytes32,
          amountLD: 0n,
          minAmountLD: 0n,
          extraOptions: '0x' as `0x${string}`,
          composeMsg: '0x' as `0x${string}`,
          oftCmd: '0x' as `0x${string}`,
        }, false],
      }) as { nativeFee: bigint }
      return readFee + feeQuote.nativeFee
    } catch { /* fall through to default */ }
  }

  // Fallback: readFee covers _initDeposit; multiply for share send buffer
  return readFee > 0n ? readFee * 5n : 500_000_000_000_000n // 0.0005 ETH floor
}

/**
 * Resolve the correct OFT `oftCmd` for spoke-to-hub deposits.
 *
 * Stargate V2 `oftCmd` semantics (IMPORTANT — counter-intuitive):
 *   '0x'   (empty) = TAXI mode — immediate delivery, supports composeMsg ← required for D6/D7
 *   '0x01'         = BUS mode  — queued batch delivery, NO composeMsg support
 *
 * For spoke deposits we always want TAXI to carry the composeMsg to the hub composer.
 * Both Stargate OFTs AND standard OFTs use '0x' for immediate (taxi) delivery.
 */
function resolveOftCmd(_oft: Address): `0x${string}` {
  return '0x'
}

/**
 * D6 / D7 — Deposit from a spoke chain to the hub vault via OFT Compose.
 *
 * Bridges tokens from the spoke chain to the hub via LayerZero OFT, attaching a
 * composeMsg that instructs the hub-side MoreVaultsComposer to deposit into the vault
 * and send the resulting shares back to the receiver on the spoke chain.
 *
 * - **D6 (oracle ON)**: composer calls `_depositAndSend` — shares arrive on spoke in ~1 LZ round-trip.
 * - **D7 (oracle OFF)**: composer calls `_initDeposit` — requires an additional LZ Read round-trip.
 *
 * From the user's perspective, both D6 and D7 have the same interface.
 *
 * **User transactions on spoke chain**: 1 approve + 1 OFT.send().
 * **Wait**: Shares arrive on spoke chain after the hub processes the deposit (~1-5 min).
 *
 * ## OFT type handling (Stargate vs Standard)
 *
 * The SDK auto-detects the OFT type via `isStargateOft()`:
 *
 * - **Stargate OFT** (stgUSDC, USDT, WETH): `extraOptions = '0x'` — Stargate's
 *   TokenMessaging rejects LZCOMPOSE type-3 options (`InvalidExecutorOption(3)`).
 *   The compose stays pending in the LZ Endpoint's `composeQueue`. User must
 *   execute a 2nd TX on the hub: `waitForCompose()` → `executeCompose()`.
 *   Returns `composeData` for the caller to handle.
 *
 * - **Standard OFT** (non-Stargate): SDK injects `buildLzComposeOption(500_000 gas,
 *   nativeValue)` into extraOptions. The LZ executor forwards ETH to the compose
 *   call automatically → compose executes in 1 TX, no retry needed.
 *   Returns `composeData = undefined`.
 *
 * ## Tested flows
 *
 * - [x] Stargate OFT cross-chain deposit (Eth→Base, stgUSDC, vault 0x8f74...ba6):
 *       2-TX flow: depositFromSpoke → waitForCompose → executeCompose.
 *       Compose delivery ~5-7 min, executeCompose with readFee + shareSendFee.
 *
 * ## Untested flows
 *
 * - [ ] Standard OFT cross-chain deposit (1-TX compose, no retry) — needs a
 *       non-Stargate OFT route (e.g. a custom OFT adapter)
 * - [ ] D6 path (oracle ON vault) — needs vault with oracle accounting enabled
 *
 * @param walletClient   Wallet client on the SPOKE chain
 * @param publicClient   Public client on the SPOKE chain
 * @param vault          Vault address (used to resolve the hub-side MoreVaultsComposer)
 * @param spokeOFT       OFT contract address on spoke chain (e.g. USDC OFT adapter)
 * @param hubEid         LayerZero EID for the hub chain — where tokens are sent
 * @param spokeEid       LayerZero EID for the spoke chain — where shares are sent back
 * @param amount         Amount of tokens to bridge (in spoke token decimals)
 * @param receiver       Address that will receive vault shares on the spoke chain
 * @param lzFee          msg.value for the OFT.send() call. Must cover both the
 *                       hub-bound LZ message AND the return message (shares back).
 *                       Quote via `quoteDepositFromSpokeFee`.
 * @param minMsgValue    Minimum msg.value the hub composer must receive. Defaults to 0.
 * @param minSharesOut   Minimum shares to receive after deposit (slippage). Defaults to 0.
 * @param minAmountLD    Minimum tokens on hub after bridge. Auto-resolved via quoteOFT if omitted.
 * @param extraOptions   LZ extra options bytes for the hub-bound message
 * @returns              Transaction hash and LayerZero GUID for tracking
 */
export async function depositFromSpoke(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  spokeOFT: Address,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  receiver: Address,
  lzFee: bigint,
  minMsgValue: bigint = 0n,
  minSharesOut: bigint = 0n,
  minAmountLD?: bigint,
  extraOptions: `0x${string}` = '0x',
): Promise<SpokeDepositResult> {
  const account = walletClient.account!
  const oft = getAddress(spokeOFT)

  // OFTAdapters (e.g. Stargate) wrap an existing ERC-20: token() returns the underlying.
  // Pure OFTs are their own token: token() returns address(this).
  // Either way, approve whatever token() says — the OFT contract handles the rest.
  const tokenToApprove = await publicClient.readContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'token',
  })
  await ensureAllowance(walletClient, publicClient, tokenToApprove, oft, amount)

  // Stargate pools require taxi mode (oftCmd = 0x01); standard OFTs use empty (0x).
  // Resolved automatically — callers never need to know about this detail.
  const resolvedOftCmd = resolveOftCmd(oft)

  // Resolve the MoreVaultsComposer on the hub chain.
  // The OFT sendParam `to` must be the composer — Stargate calls endpoint.sendCompose(to, ...)
  // which requires `to` to implement ILayerZeroComposer. Using a wallet address here causes
  // the compose to be undeliverable and tokens land directly at the user's wallet on Base.
  const hubChainId = EID_TO_CHAIN_ID[hubEid]
  const hubClient = createChainClient(hubChainId)
  if (!hubClient) throw new Error(`No public RPC for hub chainId ${hubChainId}`)
  const composerAddress = await hubClient.readContract({
    address: OMNI_FACTORY_ADDRESS,
    abi: FACTORY_COMPOSER_ABI,
    functionName: 'vaultComposer',
    args: [getAddress(vault)],
  })
  if (composerAddress === zeroAddress) throw new Error(`No composer registered for vault ${vault} on hub chainId ${hubChainId}`)
  const composerBytes32 = pad(composerAddress, { size: 32 })

  const receiverBytes32 = pad(getAddress(receiver), { size: 32 })

  // hopSendParam tells the composer where to deliver shares after deposit.
  // dstEid = spokeEid → shares are sent back to the user on the spoke chain via SHARE_OFT.
  // Requires SHARE_OFT peers + enforcedOptions configured on both hub and spoke chains.
  //
  // For Stargate OFTs: the executor cannot forward ETH (LZCOMPOSE options rejected),
  // so the compose stays pending. The user retries via executeCompose() on the hub with
  // enough ETH to cover readFee + SHARE_OFT send fee.
  //
  // For standard OFTs: the SDK injects LZCOMPOSE native value in extraOptions —
  // the executor forwards ETH and the compose succeeds in 1 TX.

  // For Stargate OFTs: extraOptions must be '0x' (rejects LZCOMPOSE type-3 options).
  // For standard OFTs: inject LZCOMPOSE option with native ETH for readFee + share send.
  const isStargate = isStargateOft(oft)
  let resolvedExtraOptions: `0x${string}`
  if (extraOptions !== '0x') {
    resolvedExtraOptions = extraOptions
  } else if (!isStargate) {
    // Standard OFTs: inject LZCOMPOSE executor option so compose gets ETH in 1 TX
    const composeNativeValue = await resolveComposeNativeValue(
      hubClient, vault, composerAddress, spokeEid, pad(getAddress(receiver), { size: 32 }),
    )
    resolvedExtraOptions = composeNativeValue > 0n
      ? buildLzComposeOption(500_000n, composeNativeValue)
      : '0x' as `0x${string}`
  } else {
    resolvedExtraOptions = '0x' as `0x${string}`
  }

  const hopSendParam = {
    dstEid: spokeEid,
    to: receiverBytes32,
    amountLD: 0n,
    minAmountLD: minSharesOut,
    extraOptions: '0x' as `0x${string}`,
    composeMsg: '0x' as `0x${string}`,
    oftCmd: '0x' as `0x${string}`,
  }

  // composeMsg = abi.encode(SendParam hopSendParam, uint256 minMsgValue)
  // This is what MoreVaultsComposer.handleCompose() decodes.
  const composeMsgBytes = encodeAbiParameters(
    [
      {
        type: 'tuple',
        name: 'hopSendParam',
        components: [
          { type: 'uint32', name: 'dstEid' },
          { type: 'bytes32', name: 'to' },
          { type: 'uint256', name: 'amountLD' },
          { type: 'uint256', name: 'minAmountLD' },
          { type: 'bytes', name: 'extraOptions' },
          { type: 'bytes', name: 'composeMsg' },
          { type: 'bytes', name: 'oftCmd' },
        ],
      },
      { type: 'uint256', name: 'minMsgValue' },
    ],
    [hopSendParam, minMsgValue],
  )

  // For OFTAdapters (e.g. Stargate) fees are deducted on transfer — quoteOFT tells us
  // exactly how much arrives on the hub. Use that as minAmountLD so the tx never reverts
  // due to slippage unless the caller explicitly sets a tighter limit.
  let resolvedMinAmountLD = minAmountLD
  if (resolvedMinAmountLD === undefined) {
    try {
      // viem returns multiple outputs as a positional array: [oftLimit, feeDetails, oftReceipt]
      const [, , oftReceipt] = await publicClient.readContract({
        address: oft,
        abi: OFT_ABI,
        functionName: 'quoteOFT',
        args: [{
          dstEid: hubEid,
          to: composerBytes32,
          amountLD: amount,
          minAmountLD: 0n,
          extraOptions: resolvedExtraOptions,
          composeMsg: composeMsgBytes,
          oftCmd: resolvedOftCmd,
        }],
      }) as [unknown, unknown, { amountSentLD: bigint; amountReceivedLD: bigint }]
      resolvedMinAmountLD = oftReceipt.amountReceivedLD
    } catch {
      resolvedMinAmountLD = amount
    }
  }

  const sendParam = {
    dstEid: hubEid,
    to: composerBytes32,
    amountLD: amount,
    minAmountLD: resolvedMinAmountLD,
    extraOptions: resolvedExtraOptions,
    composeMsg: composeMsgBytes,
    oftCmd: resolvedOftCmd,
  }

  const fee = {
    nativeFee: lzFee,
    lzTokenFee: 0n,
  }

  const { result } = await publicClient.simulateContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'send',
    args: [sendParam, fee, account.address],
    value: lzFee,
    account: account.address,
  })
  const guid = (result as unknown as [{ guid: `0x${string}` }, unknown])[0].guid

  const txHash = await walletClient.writeContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'send',
    args: [sendParam, fee, account.address],
    value: lzFee,
    account,
    chain: walletClient.chain,
  })

  // For Stargate OFTs: return compose data so the user can execute TX2 on the hub.
  // The compose message is NOT available yet — it's emitted as ComposeSent on the hub
  // after LZ delivers the message. The user must call waitForCompose() to get it,
  // then executeCompose() to execute it.
  const stargate = isStargateOft(getAddress(spokeOFT))
  let composeData: ComposeData | undefined
  if (stargate) {
    // Snapshot current hub block BEFORE waiting — this is exactly where we start
    // searching for ComposeSent events later. No guessing block ranges.
    const hubBlockStart = await hubClient.getBlockNumber()
    composeData = {
      endpoint: LZ_ENDPOINT,
      from: zeroAddress, // resolved by waitForCompose — Stargate pool on hub
      to: composerAddress,
      guid,
      index: 0,
      message: '0x', // resolved by waitForCompose — from ComposeSent event
      isStargate: true,
      hubChainId,
      hubBlockStart,
    }
  }

  return { txHash, guid, composeData }
}

/**
 * Alias: D7 — Spoke to hub deposit when oracle is OFF (async resolution).
 * Same interface as D6; the difference is handled server-side by the composer contract.
 * Shares may take longer to arrive due to the additional LZ Read round-trip.
 */
export { depositFromSpoke as depositFromSpokeAsync }

/**
 * Quote the LayerZero fee required for depositFromSpoke / depositFromSpokeAsync.
 *
 * The fee must cover TWO LZ hops: spoke→hub (deposit) + hub→spoke (shares return).
 * Pass the SAME parameters you intend to use for depositFromSpoke.
 *
 * @param publicClient   Public client on the SPOKE chain
 * @param vault          Vault address (to resolve the hub-side MoreVaultsComposer)
 * @param spokeOFT       OFT contract address on spoke chain
 * @param hubEid         LayerZero EID for the hub chain
 * @param spokeEid       LayerZero EID for the spoke chain
 * @param amount         Amount of tokens to bridge
 * @param receiver       Address that will receive vault shares on the spoke chain
 * @param minMsgValue    Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minSharesOut   Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minAmountLD    Same value you plan to pass to depositFromSpoke (default amount)
 * @param extraOptions   Same value you plan to pass to depositFromSpoke (default 0x)
 * @returns              Native fee in wei to pass as lzFee to depositFromSpoke
 */
export async function quoteDepositFromSpokeFee(
  publicClient: PublicClient,
  vault: Address,
  spokeOFT: Address,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  receiver: Address,
  minMsgValue: bigint = 0n,
  minSharesOut: bigint = 0n,
  minAmountLD?: bigint,
  extraOptions: `0x${string}` = '0x',
): Promise<bigint> {
  const oft = getAddress(spokeOFT)
  const resolvedOftCmd = resolveOftCmd(oft)
  const receiverBytes32 = pad(getAddress(receiver), { size: 32 })

  const hubChainId = EID_TO_CHAIN_ID[hubEid]
  const hubClient = createChainClient(hubChainId)
  if (!hubClient) throw new Error(`No public RPC for hub chainId ${hubChainId}`)
  const composerAddress = await hubClient.readContract({
    address: OMNI_FACTORY_ADDRESS,
    abi: FACTORY_COMPOSER_ABI,
    functionName: 'vaultComposer',
    args: [getAddress(vault)],
  })
  const composerBytes32 = pad(composerAddress, { size: 32 })

  // Match depositFromSpoke: resolve extraOptions the same way
  const isStargate = isStargateOft(oft)
  let resolvedExtraOptions: `0x${string}`
  if (extraOptions !== '0x') {
    resolvedExtraOptions = extraOptions
  } else if (!isStargate) {
    const composeNativeValue = await resolveComposeNativeValue(
      hubClient, vault, composerAddress, spokeEid, receiverBytes32 as `0x${string}`,
    )
    resolvedExtraOptions = composeNativeValue > 0n
      ? buildLzComposeOption(500_000n, composeNativeValue)
      : '0x' as `0x${string}`
  } else {
    resolvedExtraOptions = '0x' as `0x${string}`
  }

  // hopSendParam with dstEid=spokeEid → shares go back to spoke via SHARE_OFT
  const hopSendParam = {
    dstEid: spokeEid,
    to: receiverBytes32,
    amountLD: 0n,
    minAmountLD: minSharesOut,
    extraOptions: '0x' as `0x${string}`,
    composeMsg: '0x' as `0x${string}`,
    oftCmd: '0x' as `0x${string}`,
  }

  // Build composeMsg — same encoding as depositFromSpoke
  const composeMsgBytes = encodeAbiParameters(
    [
      {
        type: 'tuple',
        name: 'hopSendParam',
        components: [
          { type: 'uint32', name: 'dstEid' },
          { type: 'bytes32', name: 'to' },
          { type: 'uint256', name: 'amountLD' },
          { type: 'uint256', name: 'minAmountLD' },
          { type: 'bytes', name: 'extraOptions' },
          { type: 'bytes', name: 'composeMsg' },
          { type: 'bytes', name: 'oftCmd' },
        ],
      },
      { type: 'uint256', name: 'minMsgValue' },
    ],
    [hopSendParam, minMsgValue],
  )

  const sendParam = {
    dstEid: hubEid,
    to: composerBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions: resolvedExtraOptions,
    composeMsg: composeMsgBytes,
    oftCmd: resolvedOftCmd,
  }

  const fee = await publicClient.readContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [sendParam, false],
  })

  return (fee as { nativeFee: bigint; lzTokenFee: bigint }).nativeFee
}

// ---------------------------------------------------------------------------
// Stargate 2-TX compose helpers
// ---------------------------------------------------------------------------

const EMPTY_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const
const RECEIVED_HASH = '0x0000000000000000000000000000000000000000000000000000000000000001' as const

/**
 * Wait for a pending compose to appear in the LZ Endpoint's composeQueue on the hub chain.
 *
 * After `depositFromSpoke` sends tokens via Stargate, the LZ network delivers the message
 * to the hub chain. The endpoint stores the compose hash in `composeQueue` and emits
 * a `ComposeSent` event with the full message bytes.
 *
 * Strategy: scan ComposeSent events on the LZ Endpoint starting from `hubBlockStart`
 * (captured by `depositFromSpoke` right before TX1). This gives us an exact starting
 * block — no guessing. We scan forward in 500-block chunks, matching by composer address
 * and receiver in the message body. When found, we verify it's still pending in composeQueue.
 *
 * @param hubPublicClient  Public client on the HUB chain
 * @param composeData      Partial compose data from `depositFromSpoke` (includes hubBlockStart)
 * @param receiver         Receiver address to match in the compose message
 * @param pollIntervalMs   Polling interval (default 20s)
 * @param timeoutMs        Timeout (default 30 min)
 * @returns                Complete ComposeData ready for executeCompose
 */
export async function waitForCompose(
  hubPublicClient: PublicClient,
  composeData: ComposeData,
  receiver: Address,
  pollIntervalMs = 20_000,
  timeoutMs = 1_800_000,
): Promise<ComposeData> {
  const deadline = Date.now() + timeoutMs
  const composer = getAddress(composeData.to)
  const endpoint = getAddress(composeData.endpoint)
  const receiverNeedle = getAddress(receiver).slice(2).toLowerCase()
  const startBlock = composeData.hubBlockStart

  // Known Stargate pool addresses on hub for composeQueue checks
  const knownFromAddresses: Address[] = []
  const hubChainId = composeData.hubChainId
  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    if (!STARGATE_ASSETS.has(symbol)) continue
    const entry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    if (entry) knownFromAddresses.push(getAddress(entry.oft) as Address)
  }

  let attempt = 0
  // Track the highest block we've already scanned to avoid re-scanning
  let scannedUpTo = startBlock - 1n

  while (Date.now() < deadline) {
    attempt++
    const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000)

    try {
      const currentBlock = await hubPublicClient.getBlockNumber()

      // Scan new blocks since last scan, in 500-block chunks
      const chunkSize = 500n
      let from = scannedUpTo + 1n

      while (from <= currentBlock) {
        const chunkEnd = from + chunkSize > currentBlock ? currentBlock : from + chunkSize

        try {
          const logs = await hubPublicClient.getLogs({
            address: endpoint,
            events: [{
              type: 'event',
              name: 'ComposeSent',
              inputs: [
                { name: 'from', type: 'address', indexed: false },
                { name: 'to', type: 'address', indexed: false },
                { name: 'guid', type: 'bytes32', indexed: false },
                { name: 'index', type: 'uint16', indexed: false },
                { name: 'message', type: 'bytes', indexed: false },
              ],
            }],
            fromBlock: from,
            toBlock: chunkEnd,
          })

          for (const log of logs) {
            const args = log.args as {
              from?: Address; to?: Address; guid?: `0x${string}`;
              index?: number; message?: `0x${string}`
            }

            // Match by: composer address AND receiver in the message body
            if (
              args.to && getAddress(args.to) === composer &&
              args.message?.toLowerCase().includes(receiverNeedle)
            ) {
              // Verify this compose is still pending in composeQueue
              const hash = await hubPublicClient.readContract({
                address: endpoint,
                abi: LZ_ENDPOINT_ABI,
                functionName: 'composeQueue',
                args: [getAddress(args.from!), composer, args.guid!, args.index ?? 0],
              })

              if (hash !== EMPTY_HASH && hash !== RECEIVED_HASH) {
                console.log(`[${elapsed}s] Poll #${attempt} — compose found! (block ${log.blockNumber}, scanned from ${startBlock})`)
                return {
                  ...composeData,
                  from: getAddress(args.from!),
                  to: composer,
                  guid: args.guid!,
                  index: args.index ?? 0,
                  message: args.message!,
                }
              }
            }
          }
        } catch {
          // Chunk failed (RPC limit) — skip, will retry next poll
          break
        }

        from = chunkEnd + 1n
      }

      scannedUpTo = currentBlock
    } catch {
      // getBlockNumber failed — retry next poll
    }

    // Also try composeQueue directly with spoke GUID (works when GUIDs match)
    let guidMatchFound = false
    for (const fromAddr of knownFromAddresses) {
      try {
        const hash = await hubPublicClient.readContract({
          address: endpoint,
          abi: LZ_ENDPOINT_ABI,
          functionName: 'composeQueue',
          args: [fromAddr, composer, composeData.guid, 0],
        })
        if (hash !== EMPTY_HASH && hash !== RECEIVED_HASH) {
          const elapsed2 = Math.round((Date.now() - (deadline - timeoutMs)) / 1000)
          console.log(`[${elapsed2}s] Poll #${attempt} — composeQueue confirms pending (GUID match), re-scanning for message bytes...`)
          // Re-scan all blocks from start to find the message bytes
          scannedUpTo = startBlock - 1n
          guidMatchFound = true
        }
      } catch {
        // composeQueue call failed — continue
      }
    }

    if (!guidMatchFound) {
      console.log(`[${elapsed}s] Poll #${attempt} — compose not found yet (scanned blocks ${startBlock}→${scannedUpTo}), waiting ${pollIntervalMs / 1000}s...`)
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`Timeout waiting for compose after ${timeoutMs / 60_000} min. Scanned blocks ${startBlock}→${scannedUpTo}. Check LayerZero scan for composer ${composer}.`)
}

/**
 * Quote the ETH needed to execute a pending compose on the hub chain.
 *
 * For D7 (oracle OFF) vaults, the composer needs ETH to cover:
 *   1. `readFee` for `vault.initVaultActionRequest`
 *   2. `shareSendFee` for `SHARE_OFT.send()` to deliver shares to the spoke chain
 *
 * The composer stores `msg.value - readFee` as `pendingDeposit.msgValue`, which is
 * later used as the value for `SHARE_OFT.send{value: msgValue}(...)`.
 *
 * @param hubPublicClient  Public client on the HUB chain
 * @param vault            Vault address on the hub
 * @param spokeEid         Destination EID for share delivery (spoke chain)
 * @param receiver         Receiver address on the spoke chain
 * @returns                ETH amount in wei to send with executeCompose
 */
export async function quoteComposeFee(
  hubPublicClient: PublicClient,
  vault: Address,
  spokeEid?: number,
  receiver?: Address,
): Promise<bigint> {
  try {
    const readFee = await hubPublicClient.readContract({
      address: getAddress(vault),
      abi: BRIDGE_ABI,
      functionName: 'quoteAccountingFee',
      args: ['0x'],
    }) as bigint

    // If spokeEid provided, also quote the SHARE_OFT send fee
    let shareSendFee = 0n
    if (spokeEid && receiver) {
      try {
        const composerAddress = await hubPublicClient.readContract({
          address: OMNI_FACTORY_ADDRESS,
          abi: FACTORY_COMPOSER_ABI,
          functionName: 'vaultComposer',
          args: [getAddress(vault)],
        })
        const shareOft = await hubPublicClient.readContract({
          address: composerAddress,
          abi: COMPOSER_ABI,
          functionName: 'SHARE_OFT',
        }) as Address

        const feeQuote = await hubPublicClient.readContract({
          address: shareOft,
          abi: OFT_ABI,
          functionName: 'quoteSend',
          args: [{
            dstEid: spokeEid,
            to: pad(getAddress(receiver), { size: 32 }),
            amountLD: 1_000_000n, // non-zero placeholder for fee estimation
            minAmountLD: 0n,
            extraOptions: '0x' as `0x${string}`,
            composeMsg: '0x' as `0x${string}`,
            oftCmd: '0x' as `0x${string}`,
          }, false],
        }) as { nativeFee: bigint }
        shareSendFee = feeQuote.nativeFee
      } catch { /* fallback below */ }
    }

    // readFee + shareSendFee + 10% buffer
    return (readFee + shareSendFee) * 110n / 100n
  } catch {
    // Fallback: 0.0005 ETH should cover readFee + share send
    return 500_000_000_000_000n
  }
}

/**
 * Execute a pending LZ compose on the hub chain (Stargate 2-TX flow, step 2).
 *
 * Calls `endpoint.lzCompose{value: fee}(from, to, guid, index, message, '0x')`.
 * This triggers MoreVaultsComposer.lzCompose() which deposits tokens into the vault
 * and delivers shares to the user on the hub chain.
 *
 * @param walletClient     Wallet client on the HUB chain (user signs TX2 here)
 * @param hubPublicClient  Public client on the HUB chain
 * @param composeData      Complete compose data (from waitForCompose or manual)
 * @param fee              ETH to send (from quoteComposeFee). Covers readFee for D7.
 * @returns                Transaction hash of the compose execution
 */
export async function executeCompose(
  walletClient: WalletClient,
  hubPublicClient: PublicClient,
  composeData: ComposeData,
  fee: bigint,
): Promise<{ txHash: Hash }> {
  const account = walletClient.account!
  const endpoint = getAddress(composeData.endpoint)

  // Verify compose is still pending
  const hash = await hubPublicClient.readContract({
    address: endpoint,
    abi: LZ_ENDPOINT_ABI,
    functionName: 'composeQueue',
    args: [composeData.from, composeData.to, composeData.guid, composeData.index],
  })

  if (hash === EMPTY_HASH) {
    throw new Error('Compose not found in queue (hash = 0). Never sent or wrong parameters.')
  }
  if (hash === RECEIVED_HASH) {
    throw new Error('Compose already delivered — no action needed.')
  }

  // Simulate first to catch reverts early
  await hubPublicClient.simulateContract({
    address: endpoint,
    abi: LZ_ENDPOINT_ABI,
    functionName: 'lzCompose',
    args: [composeData.from, composeData.to, composeData.guid, composeData.index, composeData.message, '0x'],
    value: fee,
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: endpoint,
    abi: LZ_ENDPOINT_ABI,
    functionName: 'lzCompose',
    args: [composeData.from, composeData.to, composeData.guid, composeData.index, composeData.message, '0x'],
    value: fee,
    account,
    chain: walletClient.chain,
    gas: 5_000_000n, // initVaultActionRequest + LZ Read is gas-heavy
  })

  return { txHash }
}
