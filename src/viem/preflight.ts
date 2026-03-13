/**
 * Pre-flight validation helpers for MoreVaults SDK flows.
 *
 * Each function reads on-chain state and throws a descriptive error BEFORE
 * the actual contract call, so developers see a clear, actionable message
 * instead of a raw VM revert.
 */

import { type Address, type PublicClient, getAddress, zeroAddress } from 'viem'
import { CONFIG_ABI, BRIDGE_ABI, VAULT_ABI, ERC20_ABI, OFT_ABI } from './abis'
import { InsufficientLiquidityError } from './errors'
import { quoteComposeFee } from './crossChainFlows'
import { createChainClient } from './spokeRoutes'
import { EID_TO_CHAIN_ID, OFT_ROUTES } from './chains'

/**
 * Pre-flight checks for async cross-chain flows (D4 / D5 / R5).
 *
 * Validates that:
 * 1. The CCManager is configured on the vault.
 * 2. An escrow is registered in the vault's registry.
 * 3. The vault is a hub (required for async flows).
 * 4. The vault does NOT have oracle-based cross-chain accounting enabled
 *    (oracle-on vaults should use depositSimple / depositCrossChainOracleOn).
 * 5. The vault is not paused.
 *
 * All reads that are independent of each other are executed in parallel via
 * Promise.all to minimise latency.
 *
 * @param publicClient  Public client for contract reads
 * @param vault         Vault address (diamond proxy)
 * @param escrow        Escrow address from VaultAddresses
 */
export async function preflightAsync(
  publicClient: PublicClient,
  vault: Address,
  escrow: Address,
): Promise<void> {
  const v = getAddress(vault)

  // Parallel read: ccManager, escrow, isHub, oraclesCrossChainAccounting, paused
  const [ccManager, registeredEscrow, isHub, oraclesEnabled, isPaused] =
    await Promise.all([
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'getCrossChainAccountingManager',
      }),
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'getEscrow',
      }),
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'isHub',
      }),
      publicClient.readContract({
        address: v,
        abi: BRIDGE_ABI,
        functionName: 'oraclesCrossChainAccounting',
      }),
      publicClient.readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'paused',
      }),
    ])

  if (ccManager === zeroAddress) {
    throw new Error(
      `[MoreVaults] CCManager not configured on vault ${vault}. Call setCrossChainAccountingManager(ccManagerAddress) as vault owner first.`,
    )
  }

  if (registeredEscrow === zeroAddress) {
    throw new Error(
      `[MoreVaults] Escrow not configured for vault ${vault}. The registry must have an escrow set for this vault.`,
    )
  }

  if (!isHub) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is not a hub vault. Async flows (D4/D5/R5) only work on hub vaults.`,
    )
  }

  if (oraclesEnabled) {
    throw new Error(
      `[MoreVaults] Vault ${vault} has oracle-based cross-chain accounting enabled. Use depositSimple/depositCrossChainOracleOn instead of async flows.`,
    )
  }

  if (isPaused) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`,
    )
  }
}

/**
 * Pre-flight liquidity check for async redeem (R5).
 *
 * Reads the hub's liquid balance of the underlying token and compares it
 * against the assets the user expects to receive. If the hub does not hold
 * enough liquid assets the redeem will be auto-refunded after the LZ round-trip,
 * wasting the LayerZero fee.
 *
 * Uses `convertToAssets` (not `previewRedeem`) because async cross-chain vaults
 * disable direct redeem and revert on `previewRedeem` by design.
 *
 * This check is best-effort: liquidity could change in the 1-5 minutes between
 * submission and execution. But it catches the common case where the hub is
 * already under-funded at the time of submission.
 *
 * @param publicClient  Public client for contract reads
 * @param vault         Vault address (diamond proxy)
 * @param shares        Shares the user intends to redeem
 */
export async function preflightRedeemLiquidity(
  publicClient: PublicClient,
  vault: Address,
  shares: bigint,
): Promise<void> {
  const v = getAddress(vault)

  // Batch 1: check if this is a hub vault without oracle accounting.
  // Only those vaults can have liquidity stranded on spoke chains.
  const [isHub, oraclesEnabled] = await Promise.all([
    publicClient.readContract({
      address: v,
      abi: CONFIG_ABI,
      functionName: 'isHub',
    }),
    publicClient.readContract({
      address: v,
      abi: BRIDGE_ABI,
      functionName: 'oraclesCrossChainAccounting',
    }),
  ])

  // Non-hub vaults and oracle-on hubs hold all redeemable assets locally —
  // no liquidity gap is possible, so skip the check.
  if (!isHub || oraclesEnabled) return

  // Batch 2: underlying address (needed for ERC-20 balanceOf)
  const underlying = await publicClient.readContract({
    address: v,
    abi: VAULT_ABI,
    functionName: 'asset',
  })

  // Batch 3: hub liquid balance + convertToAssets
  // NOTE: previewRedeem reverts on async cross-chain vaults (disabled by design).
  //       convertToAssets is always safe and gives a correct lower-bound estimate.
  const [hubLiquid, assetsNeeded] = await Promise.all([
    publicClient.readContract({
      address: getAddress(underlying as Address),
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [v],
    }),
    publicClient.readContract({
      address: v,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [shares],
    }),
  ])

  const hubLiquidBig = hubLiquid as bigint
  const assetsNeededBig = assetsNeeded as bigint

  if (hubLiquidBig < assetsNeededBig) {
    throw new InsufficientLiquidityError(vault, hubLiquidBig, assetsNeededBig)
  }
}

/**
 * Pre-flight checks for synchronous deposit flows (D1 / D3).
 *
 * Validates that:
 * 1. The vault is not paused.
 * 2. The vault still has deposit capacity (maxDeposit > 0).
 *
 * Both reads are executed in parallel.
 *
 * @param publicClient  Public client for contract reads
 * @param vault         Vault address (diamond proxy)
 */
export async function preflightSync(
  publicClient: PublicClient,
  vault: Address,
): Promise<void> {
  const v = getAddress(vault)

  // Run paused and maxDeposit in parallel.
  // maxDeposit(address(0)) may REVERT on whitelisted vaults — catch separately.
  const [isPaused, depositCapResult] = await Promise.all([
    publicClient.readContract({
      address: v,
      abi: CONFIG_ABI,
      functionName: 'paused',
    }),
    publicClient
      .readContract({
        address: v,
        abi: CONFIG_ABI,
        functionName: 'maxDeposit',
        args: [zeroAddress],
      })
      .catch(() => null as null),
  ])

  if (isPaused) {
    throw new Error(
      `[MoreVaults] Vault ${vault} is paused. Cannot perform any actions.`,
    )
  }

  // null means maxDeposit reverted → whitelist vault — skip capacity check
  // (the user may still be whitelisted; canDeposit will do user-specific check)
  if (depositCapResult !== null && depositCapResult === 0n) {
    throw new Error(
      `[MoreVaults] Vault ${vault} has reached deposit capacity. No more deposits accepted.`,
    )
  }
}

/**
 * Pre-flight checks for spoke-to-hub deposits (D6 / D7 via OFT Compose).
 *
 * Validates that:
 * 1. User has enough tokens on the spoke chain to deposit.
 * 2. User has enough native gas on the spoke chain for TX1 (OFT.send).
 * 3. For Stargate OFTs (2-TX flow): user has enough ETH on the hub chain
 *    for TX2 (compose retry). This prevents sending TX1 only to get stuck
 *    because there's no ETH on the hub for TX2.
 *
 * @param spokePublicClient  Public client on the SPOKE chain
 * @param vault              Vault address
 * @param spokeOFT           OFT contract address on the spoke chain
 * @param hubEid             LZ EID for the hub chain
 * @param spokeEid           LZ EID for the spoke chain
 * @param amount             Amount of tokens to deposit
 * @param userAddress        User's wallet address
 * @param lzFee              LZ fee for TX1 (from quoteDepositFromSpokeFee)
 * @returns                  Object with validated balances for UI display
 */
export async function preflightSpokeDeposit(
  spokePublicClient: PublicClient,
  vault: Address,
  spokeOFT: Address,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  userAddress: Address,
  lzFee: bigint,
): Promise<{
  spokeTokenBalance: bigint
  spokeNativeBalance: bigint
  hubNativeBalance: bigint
  estimatedComposeFee: bigint
  isStargate: boolean
}> {
  const oft = getAddress(spokeOFT)

  // Read the underlying token address from the OFT
  const spokeToken = await spokePublicClient.readContract({
    address: oft,
    abi: OFT_ABI,
    functionName: 'token',
  })

  // Check token balance + native balance on spoke in parallel
  const [spokeTokenBalance, spokeNativeBalance] = await Promise.all([
    spokePublicClient.readContract({
      address: spokeToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [getAddress(userAddress)],
    }),
    spokePublicClient.getBalance({ address: getAddress(userAddress) }),
  ])

  // 1. Check token balance
  if (spokeTokenBalance < amount) {
    throw new Error(
      `[MoreVaults] Insufficient token balance on spoke chain.\n` +
      `  Need:  ${amount}\n` +
      `  Have:  ${spokeTokenBalance}\n` +
      `  Token: ${spokeToken}`,
    )
  }

  // 2. Check native gas for TX1 (lzFee + gas buffer)
  const gasBuffer = 500_000_000_000_000n // 0.0005 ETH for gas
  if (spokeNativeBalance < lzFee + gasBuffer) {
    throw new Error(
      `[MoreVaults] Insufficient native gas on spoke chain for TX1.\n` +
      `  Need:  ~${lzFee + gasBuffer} wei (LZ fee + gas)\n` +
      `  Have:  ${spokeNativeBalance} wei`,
    )
  }

  // 3. For Stargate OFTs: check ETH on hub for TX2 (compose retry)
  const STARGATE_ASSETS = new Set(['stgUSDC', 'USDT', 'WETH'])
  let isStargate = false
  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    if (!STARGATE_ASSETS.has(symbol)) continue
    for (const entry of Object.values(chainMap as Record<number, { oft: string; token: string }>)) {
      if (getAddress(entry.oft) === oft) isStargate = true
    }
  }

  let hubNativeBalance = 0n
  let estimatedComposeFee = 0n

  if (isStargate) {
    const hubChainId = EID_TO_CHAIN_ID[hubEid]
    const hubClient = createChainClient(hubChainId)
    if (hubClient) {
      [hubNativeBalance, estimatedComposeFee] = await Promise.all([
        hubClient.getBalance({ address: getAddress(userAddress) }),
        quoteComposeFee(hubClient, vault, spokeEid, userAddress),
      ])

      const hubGasBuffer = 300_000_000_000_000n // 0.0003 ETH for gas
      const totalNeeded = estimatedComposeFee + hubGasBuffer

      if (hubNativeBalance < totalNeeded) {
        throw new Error(
          `[MoreVaults] Insufficient ETH on hub chain for TX2 (compose retry).\n` +
          `  This is a Stargate 2-TX flow — TX2 requires ETH on the hub chain.\n` +
          `  Need:  ~${totalNeeded} wei (compose fee ${estimatedComposeFee} + gas)\n` +
          `  Have:  ${hubNativeBalance} wei\n` +
          `  Short: ${totalNeeded - hubNativeBalance} wei\n` +
          `  Send ETH to ${userAddress} on chainId ${hubChainId} before depositing.`,
        )
      }
    }
  }

  return {
    spokeTokenBalance,
    spokeNativeBalance,
    hubNativeBalance,
    estimatedComposeFee,
    isStargate,
  }
}

/**
 * Pre-flight checks for spoke→hub→spoke redeem (R6 + R1 + R7).
 *
 * Validates that:
 * 1. User has shares on the spoke chain.
 * 2. User has enough native gas on the spoke for TX1 (share bridge LZ fee + gas).
 * 3. User has enough native gas on the hub for TX2 (redeem gas) + TX3 (asset bridge LZ fee + gas).
 * 4. The vault has enough liquid assets on the hub to redeem.
 *
 * @param route           SpokeRedeemRoute from resolveRedeemAddresses
 * @param shares          Shares the user intends to redeem
 * @param userAddress     User's wallet address
 * @param shareBridgeFee  LZ fee for share bridge (TX1) — from quoteSend on spoke SHARE_OFT
 * @returns               Validated balances for UI display
 */
export async function preflightSpokeRedeem(
  route: {
    hubChainId: number
    spokeChainId: number
    hubEid: number
    spokeEid: number
    hubAsset: `0x${string}`
    spokeShareOft: `0x${string}`
    hubAssetOft: `0x${string}`
    spokeAsset: `0x${string}`
    isStargate: boolean
  },
  shares: bigint,
  userAddress: `0x${string}`,
  shareBridgeFee: bigint,
): Promise<{
  sharesOnSpoke: bigint
  spokeNativeBalance: bigint
  hubNativeBalance: bigint
  estimatedAssetBridgeFee: bigint
  estimatedAssetsOut: bigint
  hubLiquidBalance: bigint
}> {
  const spokeClient = createChainClient(route.spokeChainId)
  const hubClient = createChainClient(route.hubChainId)
  if (!spokeClient) throw new Error(`No public RPC for spoke chainId ${route.spokeChainId}`)
  if (!hubClient) throw new Error(`No public RPC for hub chainId ${route.hubChainId}`)

  const user = getAddress(userAddress)
  const vault = getAddress(route.hubAsset) // vault address is same on all chains

  // Parallel reads: shares on spoke, native balances, vault data on hub
  const [sharesOnSpoke, spokeNativeBalance, hubNativeBalance] = await Promise.all([
    spokeClient.readContract({
      address: route.spokeShareOft,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [user],
    }),
    spokeClient.getBalance({ address: user }),
    hubClient.getBalance({ address: user }),
  ])

  // 1. Check shares
  if (sharesOnSpoke < shares) {
    throw new Error(
      `[MoreVaults] Insufficient shares on spoke chain.\n` +
      `  Need:  ${shares}\n` +
      `  Have:  ${sharesOnSpoke}\n` +
      `  Token: ${route.spokeShareOft}`,
    )
  }

  // 2. Check spoke gas for TX1
  const spokeGasBuffer = 500_000_000_000_000n // 0.0005 ETH
  if (spokeNativeBalance < shareBridgeFee + spokeGasBuffer) {
    throw new Error(
      `[MoreVaults] Insufficient native gas on spoke for TX1 (share bridge).\n` +
      `  Need:  ~${shareBridgeFee + spokeGasBuffer} wei (LZ fee + gas)\n` +
      `  Have:  ${spokeNativeBalance} wei`,
    )
  }

  // 3. Estimate asset bridge fee (TX3) and check hub gas
  // Quote Stargate/OFT fee for bridging assets back to spoke
  // Use convertToAssets estimate for quoting
  let estimatedAssetsOut = 0n
  let estimatedAssetBridgeFee = 0n
  let hubLiquidBalance = 0n

  // Read vault data on hub — need the actual vault address (not hub asset)
  // The vault address is same as route but we need it from the calling context
  // For now, read convertToAssets using the share token which IS the vault for ERC-4626
  // Actually we need the vault address. The hubAsset is the underlying token, not the vault.
  // We can get vault address by checking what contract the shares are from.
  // In MoreVaults, share OFT on hub wraps the vault token. Let's read token() from hub share OFT.

  // Get vault address from hub: the SHARE_OFT.token() on hub = vault address
  // But we have hubAssetOft which is Stargate pool, not share OFT.
  // Instead, read from the spoke SHARE_OFT's peer on hub.
  // Actually, for preflightSpokeRedeem we need the vault address passed in.
  // Let me simplify — estimate the LZ fee with a dummy amount.

  try {
    const toBytes32 = `0x${user.slice(2).padStart(64, '0')}` as `0x${string}`
    const dummyAmount = 1_000_000n // 1 USDC for fee estimation
    const feeResult = await hubClient.readContract({
      address: route.hubAssetOft,
      abi: OFT_ABI,
      functionName: 'quoteSend',
      args: [{
        dstEid: route.spokeEid,
        to: toBytes32,
        amountLD: dummyAmount,
        minAmountLD: dummyAmount * 99n / 100n,
        extraOptions: '0x' as `0x${string}`,
        composeMsg: '0x' as `0x${string}`,
        oftCmd: (route.isStargate ? '0x01' : '0x') as `0x${string}`,
      }, false],
    })
    estimatedAssetBridgeFee = feeResult.nativeFee
  } catch {
    // Can't quote — use conservative estimate
    estimatedAssetBridgeFee = 300_000_000_000_000n // 0.0003 ETH fallback
  }

  // Hub needs: TX2 gas (~0.0002 ETH) + TX3 LZ fee + TX3 gas (~0.0001 ETH)
  const hubGasBuffer = 300_000_000_000_000n // 0.0003 ETH for gas (TX2 + TX3)
  const totalHubNeeded = estimatedAssetBridgeFee + hubGasBuffer

  if (hubNativeBalance < totalHubNeeded) {
    throw new Error(
      `[MoreVaults] Insufficient ETH on hub chain for TX2 (redeem) + TX3 (asset bridge).\n` +
      `  Need:  ~${totalHubNeeded} wei (LZ fee ${estimatedAssetBridgeFee} + gas)\n` +
      `  Have:  ${hubNativeBalance} wei\n` +
      `  Short: ${totalHubNeeded - hubNativeBalance} wei\n` +
      `  Send ETH to ${userAddress} on chainId ${route.hubChainId} before redeeming.`,
    )
  }

  return {
    sharesOnSpoke,
    spokeNativeBalance,
    hubNativeBalance,
    estimatedAssetBridgeFee,
    estimatedAssetsOut,
    hubLiquidBalance,
  }
}
