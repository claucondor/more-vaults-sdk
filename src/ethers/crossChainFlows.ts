import { Contract, AbiCoder, zeroPadValue, Signer } from "ethers";
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
// D6 -- Spoke -> Hub OFT Compose (oracle ON, sync)
// ---------------------------------------------------------------------------

/**
 * Deposit from a spoke chain to the hub vault via OFT compose message.
 *
 * The underlying tokens are bridged through a LayerZero OFT and a compose
 * message triggers the deposit on the hub chain. Shares arrive back on the
 * spoke chain automatically via LZ callback.
 *
 * TXs: 1 approve (if needed) + 1 OFT.send().
 * Wait: LayerZero cross-chain delivery (typically 1-5 minutes).
 *
 * @param signer     - Wallet on the spoke chain.
 * @param spokeOFT   - OFT/OFTAdapter address on the spoke chain.
 * @param hubVault   - Hub vault (diamond) address on the hub chain.
 * @param amount     - Amount of underlying tokens to bridge and deposit.
 * @param receiver   - Address that will receive shares (on spoke chain).
 * @param lzFee      - Native fee for LayerZero message (use quoteSend).
 * @param dstEid     - LayerZero endpoint ID for the hub chain (e.g. 30332 for Flow EVM).
 * @returns Transaction receipt.
 */
export async function depositFromSpoke(
  signer: Signer,
  spokeOFT: string,
  hubVault: string,
  amount: bigint,
  receiver: string,
  lzFee: bigint,
  dstEid: number = 30332
): Promise<{ receipt: ContractTransactionReceipt }> {
  await ensureAllowance(signer, spokeOFT, spokeOFT, amount);

  const oft = new Contract(spokeOFT, OFT_ABI, signer);
  const refundAddress = await signer.getAddress();

  // Pad receiver to bytes32 for LZ
  const toBytes32 = zeroPadValue(receiver, 32);

  // Build composeMsg: abi.encode(hubVault, receiver)
  const coder = AbiCoder.defaultAbiCoder();
  const composeMsg = coder.encode(
    ["address", "address"],
    [hubVault, receiver]
  );

  const sendParam = {
    dstEid,
    to: toBytes32,
    amountLD: amount,
    minAmountLD: (amount * 99n) / 100n, // 1% slippage tolerance
    extraOptions: "0x",
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
 * Deposit from a spoke chain when cross-chain oracle is OFF.
 * Same UX as D6 -- the async resolution is transparent to the user.
 * The compose message triggers an async request on the hub side.
 *
 * TXs: 1 approve (if needed) + 1 OFT.send().
 * Wait: LayerZero delivery + async cross-chain fulfillment.
 */
export const depositFromSpokeAsync = depositFromSpoke;
