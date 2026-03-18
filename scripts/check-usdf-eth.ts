import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { METADATA_ABI } from '../src/viem/abis.js'

const client = createPublicClient({ chain: mainnet, transport: http('https://eth.llamarpc.com') })

// The token on Ethereum side of the "PYUSD" route
const ETH_TOKEN = '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8'

async function main() {
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address: ETH_TOKEN as `0x${string}`, abi: METADATA_ABI, functionName: 'name' }),
    client.readContract({ address: ETH_TOKEN as `0x${string}`, abi: METADATA_ABI, functionName: 'symbol' }),
    client.readContract({ address: ETH_TOKEN as `0x${string}`, abi: METADATA_ABI, functionName: 'decimals' }),
  ])
  console.log(`Eth token: ${ETH_TOKEN}`)
  console.log(`  name: ${name}, symbol: ${symbol}, decimals: ${decimals}`)
}

main().catch(e => { console.error(e); process.exit(1) })
