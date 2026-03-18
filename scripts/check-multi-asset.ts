import { type Address } from 'viem'
import { getVaultAnalysis, getInboundRoutes } from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT: Address  = '0xCBf9a7753F9D2d0e8141ebB36d99f87AcEf98597' // ayFLOW
const HUB_CHAIN = 747
const DUMMY_USER: Address = '0x0000000000000000000000000000000000000001'

const ERC20_ABI = [
  { name: 'symbol',   type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'name',     type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }],  stateMutability: 'view' },
] as const

async function main() {
  const client = createChainClient(HUB_CHAIN)!

  const analysis = await getVaultAnalysis(client, VAULT)
  console.log(`Depositable assets (${analysis.depositableAssets.length}):`)

  // Read symbol/name directly for each asset
  for (const a of analysis.depositableAssets) {
    let symbol = a.symbol, name = a.name
    if (!symbol) {
      try { symbol = await client.readContract({ address: a.address as Address, abi: ERC20_ABI, functionName: 'symbol' }) as string } catch {}
      try { name   = await client.readContract({ address: a.address as Address, abi: ERC20_ABI, functionName: 'name'   }) as string } catch {}
    }
    console.log(`  ${symbol || '?'} (${name || '?'}) @ ${a.address}  [${a.decimals} dec]`)
  }

  // Now call getInboundRoutes once per depositable asset
  console.log('\nInbound routes per depositable asset:')
  for (const a of analysis.depositableAssets) {
    const routes = await getInboundRoutes(HUB_CHAIN, VAULT, a.address as Address, DUMMY_USER)
    console.log(`\n  Asset ${a.address}:`)
    if (routes.length === 0) {
      console.log('    (no routes)')
    }
    for (const r of routes) {
      console.log(`    [${r.depositType}] token=${r.sourceTokenSymbol}  lzFee=${r.lzFeeEstimate}`)
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
