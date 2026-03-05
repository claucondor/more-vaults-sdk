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
 * Sends tokens from the spoke chain through a LayerZero OFT, attaching a
 * composeMsg that instructs the hub-side composer to call `deposit` on the vault.
 *
 * - **D6 (oracle ON)**: composer calls `_depositAndSend` — shares arrive on spoke automatically.
 * - **D7 (oracle OFF)**: composer calls `_initDeposit` — shares may take longer (2 LZ messages).
 *
 * From the user's perspective, both D6 and D7 have the same interface.
 *
 * **User transactions on spoke chain**: 1 approve + 1 OFT.send().
 * **Wait**: Shares arrive on spoke chain via OFT after the hub processes the deposit.
 *   For D7 (async), this involves an additional LZ Read round-trip.
 *
 * @param walletClient   Wallet client on the SPOKE chain
 * @param publicClient   Public client on the SPOKE chain
 * @param spokeOFT       OFT contract address on spoke chain (e.g. USDC OFT)
 * @param hubEid         LayerZero Endpoint ID for the hub chain (Flow EVM = 30332)
 * @param hubVault       Vault address on the hub chain (used in composeMsg)
 * @param amount         Amount of tokens to send (in token decimals on spoke)
 * @param receiver       Address that will receive vault shares (on spoke chain)
 * @param lzFee          msg.value for the OFT send (quote via OFT.quoteSend)
 * @param composeMsg     Pre-encoded composeMsg for the hub-side composer.
 *                       Encodes: (address vault, address receiver, uint256 minShares)
 *                       as `abi.encode(address, address, uint256)`.
 *                       If omitted, a default encoding is built.
 * @param minAmountLD    Minimum amount received on destination (slippage on bridge).
 *                       Defaults to `amount` (no bridge slippage tolerance).
 * @param extraOptions   LZ extra options bytes for gas/value on destination
 * @returns              Transaction hash of the OFT.send() call
 */
export async function depositFromSpoke(
  walletClient: WalletClient,
  publicClient: PublicClient,
  spokeOFT: Address,
  hubEid: number,
  hubVault: Address,
  amount: bigint,
  receiver: Address,
  lzFee: bigint,
  composeMsg?: `0x${string}`,
  minAmountLD?: bigint,
  extraOptions: `0x${string}` = '0x',
): Promise<{ txHash: Hash }> {
  const account = walletClient.account!
  const oft = getAddress(spokeOFT)

  // Approve OFT for token transfer
  await ensureAllowance(walletClient, publicClient, oft, oft, amount)

  // Build default composeMsg if not provided:
  // abi.encode(address vault, address receiver, uint256 minSharesOut)
  const composeMsgBytes =
    composeMsg ??
    encodeAbiParameters(
      [
        { type: 'address', name: 'vault' },
        { type: 'address', name: 'receiver' },
        { type: 'uint256', name: 'minSharesOut' },
      ],
      [getAddress(hubVault), getAddress(receiver), 0n],
    )

  // Encode receiver as bytes32 (left-padded)
  const toBytes32 = pad(getAddress(receiver), { size: 32 })

  const sendParam = {
    dstEid: hubEid,
    to: toBytes32,
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
