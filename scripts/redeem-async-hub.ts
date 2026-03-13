/**
 * Redeem shares that are already on the hub (Base) via async flow.
 * Shares were previously bridged from Ethereum via TX1.
 *
 * Flow:
 *   TX2 (Base): redeemAsync — approve escrow + initVaultActionRequest(REDEEM)
 *   Wait:       LZ Read callback → executeRequest (keeper)
 *   Check:      USDC arrives in wallet on Base
 *   TX3 (Base): bridgeAssetsToSpoke — USDC Base→Ethereum via Stargate
 *   Wait:       LZ delivers USDC to Ethereum (~5-15 min)
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/redeem-async-hub.ts
 */

import { createWalletClient, formatUnits, formatEther, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  redeemAsync,
  bridgeAssetsToSpoke,
  resolveRedeemAddresses,
  quoteLzFee,
  ERC20_ABI,
  OFT_ABI,
  VAULT_ABI,
} from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'
import { pad } from 'viem'

const VAULT           = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const SPOKE_CHAIN_ID  = 1
const HUB_CHAIN_ID    = 8453

const POLL_INTERVAL  = 30_000
const BRIDGE_TIMEOUT = 2_700_000

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  const hubClient = createChainClient(HUB_CHAIN_ID)!
  const spokeClient = createChainClient(SPOKE_CHAIN_ID)!
  const hubWalletClient = createWalletClient({
    account,
    chain: hubClient.chain,
    transport: createChainTransport(HUB_CHAIN_ID)!,
  })

  // Resolve route dynamically
  console.log('Resolving redeem route...')
  const route = await resolveRedeemAddresses(hubClient, VAULT, HUB_CHAIN_ID, SPOKE_CHAIN_ID)
  console.log(`  Hub asset OFT: ${route.hubAssetOft} (${route.symbol})`)
  console.log(`  Spoke asset:   ${route.spokeAsset}`)
  console.log(`  Stargate:      ${route.isStargate ? 'YES' : 'NO'}`)

  // Check shares on hub
  const sharesOnHub = await hubClient.readContract({
    address: VAULT,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  if (sharesOnHub === 0n) {
    console.error('No shares on hub to redeem.')
    process.exit(1)
  }

  // Preview + quote
  const [assetsExpected, lzFee, hubEthBalance] = await Promise.all([
    hubClient.readContract({
      address: VAULT,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [sharesOnHub],
    }) as Promise<bigint>,
    quoteLzFee(hubClient, VAULT),
    hubClient.getBalance({ address: account.address }),
  ])

  // USDC on spoke before (to track final delivery)
  const spokeAssetBefore = await spokeClient.readContract({
    address: route.spokeAsset,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log(`\nWallet:        ${account.address}`)
  console.log(`Shares on hub: ${sharesOnHub}`)
  console.log(`Expected USDC: ~${formatUnits(assetsExpected, 6)}`)
  console.log(`LZ fee:        ${formatEther(lzFee)} ETH`)
  console.log(`ETH on hub:    ${formatEther(hubEthBalance)}`)

  // ================================================================
  // TX2: Async redeem on hub
  // ================================================================
  console.log('\n========================================')
  console.log('TX2: Async redeem on hub')
  console.log('========================================')

  const { txHash: redeemTxHash, guid } = await redeemAsync(
    hubWalletClient,
    hubClient as any,
    { vault: VAULT },
    sharesOnHub,
    account.address,
    account.address,
    lzFee,
  )

  console.log(`\nTX2 sent:  ${redeemTxHash}`)
  console.log(`GUID:      ${guid}`)
  console.log(`Basescan:  https://basescan.org/tx/${redeemTxHash}`)
  console.log(`LZ scan:   https://layerzeroscan.com/tx/${guid}`)

  // ================================================================
  // Wait for USDC on hub (LZ Read callback + executeRequest)
  // ================================================================
  console.log('\n========================================')
  console.log('Waiting for USDC on hub (LZ callback)')
  console.log('========================================')
  console.log('Flow: initVaultActionRequest → LZ Read → callback → executeRequest → USDC')
  console.log(`Polling every ${POLL_INTERVAL / 1000}s, timeout ${BRIDGE_TIMEOUT / 60_000} min\n`)

  const usdcOnHubBefore = await hubClient.readContract({
    address: route.hubAsset,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log(`USDC on hub before: ${formatUnits(usdcOnHubBefore, 6)}`)

  const usdcOnHub = await pollUntilIncreased(
    hubClient,
    route.hubAsset,
    account.address,
    usdcOnHubBefore,
    POLL_INTERVAL,
    BRIDGE_TIMEOUT,
    'USDC on hub',
  )

  const usdcRedeemed = usdcOnHub - usdcOnHubBefore
  console.log(`\nUSDC received on hub: ${formatUnits(usdcRedeemed, 6)}`)

  // ================================================================
  // TX3: Bridge USDC from hub → spoke via Stargate
  // ================================================================
  console.log('\n========================================')
  console.log('TX3: Bridge USDC hub → spoke')
  console.log('========================================')

  const toBytes32 = pad(getAddress(account.address), { size: 32 })
  const assetBridgeFee = await hubClient.readContract({
    address: route.hubAssetOft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [{
      dstEid: route.spokeEid,
      to: toBytes32,
      amountLD: usdcRedeemed,
      minAmountLD: usdcRedeemed * 99n / 100n,
      extraOptions: '0x' as `0x${string}`,
      composeMsg: '0x' as `0x${string}`,
      oftCmd: (route.isStargate ? '0x01' : '0x') as `0x${string}`,
    }, false],
  })

  console.log(`Bridging: ${formatUnits(usdcRedeemed, 6)} USDC`)
  console.log(`LZ fee:   ${formatEther(assetBridgeFee.nativeFee)} ETH`)

  const { txHash: bridgeBackTxHash } = await bridgeAssetsToSpoke(
    hubWalletClient,
    hubClient as any,
    route.hubAssetOft,
    route.spokeEid,
    usdcRedeemed,
    account.address,
    assetBridgeFee.nativeFee,
    route.isStargate,
  )

  console.log(`\nTX3 sent: ${bridgeBackTxHash}`)
  console.log(`Basescan: https://basescan.org/tx/${bridgeBackTxHash}`)

  // ================================================================
  // Wait for USDC on spoke
  // ================================================================
  console.log('\n========================================')
  console.log('Waiting for USDC on spoke')
  console.log('========================================')

  const finalAssetBalance = await pollUntilIncreased(
    spokeClient,
    route.spokeAsset,
    account.address,
    spokeAssetBefore,
    POLL_INTERVAL,
    BRIDGE_TIMEOUT,
    'USDC on spoke',
  )

  const assetsReceived = finalAssetBalance - spokeAssetBefore

  console.log('\n========================================')
  console.log('REDEEM COMPLETE')
  console.log('========================================')
  console.log(`TX2 (redeem):       ${redeemTxHash}`)
  console.log(`TX3 (USDC→spoke):   ${bridgeBackTxHash}`)
  console.log(`Shares redeemed:    ${sharesOnHub}`)
  console.log(`USDC received:      ${formatUnits(assetsReceived, 6)}`)
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
      console.log(`[${elapsed}s] Poll #${attempt} — ${label}: ${formatUnits(balance, 6)}`)

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
