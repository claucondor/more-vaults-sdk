import { createPublicClient, http, pad, getAddress } from 'viem'
import { OFT_ABI } from '../src/viem/abis.js'

const ZERO_PEER = '0x0000000000000000000000000000000000000000000000000000000000000000'
const USER = '0x000000000000000000000000c5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as `0x${string}`

const chains: Record<string, { rpc: string; eid: number; adapter?: `0x${string}` }> = {
  flow:  { rpc: 'https://mainnet.evm.nodes.onflow.org', eid: 30336, adapter: '0x26d27d5AF2F6f1c14F40013C8619d97aaf015509' },
  arb:   { rpc: 'https://arb1.arbitrum.io/rpc',         eid: 30110, adapter: '0x3CD2b89C49D130C08f1d683225b2e5DeB63ff876' },
  eth:   { rpc: 'https://eth.llamarpc.com',              eid: 30101 },
  base:  { rpc: 'https://mainnet.base.org',              eid: 30184 },
  op:    { rpc: 'https://mainnet.optimism.io',            eid: 30111 },
  bsc:   { rpc: 'https://bsc-dataseed.binance.org',      eid: 30102 },
  sonic: { rpc: 'https://rpc.soniclabs.com',              eid: 30332 },
}

async function quoteSend(rpc: string, adapter: `0x${string}`, dstEid: number): Promise<bigint | null> {
  const client = createPublicClient({ transport: http(rpc) })
  try {
    const fee = await client.readContract({
      address: adapter,
      abi: OFT_ABI,
      functionName: 'quoteSend',
      args: [{
        dstEid, to: USER, amountLD: 1_000_000n, minAmountLD: 0n,
        extraOptions: '0x' as `0x${string}`, composeMsg: '0x' as `0x${string}`, oftCmd: '0x' as `0x${string}`,
      }, false],
    }) as { nativeFee: bigint }
    return fee.nativeFee
  } catch {
    return null
  }
}

async function checkPeer(rpc: string, adapter: `0x${string}`, eid: number): Promise<string | null> {
  const client = createPublicClient({ transport: http(rpc) })
  try {
    const peer = await client.readContract({
      address: adapter, abi: OFT_ABI, functionName: 'peers', args: [eid],
    }) as `0x${string}`
    return peer === ZERO_PEER ? null : '0x' + peer.slice(-40)
  } catch {
    return null
  }
}

async function main() {
  // 1. Bidirectional check Flow ↔ Arb
  console.log('=== Flow ↔ Arb Bidirectional ===')

  const flowToArb = await quoteSend(chains.flow.rpc, chains.flow.adapter!, chains.arb.eid)
  console.log(`Flow→Arb quoteSend: ${flowToArb ? `${flowToArb} wei ✅` : 'FAILED ❌'}`)

  const arbToFlow = await quoteSend(chains.arb.rpc, chains.arb.adapter!, chains.flow.eid)
  console.log(`Arb→Flow quoteSend: ${arbToFlow ? `${arbToFlow} wei ✅` : 'FAILED ❌'}`)

  // 2. Check Arb adapter peers with ALL other chains
  console.log('\n=== Arb PYUSD Adapter — Peers ===')
  for (const [name, info] of Object.entries(chains)) {
    if (name === 'arb') continue
    const peer = await checkPeer(chains.arb.rpc, chains.arb.adapter!, info.eid)
    console.log(`  Arb→${name.padEnd(5)} (${info.eid}): ${peer ? `${peer} ✅` : 'NONE'}`)
  }

  // 3. For any chain that has a peer, check if THEY also have an adapter
  console.log('\n=== Reverse peer check (does the other side point back to Arb?) ===')
  for (const [name, info] of Object.entries(chains)) {
    if (name === 'arb' || !info.adapter) continue
    const peer = await checkPeer(info.rpc, info.adapter, chains.arb.eid)
    console.log(`  ${name}→Arb (${chains.arb.eid}): ${peer ? `${peer} ✅` : 'NONE'}`)
  }

  // 4. Check Flow adapter peers with ALL chains (not just Arb)
  console.log('\n=== Flow PYUSD Adapter — Peers ===')
  for (const [name, info] of Object.entries(chains)) {
    if (name === 'flow') continue
    const peer = await checkPeer(chains.flow.rpc, chains.flow.adapter!, info.eid)
    console.log(`  Flow→${name.padEnd(5)} (${info.eid}): ${peer ? `${peer} ✅` : 'NONE'}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
