/**
 * Fetch the position of a user in a MoreVaults vault.
 *
 * Run:
 *   npx tsx scripts/user-status.ts
 */

import { formatUnits } from 'viem'
import {
  OMNI_FACTORY_ADDRESS,
  getVaultTopology,
  getVaultMetadata,
  getUserPosition,
  getUserBalances,
  canDeposit,
  getMaxWithdrawable,
  getInboundRoutes,
  getUserBalancesForRoutes,
  getOutboundRoutes,
  CHAIN_IDS,
} from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const USER  = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as const

const ALL_CHAIN_IDS = Object.values(CHAIN_IDS)

async function findHubChain() {
  const results = await Promise.allSettled(
    ALL_CHAIN_IDS.map(async (chainId) => {
      const client = createChainClient(chainId)
      if (!client) return null
      const topo = await getVaultTopology(client, VAULT, OMNI_FACTORY_ADDRESS)
      return { chainId, client, topo }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.topo.role === 'hub') {
      return r.value
    }
  }

  return null
}

function chainName(id: number): string {
  return Object.entries(CHAIN_IDS).find(([, v]) => v === id)?.[0] ?? `chain ${id}`
}

async function main() {
  console.log(`Vault: ${VAULT}`)
  console.log(`User:  ${USER}\n`)

  console.log('Discovering hub chain...')
  const found = await findHubChain()
  if (!found) {
    console.error('Vault hub not found on any supported chain.')
    process.exit(1)
  }

  const { chainId: hubChainId, client } = found
  console.log(`Hub:   ${chainName(hubChainId)} (chainId=${hubChainId})\n`)

  const [metadata, position, balances, eligibility, maxWithdrawable] = await Promise.all([
    getVaultMetadata(client, VAULT),
    getUserPosition(client, VAULT, USER),
    getUserBalances(client, VAULT, USER),
    canDeposit(client, VAULT, USER),
    getMaxWithdrawable(client, VAULT, USER),
  ])

  // Routes depend on metadata.underlying — fetch after
  const inboundRoutesRaw = await getInboundRoutes(hubChainId, VAULT, metadata.underlying, USER)
  const [inboundRoutes, outboundRoutes] = await Promise.all([
    getUserBalancesForRoutes(inboundRoutesRaw, USER),
    getOutboundRoutes(hubChainId, VAULT),
  ])

  const dec = metadata.decimals
  const uDec = metadata.underlyingDecimals
  const sym = metadata.underlyingSymbol
  const vSym = metadata.symbol

  console.log('══ Vault ═══════════════════════════════════════')
  console.log(`  ${metadata.name} (${vSym}) — ${sym} vault`)

  console.log('\n══ Position ════════════════════════════════════')
  console.log(`  Shares:          ${formatUnits(position.shares, dec)} ${vSym}`)
  console.log(`  Estimated Value: ${formatUnits(position.estimatedAssets, uDec)} ${sym}`)
  console.log(`  Share Price:     ${formatUnits(position.sharePrice, uDec)} ${sym}`)

  if (position.pendingWithdrawal) {
    const pw = position.pendingWithdrawal
    console.log(`\n  Pending Withdrawal:`)
    console.log(`    Shares:        ${formatUnits(pw.shares, dec)} ${vSym}`)
    console.log(`    Timelock ends: ${pw.timelockEndsAt === 0n ? 'no timelock' : new Date(Number(pw.timelockEndsAt) * 1000).toISOString()}`)
    console.log(`    Can redeem:    ${pw.canRedeemNow}`)
  } else {
    console.log(`  Pending Withdrawal: none`)
  }

  console.log('\n══ Balances ════════════════════════════════════')
  console.log(`  Shares in wallet:     ${formatUnits(balances.shareBalance, dec)} ${vSym}`)
  console.log(`  ${sym} in wallet:      ${formatUnits(balances.underlyingBalance, uDec)} ${sym}`)
  console.log(`  Vault position value: ${formatUnits(balances.estimatedAssets, uDec)} ${sym}`)

  console.log('\n══ Deposit Eligibility ═════════════════════════')
  console.log(`  Can deposit: ${eligibility.allowed} (${eligibility.reason})`)

  console.log('\n══ Max Withdrawable Now ════════════════════════')
  console.log(`  Shares: ${formatUnits(maxWithdrawable.shares, dec)} ${vSym}`)
  console.log(`  Assets: ${formatUnits(maxWithdrawable.assets, uDec)} ${sym}`)

  console.log('\n══ Deposit Routes (inbound) ════════════════════')
  if (inboundRoutes.length === 0) {
    console.log('  No routes available.')
  } else {
    for (const r of inboundRoutes) {
      const type = r.depositType === 'direct'
        ? 'direct — no LZ fee'
        : r.depositType === 'direct-async'
          ? `on hub (${chainName(r.spokeChainId)}) — async, LZ fee required`
          : `cross-chain from ${chainName(r.spokeChainId)}`
      const fee  = r.lzFeeEstimate > 0n ? ` | LZ fee ~${formatUnits(r.lzFeeEstimate, 18)} ${r.nativeSymbol}` : ''
      const bal  = `| balance: ${formatUnits(r.userBalance, uDec)} ${r.sourceTokenSymbol}`
      console.log(`  [${r.sourceTokenSymbol}] ${type}${fee} ${bal}`)
    }
  }

  console.log('\n══ Redeem Routes (outbound) ════════════════════')
  for (const r of outboundRoutes) {
    const type = r.routeType === 'hub' ? 'direct redeem on hub' : `bridge shares → ${chainName(r.chainId)}`
    console.log(`  [${chainName(r.chainId)}] ${type} | gas token: ${r.nativeSymbol}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
