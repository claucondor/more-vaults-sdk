/**
 * Query the test vault on Base to discover all whitelisted assets,
 * depositable assets, and check common DEX routers + DeFi protocols.
 *
 * Run:
 *   npx tsx scripts/test-vault-whitelist.ts
 */

import { createPublicClient, http, type Address } from 'viem'
import { base } from 'viem/chains'
import {
  getVaultAnalysis,
  checkProtocolWhitelist,
} from '../src/viem/index.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const RPC   = 'https://mainnet.base.org'

// ── DEX Routers ──────────────────────────────────────────────────────────────
const DEX_ROUTERS: { name: string; address: Address }[] = [
  { name: 'Uniswap V3 SwapRouter',          address: '0x2626664c2603336E57B271c5C0b26F421741e481' },
  { name: 'Uniswap Universal Router',        address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD' },
  { name: '1inch AggregationRouter V5',      address: '0x1111111254EEB25477B68fb85Ed929f73A960582' },
  { name: '1inch AggregationRouter V6',      address: '0x111111125421cA6dc452d289314280a0f8842A65' },
  { name: 'Paraswap Augustus V6.2',          address: '0x6a000f20005980200259b80c5102003040001068' },
  { name: '0x Exchange Proxy',               address: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF' },
  { name: 'OpenOcean',                       address: '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64' },
  { name: 'Odos Router V2',                  address: '0x19cEeAd7105607Cd444F5ad10dd51356436095a1' },
]

// ── DeFi Protocols ────────────────────────────────────────────────────────────
const DEFI_PROTOCOLS: { name: string; address: Address }[] = [
  { name: 'Aave V3 Pool (Base)',            address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' },
  { name: 'Morpho Blue (Base)',             address: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' },
  { name: 'Compound V3 USDC (Base)',        address: '0xb125E6687d4313864e53df431d5425969c15Eb2F' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function yesNo(v: boolean): string {
  return v ? '✓  YES' : '✗  NO'
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC),
  })

  console.log('═'.repeat(60))
  console.log(`  Vault Whitelist Inspector`)
  console.log(`  Vault:   ${VAULT}`)
  console.log(`  Network: Base (8453)`)
  console.log('═'.repeat(60))
  console.log()

  // ── 1. Fetch vault analysis (available assets, depositable assets, whitelist) ──
  console.log('Fetching vault analysis...')
  const analysis = await getVaultAnalysis(publicClient, VAULT)

  // ── 2. Available assets ───────────────────────────────────────────────────
  console.log()
  console.log('── Available Assets (getAvailableAssets) ───────────────────')
  if (analysis.availableAssets.length === 0) {
    console.log('  (none)')
  } else {
    for (const asset of analysis.availableAssets) {
      console.log(
        `  ${asset.address}  ${asset.symbol.padEnd(10)}  ${asset.name}  (${asset.decimals} dec)`,
      )
    }
  }

  // ── 3. Depositable assets ─────────────────────────────────────────────────
  console.log()
  console.log('── Depositable Assets (getDepositableAssets) ───────────────')
  if (analysis.depositableAssets.length === 0) {
    console.log('  (none)')
  } else {
    for (const asset of analysis.depositableAssets) {
      console.log(
        `  ${asset.address}  ${asset.symbol.padEnd(10)}  ${asset.name}  (${asset.decimals} dec)`,
      )
    }
  }

  // ── 4. Deposit whitelist status ───────────────────────────────────────────
  console.log()
  console.log('── Deposit Whitelist ────────────────────────────────────────')
  console.log(`  isDepositWhitelistEnabled: ${yesNo(analysis.depositWhitelistEnabled)}`)

  // ── 5. Registry address ───────────────────────────────────────────────────
  console.log()
  console.log('── Registry ─────────────────────────────────────────────────')
  if (analysis.registryAddress) {
    console.log(`  moreVaultsRegistry: ${analysis.registryAddress}`)
  } else {
    console.log('  moreVaultsRegistry: NOT FOUND (function reverted or not exposed)')
    console.log()
    console.log('  Skipping protocol whitelist checks (no registry address).')
    printSummary(analysis.availableAssets.length, analysis.depositableAssets.length, analysis.depositWhitelistEnabled, null, null)
    return
  }

  // ── 6 & 7. Whitelist checks ───────────────────────────────────────────────
  const allProtocols = [...DEX_ROUTERS, ...DEFI_PROTOCOLS]
  const allAddresses = allProtocols.map((p) => p.address)

  console.log()
  console.log('Checking protocol whitelist in registry...')
  const whitelistMap = await checkProtocolWhitelist(publicClient, VAULT, allAddresses)

  // DEX Routers
  console.log()
  console.log('── DEX Router Whitelist ─────────────────────────────────────')
  for (const router of DEX_ROUTERS) {
    const isWL = whitelistMap[router.address] ?? false
    console.log(`  ${yesNo(isWL)}  ${router.name.padEnd(32)}  ${router.address}`)
  }

  // DeFi Protocols
  console.log()
  console.log('── DeFi Protocol Whitelist ──────────────────────────────────')
  for (const protocol of DEFI_PROTOCOLS) {
    const isWL = whitelistMap[protocol.address] ?? false
    console.log(`  ${yesNo(isWL)}  ${protocol.name.padEnd(32)}  ${protocol.address}`)
  }

  printSummary(
    analysis.availableAssets.length,
    analysis.depositableAssets.length,
    analysis.depositWhitelistEnabled,
    whitelistMap,
    allProtocols,
  )
}

function printSummary(
  availableCount: number,
  depositableCount: number,
  whitelistEnabled: boolean,
  whitelistMap: Record<string, boolean> | null,
  protocols: { name: string; address: Address }[] | null,
) {
  console.log()
  console.log('═'.repeat(60))
  console.log('  Summary')
  console.log('═'.repeat(60))
  console.log(`  Available assets:         ${availableCount}`)
  console.log(`  Depositable assets:       ${depositableCount}`)
  console.log(`  Deposit whitelist active: ${whitelistEnabled}`)

  if (whitelistMap && protocols) {
    const whitelisted = protocols.filter((p) => whitelistMap[p.address])
    const notWhitelisted = protocols.filter((p) => !whitelistMap[p.address])
    console.log(`  Whitelisted protocols:    ${whitelisted.length} / ${protocols.length}`)
    if (whitelisted.length > 0) {
      console.log()
      console.log('  Whitelisted:')
      for (const p of whitelisted) {
        console.log(`    ✓  ${p.name}`)
      }
    }
    if (notWhitelisted.length > 0) {
      console.log()
      console.log('  Not whitelisted:')
      for (const p of notWhitelisted) {
        console.log(`    ✗  ${p.name}`)
      }
    }
  }

  console.log()
  console.log('  Done.')
  console.log('═'.repeat(60))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
