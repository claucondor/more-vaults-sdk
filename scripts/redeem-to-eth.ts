/**
 * Full cross-chain redeem: Ethereum shares → USDC back on Ethereum.
 *
 * All addresses are discovered dynamically from the vault + topology.
 * Only the vault address and chain IDs are configured.
 *
 * 4-step flow:
 *   TX1 (Ethereum): bridgeSharesToHub — shares Ethereum→Base via SHARE_OFT
 *   Wait:           LZ delivers shares to Base (~5-15 min)
 *   TX2 (Base):     redeemShares — vault.redeem on Base → USDC
 *   TX3 (Base):     bridgeAssetsToSpoke — USDC Base→Ethereum via Stargate
 *   Wait:           LZ delivers USDC to Ethereum (~5-15 min)
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/redeem-to-eth.ts
 */

import { createWalletClient, formatUnits, formatEther, getAddress, pad } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  bridgeSharesToHub,
  bridgeAssetsToSpoke,
  smartRedeem,
  resolveRedeemAddresses,
  preflightSpokeRedeem,
  ERC20_ABI,
  OFT_ABI,
  VAULT_ABI,
} from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'

// === ONLY THESE 3 VALUES ARE CONFIGURED ===
const VAULT           = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const SPOKE_CHAIN_ID  = 1     // Ethereum (user's chain)
const HUB_CHAIN_ID    = 8453  // Base (vault hub)

// Timeouts
const POLL_INTERVAL  = 30_000      // 30s
const BRIDGE_TIMEOUT = 2_700_000   // 45 min

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.\nUsage: PRIVATE_KEY=0x... npx tsx scripts/redeem-to-eth.ts')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  const spokeClient = createChainClient(SPOKE_CHAIN_ID)!
  const hubClient = createChainClient(HUB_CHAIN_ID)!

  const spokeWalletClient = createWalletClient({
    account,
    transport: createChainTransport(SPOKE_CHAIN_ID)!,
    chain: spokeClient.chain,
  })
  const hubWalletClient = createWalletClient({
    account,
    chain: hubClient.chain,
    transport: createChainTransport(HUB_CHAIN_ID)!,
  })

  // ================================================================
  // Discover all addresses dynamically
  // ================================================================
  console.log('Resolving redeem route...')
  const route = await resolveRedeemAddresses(hubClient, VAULT, HUB_CHAIN_ID, SPOKE_CHAIN_ID)

  console.log(`  Spoke SHARE_OFT: ${route.spokeShareOft}`)
  console.log(`  Hub asset OFT:   ${route.hubAssetOft} (${route.symbol})`)
  console.log(`  Hub asset:       ${route.hubAsset}`)
  console.log(`  Spoke asset:     ${route.spokeAsset}`)
  console.log(`  Stargate:        ${route.isStargate ? 'YES' : 'NO'}`)

  // ================================================================
  // Quote LZ fee + SDK pre-flight
  // ================================================================
  // Read shares first to quote fee
  const sharesOnSpoke = await spokeClient.readContract({
    address: route.spokeShareOft,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  if (sharesOnSpoke === 0n) {
    console.error('\nNo shares on spoke chain to redeem.')
    process.exit(1)
  }

  // Quote share bridge fee
  const toBytes32 = pad(getAddress(account.address), { size: 32 })
  const shareBridgeFee = await spokeClient.readContract({
    address: route.spokeShareOft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [{
      dstEid: route.hubEid,
      to: toBytes32,
      amountLD: sharesOnSpoke,
      minAmountLD: sharesOnSpoke,
      extraOptions: '0x' as `0x${string}`,
      composeMsg: '0x' as `0x${string}`,
      oftCmd: '0x' as `0x${string}`,
    }, false],
  })

  // SDK pre-flight: validates shares, spoke gas, hub gas for TX2+TX3
  console.log('\nRunning pre-flight checks...')
  const preflight = await preflightSpokeRedeem(
    route,
    sharesOnSpoke,
    account.address,
    shareBridgeFee.nativeFee,
  )

  // Preview
  const assetsExpected = await hubClient.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: [sharesOnSpoke],
  }) as bigint

  const spokeAssetBefore = await spokeClient.readContract({
    address: route.spokeAsset,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log(`  Shares on spoke:     ${sharesOnSpoke}`)
  console.log(`  Expected assets:     ~${formatUnits(assetsExpected, 6)}`)
  console.log(`  ETH on spoke:        ${formatEther(preflight.spokeNativeBalance)}`)
  console.log(`  ETH on hub:          ${formatEther(preflight.hubNativeBalance)}`)
  console.log(`  LZ fee (shares):     ${formatEther(shareBridgeFee.nativeFee)} ETH`)
  console.log(`  LZ fee (assets est): ${formatEther(preflight.estimatedAssetBridgeFee)} ETH`)
  console.log('  All checks passed!\n')

  // ================================================================
  // TX1: Bridge shares from spoke → hub
  // ================================================================
  console.log('========================================')
  console.log('TX1: Bridge shares spoke → hub')
  console.log('========================================')

  const { txHash: bridgeTxHash } = await bridgeSharesToHub(
    spokeWalletClient,
    spokeClient as any,
    route.spokeShareOft,
    route.hubEid,
    sharesOnSpoke,
    account.address,
    shareBridgeFee.nativeFee,
  )

  console.log(`\nTX1 sent: ${bridgeTxHash}`)

  // ================================================================
  // Wait for shares on hub
  // ================================================================
  console.log('\n========================================')
  console.log('Waiting for shares on hub')
  console.log('========================================')

  const sharesOnHubBefore = await hubClient.readContract({
    address: VAULT,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log(`Shares on hub before: ${sharesOnHubBefore}`)
  console.log(`Polling every ${POLL_INTERVAL / 1000}s, timeout ${BRIDGE_TIMEOUT / 60_000} min\n`)

  const sharesOnHub = await pollUntilIncreased(
    hubClient,
    VAULT,
    account.address,
    sharesOnHubBefore,
    POLL_INTERVAL,
    BRIDGE_TIMEOUT,
    'Shares on hub',
  )

  console.log(`\nShares arrived on hub! Balance: ${sharesOnHub}`)

  // ================================================================
  // TX2: Redeem shares on hub → underlying asset
  // ================================================================
  console.log('\n========================================')
  console.log('TX2: Redeem shares on hub')
  console.log('========================================')

  const redeemAmount = sharesOnHub
  const previewAssets = await hubClient.readContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: [redeemAmount],
  }) as bigint
  console.log(`Redeeming:   ${redeemAmount} shares`)
  console.log(`Expected:    ~${formatUnits(previewAssets, 6)}`)

  // smartRedeem auto-detects sync vs async vault
  const redeemResult = await smartRedeem(
    hubWalletClient,
    hubClient as any,
    { vault: VAULT },
    redeemAmount,
    account.address,
    account.address,
  )

  console.log(`\nTX2 sent:    ${redeemResult.txHash}`)

  // For async vaults, wait for USDC to arrive via LZ callback
  const isAsync = 'guid' in redeemResult
  if (isAsync) {
    console.log(`GUID:        ${redeemResult.guid}`)
    console.log(`LZ scan:     https://layerzeroscan.com/tx/${redeemResult.guid}`)
    console.log('\nWaiting for LZ Read callback + executeRequest...')

    const usdcBefore = await hubClient.readContract({
      address: route.hubAsset,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    })

    await pollUntilIncreased(
      hubClient,
      route.hubAsset,
      account.address,
      usdcBefore,
      POLL_INTERVAL,
      BRIDGE_TIMEOUT,
      'USDC on hub',
    )
  } else {
    console.log(`Redeemed:    ${formatUnits(redeemResult.assets, 6)}`)
  }

  // Check asset balance on hub after redeem
  const hubAssetBalance = await hubClient.readContract({
    address: route.hubAsset,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })
  console.log(`Assets on hub: ${formatUnits(hubAssetBalance, 6)}`)

  // ================================================================
  // TX3: Bridge assets from hub → spoke via OFT
  // ================================================================
  console.log('\n========================================')
  console.log('TX3: Bridge assets hub → spoke')
  console.log('========================================')

  const assetBridgeAmount = hubAssetBalance
  const assetBridgeFee = await hubClient.readContract({
    address: route.hubAssetOft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [{
      dstEid: route.spokeEid,
      to: toBytes32,
      amountLD: assetBridgeAmount,
      minAmountLD: assetBridgeAmount * 99n / 100n,
      extraOptions: '0x' as `0x${string}`,
      composeMsg: '0x' as `0x${string}`,
      oftCmd: (route.isStargate ? '0x01' : '0x') as `0x${string}`,
    }, false],
  })

  console.log(`Bridging: ${formatUnits(assetBridgeAmount, 6)}`)
  console.log(`LZ fee:   ${formatEther(assetBridgeFee.nativeFee)} ETH`)

  const { txHash: bridgeBackTxHash } = await bridgeAssetsToSpoke(
    hubWalletClient,
    hubClient as any,
    route.hubAssetOft,
    route.spokeEid,
    assetBridgeAmount,
    account.address,
    assetBridgeFee.nativeFee,
    route.isStargate,
  )

  console.log(`\nTX3 sent: ${bridgeBackTxHash}`)

  // ================================================================
  // Wait for assets on spoke
  // ================================================================
  console.log('\n========================================')
  console.log('Waiting for assets on spoke')
  console.log('========================================')
  console.log(`Polling every ${POLL_INTERVAL / 1000}s, timeout ${BRIDGE_TIMEOUT / 60_000} min\n`)

  const finalAssetBalance = await pollUntilIncreased(
    spokeClient,
    route.spokeAsset,
    account.address,
    spokeAssetBefore,
    POLL_INTERVAL,
    BRIDGE_TIMEOUT,
    'Assets on spoke',
  )

  const assetsReceived = finalAssetBalance - spokeAssetBefore

  console.log('\n========================================')
  console.log('REDEEM COMPLETE')
  console.log('========================================')
  console.log(`Vault:              ${VAULT}`)
  console.log(`TX1 (shares→hub):   ${bridgeTxHash}`)
  console.log(`TX2 (redeem):       ${redeemTxHash}`)
  console.log(`TX3 (assets→spoke): ${bridgeBackTxHash}`)
  console.log(`Shares redeemed:    ${sharesOnSpoke}`)
  console.log(`Assets received:    ${formatUnits(assetsReceived, 6)}`)
}

async function pollUntilIncreased(
  client: ReturnType<typeof createChainClient>,
  token: `0x${string}`,
  userAddress: `0x${string}`,
  balanceBefore: bigint,
  intervalMs: number,
  timeoutMs: number,
  label: string,
): Promise<bigint> {
  const startTime = Date.now()
  const deadline = startTime + timeoutMs
  let attempt = 0

  while (Date.now() < deadline) {
    attempt++
    try {
      const balance = await client!.readContract({
        address: getAddress(token),
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      })

      const elapsed = Math.round((Date.now() - startTime) / 1000)
      console.log(`[${elapsed}s] Poll #${attempt} — ${label}: ${balance}`)

      if (balance > balanceBefore) {
        return balance
      }
    } catch (e: any) {
      console.log(`[poll #${attempt}] RPC error: ${e.shortMessage || e.message} — retrying...`)
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  console.error(`\nTimeout after ${timeoutMs / 60_000} min — ${label} not increased.`)
  process.exit(1)
}

main().catch(e => {
  console.error('\n--- FATAL ERROR ---')
  console.error(e)
  process.exit(1)
})
