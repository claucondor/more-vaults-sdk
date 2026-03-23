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
import { VAULT_ABI, VAULT_REQUEST_REDEEM_LEGACY_ABI, BRIDGE_ABI, OFT_ABI, CONFIG_ABI, ERC20_ABI, METADATA_ABI } from './abis'
import type {
  VaultAddresses,
  RedeemResult,
  AsyncRequestResult,
} from './types'
import { ActionType } from './types'
import { ensureAllowance, getVaultStatus, quoteLzFee, detectStargateOft } from './utils'
import { preflightAsync, preflightRedeemLiquidity } from './preflight'
import { EscrowNotConfiguredError, VaultPausedError, InvalidInputError, WithdrawalTimelockActiveError } from './errors'
import { validateWalletChain } from './chainValidation'
import { parseContractError } from './errorParser'
import { OFT_ROUTES, CHAIN_ID_TO_EID } from './chains'
import { createChainClient } from './spokeRoutes'
import { OMNI_FACTORY_ADDRESS, getSpokeShareOft, getHubShareOft } from './topology'

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

  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  let assets: bigint
  try {
    const { result } = await publicClient.simulateContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'redeem',
      args: [shares, getAddress(receiver), getAddress(owner)],
      account: account.address,
    })
    assets = result
  } catch (err) {
    parseContractError(err, vault, account.address)
  }

  const txHash = await walletClient.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'redeem',
    args: [shares, getAddress(receiver), getAddress(owner)],
    account,
    chain: walletClient.chain,
  })

  return { txHash, assets: assets! }
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

  if (assets === 0n) throw new InvalidInputError('assets amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  try {
    await publicClient.simulateContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [assets, getAddress(receiver), getAddress(owner)],
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, vault, account.address)
  }

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

  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

  // Validate wallet is on the correct chain (opt-in via hubChainId)
  validateWalletChain(walletClient, addresses.hubChainId)

  // Detect which signature the vault supports: new (uint256, address) or legacy (uint256)
  let useLegacy = false

  try {
    await publicClient.simulateContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'requestRedeem',
      args: [shares, getAddress(owner)],
      account: account.address,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('FunctionDoesNotExist') || msg.includes('0xa9ad62f8')) {
      useLegacy = true
    } else {
      parseContractError(err, vault, account.address)
    }
  }

  if (useLegacy) {
    try {
      await publicClient.simulateContract({
        address: vault,
        abi: VAULT_REQUEST_REDEEM_LEGACY_ABI,
        functionName: 'requestRedeem',
        args: [shares],
        account: account.address,
      })
    } catch (err) {
      parseContractError(err, vault, account.address)
    }
  }

  let txHash: Hash
  if (useLegacy) {
    txHash = await walletClient.writeContract({
      address: vault,
      abi: VAULT_REQUEST_REDEEM_LEGACY_ABI,
      functionName: 'requestRedeem',
      args: [shares],
      account,
      chain: walletClient.chain,
    })
  } else {
    txHash = await walletClient.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'requestRedeem',
      args: [shares, getAddress(owner)],
      account,
      chain: walletClient.chain,
    })
  }

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

  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

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
  let guid: `0x${string}`
  let gasEstimate: bigint
  try {
    const [{ result }, gas] = await Promise.all([
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
    guid = result as `0x${string}`
    gasEstimate = gas
  } catch (err) {
    parseContractError(err, vault, account.address)
  }

  const gas = gasEstimate! * 130n / 100n

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

  return { txHash, guid: guid! }
}

/**
 * Smart redeem — auto-selects the correct flow based on vault configuration.
 *
 * Detects the vault mode and dispatches to:
 * - Sync vaults (local / cross-chain-oracle): `redeemShares` (direct ERC-4626 redeem)
 * - Async vaults (cross-chain, oracle OFF): `redeemAsync` (LZ Read flow, quotes fee automatically)
 *
 * ## Tested flows
 *
 * - [x] Hub-chain async redeem (Base→Base, vault 0x8f74...ba6):
 *       smartRedeem auto-detects async → redeemAsync → LZ Read callback ~4.5 min.
 *       TX: 0xd890c4...8b58c
 *
 * ## Untested flows
 *
 * - [ ] Hub-chain sync redeem (redeemShares path) — needs a vault with oracle ON
 * - [ ] requestRedeem + withdrawAssets (withdrawal queue flow) — separate entry points
 *
 * @param walletClient   Wallet client with account attached
 * @param publicClient   Public client for reads
 * @param addresses      Vault address set (`escrow` required for async vaults)
 * @param shares         Amount of shares to redeem
 * @param receiver       Address that will receive the underlying assets
 * @param owner          Owner of the shares being redeemed
 * @param extraOptions   Optional LZ extra options (only used for async vaults)
 * @returns              RedeemResult or AsyncRequestResult depending on vault mode
 */
export async function smartRedeem(
  walletClient: WalletClient,
  publicClient: PublicClient,
  addresses: VaultAddresses,
  shares: bigint,
  receiver: Address,
  owner: Address,
  extraOptions: `0x${string}` = '0x',
): Promise<RedeemResult | AsyncRequestResult> {
  const vault = getAddress(addresses.vault)
  const status = await getVaultStatus(publicClient, vault)

  if (status.mode === 'paused') {
    throw new VaultPausedError(vault)
  }

  if (status.recommendedDepositFlow === 'depositAsync') {
    // Async vault — use redeemAsync
    const lzFee = await quoteLzFee(publicClient, vault, extraOptions)
    return redeemAsync(walletClient, publicClient, addresses, shares, receiver, owner, lzFee, extraOptions)
  }

  if (status.withdrawalQueueEnabled) {
    const pending = await getWithdrawalRequest(publicClient, vault as Address, owner)
    const now = BigInt(Math.floor(Date.now() / 1000))

    if (pending && (pending.timelockEndsAt === 0n || now >= pending.timelockEndsAt)) {
      // Timelock expired (or no timelock) and request is pending — complete the redeem
      return redeemShares(walletClient, publicClient, addresses, shares, receiver, owner)
    }

    if (pending) {
      // Request submitted but timelock not yet expired
      throw new WithdrawalTimelockActiveError(vault, pending.timelockEndsAt)
    }

    if (status.withdrawalTimelockSeconds === 0n) {
      // R3 — no timelock: submit request then redeem immediately back-to-back
      await requestRedeem(walletClient, publicClient, addresses, shares, owner)
      return redeemShares(walletClient, publicClient, addresses, shares, receiver, owner)
    }

    // R4 — timelock active: submit request and throw with expected expiry
    const { txHash: requestTxHash } = await requestRedeem(walletClient, publicClient, addresses, shares, owner)
    const timelockEndsAt = now + status.withdrawalTimelockSeconds
    throw new WithdrawalTimelockActiveError(vault, timelockEndsAt, requestTxHash)
  }

  // Sync vault without queue — direct redeem
  return redeemShares(walletClient, publicClient, addresses, shares, receiver, owner)
}

/**
 * Quote the LZ fee for bridging shares from spoke to hub via SHARE_OFT.
 *
 * **IMPORTANT**: `amountLD` must be in SHARE_OFT native decimals (e.g. 18),
 * NOT vault decimals (e.g. 8). Use the raw `SHARE_OFT.balanceOf(user)` value,
 * or `getUserPositionMultiChain().rawSpokeShares[chainId]`.
 *
 * @param spokePublicClient  Public client on the SPOKE chain
 * @param shareOFT           SHARE_OFT address on the spoke chain
 * @param hubChainEid        LayerZero Endpoint ID for the hub chain
 * @param amountLD           Shares in SHARE_OFT native decimals (raw balanceOf)
 * @param receiver           Receiver address on the hub chain
 * @returns                  LZ native fee in wei
 */
export async function quoteShareBridgeFee(
  spokePublicClient: PublicClient,
  shareOFT: Address,
  hubChainEid: number,
  amountLD: bigint,
  receiver: Address,
): Promise<bigint> {
  const oft = getAddress(shareOFT)
  const toBytes32 = pad(getAddress(receiver), { size: 32 })

  const sendParam = {
    dstEid: hubChainEid,
    to: toBytes32,
    amountLD,
    minAmountLD: amountLD,
    extraOptions: '0x' as `0x${string}`,
    composeMsg: '0x' as `0x${string}`,
    oftCmd: '0x' as `0x${string}`,
  }

  const feeResult = await spokePublicClient.readContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [sendParam, false],
  }) as { nativeFee: bigint; lzTokenFee: bigint }

  return feeResult.nativeFee
}

/**
 * R6 — Bridge shares from spoke to hub chain via OFT.
 *
 * This is step 1 of a cross-chain spoke redeem flow:
 *   1. `bridgeSharesToHub()` — send shares from spoke → hub via SHARE_OFT
 *   2. `smartRedeem()` — redeem shares on hub → underlying (auto-detects async)
 *   3. `bridgeAssetsToSpoke()` — bridge assets from hub → spoke via asset OFT
 *
 * **IMPORTANT**: The `shares` parameter must be in SHARE_OFT decimals (the raw
 * `balanceOf` from the spoke OFT), NOT in vault decimals. Use the user's actual
 * SHARE_OFT balance, or convert with `vaultShares * 10^(oftDecimals - vaultDecimals)`.
 *
 * **User transactions on spoke chain**: 1 approve (shares to shareOFT) + 1 OFT.send().
 * **Gas**: Requires native token on spoke for LZ fees, and gas on hub for steps 2+3.
 *
 * @param walletClient   Wallet client on the SPOKE chain
 * @param publicClient   Public client on the SPOKE chain
 * @param shareOFT       OFTAdapter address for vault shares on the spoke chain
 * @param hubChainEid    LayerZero Endpoint ID for the hub chain
 * @param shares         Amount of shares in SHARE_OFT decimals (use raw balanceOf)
 * @param receiver       Receiver address on the HUB chain
 * @param lzFee          msg.value for OFT send (from quoteShareBridgeFee)
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

  if (shares === 0n) throw new InvalidInputError('shares amount must be greater than zero')

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

  try {
    await publicClient.simulateContract({
      address: oft,
      abi: OFT_ABI,
      functionName: 'send',
      args: [sendParam, fee, account.address],
      value: lzFee,
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, oft, account.address)
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
 * R7 — Bridge underlying assets from hub back to spoke chain via OFT.
 *
 * This is the final step of a full spoke redeem flow:
 *   1. `bridgeSharesToHub()` — send shares from spoke → hub via SHARE_OFT
 *   2. `smartRedeem()` — redeem shares on hub → underlying assets (e.g. USDC)
 *   3. `bridgeAssetsToSpoke()` — bridge assets from hub → spoke via OFT
 *
 * For Stargate OFTs (stgUSDC, USDT, WETH), uses TAXI mode (oftCmd 0x01) for
 * immediate delivery. For non-Stargate OFTs, uses empty oftCmd (0x).
 *
 * **User transactions on hub chain**: 1 approve (assets to OFT) + 1 OFT.send().
 * **Gas**: Requires native token on hub for LZ fees.
 *
 * ## Tested flows
 *
 * - [x] Stargate OFT bridge (Base→Eth, stgUSDC, TAXI mode 0x01):
 *       Delivery ~13 min. TX: 0x... (see redeem-async-hub.ts test)
 *
 * ## Untested flows
 *
 * - [ ] Standard OFT bridge (non-Stargate, oftCmd 0x) — needs non-Stargate asset vault
 *
 * @param walletClient   Wallet client on the HUB chain
 * @param publicClient   Public client on the HUB chain
 * @param assetOFT       OFT address for the underlying asset on the hub chain
 * @param spokeChainEid  LayerZero Endpoint ID for the spoke (destination) chain
 * @param amount         Amount of underlying assets to bridge
 * @param receiver       Receiver address on the SPOKE chain
 * @param lzFee          msg.value for OFT send (quote via OFT.quoteSend)
 * @param isStargate     Whether this is a Stargate OFT (uses TAXI mode)
 * @returns              Transaction hash of the OFT.send() call
 */
export async function bridgeAssetsToSpoke(
  walletClient: WalletClient,
  publicClient: PublicClient,
  assetOFT: Address,
  spokeChainEid: number,
  amount: bigint,
  receiver: Address,
  lzFee: bigint,
  isStargate: boolean = true,
): Promise<{ txHash: Hash }> {
  const account = walletClient.account!
  const oft = getAddress(assetOFT)

  if (amount === 0n) throw new InvalidInputError('amount must be greater than zero')

  // Read underlying token and approve if different from OFT
  const token = await publicClient.readContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'token',
  })

  if (getAddress(token) !== oft) {
    // OFTAdapter pattern: approve underlying token to OFT
    await ensureAllowance(walletClient, publicClient, token, oft, amount)
  } else {
    // Pure OFT: approve OFT to itself
    await ensureAllowance(walletClient, publicClient, oft, oft, amount)
  }

  const toBytes32 = pad(getAddress(receiver), { size: 32 })

  const sendParam = {
    dstEid: spokeChainEid,
    to: toBytes32,
    amountLD: amount,
    minAmountLD: amount * 99n / 100n, // 1% slippage tolerance for Stargate
    extraOptions: '0x' as `0x${string}`,
    composeMsg: '0x' as `0x${string}`,
    oftCmd: (isStargate ? '0x01' : '0x') as `0x${string}`,
  }

  const fee = {
    nativeFee: lzFee,
    lzTokenFee: 0n,
  }

  try {
    await publicClient.simulateContract({
      address: oft,
      abi: OFT_ABI,
      functionName: 'send',
      args: [sendParam, fee, account.address],
      value: lzFee,
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, oft, account.address)
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

export interface SpokeRedeemRoute {
  /** Hub chain ID */
  hubChainId: number
  /** Spoke chain ID */
  spokeChainId: number
  /** LZ EID for the hub */
  hubEid: number
  /** LZ EID for the spoke */
  spokeEid: number
  /** Vault underlying asset address on hub (e.g. USDC on Base) */
  hubAsset: Address
  /** SHARE_OFT on spoke chain (user has shares here) */
  spokeShareOft: Address
  /** Asset OFT on hub for bridging back (e.g. Stargate USDC pool on Base) */
  hubAssetOft: Address
  /** Underlying asset address on spoke chain (e.g. USDC on Ethereum) */
  spokeAsset: Address
  /** Whether the asset OFT is a Stargate pool (determines oftCmd) */
  isStargate: boolean
  /** OFT route symbol (e.g. 'stgUSDC') */
  symbol: string
}

const FACTORY_COMPOSER_ABI = [
  {
    type: 'function' as const,
    name: 'vaultComposer' as const,
    inputs: [{ name: '_vault', type: 'address' as const }] as const,
    outputs: [{ name: '', type: 'address' as const }] as const,
    stateMutability: 'view' as const,
  },
] as const

const REDEEM_COMPOSER_ABI = [
  {
    type: 'function' as const,
    name: 'SHARE_OFT' as const,
    inputs: [] as const,
    outputs: [{ name: '', type: 'address' as const }] as const,
    stateMutability: 'view' as const,
  },
] as const

/**
 * Resolve all addresses needed for a full spoke→hub→spoke redeem flow.
 *
 * Discovers dynamically:
 * - SHARE_OFT on the spoke chain (via hub composer → peers)
 * - Asset OFT on the hub chain (matches vault.asset() to OFT_ROUTES)
 * - Underlying asset on the spoke chain
 *
 * @param hubPublicClient  Public client on the HUB chain
 * @param vault            Vault address
 * @param hubChainId       Hub chain ID
 * @param spokeChainId     Spoke chain ID where user has shares
 * @returns                All addresses needed for bridgeSharesToHub + redeemShares + bridgeAssetsToSpoke
 */
export async function resolveRedeemAddresses(
  hubPublicClient: PublicClient,
  vault: Address,
  hubChainId: number,
  spokeChainId: number,
): Promise<SpokeRedeemRoute> {
  const v = getAddress(vault)
  const hubEid = CHAIN_ID_TO_EID[hubChainId]
  const spokeEid = CHAIN_ID_TO_EID[spokeChainId]
  if (!hubEid || !spokeEid) throw new Error(`No LZ EID for chainId ${!hubEid ? hubChainId : spokeChainId}`)

  // Read vault asset and composer address in parallel
  const [hubAsset, composerAddress] = await Promise.all([
    hubPublicClient.readContract({ address: v, abi: VAULT_ABI, functionName: 'asset' }) as Promise<Address>,
    hubPublicClient.readContract({
      address: OMNI_FACTORY_ADDRESS,
      abi: FACTORY_COMPOSER_ABI,
      functionName: 'vaultComposer',
      args: [v],
    }) as Promise<Address>,
  ])

  if (composerAddress === zeroAddress) {
    throw new Error(`[MoreVaults] No composer registered for vault ${vault} on hub chain ${hubChainId}`)
  }

  // Read hub SHARE_OFT via MoreVaultsOftAdapterFactory.OFTs(vault)
  const hubShareOft = await getHubShareOft(hubPublicClient, vault)
  if (!hubShareOft) throw new Error(`[MoreVaults] No hub share OFT found for vault ${vault} on chain ${hubChainId}`)

  // Get spoke SHARE_OFT via MoreVaultsOftFactory.OFTs(vault)
  const spokeClient = createChainClient(spokeChainId)
  if (!spokeClient) throw new Error(`[MoreVaults] No client for spoke chain ${spokeChainId}`)
  const spokeShareOft = await getSpokeShareOft(spokeClient as any, vault)
  if (!spokeShareOft) throw new Error(`[MoreVaults] No share OFT found for vault ${vault} on spoke chain ${spokeChainId}`)

  // Find matching OFT route for the vault's asset on the hub chain
  let hubAssetOft: Address | null = null
  let spokeAsset: Address | null = null
  let symbol = ''

  for (const [sym, chainMap] of Object.entries(OFT_ROUTES)) {
    const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    const spokeEntry = (chainMap as Record<number, { oft: string; token: string }>)[spokeChainId]
    if (!hubEntry || !spokeEntry) continue

    if (getAddress(hubEntry.token) === getAddress(hubAsset)) {
      hubAssetOft = getAddress(hubEntry.oft) as Address
      spokeAsset = getAddress(spokeEntry.token) as Address
      symbol = sym
      break
    }
  }

  if (!hubAssetOft || !spokeAsset) {
    throw new Error(
      `[MoreVaults] No OFT route found for vault asset ${hubAsset} ` +
      `between hub chain ${hubChainId} and spoke chain ${spokeChainId}`,
    )
  }

  // On-chain detection: Stargate pools implement stargateType(), standard OFTs revert
  const isStargate = await detectStargateOft(hubPublicClient, hubAssetOft)

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
  }
}
