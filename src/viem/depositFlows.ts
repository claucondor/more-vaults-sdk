import {
  type Address,
  type PublicClient,
  type WalletClient,
  encodeAbiParameters,
  getAddress,
  zeroAddress,
} from 'viem'
import { VAULT_ABI, BRIDGE_ABI, ERC20_ABI, CONFIG_ABI } from './abis'
import type {
  VaultAddresses,
  DepositResult,
  AsyncRequestResult,
} from './types'
import { ActionType } from './types'
import { ensureAllowance, getVaultStatus, quoteLzFee } from './utils'
import { preflightSync, preflightAsync } from './preflight'
import { EscrowNotConfiguredError, VaultPausedError, CapacityFullError } from './errors'
import { validateWalletChain } from './chainValidation'

/**
 * D1 / D3 — Simple deposit (ERC-4626 standard).
 *
 * Works for both local vaults and cross-chain hubs with oracle accounting ON.
 * When oracle accounting is enabled the cross-chain accounting is transparent
 * to the caller — the vault resolves totalAssets synchronously.
 *
 * **User transactions**: 1 approve (skipped if allowance sufficient) + 1 deposit.
 *
 * @param walletClient  Wallet client with account attached
 * @param publicClient  Public client for reads and simulation
 * @param addresses     Vault address set (only `vault` is used)
 * @param assets        Amount of underlying token to deposit (in token decimals)
 * @param receiver      Address that will receive the minted vault shares
 * @returns             Transaction hash and amount of shares minted
 */
export async function depositSimple(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: Address,
): Promise<DepositResult> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  // Pre-flight: validate vault is operational and accepting deposits
  await preflightSync(publicClient, vault)

  // Resolve underlying asset
  const underlying = await publicClient.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'asset',
  })

  // Approve vault if needed
  await ensureAllowance(walletClient, publicClient, underlying, vault, assets)

  // Simulate then send
  const { result: shares } = await publicClient.simulateContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [assets, getAddress(receiver)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [assets, getAddress(receiver)],
    account,
    chain: walletClient.chain,
  })

  return { txHash, shares }
}

/**
 * Alias: D3 — Cross-chain hub deposit when oracle accounting is ON.
 * Exactly the same UX as depositSimple because the vault resolves accounting synchronously.
 */
export { depositSimple as depositCrossChainOracleOn }

/**
 * D2 — Multi-asset deposit.
 *
 * Deposits multiple ERC-20 tokens into the vault in a single vault call.
 * The vault converts each token to the underlying via oracle pricing.
 *
 * **User transactions**: N approves (one per token, skipped if sufficient) + 1 deposit.
 *
 * @param walletClient  Wallet client with account attached
 * @param publicClient  Public client for reads and simulation
 * @param addresses     Vault address set (only `vault` is used)
 * @param tokens        Array of token addresses to deposit
 * @param amounts       Array of amounts (one per token, in each token's decimals)
 * @param receiver      Address that will receive the minted vault shares
 * @param minShares     Minimum shares to accept (slippage protection)
 * @returns             Transaction hash and amount of shares minted
 */
export async function depositMultiAsset(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  tokens: Address[],
  amounts: bigint[],
  receiver: Address,
  minShares: bigint,
): Promise<DepositResult> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  // Approve each token
  for (let i = 0; i < tokens.length; i++) {
    await ensureAllowance(walletClient, publicClient, tokens[i], vault, amounts[i])
  }

  const { result: shares } = await publicClient.simulateContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [tokens, amounts, getAddress(receiver), minShares],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [tokens, amounts, getAddress(receiver), minShares],
    account,
    chain: walletClient.chain,
  })

  return { txHash, shares }
}

/**
 * D4 — Async deposit (cross-chain hub, oracle OFF).
 *
 * Sends assets to the escrow and initiates a cross-chain accounting request via
 * `initVaultActionRequest(DEPOSIT, ...)`. The LZ Read callback will resolve
 * accounting and `executeRequest` will mint shares.
 *
 * **User transactions**: 1 approve (to ESCROW, not vault!) + 1 initVaultActionRequest.
 * **Wait**: Shares arrive after the LZ callback + executeRequest (automated by keeper).
 *
 * @param walletClient   Wallet client with account attached
 * @param publicClient   Public client for reads and simulation
 * @param addresses      Vault address set (`vault` + `escrow` required)
 * @param assets         Amount of underlying to deposit
 * @param receiver       Address that will receive shares after resolution
 * @param lzFee          msg.value for LZ Read fee (quote first with `quoteLzFee`)
 * @param extraOptions   Optional LZ extra options bytes (default 0x)
 * @returns              Transaction hash and GUID for tracking
 */
export async function depositAsync(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: Address,
  lzFee: bigint,
  extraOptions: `0x${string}` = '0x',
): Promise<AsyncRequestResult> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)
  const escrow = addresses.escrow
    ? getAddress(addresses.escrow)
    : await publicClient.readContract({ address: vault, abi: CONFIG_ABI, functionName: 'getEscrow' })
  if (escrow === zeroAddress) throw new EscrowNotConfiguredError(vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  // Pre-flight: validate async cross-chain setup before sending any transaction
  await preflightAsync(publicClient, vault, escrow)

  // Resolve underlying asset
  const underlying = await publicClient.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'asset',
  })

  // Approve ESCROW (not vault!) for the deposit amount
  await ensureAllowance(walletClient, publicClient, underlying, escrow, assets)

  // Encode parameters only (no selector) — contracts use abi.decode on these bytes
  const actionCallData = encodeAbiParameters(
    [{ type: 'uint256', name: 'assets' }, { type: 'address', name: 'receiver' }],
    [assets, getAddress(receiver)],
  ) as `0x${string}`

  const [{ result: guid }, gasEstimate] = await Promise.all([
    publicClient.simulateContract({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.DEPOSIT, actionCallData, 0n, extraOptions],
      value: lzFee,
      account: account.address,
    }),
    publicClient.estimateContractGas({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.DEPOSIT, actionCallData, 0n, extraOptions],
      value: lzFee,
      account: account.address,
    }),
  ])

  // LZ Read operations consistently underestimate gas — add 30% buffer.
  const gas = gasEstimate * 130n / 100n

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: BRIDGE_ABI,
    functionName: 'initVaultActionRequest',
    args: [ActionType.DEPOSIT, actionCallData, 0n, extraOptions],
    value: lzFee,
    account,
    chain: walletClient.chain,
    gas,
  })

  return { txHash, guid: guid as `0x${string}` }
}

/**
 * D5 — Async mint (cross-chain hub, oracle OFF).
 *
 * Mints an exact amount of shares by depositing up to `maxAssets` of underlying.
 * Similar flow to D4 but uses MINT action type.
 *
 * **User transactions**: 1 approve (to ESCROW for maxAssets) + 1 initVaultActionRequest.
 * **Wait**: Shares arrive after the LZ callback + executeRequest.
 *
 * @param walletClient   Wallet client with account attached
 * @param publicClient   Public client for reads and simulation
 * @param addresses      Vault address set (`vault` + `escrow` required)
 * @param shares         Exact number of shares to mint
 * @param maxAssets      Maximum assets to spend (slippage protection)
 * @param receiver       Address that will receive the minted shares
 * @param lzFee          msg.value for LZ Read fee
 * @param extraOptions   Optional LZ extra options bytes
 * @returns              Transaction hash and GUID for tracking
 */
export async function mintAsync(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  shares: bigint,
  maxAssets: bigint,
  receiver: Address,
  lzFee: bigint,
  extraOptions: `0x${string}` = '0x',
): Promise<AsyncRequestResult> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)
  const escrow = addresses.escrow
    ? getAddress(addresses.escrow)
    : await publicClient.readContract({ address: vault, abi: CONFIG_ABI, functionName: 'getEscrow' })
  if (escrow === zeroAddress) throw new EscrowNotConfiguredError(vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  // Pre-flight: validate async cross-chain setup before sending any transaction
  await preflightAsync(publicClient, vault, escrow)

  const underlying = await publicClient.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'asset',
  })

  // Approve ESCROW for maxAssets
  await ensureAllowance(walletClient, publicClient, underlying, escrow, maxAssets)

  // Encode parameters only (no selector) — contracts use abi.decode on these bytes
  const actionCallData = encodeAbiParameters(
    [{ type: 'uint256', name: 'shares' }, { type: 'address', name: 'receiver' }],
    [shares, getAddress(receiver)],
  ) as `0x${string}`

  // amountLimit = maxAssets (slippage check: actual assets spent must be <= maxAssets)
  const [{ result: guid }, gasEstimate] = await Promise.all([
    publicClient.simulateContract({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.MINT, actionCallData, maxAssets, extraOptions],
      value: lzFee,
      account: account.address,
    }),
    publicClient.estimateContractGas({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.MINT, actionCallData, maxAssets, extraOptions],
      value: lzFee,
      account: account.address,
    }),
  ])

  const gas = gasEstimate * 130n / 100n

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: BRIDGE_ABI,
    functionName: 'initVaultActionRequest',
    args: [ActionType.MINT, actionCallData, maxAssets, extraOptions],
    value: lzFee,
    account,
    chain: walletClient.chain,
    gas,
  })

  return { txHash, guid: guid as `0x${string}` }
}

/**
 * Smart deposit — auto-selects the correct flow based on vault configuration.
 *
 * Calls getVaultStatus internally to determine the vault mode, then dispatches
 * to the appropriate flow:
 * - local / cross-chain-oracle → depositSimple (ERC-4626 deposit)
 * - cross-chain-async → depositAsync (initVaultActionRequest + LZ Read callback)
 *
 * ## Tested flows
 *
 * - [x] Hub-chain async deposit (Base→Base, vault 0x8f74...ba6):
 *       smartDeposit auto-detects async → depositAsync → LZ Read callback ~4.5 min.
 *       TX: 0x5284b4...ca24
 *
 * ## Untested flows
 *
 * - [ ] Hub-chain sync deposit (depositSimple path) — needs a vault with oracle ON
 * - [ ] Multi-asset deposit (depositMultiAsset) — separate entry point, not dispatched here
 *
 * @param walletClient   Wallet client with account attached
 * @param publicClient   Public client for reads
 * @param addresses      Vault address set (`escrow` required for async vaults)
 * @param assets         Amount of underlying to deposit
 * @param receiver       Address that will receive shares
 * @param extraOptions   Optional LZ extra options (only used for async vaults)
 * @returns              DepositResult or AsyncRequestResult depending on vault mode
 * @throws               VaultPausedError if vault is paused
 * @throws               CapacityFullError if vault is full
 */
export async function smartDeposit(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: Address,
  extraOptions: `0x${string}` = '0x',
): Promise<DepositResult | AsyncRequestResult> {
  const vault = getAddress(addresses.vault)
  const status = await getVaultStatus(publicClient, vault)

  if (status.mode === 'paused') {
    throw new VaultPausedError(vault)
  }
  if (status.mode === 'full') {
    throw new CapacityFullError(vault)
  }

  if (status.recommendedDepositFlow === 'depositAsync') {
    const lzFee = await quoteLzFee(publicClient, vault, extraOptions)
    return depositAsync(walletClient, publicClient, addresses, assets, receiver, lzFee, extraOptions)
  }

  // local or cross-chain-oracle
  return depositSimple(walletClient, publicClient, addresses, assets, receiver)
}
