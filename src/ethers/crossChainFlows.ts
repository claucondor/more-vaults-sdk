import { Contract, AbiCoder, zeroPadValue, Signer, Provider } from "ethers";
import { ERC20_ABI, OFT_ABI, BRIDGE_ABI, LZ_ENDPOINT_ABI } from "./abis";
import type { ContractTransactionReceipt } from "ethers";

/** LZ Endpoint V2 address — same on all EVM chains */
const LZ_ENDPOINT = "0x1a44076050125825900e736c501f859c50fe728c";

const EMPTY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const RECEIVED_HASH = "0x0000000000000000000000000000000000000000000000000000000000000001";

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
 * composeMsg that instructs the hub-side MoreVaultsComposer to deposit into the vault.
 * Shares are delivered on the hub chain (local safeTransfer).
 *
 * - **D6 (oracle ON)**: composer calls `_depositAndSend` — shares arrive immediately on hub.
 * - **D7 (oracle OFF)**: composer calls `_initDeposit` — requires an additional LZ Read round-trip.
 *
 * TXs: 1 approve (if needed) + 1 OFT.send().
 *
 * @param signer        - Wallet on the spoke chain.
 * @param spokeOFT      - OFT/OFTAdapter address on the spoke chain.
 * @param composer      - MoreVaultsComposer address on the hub chain.
 * @param hubEid        - LayerZero EID for the hub chain.
 * @param spokeEid      - LayerZero EID for the spoke chain — where shares are sent back.
 * @param amount        - Amount of underlying tokens to bridge and deposit.
 * @param receiver      - Address that will receive shares on the hub chain.
 * @param lzFee         - Native fee for the OFT.send() call.
 * @param minMsgValue   - Minimum msg.value the hub composer must receive (default 0).
 * @param minSharesOut  - Minimum shares to receive after deposit (default 0).
 * @param minAmountLD   - Minimum tokens received on hub after bridge (default: amount).
 * @param extraOptions  - LZ extra options bytes (default '0x').
 * @returns Transaction receipt.
 */
export async function depositFromSpoke(
  signer: Signer,
  spokeOFT: string,
  composer: string,
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

  const receiverBytes32 = zeroPadValue(receiver, 32);
  const composerBytes32 = zeroPadValue(composer, 32);

  // hopSendParam: dstEid = spokeEid → shares sent back to user on spoke via SHARE_OFT
  // Requires SHARE_OFT peers + enforcedOptions configured on both chains.
  // For Stargate OFTs: compose stays pending (msg.value=0), user retries via executeCompose.
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
  const composeMsg = coder.encode(
    [
      "tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)",
      "uint256",
    ],
    [hopSendParam, minMsgValue],
  );

  const sendParam = {
    dstEid: hubEid,
    to: composerBytes32,
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
 */
export const depositFromSpokeAsync = depositFromSpoke;

// ---------------------------------------------------------------------------
// Fee quote helper
// ---------------------------------------------------------------------------

/**
 * Quote the LayerZero fee required for depositFromSpoke.
 *
 * @param provider       Read-only provider on the SPOKE chain
 * @param spokeOFT       OFT contract address on spoke chain
 * @param composer       MoreVaultsComposer address on the hub chain
 * @param hubEid         LayerZero EID for the hub chain
 * @param amount         Amount of tokens to bridge
 * @param receiver       Address that will receive vault shares
 * @param minMsgValue    Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minSharesOut   Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minAmountLD    Minimum tokens on hub after bridge (default: amount)
 * @param extraOptions   LZ extra options (default 0x)
 * @returns              Native fee in wei
 */
export async function quoteDepositFromSpokeFee(
  provider: Provider,
  spokeOFT: string,
  composer: string,
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
  const composerBytes32 = zeroPadValue(composer, 32);

  // hopSendParam with dstEid=spokeEid → shares go back to spoke via SHARE_OFT
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
    to: composerBytes32,
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

// ---------------------------------------------------------------------------
// Stargate 2-TX compose helpers
// ---------------------------------------------------------------------------

/**
 * Quote the ETH needed to execute a pending compose on the hub chain.
 *
 * For D7 (oracle OFF) vaults, the composer needs ETH to cover:
 *   1. `readFee` for `vault.initVaultActionRequest`
 *   2. `shareSendFee` for `SHARE_OFT.send()` to deliver shares to the spoke chain
 *
 * @param provider   Read-only provider on the HUB chain
 * @param vault      Vault address on the hub
 * @param spokeEid   Destination EID for share delivery (optional — improves accuracy)
 * @param receiver   Receiver address on the spoke chain (optional — improves accuracy)
 * @returns          ETH amount in wei to send with executeCompose
 */
export async function quoteComposeFee(
  provider: Provider,
  vault: string,
  spokeEid?: number,
  receiver?: string,
): Promise<bigint> {
  try {
    const vaultContract = new Contract(vault, BRIDGE_ABI, provider);
    const readFee: bigint = await vaultContract.quoteAccountingFee("0x");

    // If spokeEid provided, also quote the SHARE_OFT send fee
    let shareSendFee = 0n;
    if (spokeEid && receiver) {
      try {
        const COMPOSER_ABI = ["function SHARE_OFT() view returns (address)"];
        const FACTORY_ABI = ["function vaultComposer(address _vault) view returns (address)"];
        const factory = new Contract("0x7bDB8B17604b03125eFAED33cA0c55FBf856BB0C", FACTORY_ABI, provider);
        const composerAddr: string = await factory.vaultComposer(vault);
        const composer = new Contract(composerAddr, COMPOSER_ABI, provider);
        const shareOftAddr: string = await composer.SHARE_OFT();
        const shareOft = new Contract(shareOftAddr, OFT_ABI, provider);

        const receiverBytes32 = zeroPadValue(receiver, 32);
        const fee = await shareOft.quoteSend({
          dstEid: spokeEid,
          to: receiverBytes32,
          amountLD: 1_000_000n,
          minAmountLD: 0n,
          extraOptions: "0x",
          composeMsg: "0x",
          oftCmd: "0x",
        }, false);
        shareSendFee = fee.nativeFee as bigint;
      } catch { /* fallback to readFee only */ }
    }

    return (readFee + shareSendFee) * 110n / 100n; // 10% buffer
  } catch {
    return 500_000_000_000_000n; // 0.0005 ETH fallback
  }
}

/**
 * Execute a pending LZ compose on the hub chain (Stargate 2-TX flow, step 2).
 *
 * Calls `endpoint.lzCompose{value: fee}(from, to, guid, index, message, '0x')`.
 *
 * @param signer      Wallet on the HUB chain
 * @param from        Stargate pool address on hub (from ComposeSent event)
 * @param to          MoreVaultsComposer address on hub
 * @param guid        LayerZero GUID from the original OFT.send()
 * @param message     Full compose message bytes (from ComposeSent event)
 * @param fee         ETH to send (from quoteComposeFee)
 * @param index       Compose index (default 0)
 * @returns           Transaction receipt
 */
export async function executeCompose(
  signer: Signer,
  from: string,
  to: string,
  guid: string,
  message: string,
  fee: bigint,
  index: number = 0,
): Promise<{ receipt: ContractTransactionReceipt }> {
  const endpoint = new Contract(LZ_ENDPOINT, LZ_ENDPOINT_ABI, signer);

  // Verify compose is still pending
  const hash: string = await endpoint.composeQueue(from, to, guid, index);
  if (hash === EMPTY_HASH) {
    throw new Error("Compose not found in queue (hash = 0). Never sent or wrong parameters.");
  }
  if (hash === RECEIVED_HASH) {
    throw new Error("Compose already delivered — no action needed.");
  }

  const tx = await endpoint.lzCompose(from, to, guid, index, message, "0x", {
    value: fee,
    gasLimit: 5_000_000n,
  });
  const receipt = await tx.wait();

  return { receipt };
}
