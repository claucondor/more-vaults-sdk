/**
 * Vault investigation script — discovers and inspects two vaults
 * using only SDK functions (no chain assumptions).
 *
 * Usage: npx tsx scripts/investigate-vaults.ts
 */

import { formatUnits, type Address } from 'viem'
import {
  discoverVaultTopology,
  getVaultStatus,
  getVaultMetadata,
  getVaultConfiguration,
  getVaultAnalysis,
  getVaultDistribution,
  CHAIN_IDS,
} from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULTS: { name: string; address: Address }[] = [
  { name: 'ayUSD',   address: '0xaf46A54208CE9924B7577AFf146dfD65eB193861' },
  { name: 'ayFLOW',  address: '0xCBf9a7753F9D2d0e8141ebB36d99f87AcEf98597' },
]

function chainName(id: number): string {
  return Object.entries(CHAIN_IDS).find(([, v]) => v === id)?.[0] ?? `chain-${id}`
}

function fmt(value: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(value, decimals)} ${symbol}`
}

const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

function sep(title: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

function sub(title: string) {
  console.log(`\n  ── ${title} ─────────────────────────────`)
}

async function investigateVault(name: string, vault: Address) {
  sep(`VAULT: ${name}  (${vault})`)

  // ── 1. Topology ─────────────────────────────────────────
  sub('Topology (auto-discovery)')
  console.log('  Discovering hub chain across all supported chains...')
  const topo = await discoverVaultTopology(vault)
  console.log(`  Role:         ${topo.role}`)
  console.log(`  Hub chain:    ${chainName(topo.hubChainId)} (chainId=${topo.hubChainId})`)
  console.log(`  Spoke chains: ${topo.spokeChainIds.length > 0
    ? topo.spokeChainIds.map(id => `${chainName(id)} (${id})`).join(', ')
    : 'none (single-chain vault)'}`)

  const hubClient = createChainClient(topo.hubChainId)
  if (!hubClient) {
    console.log(`  ERROR: no RPC available for hub chainId=${topo.hubChainId}`)
    return
  }

  // ── 2. Metadata ──────────────────────────────────────────
  sub('Metadata')
  const meta = await getVaultMetadata(hubClient, vault)
  const dec  = meta.decimals
  const udec = meta.underlyingDecimals
  const sym  = meta.underlyingSymbol
  console.log(`  Vault name:      ${meta.name}`)
  console.log(`  Vault symbol:    ${meta.symbol}`)
  console.log(`  Vault decimals:  ${dec}`)
  console.log(`  Underlying addr: ${meta.underlying}`)
  console.log(`  Underlying sym:  ${sym}`)
  console.log(`  Underlying dec:  ${udec}`)

  // ── 3. Status ────────────────────────────────────────────
  sub('Status & Mode')
  const status = await getVaultStatus(hubClient, vault)
  console.log(`  Mode:               ${status.mode}`)
  console.log(`  Is Hub:             ${status.isHub}`)
  console.log(`  Is Paused:          ${status.isPaused}`)
  console.log(`  Oracle Accounting:  ${status.oracleAccountingEnabled}`)
  console.log(`  Withdrawal Queue:   ${status.withdrawalQueueEnabled}`)
  console.log(`  Withdrawal Timelock: ${status.withdrawalTimelockSeconds}s`)

  sub('Metrics')
  const cap = status.remainingDepositCapacity
  console.log(`  Total Assets:       ${fmt(status.totalAssets, udec, sym)}`)
  console.log(`  Total Supply:       ${fmt(status.totalSupply, dec, meta.symbol)}`)
  console.log(`  Share Price:        ${fmt(status.sharePrice, udec, sym)}`)
  console.log(`  Hub Liquid:         ${fmt(status.hubLiquidBalance, udec, sym)}`)
  console.log(`  Spokes Deployed:    ${fmt(status.spokesDeployedBalance, udec, sym)}`)
  console.log(`  Max Immed Redeem:   ${fmt(status.maxImmediateRedeemAssets, udec, sym)}`)
  console.log(`  Deposit Capacity:   ${cap === MAX_UINT256 ? 'unlimited' : fmt(cap, udec, sym)}`)
  console.log(`  Access Restricted:  ${status.depositAccessRestricted}`)

  sub('Recommended Flows')
  console.log(`  Deposit:  ${status.recommendedDepositFlow}`)
  console.log(`  Redeem:   ${status.recommendedRedeemFlow}`)

  if (status.issues.length > 0) {
    sub('Issues')
    status.issues.forEach((issue, i) => console.log(`  [${i + 1}] ${issue}`))
  } else {
    console.log('\n  No issues — vault is operational.')
  }

  // ── 4. Analysis (depositable / available assets) ─────────
  sub('Vault Analysis (depositable & available assets)')
  try {
    const analysis = await getVaultAnalysis(hubClient, vault)
    console.log(`  Deposit whitelist enabled: ${analysis.depositWhitelistEnabled}`)
    console.log(`  Depositable assets (${analysis.depositableAssets.length}):`)
    for (const a of analysis.depositableAssets) {
      console.log(`    - ${a.symbol} (${a.name}) @ ${a.address}  [${a.decimals} dec]`)
    }
    console.log(`  Available assets (${analysis.availableAssets.length}):`)
    for (const a of analysis.availableAssets) {
      console.log(`    - ${a.symbol} (${a.name}) @ ${a.address}  [${a.decimals} dec]`)
    }
  } catch (e: any) {
    console.log(`  WARN: getVaultAnalysis failed — ${e.message}`)
  }

  // ── 5. Full Configuration ────────────────────────────────
  sub('Full Configuration (Phase 7)')
  try {
    const cfg = await getVaultConfiguration(hubClient, vault)
    console.log(`  Owner:          ${cfg.owner}`)
    console.log(`  Pending Owner:  ${cfg.pendingOwner}`)
    console.log(`  Curator:        ${cfg.curator}`)
    console.log(`  Guardian:       ${cfg.guardian}`)
    console.log(`  Fee:            ${cfg.fee} bps`)
    console.log(`  Withdrawal Fee: ${cfg.withdrawalFee} bps`)
    console.log(`  Fee Recipient:  ${cfg.feeRecipient}`)
    console.log(`  Deposit Cap:    ${cfg.depositCapacity === MAX_UINT256 ? 'unlimited' : fmt(cfg.depositCapacity, udec, sym)}`)
    console.log(`  Max Slippage:   ${cfg.maxSlippagePercent} bps`)
    console.log(`  Timelock:       ${cfg.timeLockPeriod}s`)
    console.log(`  Current Nonce:  ${cfg.currentNonce}`)
    console.log(`  WQ Enabled:     ${cfg.withdrawalQueueEnabled}`)
    console.log(`  WQ Timelock:    ${cfg.withdrawalTimelock}s`)
    console.log(`  Max WQ Delay:   ${cfg.maxWithdrawalDelay}s`)
    console.log(`  Whitelist:      ${cfg.depositWhitelistEnabled}`)
    console.log(`  Is Hub:         ${cfg.isHub}`)
    console.log(`  Paused:         ${cfg.paused}`)
    console.log(`  Escrow:         ${cfg.escrow}`)
    console.log(`  LZ Adapter:     ${cfg.lzAdapter}`)
    console.log(`  CC Manager:     ${cfg.ccManager}`)
    console.log(`  Registry:       ${cfg.registry}`)
  } catch (e: any) {
    console.log(`  WARN: getVaultConfiguration failed — ${e.message}`)
  }

  // ── 6. Distribution (assets across hub + spokes) ─────────
  sub('Distribution across chains')
  try {
    const dist = await getVaultDistribution(hubClient, vault)
    console.log(`  Hub assets:  ${fmt(dist.hubAssets, udec, sym)}`)
    for (const s of dist.spokes) {
      console.log(`  Spoke ${chainName(s.chainId)} (${s.chainId}): ${fmt(s.totalAssets, udec, sym)}  isReachable=${s.isReachable}`)
    }
  } catch (e: any) {
    console.log(`  WARN: getVaultDistribution failed — ${e.message}`)
  }
}

async function main() {
  for (const { name, address } of VAULTS) {
    try {
      await investigateVault(name, address)
    } catch (e: any) {
      console.error(`\nFATAL for ${name}: ${e.message}`)
    }
    console.log()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
