import { Contract, AbiCoder, zeroPadValue, Signer, Provider, ZeroAddress } from "ethers";
import {
  VAULT_ABI,
  VAULT_REQUEST_REDEEM_LEGACY_ABI,
  BRIDGE_ABI,
  ERC20_ABI,
  OFT_ABI,
} from "./abis";
import {
  VaultAddresses,
  RedeemResult,
  AsyncRequestResult,
  RedeemCostEstimate,
  ActionType,
} from "./types";
import type { ContractTransactionReceipt } from "ethers";
import { preflightAsync, preflightRedeemLiquidity } from "./preflight";
import { EscrowNotConfiguredError, InvalidInputError, VaultPausedError, WithdrawalTimelockActiveError, WithdrawalQueueDisabledError } from "./errors";
import { validateWalletChain } from "./chainValidation";
import { getVaultStatus, quoteLzFee, detectStargateOft } from "./utils";
import { CHAIN_ID_TO_EID, OFT_ROUTES, createChainProvider } from "./chains";
import { OMNI_FACTORY_ADDRESS } from "./topology";
import { parseContractError } from "./errorParser";

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
  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);

  // Static call to get the return value (assets) before broadcasting
  let assets: bigint
  try {
    assets = await vault.redeem.staticCall(shares, receiver, owner);
  } catch (err) {
    parseContractError(err, addresses.vault)
  }

  let tx: any
  try {
    tx = await vault.redeem(shares, receiver, owner);
  } catch (err) {
    parseContractError(err, addresses.vault)
  }
  const receipt = await tx!.wait();

  return { receipt, assets: assets! };
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
  if (assets === 0n) throw new InvalidInputError('assets amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  let tx: any
  try {
    tx = await vault.withdraw(assets, receiver, owner);
  } catch (err) {
    parseContractError(err, addresses.vault)
  }
  const receipt = await tx!.wait();

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
  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  // Pre-check: vault must have withdrawal queue enabled — otherwise the contract
  // reverts with WithdrawalQueueDisabled (0xdbb22fbf). Use redeemShares directly
  // or smartRedeem which auto-selects the correct flow.
  const provider = signer.provider!
  const configRead = new Contract(addresses.vault, ['function getWithdrawalQueueStatus() view returns (bool)'], provider)
  const queueEnabled: boolean = await configRead.getWithdrawalQueueStatus()
  if (!queueEnabled) {
    throw new WithdrawalQueueDisabledError(addresses.vault)
  }

  // Detect which signature the vault supports: new (uint256, address) or legacy (uint256)
  let useLegacy = false
  const vaultNew = new Contract(addresses.vault, VAULT_ABI, signer)

  try {
    await vaultNew.requestRedeem.staticCall(shares, owner)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('FunctionDoesNotExist') || msg.includes('0xa9ad62f8')) {
      useLegacy = true
    } else {
      parseContractError(err, addresses.vault)
    }
  }

  let tx: any
  if (useLegacy) {
    const vaultLegacy = new Contract(addresses.vault, VAULT_REQUEST_REDEEM_LEGACY_ABI, signer)
    try {
      tx = await vaultLegacy.requestRedeem(shares)
    } catch (err) {
      parseContractError(err, addresses.vault)
    }
  } else {
    try {
      tx = await vaultNew.requestRedeem(shares, owner)
    } catch (err) {
      parseContractError(err, addresses.vault)
    }
  }

  const receipt = await tx!.wait();
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
  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

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
  let guid: string
  try {
    guid = await bridge.initVaultActionRequest.staticCall(
      ActionType.REDEEM,
      actionCallData,
      0,
      extraOptions,
      { value: lzFee }
    );
  } catch (err) {
    parseContractError(err, addresses.vault)
  }

  let tx: any
  try {
    tx = await bridge.initVaultActionRequest(
      ActionType.REDEEM,
      actionCallData,
      0, // amountLimit MUST be 0 for redeems
      extraOptions,
      { value: lzFee }
    );
  } catch (err) {
    parseContractError(err, addresses.vault)
  }
  const receipt = await tx!.wait();

  return { receipt, guid: guid! };
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
  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

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
 * Estimate the gas cost of closing a position (redeeming shares).
 *
 * Detects the vault mode and returns a per-step gas breakdown without
 * sending any transaction. For async vaults the LayerZero fee is also quoted.
 *
 * @param provider      Provider for reads and gas estimation
 * @param addresses     Vault address set
 * @param shares        Amount of shares to redeem
 * @param receiver      Address that will receive the underlying assets
 * @param owner         Owner of the shares
 * @param extraOptions  Optional LZ extra options (only used for async vaults)
 * @returns             Cost estimate with per-step gas breakdown and total
 */
export async function estimateRedeemCost(
  provider: Provider,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: string,
  owner: string,
  extraOptions: string = "0x",
): Promise<RedeemCostEstimate> {
  const vault = addresses.vault;
  const status = await getVaultStatus(provider, vault);

  if (status.mode === "paused") throw new VaultPausedError(vault);

  // --- Async vault ---
  if (status.recommendedDepositFlow === "depositAsync") {
    const lzFee = await quoteLzFee(provider, vault, extraOptions);

    const abiCoder = AbiCoder.defaultAbiCoder();
    const actionCallData = abiCoder.encode(
      ["uint256", "address", "address"],
      [shares, receiver, owner],
    );

    const vaultContract = new Contract(vault, BRIDGE_ABI, provider);
    let requestGas = 0n;
    try {
      const raw = await vaultContract.initVaultActionRequest.estimateGas(
        ActionType.REDEEM, actionCallData, 0n, extraOptions,
        { value: lzFee, from: owner },
      );
      requestGas = (BigInt(raw.toString()) * 130n) / 100n;
    } catch { /* return 0 if simulation fails */ }

    const approveGas = 60_000n;
    return {
      flow: "async",
      steps: [
        { label: "approve shares to escrow", gasEstimate: approveGas },
        { label: "initVaultActionRequest", gasEstimate: requestGas },
      ],
      totalGasEstimate: approveGas + requestGas,
      lzFee,
    };
  }

  // --- Queued vault ---
  if (status.withdrawalQueueEnabled) {
    const vaultNew = new Contract(vault, VAULT_ABI, provider);
    let requestGas = 0n;
    try {
      const raw = await vaultNew.requestRedeem.estimateGas(shares, owner, { from: owner });
      requestGas = BigInt(raw.toString());
    } catch {
      try {
        const vaultLegacy = new Contract(vault, VAULT_REQUEST_REDEEM_LEGACY_ABI, provider);
        const raw = await vaultLegacy.requestRedeem.estimateGas(shares, { from: owner });
        requestGas = BigInt(raw.toString());
      } catch { /* return 0 if simulation fails */ }
    }

    if (status.withdrawalTimelockSeconds === 0n) {
      let redeemGas = 0n;
      try {
        const raw = await vaultNew.redeem.estimateGas(shares, receiver, owner, { from: owner });
        redeemGas = BigInt(raw.toString());
      } catch { /* return 0 if simulation fails */ }

      return {
        flow: "queue-no-timelock",
        steps: [
          { label: "requestRedeem", gasEstimate: requestGas },
          { label: "redeemShares", gasEstimate: redeemGas },
        ],
        totalGasEstimate: requestGas + redeemGas,
        lzFee: 0n,
      };
    }

    return {
      flow: "queue-timelock",
      steps: [{ label: "requestRedeem", gasEstimate: requestGas }],
      totalGasEstimate: requestGas,
      lzFee: 0n,
    };
  }

  // --- Direct sync redeem ---
  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  let redeemGas = 0n;
  try {
    const raw = await vaultContract.redeem.estimateGas(shares, receiver, owner, { from: owner });
    redeemGas = BigInt(raw.toString());
  } catch { /* return 0 if simulation fails */ }

  return {
    flow: "direct",
    steps: [{ label: "redeemShares", gasEstimate: redeemGas }],
    totalGasEstimate: redeemGas,
    lzFee: 0n,
  };
}

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
    throw new VaultPausedError(vault)
  }

  if (status.recommendedDepositFlow === "depositAsync") {
    // Async vault — use redeemAsync
    const lzFee = await quoteLzFee(provider, vault, extraOptions);
    return redeemAsync(signer, addresses, shares, receiver, owner, lzFee, extraOptions);
  }

  if (status.withdrawalQueueEnabled) {
    const pending = await getWithdrawalRequest(provider, vault, owner);
    const now = BigInt(Math.floor(Date.now() / 1000));

    if (pending && (pending.timelockEndsAt === 0n || now >= pending.timelockEndsAt)) {
      // Timelock expired (or no timelock) and request is pending — complete the redeem
      return redeemShares(signer, addresses, shares, receiver, owner);
    }

    if (pending) {
      // Request submitted but timelock not yet expired
      throw new WithdrawalTimelockActiveError(vault, pending.timelockEndsAt);
    }

    if (status.withdrawalTimelockSeconds === 0n) {
      // R3 — no timelock: submit request then redeem immediately back-to-back
      await requestRedeem(signer, addresses, shares, owner);
      return redeemShares(signer, addresses, shares, receiver, owner);
    }

    // R4 — timelock active: submit request and throw with expected expiry
    const { receipt } = await requestRedeem(signer, addresses, shares, owner);
    const timelockEndsAt = now + status.withdrawalTimelockSeconds;
    throw new WithdrawalTimelockActiveError(vault, timelockEndsAt, receipt?.hash);
  }

  // Sync vault without queue — direct redeem
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
  if (amount === 0n) throw new InvalidInputError('amount must be greater than zero')

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

// ---------------------------------------------------------------------------
// Spoke redeem helpers
// ---------------------------------------------------------------------------

/** Minimal ABIs used only within redeemFlows */
const FACTORY_COMPOSER_ABI_RF = [
  "function vaultComposer(address _vault) view returns (address)",
] as const;

const REDEEM_COMPOSER_ABI = [
  "function SHARE_OFT() view returns (address)",
] as const;

const OFT_PEERS_ABI_RF = [
  "function peers(uint32 eid) view returns (bytes32)",
] as const;

export interface SpokeRedeemRoute {
  /** Hub chain ID */
  hubChainId: number
  /** Spoke chain ID */
  spokeChainId: number
  /** LZ EID for the hub */
  hubEid: number
  /** LZ EID for the spoke */
  spokeEid: number
  /** Vault underlying asset address on hub */
  hubAsset: string
  /** SHARE_OFT on spoke chain */
  spokeShareOft: string
  /** Asset OFT on hub for bridging back */
  hubAssetOft: string
  /** Underlying asset address on spoke chain */
  spokeAsset: string
  /** Whether the asset OFT is a Stargate pool */
  isStargate: boolean
  /** OFT route symbol (e.g. 'stgUSDC') */
  symbol: string
}

/**
 * Quote the LZ fee for bridging shares from spoke to hub via SHARE_OFT.
 *
 * IMPORTANT: `amountLD` must be in SHARE_OFT native decimals (e.g. 18),
 * NOT vault decimals (e.g. 8). Use the raw `SHARE_OFT.balanceOf(user)` value.
 *
 * @param spokeProvider  Read-only provider on the SPOKE chain
 * @param shareOFT       SHARE_OFT address on the spoke chain
 * @param hubChainEid    LayerZero Endpoint ID for the hub chain
 * @param amountLD       Shares in SHARE_OFT native decimals (raw balanceOf)
 * @param receiver       Receiver address on the hub chain
 * @returns              LZ native fee in wei
 */
export async function quoteShareBridgeFee(
  spokeProvider: Provider,
  shareOFT: string,
  hubChainEid: number,
  amountLD: bigint,
  receiver: string,
): Promise<bigint> {
  const toBytes32 = zeroPadValue(receiver, 32);
  const sendParam = {
    dstEid: hubChainEid,
    to: toBytes32,
    amountLD,
    minAmountLD: amountLD,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };

  const oft = new Contract(shareOFT, OFT_ABI, spokeProvider);
  const fee = await oft.quoteSend(sendParam, false);
  return fee.nativeFee as bigint;
}

/**
 * Resolve all addresses needed for a full spoke→hub→spoke redeem flow.
 *
 * @param hubProvider  Read-only provider on the HUB chain
 * @param vault        Vault address
 * @param hubChainId   Hub chain ID
 * @param spokeChainId Spoke chain ID where user has shares
 * @returns            All addresses needed for bridgeSharesToHub + redeemShares + bridgeAssetsToSpoke
 */
export async function resolveRedeemAddresses(
  hubProvider: Provider,
  vault: string,
  hubChainId: number,
  spokeChainId: number,
): Promise<SpokeRedeemRoute> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId];
  const spokeEid = CHAIN_ID_TO_EID[spokeChainId];
  if (!hubEid || !spokeEid) {
    throw new Error(`No LZ EID for chainId ${!hubEid ? hubChainId : spokeChainId}`);
  }

  const vaultContract = new Contract(vault, VAULT_ABI, hubProvider);
  const factory = new Contract(OMNI_FACTORY_ADDRESS, FACTORY_COMPOSER_ABI_RF, hubProvider);
  const [hubAsset, composerAddress]: [string, string] = await Promise.all([
    vaultContract.asset(),
    factory.vaultComposer(vault),
  ]);

  if (composerAddress === ZeroAddress) {
    throw new Error(`[MoreVaults] No composer registered for vault ${vault} on hub chain ${hubChainId}`);
  }

  const composer = new Contract(composerAddress, REDEEM_COMPOSER_ABI, hubProvider);
  const hubShareOft: string = await composer.SHARE_OFT();

  const hubShareOftContract = new Contract(hubShareOft, OFT_PEERS_ABI_RF, hubProvider);
  const spokeShareOftBytes32: string = await hubShareOftContract.peers(spokeEid);

  // Convert bytes32 to address (last 20 bytes = last 40 hex chars)
  const spokeShareOft = `0x${spokeShareOftBytes32.slice(-40)}`;

  let hubAssetOft: string | null = null;
  let spokeAsset: string | null = null;
  let symbol = '';

  for (const [sym, chainMap] of Object.entries(OFT_ROUTES)) {
    const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId];
    const spokeEntry = (chainMap as Record<number, { oft: string; token: string }>)[spokeChainId];
    if (!hubEntry || !spokeEntry) continue;

    if (hubEntry.token.toLowerCase() === hubAsset.toLowerCase()) {
      hubAssetOft = hubEntry.oft;
      spokeAsset = spokeEntry.token;
      symbol = sym;
      break;
    }
  }

  if (!hubAssetOft || !spokeAsset) {
    throw new Error(
      `[MoreVaults] No OFT route found for vault asset ${hubAsset} ` +
      `between hub chain ${hubChainId} and spoke chain ${spokeChainId}`,
    );
  }

  const isStargate = await detectStargateOft(hubProvider, hubAssetOft);

  return {
    hubChainId,
    spokeChainId,
    hubEid,
    spokeEid,
    hubAsset,
    spokeShareOft,
    hubAssetOft,
    spokeAsset,
    isStargate,
    symbol,
  };
}
