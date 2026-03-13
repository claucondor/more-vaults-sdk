import { Contract, AbiCoder, zeroPadValue, Signer, Provider, ZeroAddress } from "ethers";
import {
  VAULT_ABI,
  BRIDGE_ABI,
  ERC20_ABI,
  OFT_ABI,
} from "./abis";
import {
  VaultAddresses,
  RedeemResult,
  AsyncRequestResult,
  ActionType,
} from "./types";
import type { ContractTransactionReceipt } from "ethers";
import { preflightAsync, preflightRedeemLiquidity } from "./preflight";
import { EscrowNotConfiguredError } from "./errors";
import { validateWalletChain } from "./chainValidation";
import { getVaultStatus, quoteLzFee } from "./utils";

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
// R1 -- Simple redeem
// ---------------------------------------------------------------------------

/**
 * Redeem `shares` for underlying assets.
 *
 * TXs: 1 redeem.
 * Pre-condition: if withdrawal queue is enabled, `requestRedeem` must have
 * been called and the timelock must have elapsed.
 *
 * @param signer    - Wallet holding the shares.
 * @param addresses - Vault addresses. Only `vault` is used.
 * @param shares    - Number of shares to redeem.
 * @param receiver  - Address that will receive the underlying assets.
 * @param owner     - Address that owns the shares.
 * @returns Assets received and the transaction receipt.
 */
export async function redeemShares(
  signer: Signer,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: string,
  owner: string
): Promise<RedeemResult> {
  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);

  // Static call to get the return value (assets) before broadcasting
  const assets: bigint = await vault.redeem.staticCall(shares, receiver, owner);

  const tx = await vault.redeem(shares, receiver, owner);
  const receipt = await tx.wait();

  return { receipt, assets };
}

// ---------------------------------------------------------------------------
// R2 -- Simple withdraw
// ---------------------------------------------------------------------------

/**
 * Withdraw exact `assets` amount of underlying tokens by burning shares.
 *
 * TXs: 1 withdraw.
 *
 * @param signer    - Wallet holding the shares.
 * @param addresses - Vault addresses. Only `vault` is used.
 * @param assets    - Exact amount of underlying tokens to withdraw.
 * @param receiver  - Address that will receive the tokens.
 * @param owner     - Address that owns the shares.
 * @returns Assets received and the transaction receipt.
 */
export async function withdrawAssets(
  signer: Signer,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: string,
  owner: string
): Promise<RedeemResult> {
  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  const tx = await vault.withdraw(assets, receiver, owner);
  const receipt = await tx.wait();

  return { receipt, assets };
}

// ---------------------------------------------------------------------------
// R3 -- Queue redeem, no timelock (2 TXs)
// ---------------------------------------------------------------------------

/**
 * Submit a withdrawal queue request for `shares`.
 *
 * TXs: 1 requestRedeem.
 * After this call and once any timelock elapses, call `redeemShares()` to
 * complete the withdrawal.
 *
 * @param signer    - Wallet holding the shares.
 * @param addresses - Vault addresses. Only `vault` is used.
 * @param shares    - Number of shares to queue for redemption.
 * @param owner     - Address on whose behalf to request.
 * @returns Transaction receipt.
 */
export async function requestRedeem(
  signer: Signer,
  addresses: VaultAddresses,
  shares: bigint,
  owner: string
): Promise<{ receipt: ContractTransactionReceipt }> {
  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  const tx = await vault.requestRedeem(shares, owner);
  const receipt = await tx.wait();
  return { receipt };
}

// ---------------------------------------------------------------------------
// R4 -- Queue redeem with timelock (helper to check status)
// ---------------------------------------------------------------------------

/**
 * Get the current withdrawal request for an owner.
 * Returns null if no pending request exists.
 *
 * @param provider - JSON-RPC provider.
 * @param vault    - Vault (diamond) address.
 * @param owner    - Address of the shares owner.
 * @returns The request details or null.
 */
export async function getWithdrawalRequest(
  provider: Provider,
  vault: string,
  owner: string
): Promise<{ shares: bigint; timelockEndsAt: bigint } | null> {
  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  const [shares, timelockEndsAt]: [bigint, bigint] =
    await vaultContract.getWithdrawalRequest(owner);

  if (shares === 0n) {
    return null;
  }

  return { shares, timelockEndsAt };
}

// ---------------------------------------------------------------------------
// R5 -- Cross-chain oracle OFF, async redeem
// ---------------------------------------------------------------------------

/**
 * Initiate an asynchronous cross-chain redeem request.
 *
 * CRITICAL: shares are approved to the **escrow** address (vault share token).
 * amountLimit MUST be 0 for redeems.
 *
 * TXs: 1 approve to escrow for shares (if needed) + 1 initVaultActionRequest.
 * Wait: LayerZero cross-chain fulfillment.
 *
 * @param signer       - Wallet holding the shares.
 * @param addresses    - Must include `vault` and `escrow`.
 * @param shares       - Number of shares to redeem.
 * @param receiver     - Address that will receive the underlying assets.
 * @param owner        - Address that owns the shares.
 * @param lzFee        - Native fee for LayerZero message.
 * @param extraOptions - Optional LZ adapter parameters (bytes).
 * @returns The request GUID for tracking and the transaction receipt.
 */
export async function redeemAsync(
  signer: Signer,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: string,
  owner: string,
  lzFee: bigint,
  extraOptions: string = "0x"
): Promise<AsyncRequestResult> {
  const provider = signer.provider!;
  const escrow = addresses.escrow
    ?? await new Contract(addresses.vault, ['function getEscrow() view returns (address)'], provider).getEscrow()
  if (escrow === ZeroAddress) throw new EscrowNotConfiguredError(addresses.vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  // Pre-flight: validate async cross-chain setup before sending any transaction
  await preflightAsync(provider, addresses.vault, escrow);

  // Pre-flight: check hub has enough liquid assets — avoids wasting LZ fee on a guaranteed refund
  await preflightRedeemLiquidity(provider, addresses.vault, shares);

  // CRITICAL: approve ESCROW for shares (the vault token itself)
  await ensureAllowance(signer, addresses.vault, escrow, shares);

  const coder = AbiCoder.defaultAbiCoder();
  const actionCallData = coder.encode(
    ["uint256", "address", "address"],
    [shares, receiver, owner]
  );

  const bridge = new Contract(addresses.vault, BRIDGE_ABI, signer);

  // Static call first to capture the return value (guid) before broadcasting
  const guid: string = await bridge.initVaultActionRequest.staticCall(
    ActionType.REDEEM,
    actionCallData,
    0,
    extraOptions,
    { value: lzFee }
  );

  const tx = await bridge.initVaultActionRequest(
    ActionType.REDEEM,
    actionCallData,
    0, // amountLimit MUST be 0 for redeems
    extraOptions,
    { value: lzFee }
  );
  const receipt = await tx.wait();

  return { receipt, guid };
}

// ---------------------------------------------------------------------------
// R6 -- Spoke -> Hub redeem (step 1: bridge shares to hub)
// ---------------------------------------------------------------------------

/**
 * Bridge shares from a spoke chain to the hub chain (step 1 of 2).
 *
 * After the shares arrive on the hub chain, call `redeemShares()` on the
 * hub to complete the redemption.
 *
 * TXs: 1 approve (if needed) + 1 OFT.send().
 * Wait: LayerZero delivery (typically 1-5 minutes).
 *
 * @param signer      - Wallet on the spoke chain holding shares.
 * @param shareOFT    - OFTAdapter address for the share token on spoke.
 * @param hubChainEid - LayerZero endpoint ID for the hub chain (e.g. 30336 for Flow EVM).
 * @param shares      - Number of shares to bridge.
 * @param receiver    - Address on hub chain that will receive the shares.
 * @param lzFee       - Native fee for LayerZero message.
 * @returns Transaction receipt.
 */
export async function bridgeSharesToHub(
  signer: Signer,
  shareOFT: string,
  hubChainEid: number,
  shares: bigint,
  receiver: string,
  lzFee: bigint
): Promise<{ receipt: ContractTransactionReceipt }> {
  await ensureAllowance(signer, shareOFT, shareOFT, shares);

  const oft = new Contract(shareOFT, OFT_ABI, signer);
  const refundAddress = await signer.getAddress();
  const toBytes32 = zeroPadValue(receiver, 32);

  const sendParam = {
    dstEid: hubChainEid,
    to: toBytes32,
    amountLD: shares,
    minAmountLD: shares, // no slippage on share bridging
    extraOptions: "0x",
    composeMsg: "0x",
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
// Smart redeem -- auto-detect vault type
// ---------------------------------------------------------------------------

/**
 * Smart redeem — auto-selects the correct flow based on vault configuration.
 *
 * Detects the vault mode and dispatches to:
 * - Sync vaults (local / cross-chain-oracle): `redeemShares`
 * - Async vaults (cross-chain, oracle OFF): `redeemAsync` (quotes LZ fee automatically)
 *
 * @param signer         Wallet signer with account attached
 * @param addresses      Vault address set (`escrow` required for async vaults)
 * @param shares         Amount of shares to redeem
 * @param receiver       Address that will receive the underlying assets
 * @param owner          Owner of the shares being redeemed
 * @param extraOptions   Optional LZ extra options (only used for async vaults)
 * @returns              RedeemResult or AsyncRequestResult depending on vault mode
 */
export async function smartRedeem(
  signer: Signer,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: string,
  owner: string,
  extraOptions: string = "0x"
): Promise<RedeemResult | AsyncRequestResult> {
  const provider = signer.provider!;
  const vault = addresses.vault;
  const status = await getVaultStatus(provider, vault);

  if (status.mode === "paused") {
    throw new Error(`[MoreVaults] Vault ${vault} is paused. Cannot redeem.`);
  }

  if (status.recommendedDepositFlow === "depositAsync") {
    // Async vault — use redeemAsync
    const lzFee = await quoteLzFee(provider, vault, extraOptions);
    return redeemAsync(signer, addresses, shares, receiver, owner, lzFee, extraOptions);
  }

  // Sync vault — direct redeem
  return redeemShares(signer, addresses, shares, receiver, owner);
}

// ---------------------------------------------------------------------------
// R7 -- Bridge assets from hub back to spoke
// ---------------------------------------------------------------------------

/**
 * Bridge underlying assets from hub back to spoke chain via OFT.
 *
 * Step 3 of the full spoke redeem flow:
 *   1. bridgeSharesToHub() — shares spoke->hub
 *   2. smartRedeem() — redeem on hub
 *   3. bridgeAssetsToSpoke() — assets hub->spoke
 *
 * @param signer         Wallet signer on the HUB chain
 * @param assetOFT       OFT address for the underlying asset on hub
 * @param spokeChainEid  LayerZero EID for the spoke (destination) chain
 * @param amount         Amount of underlying assets to bridge
 * @param receiver       Receiver address on the spoke chain
 * @param lzFee          OFT send fee (quote via OFT.quoteSend)
 * @param isStargate     Whether this is a Stargate OFT (uses TAXI mode)
 * @returns              Transaction receipt
 */
export async function bridgeAssetsToSpoke(
  signer: Signer,
  assetOFT: string,
  spokeChainEid: number,
  amount: bigint,
  receiver: string,
  lzFee: bigint,
  isStargate: boolean = true
): Promise<{ receipt: ContractTransactionReceipt }> {
  const oft = new Contract(assetOFT, OFT_ABI, signer);

  // Read underlying token and approve
  const token: string = await oft.token();
  if (token.toLowerCase() !== assetOFT.toLowerCase()) {
    await ensureAllowance(signer, token, assetOFT, amount);
  } else {
    await ensureAllowance(signer, assetOFT, assetOFT, amount);
  }

  const refundAddress = await signer.getAddress();
  const toBytes32 = zeroPadValue(receiver, 32);

  const sendParam = {
    dstEid: spokeChainEid,
    to: toBytes32,
    amountLD: amount,
    minAmountLD: amount * 99n / 100n, // 1% slippage for Stargate
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: isStargate ? "0x01" : "0x",
  };

  const msgFee = { nativeFee: lzFee, lzTokenFee: 0n };

  const tx = await oft.send(sendParam, msgFee, refundAddress, {
    value: lzFee,
  });
  const receipt = await tx.wait();

  return { receipt };
}
