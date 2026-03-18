/**
 * Test actual redeem routes for ayUSD and ayFLOW.
 * For each outbound route, tries resolveRedeemAddresses to confirm it works on-chain.
 *
 * Usage: npx tsx scripts/test-redeem-routes.ts
 */

import { formatUnits, type Address } from 'viem'
import {
  discoverVaultTopology,
  getVaultStatus,
  getVaultMetadata,
  getOutboundRoutes,
  resolveRedeemAddresses,
  CHAIN_IDS,
} from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULTS: { name: string; address: Address }[] = [
  { name: 'ayUSD',  address: '0xaf46A54208CE9924B7577AFf146dfD65eB193861' },
  { name: 'ayFLOW', address: '0xCBf9a7753F9D2d0e8141ebB36d99f87AcEf98597' },
]

function chainName(id: number) {
  return Object.entries(CHAIN_IDS).find(([, v]) => v === id)?.[0] ?? `chain-${id}`
}

function sep(t: string) {
  console.log(`\n${'═'.repeat(62)}\n  ${t}\n${'═'.repeat(62)}`)
}

async function testVault(name: string, vault: Address) {
  sep(`${name}  (${vault})`)

  const topo = await discoverVaultTopology(vault)
  const hubChainId = topo.hubChainId
  const hubClient = createChainClient(hubChainId)!

  const [status, meta] = await Promise.all([
    getVaultStatus(hubClient, vault),
    getVaultMetadata(hubClient, vault),
  ])
  const udec = meta.underlyingDecimals
  const sym  = meta.underlyingSymbol
  const fmt  = (v: bigint) => `${formatUnits(v, udec)} ${sym}`

  console.log(`\n  Vault type:    ${status.mode}`)
  console.log(`  Hub:           ${chainName(hubChainId)} (${hubChainId})`)
  console.log(`  Recommended:   deposit=${status.recommendedDepositFlow}  redeem=${status.recommendedRedeemFlow}`)
  console.log(`  Max imm redeem: ${fmt(status.maxImmediateRedeemAssets)}`)

  // ── Outbound routes (topology) ───────────────────────────
  console.log('\n  ── Outbound routes (getOutboundRoutes)')
  const outbound = await getOutboundRoutes(hubChainId, vault)
  for (const r of outbound) {
    console.log(`     [${r.routeType.padEnd(5)}] ${chainName(r.chainId).padEnd(18)} chainId=${r.chainId}  eid=${r.eid}  native=${r.nativeSymbol}`)
  }

  // ── Hub redeem flow ──────────────────────────────────────
  console.log('\n  ── Hub redeem flow (user has shares on hub)')
  switch (status.recommendedRedeemFlow) {
    case 'redeemShares':
      console.log(`     → redeemShares()  — direct ERC4626, no LZ, assets land on ${chainName(hubChainId)}`)
      break
    case 'redeemAsync':
      console.log(`     → redeemAsync()   — ERC7540 initVaultActionRequest, LZ Read callback ~4-5 min`)
      console.log(`        1. approve shares → escrow`)
      console.log(`        2. initVaultActionRequest(REDEEM, ...) + lzFee`)
      console.log(`        3. wait LZ callback → executeRequest → assets on ${chainName(hubChainId)}`)
      break
    default:
      console.log(`     → ${status.recommendedRedeemFlow}`)
  }

  // ── Spoke redeem routes (resolveRedeemAddresses) ─────────
  const spokes = outbound.filter(r => r.routeType === 'spoke')
  if (spokes.length === 0) {
    console.log('\n  ── Spoke redeem routes\n     none (single-chain vault)')
    return
  }

  console.log('\n  ── Spoke redeem routes (resolveRedeemAddresses per spoke)')
  console.log('     Full flow: bridgeSharesToHub → redeemAsync/redeemShares → bridgeAssetsToSpoke')

  for (const spoke of spokes) {
    const label = `${chainName(spoke.chainId)} (${spoke.chainId})`
    try {
      const route = await resolveRedeemAddresses(hubClient, vault, hubChainId, spoke.chainId)
      console.log(`\n     ✓ ${label}`)
      console.log(`        hubAsset:      ${route.hubAsset}  (${sym})`)
      console.log(`        spokeShareOFT: ${route.spokeShareOft}  (user's shares on spoke)`)
      console.log(`        hubAssetOFT:   ${route.hubAssetOft}  (${route.symbol}, isStargate=${route.isStargate})`)
      console.log(`        spokeAsset:    ${route.spokeAsset}  (${route.symbol} on spoke)`)
      console.log(`        Steps:`)
      console.log(`          1. [${chainName(spoke.chainId)}] approve spokeShareOFT → bridgeSharesToHub()  (LZ fee in ${spoke.nativeSymbol})`)
      console.log(`          2. [${chainName(hubChainId)}]    ${status.recommendedRedeemFlow}()  (LZ fee in FLOW if async)`)
      console.log(`          3. [${chainName(hubChainId)}]    bridgeAssetsToSpoke() via ${route.symbol} OFT  (LZ fee in FLOW)`)
      console.log(`          4. [${chainName(spoke.chainId)}] receive ${route.symbol} tokens`)
    } catch (e: any) {
      console.log(`\n     ✗ ${label}  →  ${e.message}`)
    }
  }
}

async function main() {
  for (const { name, address } of VAULTS) {
    try {
      await testVault(name, address)
    } catch (e: any) {
      console.error(`\nFATAL for ${name}: ${e.message}`)
    }
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
