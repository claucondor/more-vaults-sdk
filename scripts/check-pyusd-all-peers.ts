import { createPublicClient, http } from 'viem'
import { OFT_ABI } from '../src/viem/abis.js'

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

const rpcs: Record<string, string> = {
  flow: 'https://mainnet.evm.nodes.onflow.org',
  arb: 'https://arb1.arbitrum.io/rpc',
  eth: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  op: 'https://mainnet.optimism.io',
  bsc: 'https://bsc-dataseed.binance.org',
  sonic: 'https://rpc.soniclabs.com',
}

const eids: Record<string, number> = {
  flow: 30336,
  arb: 30110,
  eth: 30101,
  base: 30184,
  op: 30111,
  bsc: 30102,
  sonic: 30332,
}

const FLOW_ADAPTER = '0x26d27d5AF2F6f1c14F40013C8619d97aaf015509' as const
const ARB_ADAPTER = '0x3CD2b89C49D130C08f1d683225b2e5DeB63ff876' as const

async function checkPeers(label: string, adapter: `0x${string}`, rpcUrl: string, skipChain: string) {
  const client = createPublicClient({ transport: http(rpcUrl) })
  console.log(`\n=== ${label} peers ===`)
  for (const [chain, eid] of Object.entries(eids)) {
    if (chain === skipChain) continue
    try {
      const peer = await client.readContract({
        address: adapter, abi: OFT_ABI, functionName: 'peers', args: [eid],
      }) as `0x${string}`
      const found = peer !== ZERO
      if (found) console.log(`  ${chain} (${eid}): 0x${peer.slice(-40)}`)
      else console.log(`  ${chain} (${eid}): NONE`)
    } catch {
      console.log(`  ${chain} (${eid}): ERROR`)
    }
  }
}

async function main() {
  await checkPeers('Flow OFT Adapter', FLOW_ADAPTER, rpcs.flow, 'flow')
  await checkPeers('Arb OFT Adapter', ARB_ADAPTER, rpcs.arb, 'arb')
}

main().catch(e => { console.error(e); process.exit(1) })
