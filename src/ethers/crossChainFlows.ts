import { Contract, AbiCoder, zeroPadValue, Signer, Provider } from "ethers";
import { ERC20_ABI, OFT_ABI } from "./abis";
import type { ContractTransactionReceipt } from "ethers";

/**
 * Ensure `spender` has at least `amount` allowance from `owner`.
 */
async function ensureAllowance(
  signer: Signer,
  token: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const owner = await signer.getAddress();
  const erc20 = new Contract(token, ERC20_ABI, signer);
  const current: bigint = await erc20.allowance(owner, spender);
  if (current < amount) {
    const tx = await erc20.approve(spender, amount);
    await tx.wait();
  }
}

// ---------------------------------------------------------------------------
// D6 / D7 — Spoke → Hub, OFT Compose deposit
// ---------------------------------------------------------------------------

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
 * TXs: 1 approve (if needed) + 1 OFT.send().
 * Wait: LayerZero cross-chain delivery (typically 1-5 minutes).
 *
 * @param signer        - Wallet on the spoke chain.
 * @param spokeOFT      - OFT/OFTAdapter address on the spoke chain.
 * @param hubEid        - LayerZero EID for the hub chain (e.g. 30336 for Flow EVM).
 * @param spokeEid      - LayerZero EID for the spoke chain — where shares are sent back.
 * @param amount        - Amount of underlying tokens to bridge and deposit.
 * @param receiver      - Address that will receive shares on the spoke chain.
 * @param lzFee         - Native fee for the OFT.send() call. Must cover both hub-bound
 *                        and return (shares back) messages. Quote via OFT.quoteSend().
 * @param minMsgValue   - Minimum msg.value the hub composer must receive to process
 *                        the compose and send shares back. Defaults to 0.
 * @param minSharesOut  - Minimum shares to receive after deposit (slippage protection).
 *                        Defaults to 0.
 * @param minAmountLD   - Minimum tokens received on hub after bridge. Defaults to `amount`.
 * @param extraOptions  - LZ extra options bytes for the hub-bound message.
 * @returns Transaction receipt.
 */
export async function depositFromSpoke(
  signer: Signer,
  spokeOFT: string,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  receiver: string,
  lzFee: bigint,
  minMsgValue: bigint = 0n,
  minSharesOut: bigint = 0n,
  minAmountLD?: bigint,
  extraOptions: string = "0x",
): Promise<{ receipt: ContractTransactionReceipt }> {
  await ensureAllowance(signer, spokeOFT, spokeOFT, amount);

  const oft = new Contract(spokeOFT, OFT_ABI, signer);
  const refundAddress = await signer.getAddress();

  // Pad receiver to bytes32 for LZ
  const receiverBytes32 = zeroPadValue(receiver, 32);

  // Build hopSendParam: tells the hub composer where to send shares back.
  // dstEid = spoke chain, receiver = shares recipient, amountLD = 0 (overwritten by composer).
  const hopSendParam = {
    dstEid: spokeEid,
    to: receiverBytes32,
    amountLD: 0n,
    minAmountLD: minSharesOut,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };

  // composeMsg = abi.encode(SendParam hopSendParam, uint256 minMsgValue)
  // This is what MoreVaultsComposer.handleCompose() decodes.
  const coder = AbiCoder.defaultAbiCoder();
  const composeMsg = coder.encode(
    [
      "tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)",
      "uint256",
    ],
    [hopSendParam, minMsgValue],
  );

  const sendParam = {
    dstEid: hubEid,
    to: receiverBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions,
    composeMsg,
    oftCmd: "0x",
  };

  const msgFee = { nativeFee: lzFee, lzTokenFee: 0n };

  const tx = await oft.send(sendParam, msgFee, refundAddress, {
    value: lzFee,
  });
  const receipt = await tx.wait();

  return { receipt };
}

// ---------------------------------------------------------------------------
// D7 -- Spoke -> Hub OFT Compose (oracle OFF, async)
// ---------------------------------------------------------------------------

/**
 * Alias: D7 — Spoke to hub deposit when oracle is OFF (async resolution).
 * Same interface as D6; the difference is handled server-side by the composer contract.
 * Shares may take longer to arrive due to the additional LZ Read round-trip.
 */
export const depositFromSpokeAsync = depositFromSpoke;

// ---------------------------------------------------------------------------
// Fee quote helper
// ---------------------------------------------------------------------------

/**
 * Quote the LayerZero fee required for depositFromSpoke / depositFromSpokeAsync.
 *
 * @param provider       Read-only provider on the SPOKE chain
 * @param spokeOFT       OFT contract address on spoke chain
 * @param hubEid         LayerZero EID for the hub chain
 * @param spokeEid       LayerZero EID for the spoke chain
 * @param amount         Amount of tokens to bridge
 * @param receiver       Address that will receive vault shares on the spoke chain
 * @param minMsgValue    Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minSharesOut   Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minAmountLD    Minimum tokens on hub after bridge (default: amount)
 * @param extraOptions   LZ extra options (default 0x)
 * @returns              Native fee in wei to pass as lzFee to depositFromSpoke
 */
export async function quoteDepositFromSpokeFee(
  provider: Provider,
  spokeOFT: string,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  receiver: string,
  minMsgValue: bigint = 0n,
  minSharesOut: bigint = 0n,
  minAmountLD?: bigint,
  extraOptions: string = "0x"
): Promise<bigint> {
  const receiverBytes32 = zeroPadValue(receiver, 32);

  const hopSendParam = {
    dstEid: spokeEid,
    to: receiverBytes32,
    amountLD: 0n,
    minAmountLD: minSharesOut,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };

  const coder = AbiCoder.defaultAbiCoder();
  const composeMsgBytes = coder.encode(
    ["tuple(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)", "uint256"],
    [
      [
        hopSendParam.dstEid,
        hopSendParam.to,
        hopSendParam.amountLD,
        hopSendParam.minAmountLD,
        hopSendParam.extraOptions,
        hopSendParam.composeMsg,
        hopSendParam.oftCmd,
      ],
      minMsgValue,
    ]
  );

  const sendParam = {
    dstEid: hubEid,
    to: receiverBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions,
    composeMsg: composeMsgBytes,
    oftCmd: "0x",
  };

  const oft = new Contract(spokeOFT, OFT_ABI, provider);
  const fee = await oft.quoteSend(sendParam, false);
  return fee.nativeFee as bigint;
}
