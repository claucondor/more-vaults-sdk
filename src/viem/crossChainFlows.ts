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
import { ensureAllowance, detectStargateOft } from './utils'
import { OFT_ROUTES, EID_TO_CHAIN_ID } from './chains'
import { OMNI_FACTORY_ADDRESS } from './topology'
import { createChainClient } from './spokeRoutes'
import { ComposerNotConfiguredError, InvalidInputError } from './errors'
import { parseContractError } from './errorParser'
import { getDefaultStorage, saveDepositFlow, clearDepositFlow, type FlowStorage } from './flowStorage'

/** Returns true if the error is a LZ NativeDropAmountCap revert (0x0084ce02). */
function isNativeDropCapError(e: unknown): boolean {
  return String(e).includes('0x0084ce02')
}

/** LZ Endpoint V2 address — standard deployment, used on most EVM chains */
const LZ_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c' as const

/** Chain-specific LZ Endpoint overrides (some chains deploy at a different address) */
const LZ_ENDPOINT_BY_CHAIN: Record<number, `0x${string}`> = {
  747: '0xcb566e3B6934Fa77258d68ea18E931fa75e1aaAa', // Flow EVM
}

function getLzEndpoint(chainId: number): `0x${string}` {
  return LZ_ENDPOINT_BY_CHAIN[chainId] ?? LZ_ENDPOINT
}

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
 * Encoding (LZ V2 executor options spec, per OptionsBuilder.sol):
 *   [uint16 TYPE_3=0x0003][uint8 workerId=0x01][uint16 size=0x0023][uint8 optionType=0x03][uint16 index=0x0000][uint128 gas][uint128 value]
 *   size = 1(optionType) + 2(index) + 16(gas) + 16(value) = 35 = 0x23
 */
function buildLzComposeOption(gas: bigint, nativeValue: bigint): `0x${string}` {
  const gasHex = gas.toString(16).padStart(32, '0')
  const valueHex = nativeValue.toString(16).padStart(32, '0')
  return `0x0003010023030000${gasHex}${valueHex}` as `0x${string}`
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

  if (readFeeResult.status === 'rejected') {
    console.warn('[more-vaults-sdk] resolveComposeNativeValue: quoteAccountingFee failed', readFeeResult.reason)
  }

  if (shareOftResult.status === 'rejected') {
    console.warn('[more-vaults-sdk] resolveComposeNativeValue: SHARE_OFT() failed on composer', composerAddress, shareOftResult.reason)
  } else {
    try {
      const shareOft = shareOftResult.value as Address
      console.warn('[more-vaults-sdk] resolveComposeNativeValue: calling quoteSend on', shareOft, 'dstEid', spokeEid)
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
      console.warn('[more-vaults-sdk] resolveComposeNativeValue: quoteSend ok', feeQuote.nativeFee)
      return readFee + feeQuote.nativeFee
    } catch (e) {
      console.warn('[more-vaults-sdk] resolveComposeNativeValue: quoteSend failed, using fallback', e)
    }
  }

  // Fallback: readFee covers _initDeposit; multiply for share send buffer
  console.warn('[more-vaults-sdk] resolveComposeNativeValue: using fallback readFee*5 =', readFee * 5n)
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
  options?: { storage?: FlowStorage | null },
): Promise<SpokeDepositResult> {
  const account = walletClient.account!
  const oft = getAddress(spokeOFT)

  if (amount === 0n) throw new InvalidInputError('deposit amount must be greater than zero')

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
  if (composerAddress === zeroAddress) throw new ComposerNotConfiguredError(vault)
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
  const isStargate = await detectStargateOft(publicClient, oft)
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

  // Probe: for non-Stargate OFTs that carry lzCompose native drop, verify the OFT's
  // executor config allows the native drop amount. If the executor cap is too low
  // (NativeDropAmountCap error 0x0084ce02), fall back to extraOptions='0x' and use
  // the same pending-compose flow as Stargate — the user executes TX2 via executeCompose().
  let needsPendingCompose = isStargate
  if (!isStargate && resolvedExtraOptions !== '0x') {
    try {
      await publicClient.readContract({
        address: oft, abi: OFT_ABI, functionName: 'quoteSend',
        args: [{ dstEid: hubEid, to: composerBytes32, amountLD: amount, minAmountLD: amount, extraOptions: resolvedExtraOptions, composeMsg: composeMsgBytes, oftCmd: resolvedOftCmd }, false],
      })
    } catch (e) {
      if (isNativeDropCapError(e)) {
        resolvedExtraOptions = '0x'
        needsPendingCompose = true
      }
    }
  }

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

  let guid: `0x${string}`
  try {
    const { result } = await publicClient.simulateContract({
      address: oft,
      abi: OFT_ABI,
      functionName: 'send',
      args: [sendParam, fee, account.address],
      value: lzFee,
      account: account.address,
    })
    guid = (result as unknown as [{ guid: `0x${string}` }, unknown])[0].guid
  } catch (err) {
    parseContractError(err, vault, account.address)
  }

  const txHash = await walletClient.writeContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'send',
    args: [sendParam, fee, account.address],
    value: lzFee,
    account,
    chain: walletClient.chain,
  })

  // For Stargate OFTs OR non-Stargate OFTs where native drop exceeds the executor cap:
  // return compose data so the user can execute TX2 on the hub.
  // The compose message is NOT available yet — it's emitted as ComposeSent on the hub
  // after LZ delivers the message. The user must call waitForCompose() to get it,
  // then executeCompose() to execute it.
  let composeData: ComposeData | undefined
  if (needsPendingCompose) {
    // Snapshot current hub block BEFORE waiting — this is exactly where we start
    // searching for ComposeSent events later. No guessing block ranges.
    const hubBlockStart = await hubClient.getBlockNumber()
    composeData = {
      endpoint: getLzEndpoint(hubChainId),
      from: zeroAddress, // resolved by waitForCompose — Stargate pool on hub
      to: composerAddress,
      guid: guid!,
      index: 0,
      message: '0x', // resolved by waitForCompose — from ComposeSent event
      isStargate,
      hubChainId,
      hubBlockStart,
    }
  }

  // Checkpoint: persist spoke_sent state for crash recovery (D7 path only)
  if (composeData) {
    const storage = options?.storage !== undefined ? options.storage : getDefaultStorage()
    if (storage) {
      try {
        await saveDepositFlow(storage, account.address, {
          phase: 'spoke_sent',
          txHash,
          composeData: composeData as unknown as Record<string, unknown>,
          startBlock: composeData.hubBlockStart.toString(),
          vault: vault as string,
          timestamp: Date.now(),
        })
      } catch { /* storage failure is non-fatal */ }
    }
  }

  return { txHash, guid: guid!, composeData }
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
  const isStargate = await detectStargateOft(publicClient, oft)
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

  // If native drop exceeds the executor cap, retry without native drop (pending compose flow).
  let fee: unknown
  try {
    fee = await publicClient.readContract({ address: oft, abi: OFT_ABI, functionName: 'quoteSend', args: [sendParam, false] })
  } catch (e) {
    if (isNativeDropCapError(e)) {
      fee = await publicClient.readContract({ address: oft, abi: OFT_ABI, functionName: 'quoteSend', args: [{ ...sendParam, extraOptions: '0x' as `0x${string}` }, false] })
    } else {
      throw e
    }
  }

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
  options?: { storage?: FlowStorage | null; walletAddress?: Address },
): Promise<ComposeData> {
  const deadline = Date.now() + timeoutMs
  const composer = getAddress(composeData.to)
  const endpoint = getAddress(composeData.endpoint)
  const receiverNeedle = getAddress(receiver).slice(2).toLowerCase()
  const startBlock = composeData.hubBlockStart

  // Collect all OFT addresses on the hub chain, then filter to Stargate pools on-chain
  const hubChainId = composeData.hubChainId
  const candidateAddresses: Address[] = []
  for (const chainMap of Object.values(OFT_ROUTES)) {
    const entry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    if (entry) candidateAddresses.push(getAddress(entry.oft) as Address)
  }
  const stargateChecks = await Promise.all(
    candidateAddresses.map(async (addr) => ({ addr, isSg: await detectStargateOft(hubPublicClient, addr) })),
  )
  const knownFromAddresses = stargateChecks.filter((c) => c.isSg).map((c) => c.addr)

  let attempt = 0
  // Track the highest block we've already scanned to avoid re-scanning
  let scannedUpTo = startBlock - 1n

  // Log chain info once so we can verify the client is on the right network
  try {
    const chainId = await hubPublicClient.getChainId()
    console.log(`[more-vaults-sdk] waitForCompose starting — chainId=${chainId} endpoint=${endpoint} composer=${composer} startBlock=${startBlock} receiver=0x${receiverNeedle}`)
  } catch { /* non-fatal */ }

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

          console.log(`[more-vaults-sdk] waitForCompose chunk ${from}→${chunkEnd}: ${logs.length} ComposeSent log(s)`)

          for (const log of logs) {
            const args = log.args as {
              from?: Address; to?: Address; guid?: `0x${string}`;
              index?: number; message?: `0x${string}`
            }

            const toMatch = args.to ? getAddress(args.to) === composer : false
            const msgMatch = args.message?.toLowerCase().includes(receiverNeedle) ?? false
            console.log(`[more-vaults-sdk] waitForCompose log @ block ${log.blockNumber}: to_match=${toMatch} msg_match=${msgMatch} from=${args.from}`)

            // Match by: composer address AND receiver in the message body
            if (toMatch && msgMatch) {
              // Verify this compose is still pending in composeQueue.
              // Let the error propagate to the outer catch so scannedUpTo
              // does NOT advance — the chunk will be retried next poll.
              const hash = await hubPublicClient.readContract({
                address: endpoint,
                abi: LZ_ENDPOINT_ABI,
                functionName: 'composeQueue',
                args: [getAddress(args.from!), composer, args.guid!, args.index ?? 0],
              })

              console.log(`[more-vaults-sdk] waitForCompose composeQueue hash=${hash} empty=${hash === EMPTY_HASH} received=${hash === RECEIVED_HASH}`)

              if (hash !== EMPTY_HASH && hash !== RECEIVED_HASH) {
                console.log(`[${elapsed}s] Poll #${attempt} — compose found! (block ${log.blockNumber}, scanned from ${startBlock})`)
                const fullComposeData = {
                  ...composeData,
                  from: getAddress(args.from!),
                  to: composer,
                  guid: args.guid!,
                  index: args.index ?? 0,
                  message: args.message!,
                }
                // Checkpoint: persist compose_found state for crash recovery
                if (options?.walletAddress) {
                  const storage = options?.storage !== undefined ? options.storage : getDefaultStorage()
                  if (storage) {
                    try {
                      await saveDepositFlow(storage, options.walletAddress, {
                        phase: 'compose_found',
                        composeData: fullComposeData as unknown as Record<string, unknown>,
                        timestamp: Date.now(),
                      })
                    } catch { /* non-fatal */ }
                  }
                }
                return fullComposeData
              }
            }
          }

          // Only advance scannedUpTo after getLogs + composeQueue all succeed
          scannedUpTo = chunkEnd
        } catch (e) {
          // Any failure (getLogs or composeQueue) — retry this chunk next poll
          console.log(`[more-vaults-sdk] waitForCompose chunk ${from}→${chunkEnd} failed, will retry:`, String(e).slice(0, 120))
          break
        }

        from = chunkEnd + 1n
      }
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
 * MoreVaultsEscrow.TokensLocked(bytes32 guid, address vault, address token, uint256 amount, address owner)
 * topic0 = keccak256("TokensLocked(bytes32,address,address,uint256,address)")
 * topic1 = guid, topic2 = vault, topic3 = token, data = abi.encode(amount, owner)
 */
const ESCROW_REQUEST_TOPIC = '0x304ac8b57de34b9e6118fb049ba362689cfcfab98c30c9d78e3e2e14be7e0972' as const

/**
 * MoreVaultsComposer.Sent(bytes32 guid)
 * topic0 = keccak256("Sent(bytes32)")
 * topic1 = guid — the LZ Read request guid (use for layerzeroscan tracking)
 */
const COMPOSER_SENT_TOPIC = '0x27b5aea9f5736c02241d8a0272e9ec988ea44cf85c4b4760329431aa19678394' as const

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
 * @param fee              ETH to send (from quoteComposeFee); covers readFee for D7
 * @returns                Transaction hash, optional async request GUID, optional LZ Read guid, and optional tokens-locked info
 * @throws {ComposerNotConfiguredError} If compose is not found or already delivered
 */
export async function executeCompose(
  walletClient: WalletClient,
  hubPublicClient: PublicClient,
  composeData: ComposeData,
  fee: bigint,
  options?: { storage?: FlowStorage | null },
): Promise<{
  txHash: Hash
  /** Escrow async-request GUID — use with waitForAsyncRequest for finalization polling */
  guid?: `0x${string}`
  /** LZ Read request GUID emitted by MoreVaultsComposer.Sent — use for layerzeroscan tracking */
  composerSentGuid?: `0x${string}`
  /** Tokens locked in escrow from this compose */
  tokensLocked?: { guid: `0x${string}`; vault: `0x${string}`; token: `0x${string}`; amount: bigint }
}> {
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
  try {
    await hubPublicClient.simulateContract({
      address: endpoint,
      abi: LZ_ENDPOINT_ABI,
      functionName: 'lzCompose',
      args: [composeData.from, composeData.to, composeData.guid, composeData.index, composeData.message, '0x'],
      value: fee,
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, composeData.to, account.address)
  }

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

  // Parse events from the TX receipt.
  // TokensLocked  → escrow guid (for waitForAsyncRequest) + vault/token/amount for display
  // Composer.Sent → LZ Read request guid (for layerzeroscan tracking)
  let guid: `0x${string}` | undefined
  let composerSentGuid: `0x${string}` | undefined
  let tokensLocked: { guid: `0x${string}`; vault: `0x${string}`; token: `0x${string}`; amount: bigint } | undefined
  try {
    const receipt = await hubPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })
    for (const log of receipt.logs) {
      if (log.topics[0] === ESCROW_REQUEST_TOPIC && log.topics[1] && log.topics[2] && log.topics[3]) {
        guid = log.topics[1] as `0x${string}`
        const vault = `0x${log.topics[2].slice(26)}` as `0x${string}`
        const token = `0x${log.topics[3].slice(26)}` as `0x${string}`
        // data = abi.encode(uint256 amount, address owner) — first 32 bytes is amount
        const amount = log.data.length >= 66 ? BigInt(`0x${log.data.slice(2, 66)}`) : 0n
        tokensLocked = { guid, vault, token, amount }
      }
      if (log.topics[0] === COMPOSER_SENT_TOPIC && log.topics[1]) {
        composerSentGuid = log.topics[1] as `0x${string}`
      }
    }
  } catch {
    // Receipt timeout — guid will be undefined, caller can still poll by balance
  }

  // Checkpoint: persist hub_sent state for crash recovery
  const execStorage = options?.storage !== undefined ? options.storage : getDefaultStorage()
  if (execStorage) {
    try {
      await saveDepositFlow(execStorage, account.address, {
        phase: 'hub_sent',
        guid: guid ?? '',
        vault: (tokensLocked?.vault ?? composeData.to) as string,
        composerSentGuid,
        tokensLocked: tokensLocked
          ? { ...tokensLocked, amount: tokensLocked.amount.toString() }
          : undefined,
        timestamp: Date.now(),
      })
    } catch { /* non-fatal */ }
  }

  return { txHash, guid, composerSentGuid, tokensLocked }
}
