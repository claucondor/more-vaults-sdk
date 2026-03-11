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
import { VAULT_ABI, BRIDGE_ABI, OFT_ABI, CONFIG_ABI } from './abis'
import type {
  VaultAddresses,
  RedeemResult,
  AsyncRequestResult,
} from './types'
import { ActionType } from './types'
import { ensureAllowance } from './utils'
import { preflightAsync, preflightRedeemLiquidity } from './preflight'
import { EscrowNotConfiguredError } from './errors'
import { validateWalletChain } from './chainValidation'

/**
 * R1 — Simple share redemption (ERC-4626 standard).
 *
 * Burns `shares` and returns the proportional amount of underlying assets.
 * If a withdrawal queue is enabled, the caller must have previously called
 * `requestRedeem` and waited for the timelock to expire.
 *
 * **User transactions**: 1 redeem call.
 *
 * @param walletClient  Wallet client with account attached
 * @param publicClient  Public client for reads and simulation
 * @param addresses     Vault address set (only `vault` is used)
 * @param shares        Amount of vault shares to redeem
 * @param receiver      Address that will receive the underlying assets
 * @param owner         Owner of the shares being redeemed
 * @returns             Transaction hash and amount of assets received
 */
export async function redeemShares(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: Address,
  owner: Address,
): Promise<RedeemResult> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  const { result: assets } = await publicClient.simulateContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'redeem',
    args: [shares, getAddress(receiver), getAddress(owner)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'redeem',
    args: [shares, getAddress(receiver), getAddress(owner)],
    account,
    chain: walletClient.chain,
  })

  return { txHash, assets }
}

/**
 * R2 — Withdraw by specifying the exact assets amount.
 *
 * Burns the necessary shares to withdraw exactly `assets` amount of underlying.
 * If a withdrawal queue is enabled, the caller must have previously called
 * `requestWithdraw` and waited for the timelock.
 *
 * **User transactions**: 1 withdraw call.
 *
 * @param walletClient  Wallet client with account attached
 * @param publicClient  Public client for reads and simulation
 * @param addresses     Vault address set (only `vault` is used)
 * @param assets        Exact amount of underlying assets to withdraw
 * @param receiver      Address that will receive the assets
 * @param owner         Owner of the shares being burned
 * @returns             Transaction hash and the actual assets withdrawn
 */
export async function withdrawAssets(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  assets: bigint,
  receiver: Address,
  owner: Address,
): Promise<RedeemResult> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  const { result: sharesBurned } = await publicClient.simulateContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'withdraw',
    args: [assets, getAddress(receiver), getAddress(owner)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'withdraw',
    args: [assets, getAddress(receiver), getAddress(owner)],
    account,
    chain: walletClient.chain,
  })

  // For withdraw, the return is shares burned; assets is what was requested
  return { txHash, assets }
}

/**
 * R3 / R4 — Request redeem (queue shares for withdrawal).
 *
 * Places `shares` into the withdrawal queue. If a timelock is configured (R4),
 * the user must wait until `timelockEndsAt` before calling `redeemShares`.
 * If no timelock (R3), `redeemShares` can be called immediately after.
 *
 * Use `getWithdrawalRequest` to check the timelock status.
 *
 * **User transactions**: 1 requestRedeem call, then later 1 redeemShares call.
 *
 * @param walletClient  Wallet client with account attached
 * @param publicClient  Public client for simulation
 * @param addresses     Vault address set (only `vault` is used)
 * @param shares        Amount of shares to queue for redemption
 * @param owner         The address on behalf of which the request is made
 * @returns             Transaction hash of the request
 */
export async function requestRedeem(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  shares: bigint,
  owner: Address,
): Promise<{ txHash: Hash }> {
  const account = walletClient.account!
  const vault = getAddress(addresses.vault)

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  await publicClient.simulateContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'requestRedeem',
    args: [shares, getAddress(owner)],
    account: account.address,
  })

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'requestRedeem',
    args: [shares, getAddress(owner)],
    account,
    chain: walletClient.chain,
  })

  return { txHash }
}

/**
 * Helper — Get the current withdrawal request for an owner.
 *
 * Returns the queued shares and timelock end timestamp.
 * Useful for showing a countdown timer in the UI (R4 flow).
 *
 * @param publicClient  Public client for reading state
 * @param vault         Vault address
 * @param owner         Owner whose request to query
 * @returns             Request info or null if no active request
 */
export async function getWithdrawalRequest(
  publicClient: PublicClient,
  vault: Address,
  owner: Address,
): Promise<{ shares: bigint; timelockEndsAt: bigint } | null> {
  const [shares, timelockEndsAt] = await publicClient.readContract({
    address: getAddress(vault),
    abi: VAULT_ABI,
    functionName: 'getWithdrawalRequest',
    args: [getAddress(owner)],
  })

  if (shares === 0n) return null

  return { shares, timelockEndsAt }
}

/**
 * R5 — Async redeem (cross-chain hub, oracle OFF).
 *
 * Initiates an async redeem via `initVaultActionRequest(REDEEM, ...)`.
 * Shares are locked in the escrow while the LZ Read resolves accounting.
 * After `executeRequest`, assets are sent to the receiver.
 *
 * **IMPORTANT**: `amountLimit` MUST be 0 for REDEEM actions (not shares).
 * The shares amount is encoded in the actionCallData. Setting amountLimit to
 * a non-zero value would be interpreted as "max assets to receive" (inverted
 * slippage check), which is almost never what the user wants.
 *
 * **User transactions**: 1 approve (shares to ESCROW) + 1 initVaultActionRequest.
 * **Wait**: Assets arrive after LZ callback + executeRequest.
 *
 * @param walletClient   Wallet client with account attached
 * @param publicClient   Public client for reads and simulation
 * @param addresses      Vault address set (`vault` + `escrow` required)
 * @param shares         Amount of shares to redeem
 * @param receiver       Address that will receive the underlying assets
 * @param owner          Owner of the shares (must match the initiator)
 * @param lzFee          msg.value for LZ Read fee
 * @param extraOptions   Optional LZ extra options bytes
 * @returns              Transaction hash and GUID for tracking
 */
export async function redeemAsync(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: Address,
  owner: Address,
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

  // Pre-flight: check hub has enough liquid assets — avoids wasting LZ fee on a guaranteed refund
  await preflightRedeemLiquidity(publicClient, vault, shares)

  // Approve ESCROW for shares (vault share token is the vault itself for ERC-4626)
  await ensureAllowance(walletClient, publicClient, vault, escrow, shares)

  // Encode parameters only (no selector) — contracts use abi.decode on these bytes
  const actionCallData = encodeAbiParameters(
    [{ type: 'uint256', name: 'shares' }, { type: 'address', name: 'receiver' }, { type: 'address', name: 'owner' }],
    [shares, getAddress(receiver), getAddress(owner)],
  ) as `0x${string}`

  // amountLimit MUST be 0 for REDEEM — see JSDoc above
  const [{ result: guid }, gasEstimate] = await Promise.all([
    publicClient.simulateContract({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.REDEEM, actionCallData, 0n, extraOptions],
      value: lzFee,
      account: account.address,
    }),
    publicClient.estimateContractGas({
      address: vault,
      abi: BRIDGE_ABI,
      functionName: 'initVaultActionRequest',
      args: [ActionType.REDEEM, actionCallData, 0n, extraOptions],
      value: lzFee,
      account: account.address,
    }),
  ])

  const gas = gasEstimate * 130n / 100n

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: BRIDGE_ABI,
    functionName: 'initVaultActionRequest',
    args: [ActionType.REDEEM, actionCallData, 0n, extraOptions],
    value: lzFee,
    account,
    chain: walletClient.chain,
    gas,
  })

  return { txHash, guid: guid as `0x${string}` }
}

/**
 * R6 — Bridge shares from spoke to hub chain via OFT.
 *
 * This is step 1 of a 2-step spoke redeem flow:
 *   1. `bridgeSharesToHub()` — send shares from spoke to hub via OFT
 *   2. `redeemShares()` — call redeem on the hub vault (after shares arrive)
 *
 * The two steps happen on different chains and cannot be combined into a single
 * SDK call. The frontend must switch chains between steps.
 *
 * **User transactions on spoke chain**: 1 approve (shares to shareOFT) + 1 OFT.send().
 * **Gas**: Requires native token on spoke for LZ fees, and gas on hub for step 2.
 *
 * @param walletClient   Wallet client on the SPOKE chain
 * @param publicClient   Public client on the SPOKE chain
 * @param shareOFT       OFTAdapter address for vault shares on the spoke chain
 * @param hubChainEid    LayerZero Endpoint ID for the hub chain (Flow EVM = 30336)
 * @param shares         Amount of vault shares to bridge
 * @param receiver       Receiver address on the HUB chain
 * @param lzFee          msg.value for OFT send (quote via OFT.quoteSend)
 * @returns              Transaction hash of the OFT.send() call
 */
export async function bridgeSharesToHub(
  walletClient: WalletClient,
  publicClient: PublicClient,
  shareOFT: Address,
  hubChainEid: number,
  shares: bigint,
  receiver: Address,
  lzFee: bigint,
): Promise<{ txHash: Hash }> {
  const account = walletClient.account!
  const oft = getAddress(shareOFT)

  // Approve OFT for share transfer
  await ensureAllowance(walletClient, publicClient, oft, oft, shares)

  const toBytes32 = pad(getAddress(receiver), { size: 32 })

  const sendParam = {
    dstEid: hubChainEid,
    to: toBytes32,
    amountLD: shares,
    minAmountLD: shares, // shares should bridge 1:1
    extraOptions: '0x' as `0x${string}`,
    composeMsg: '0x' as `0x${string}`,
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
