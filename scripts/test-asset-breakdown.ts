import { createPublicClient, http, formatUnits } from 'viem'
import { base } from 'viem/chains'
import { getVaultAnalysis } from '../src/viem/curatorStatus.js'
import { ERC20_ABI, VAULT_ABI } from '../src/viem/abis.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const publicClient = createPublicClient({ chain: base, transport: http('https://base-mainnet.g.alchemy.com/v2/demo') })

async function main() {
  const analysis = await getVaultAnalysis(publicClient, VAULT)

  // Multicall: balanceOf for each available asset + totalAssets + totalSupply
  const balanceCalls = analysis.availableAssets.map(a => ({
    address: a.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [VAULT] as [typeof VAULT],
  }))

  const results = await publicClient.multicall({
    contracts: [
      ...balanceCalls,
      { address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' },
      { address: VAULT, abi: VAULT_ABI, functionName: 'totalSupply' },
    ],
    allowFailure: true,
  })

  console.log('=== Hub Asset Breakdown ===')
  for (let i = 0; i < analysis.availableAssets.length; i++) {
    const asset = analysis.availableAssets[i]
    const r = results[i]
    const bal = r.status === 'success' ? r.result as bigint : 0n
    console.log(`  ${asset.symbol}: ${formatUnits(bal, asset.decimals)} (raw: ${bal})`)
  }

  const totalAssets = results[balanceCalls.length]
  const totalSupply = results[balanceCalls.length + 1]

  console.log(`\n=== Vault Totals ===`)
  console.log(`  totalAssets: ${formatUnits(totalAssets.status === 'success' ? totalAssets.result as bigint : 0n, 6)} USDC`)
  console.log(`  totalSupply: ${formatUnits(totalSupply.status === 'success' ? totalSupply.result as bigint : 0n, 8)} shares`)
}

main().catch(e => { console.error(e); process.exit(1) })
