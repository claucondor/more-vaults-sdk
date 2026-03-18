/**
 * Brute-force search: check if ayFLOW vault has bytecode on any chain
 * (including testnet) and attempt raw contract reads.
 */

import { createPublicClient, http, zeroAddress, type Address } from 'viem'
import { CHAIN_IDS } from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'
import { METADATA_ABI, VAULT_ABI } from '../src/viem/abis.js'

const VAULT: Address = '0xCBf9a7753F9D2d0e8141ebB36d99f87AcEf98597'
const FACTORY: Address = '0x7bDB8B17604b03125eFAED33cA0c55FBf856BB0C'

const EXTRA_CHAINS: { id: number; name: string; rpc: string }[] = [
  { id: 545,  name: 'flowEVMTestnet',   rpc: 'https://testnet.evm.nodes.onflow.org' },
  { id: 747,  name: 'flowEVMMainnet',   rpc: 'https://mainnet.evm.nodes.onflow.org' },
]

const FACTORY_ABI = [
  { name: 'localEid', type: 'function', inputs: [], outputs: [{ type: 'uint32' }], stateMutability: 'view' },
] as const

async function checkChain(chainId: number, name: string, client: any) {
  try {
    // Check bytecode
    const code = await client.getBytecode({ address: VAULT })
    if (!code || code === '0x') {
      console.log(`  ${name.padEnd(20)} chainId=${chainId} — NO bytecode`)
      return
    }

    // Has bytecode — try reads
    let symbol = '?', totalAssets = '?', factoryEid = '?'
    try {
      symbol = await client.readContract({ address: VAULT, abi: METADATA_ABI, functionName: 'symbol' }) as string
    } catch {}
    try {
      const ta = await client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }) as bigint
      totalAssets = ta.toString()
    } catch {}
    try {
      const eid = await client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: 'localEid' }) as number
      factoryEid = eid.toString()
    } catch {}

    console.log(`  ${name.padEnd(20)} chainId=${chainId} — HAS BYTECODE  symbol=${symbol}  totalAssets=${totalAssets}  factoryLocalEid=${factoryEid}`)
  } catch (e: any) {
    console.log(`  ${name.padEnd(20)} chainId=${chainId} — RPC ERROR: ${e.message?.slice(0, 60)}`)
  }
}

async function main() {
  console.log(`Searching for ayFLOW vault: ${VAULT}\n`)

  // SDK-supported mainnet chains
  const checks: Promise<void>[] = []
  for (const [name, chainId] of Object.entries(CHAIN_IDS)) {
    if (chainId === 545) continue  // handled separately
    const client = createChainClient(chainId)
    if (!client) continue
    checks.push(checkChain(chainId, name, client))
  }

  // Extra chains (testnet + mainnet flow with direct client)
  for (const { id, name, rpc } of EXTRA_CHAINS) {
    const client = createPublicClient({
      transport: http(rpc, { retryCount: 2 }),
      chain: {
        id,
        name,
        nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
        rpcUrls: { default: { http: [rpc] } },
      } as any,
    })
    checks.push(checkChain(id, name, client))
  }

  await Promise.all(checks)
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
