import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  encodeAbiParameters,
  getAddress,
  pad,
} from 'viem'
import { OFT_ABI, ERC20_ABI } from './abis'
import { ensureAllowance } from './utils'

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
 * @param walletClient   Wallet client on the SPOKE chain
 * @param publicClient   Public client on the SPOKE chain
 * @param spokeOFT       OFT contract address on spoke chain (e.g. USDC OFT adapter)
 * @param hubEid         LayerZero EID for the hub chain — where tokens are sent (e.g. Flow EVM = 30332)
 * @param spokeEid       LayerZero EID for the spoke chain — where shares are sent back
 * @param amount         Amount of tokens to bridge (in spoke token decimals)
 * @param receiver       Address that will receive vault shares on the spoke chain
 * @param lzFee          msg.value for the OFT.send() call. Must cover both the
 *                       hub-bound LZ message AND the return message (shares back).
 *                       Quote via `OFT.quoteSend()` with compose enabled.
 * @param minMsgValue    Minimum msg.value the hub composer must receive to process the
 *                       compose and send shares back. Defaults to 0 (no minimum check).
 * @param minSharesOut   Minimum shares to receive after deposit (slippage protection).
 *                       Defaults to 0 (no slippage check).
 * @param minAmountLD    Minimum tokens received on hub after bridge (slippage on OFT bridge).
 *                       Defaults to `amount` (no bridge slippage tolerance).
 * @param extraOptions   LZ extra options bytes for the hub-bound message
 * @returns              Transaction hash of the OFT.send() call
 */
export async function depositFromSpoke(
  walletClient: WalletClient,
  publicClient: PublicClient,
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
): Promise<{ txHash: Hash }> {
  const account = walletClient.account!
  const oft = getAddress(spokeOFT)

  // Approve OFT for token transfer
  await ensureAllowance(walletClient, publicClient, oft, oft, amount)

  // Build hopSendParam: tells the hub composer where to send shares back.
  // dstEid = spoke chain, receiver = shares recipient, amountLD = 0 (overwritten by composer).
  const receiverBytes32 = pad(getAddress(receiver), { size: 32 })
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

  const sendParam = {
    dstEid: hubEid,
    to: receiverBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions,
    composeMsg: composeMsgBytes,
    oftCmd: '0x' as `0x${string}`,
  }

  const fee = {
    nativeFee: lzFee,
    lzTokenFee: 0n,
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

  return { txHash }
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
  const receiverBytes32 = pad(getAddress(receiver), { size: 32 })

  // Build hopSendParam — same as in depositFromSpoke
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
    to: receiverBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions,
    composeMsg: composeMsgBytes,
    oftCmd: '0x' as `0x${string}`,
  }

  const fee = await publicClient.readContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [sendParam, false],
  })

  return (fee as { nativeFee: bigint; lzTokenFee: bigint }).nativeFee
}
