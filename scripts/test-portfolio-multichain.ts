/**
 * Test script for getVaultPortfolioMultiChain().
 *
 * Tests against the MoreVaults hub on Base:
 *   Vault:    0x8f740aba022b3fcc934ab75c581c04b75e72aba6
 *   Hub:      Base (chainId 8453)
 *
 * Run:  npx tsx scripts/test-portfolio-multichain.ts
 */

import { createPublicClient, http, formatUnits } from 'viem'
import { base } from 'viem/chains'
import { getVaultPortfolioMultiChain } from '../src/viem/curatorSubVaults.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
})

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${label}`)
  console.log('─'.repeat(60))
}

async function main() {
  console.log('MoreVaults SDK — getVaultPortfolioMultiChain()')
  console.log(`Vault:  ${VAULT}`)
  console.log(`Hint:   Base (chainId 8453)`)

  sep('Fetching multi-chain portfolio…')

  const portfolio = await getVaultPortfolioMultiChain(publicClient, VAULT)

  console.log(`\nHub chain:    ${portfolio.hubChainId}`)
  console.log(`Total chains: ${portfolio.chains.length}`)

  for (const chain of portfolio.chains) {
    sep(`Chain ${chain.chainId} (${chain.role}) — ${chain.vault}`)
    const p = chain.portfolio

    console.log(`\n  Vault totalAssets:  ${p.totalAssets.toString()} (raw)`)
    console.log(`  Vault totalSupply:  ${p.totalSupply.toString()} (raw)`)
    console.log(`  Locked assets:      ${p.lockedAssets.toString()} (raw)`)
    console.log(`  Calc totalValue:    ${p.totalValue.toString()} (raw)`)

    if (p.liquidAssets.length > 0) {
      console.log(`\n  Liquid assets (${p.liquidAssets.length}):`)
      for (const a of p.liquidAssets) {
        console.log(`    ${a.symbol || a.address}: ${formatUnits(a.balance, a.decimals)} (${a.address})`)
      }
    } else {
      console.log(`\n  Liquid assets: (none)`)
    }

    if (p.subVaultPositions.length > 0) {
      console.log(`\n  Sub-vault positions (${p.subVaultPositions.length}):`)
      for (const pos of p.subVaultPositions) {
        console.log(`    [${pos.type}] ${pos.symbol}: ${formatUnits(pos.underlyingValue, pos.underlyingDecimals)} ${pos.underlyingSymbol}`)
        console.log(`      address: ${pos.address}`)
      }
    } else {
      console.log(`\n  Sub-vault positions: (none)`)
    }
  }

  sep('Aggregated Totals')
  console.log(`\n  totalLiquidValue:   ${portfolio.totalLiquidValue.toString()} (raw)`)
  console.log(`  totalDeployedValue: ${portfolio.totalDeployedValue.toString()} (raw)`)
  console.log(`  totalLockedValue:   ${portfolio.totalLockedValue.toString()} (raw)`)
  console.log(`\n  allSubVaultPositions (${portfolio.allSubVaultPositions.length}):`)
  for (const pos of portfolio.allSubVaultPositions) {
    console.log(`    [chainId=${pos.chainId}] [${pos.type}] ${pos.symbol}: ${formatUnits(pos.underlyingValue, pos.underlyingDecimals)} ${pos.underlyingSymbol}`)
  }

  console.log('\n\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
