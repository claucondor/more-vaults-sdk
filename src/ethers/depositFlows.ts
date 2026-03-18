import { Contract, AbiCoder, Signer, ZeroAddress } from "ethers";
import type { Provider } from "ethers";
import { VAULT_ABI, BRIDGE_ABI, ERC20_ABI } from "./abis";
import {
  VaultAddresses,
  DepositResult,
  AsyncRequestResult,
  ActionType,
} from "./types";
import { preflightAsync, preflightSync } from "./preflight";
import { EscrowNotConfiguredError, VaultPausedError, CapacityFullError, InvalidInputError } from "./errors";
import { validateWalletChain } from "./chainValidation";
import { getVaultStatus, quoteLzFee } from "./utils";
import { parseContractError } from "./errorParser";

/**
 * Ensure `spender` has at least `amount` allowance from `owner`.
 * Sends an approve TX only if current allowance is insufficient.
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
// D1 -- Simple deposit (1 TX, sync)
// ---------------------------------------------------------------------------

/**
 * Deposit `assets` of the vault's underlying token and receive shares.
 *
 * TXs: 1 approve (if needed) + 1 deposit.
 *
 * @param signer   - Wallet that holds the underlying tokens.
 * @param addresses - Vault addresses. Only `vault` is used.
 * @param assets   - Amount of underlying tokens to deposit.
 * @param receiver - Address that will receive the minted shares.
 * @returns Shares minted and the transaction receipt.
 */
export async function depositSimple(
  signer: Signer,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: string
): Promise<DepositResult> {
  if (assets === 0n) throw new InvalidInputError('deposit amount must be greater than zero')

  const provider = signer.provider!;

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  // Pre-flight: validate vault is operational and accepting deposits
  await preflightSync(provider, addresses.vault);

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  const underlying: string = await vault.asset();

  await ensureAllowance(signer, underlying, addresses.vault, assets);

  // Call the single-asset deposit overload: deposit(uint256, address)
  const tx = await vault["deposit(uint256,address)"](assets, receiver);
  const receipt = await tx.wait();

  // Extract shares from the return value via Transfer event (from 0x0 = mint)
  let shares = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = vault.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (
        parsed &&
        parsed.name === "Transfer" &&
        parsed.args[0] === "0x0000000000000000000000000000000000000000"
      ) {
        shares = parsed.args[2];
        break;
      }
    } catch {
      // skip non-matching logs
    }
  }

  return { receipt, shares };
}

// ---------------------------------------------------------------------------
// D2 -- Multi-asset deposit
// ---------------------------------------------------------------------------

/**
 * Deposit multiple tokens in a single transaction.
 *
 * TXs: N approves (if needed) + 1 deposit.
 *
 * @param signer      - Wallet holding the tokens.
 * @param addresses   - Vault addresses. Only `vault` is used.
 * @param tokens      - Array of token addresses to deposit.
 * @param amounts     - Corresponding amounts for each token.
 * @param receiver    - Address that will receive the minted shares.
 * @param minShares   - Minimum acceptable shares (slippage protection).
 * @returns Shares minted and the transaction receipt.
 */
export async function depositMultiAsset(
  signer: Signer,
  addresses: VaultAddresses,
  tokens: string[],
  amounts: bigint[],
  receiver: string,
  minShares: bigint
): Promise<DepositResult> {
  if (tokens.length === 0) throw new InvalidInputError('tokens array must not be empty')
  if (amounts.some(a => a === 0n)) throw new InvalidInputError('deposit amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  await validateWalletChain(signer, addresses.hubChainId);

  // Approve each token
  for (let i = 0; i < tokens.length; i++) {
    await ensureAllowance(signer, tokens[i], addresses.vault, amounts[i]);
  }

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  let tx: any
  try {
    tx = await vault[
      "deposit(address[],uint256[],address,uint256)"
    ](tokens, amounts, receiver, minShares);
  } catch (err) {
    parseContractError(err, addresses.vault)
  }
  const receipt = await tx.wait();

  let shares = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = vault.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && parsed.name === "Deposit") {
        shares = parsed.args[4]; // 5th arg = shares
        break;
      }
    } catch {
      // skip
    }
  }

  return { receipt, shares };
}

// ---------------------------------------------------------------------------
// D3 -- Cross-chain oracle ON (transparent, identical to D1)
// ---------------------------------------------------------------------------

/**
 * Deposit when cross-chain oracle accounting is ON.
 * Behaves identically to a simple deposit because oracle provides
 * synchronous pricing.
 *
 * TXs: 1 approve (if needed) + 1 deposit.
 */
export const depositCrossChainOracleOn = depositSimple;

// ---------------------------------------------------------------------------
// D4 -- Cross-chain oracle OFF, async DEPOSIT
// ---------------------------------------------------------------------------

/**
 * Initiate an asynchronous cross-chain deposit request.
 *
 * CRITICAL: tokens are approved to the **escrow** address, not the vault.
 *
 * TXs: 1 approve to escrow (if needed) + 1 initVaultActionRequest.
 * After this call, a LayerZero message is sent; the caller must wait for
 * cross-chain fulfillment before shares are minted.
 *
 * @param signer       - Wallet holding the underlying tokens.
 * @param addresses    - Must include `vault` and `escrow`.
 * @param assets       - Amount of underlying tokens to deposit.
 * @param receiver     - Address that will receive shares on fulfillment.
 * @param lzFee        - Native fee for LayerZero message (use `quoteLzFee`).
 * @param extraOptions - Optional LZ adapter parameters (bytes).
 * @returns The request GUID for tracking and the transaction receipt.
 */
export async function depositAsync(
  signer: Signer,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: string,
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

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  const underlying: string = await vault.asset();

  // CRITICAL: approve ESCROW, not vault
  await ensureAllowance(signer, underlying, escrow, assets);

  // Encode parameters only (no selector) — contracts use abi.decode on these bytes
  const coder = AbiCoder.defaultAbiCoder();
  const actionCallData = coder.encode(
    ["uint256", "address"],
    [assets, receiver]
  );

  const bridge = new Contract(addresses.vault, BRIDGE_ABI, signer);

  // Static call first to capture the return value (guid) before broadcasting
  let guid: string
  try {
    guid = await bridge.initVaultActionRequest.staticCall(
      ActionType.DEPOSIT,
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
      ActionType.DEPOSIT,
      actionCallData,
      0, // amountLimit = 0 for deposits (minAmountOut handled by cross-chain manager)
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
// D5 -- Cross-chain oracle OFF, async MINT
// ---------------------------------------------------------------------------

/**
 * Initiate an asynchronous cross-chain mint request (exact shares).
 *
 * CRITICAL: tokens are approved to the **escrow** address, not the vault.
 *
 * TXs: 1 approve to escrow for maxAssets (if needed) + 1 initVaultActionRequest.
 *
 * @param signer       - Wallet holding the underlying tokens.
 * @param addresses    - Must include `vault` and `escrow`.
 * @param shares       - Exact number of shares to mint.
 * @param maxAssets     - Maximum underlying tokens to spend (slippage cap).
 * @param receiver     - Address that will receive shares on fulfillment.
 * @param lzFee        - Native fee for LayerZero message.
 * @param extraOptions - Optional LZ adapter parameters (bytes).
 * @returns The request GUID for tracking and the transaction receipt.
 */
export async function mintAsync(
  signer: Signer,
  addresses: VaultAddresses,
  shares: bigint,
  maxAssets: bigint,
  receiver: string,
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

  const vault = new Contract(addresses.vault, VAULT_ABI, signer);
  const underlying: string = await vault.asset();

  // CRITICAL: approve ESCROW for maxAssets
  await ensureAllowance(signer, underlying, escrow, maxAssets);

  // Encode parameters only (no selector) — contracts use abi.decode on these bytes
  const coder = AbiCoder.defaultAbiCoder();
  const actionCallData = coder.encode(
    ["uint256", "address"],
    [shares, receiver]
  );

  const bridge = new Contract(addresses.vault, BRIDGE_ABI, signer);

  // Static call first to capture the return value (guid) before broadcasting
  let guid: string
  try {
    guid = await bridge.initVaultActionRequest.staticCall(
      ActionType.MINT,
      actionCallData,
      maxAssets,
      extraOptions,
      { value: lzFee }
    );
  } catch (err) {
    parseContractError(err, addresses.vault)
  }

  let tx: any
  try {
    tx = await bridge.initVaultActionRequest(
      ActionType.MINT,
      actionCallData,
      maxAssets,
      extraOptions,
      { value: lzFee }
    );
  } catch (err) {
    parseContractError(err, addresses.vault)
  }
  const receipt = await tx!.wait();

  return { receipt, guid: guid! };
}

/**
 * Smart deposit — auto-selects the correct flow based on vault configuration.
 *
 * Calls getVaultStatus internally to determine the vault mode, then dispatches
 * to the appropriate flow:
 * - local / cross-chain-oracle → depositSimple
 * - cross-chain-async → depositAsync (quotes LZ fee automatically)
 *
 * @param signer         Wallet signer with account attached
 * @param provider       Read-only provider for on-chain reads
 * @param addresses      Vault address set (`escrow` required for async vaults)
 * @param assets         Amount of underlying to deposit
 * @param receiver       Address that will receive shares
 * @param extraOptions   Optional LZ extra options (only used for async vaults)
 * @returns              DepositResult or AsyncRequestResult depending on vault mode
 * @throws               VaultPausedError if vault is paused
 * @throws               CapacityFullError if vault is full
 */
export async function smartDeposit(
  signer: Signer,
  provider: Provider,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: string,
  extraOptions: string = "0x"
): Promise<DepositResult | AsyncRequestResult> {
  const vault = addresses.vault;
  const status = await getVaultStatus(provider, vault);

  if (status.mode === "paused") {
    throw new VaultPausedError(vault);
  }
  if (status.mode === "full") {
    throw new CapacityFullError(vault);
  }

  if (status.recommendedDepositFlow === "depositAsync") {
    const lzFee = await quoteLzFee(provider, vault, extraOptions);
    return depositAsync(signer, addresses, assets, receiver, lzFee, extraOptions);
  }

  // local or cross-chain-oracle
  return depositSimple(signer, addresses, assets, receiver);
}
