import { createPublicClient, http, getAddress } from 'viem'
import { METADATA_ABI } from '../src/viem/abis.js'

const flowRpc = 'https://mainnet.evm.nodes.onflow.org'
const client = createPublicClient({ transport: http(flowRpc) })

const VAULT_ASSET = '0x99aF3EeA856556646C98c8B9b2548Fe815240750'
const PYUSD_OFT   = '0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed'

async function main() {
  for (const [label, addr] of [['Vault asset (PYUSD0)', VAULT_ASSET], ['OFT_ROUTES PYUSD', PYUSD_OFT]]) {
    try {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address: addr as `0x${string}`, abi: METADATA_ABI, functionName: 'name' }),
        client.readContract({ address: addr as `0x${string}`, abi: METADATA_ABI, functionName: 'symbol' }),
        client.readContract({ address: addr as `0x${string}`, abi: METADATA_ABI, functionName: 'decimals' }),
      ])
      console.log(`${label}: ${addr}`)
      console.log(`  name: ${name}, symbol: ${symbol}, decimals: ${decimals}`)
    } catch (e: any) {
      console.log(`${label}: ${addr} — ERROR: ${e.message?.slice(0, 100)}`)
    }
  }

  // Check if the PYUSD OFT has a .token() method (OFTAdapter pattern)
  console.log('\nChecking OFT.token()...')
  try {
    const token = await client.readContract({
      address: PYUSD_OFT as `0x${string}`,
      abi: [{ type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'token',
    })
    console.log(`OFT.token() = ${token}`)
  } catch {
    console.log('OFT.token() reverted — pure OFT (token IS the OFT)')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
