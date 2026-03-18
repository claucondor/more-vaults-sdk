/**
 * Test stargateType() on ALL OFTs from OFT_ROUTES to verify on-chain detection.
 * Expected: stgUSDC, USDT, WETH → stargateType() succeeds (Stargate)
 * Expected: everything else → stargateType() reverts (standard OFT)
 */
import { createPublicClient, http, type PublicClient } from 'viem'
import { base, mainnet, arbitrum, optimism } from 'viem/chains'

// We test on chains where we have free RPCs
const CHAINS: Record<number, { chain: any; rpc: string }> = {
  8453:  { chain: base,     rpc: 'https://mainnet.base.org' },
  1:     { chain: mainnet,  rpc: 'https://eth.llamarpc.com' },
  42161: { chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc' },
  10:    { chain: optimism, rpc: 'https://mainnet.optimism.io' },
}

const STARGATE_TYPE_ABI = [
  { type: 'function', name: 'stargateType', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
] as const

// All OFTs from chains.ts — symbol, chainId, oft address, expected result
const ALL_OFTS: { symbol: string; chainId: number; oft: string; expectStargate: boolean }[] = [
  // --- Stargate (should return stargateType) ---
  { symbol: 'stgUSDC', chainId: 8453,  oft: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26', expectStargate: true },
  { symbol: 'stgUSDC', chainId: 1,     oft: '0xc026395860Db2d07ee33e05fE50ed7bD583189C7', expectStargate: true },
  { symbol: 'stgUSDC', chainId: 42161, oft: '0xe8CDF27AcD73a434D661C84887215F7598e7d0d3', expectStargate: true },
  { symbol: 'stgUSDC', chainId: 10,    oft: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0', expectStargate: true },
  { symbol: 'USDT',    chainId: 1,     oft: '0x933597a323Eb81cAe705C5bC29985172fd5A3973', expectStargate: true },
  { symbol: 'USDT',    chainId: 42161, oft: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0', expectStargate: true },
  { symbol: 'USDT',    chainId: 10,    oft: '0x19cFCE47eD54a88614648DC3f19A5980097007dD', expectStargate: true },
  { symbol: 'WETH',    chainId: 1,     oft: '0x77b2043768d28E9C9aB44E1aBfC95944bcE57931', expectStargate: true },
  { symbol: 'WETH',    chainId: 42161, oft: '0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F', expectStargate: true },
  { symbol: 'WETH',    chainId: 8453,  oft: '0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7', expectStargate: true },

  // --- Standard OFTs (should revert on stargateType) ---
  { symbol: 'sUSDe',   chainId: 8453,  oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', expectStargate: false },
  { symbol: 'sUSDe',   chainId: 1,     oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', expectStargate: false },
  { symbol: 'sUSDe',   chainId: 42161, oft: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', expectStargate: false },
  { symbol: 'USDe',    chainId: 1,     oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', expectStargate: false },
  { symbol: 'USDe',    chainId: 42161, oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', expectStargate: false },
  { symbol: 'USDe',    chainId: 8453,  oft: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', expectStargate: false },
  { symbol: 'weETH',   chainId: 1,     oft: '0xcd2eb13d6831d4602d80e5db9230a57596cdca63', expectStargate: false },
  { symbol: 'weETH',   chainId: 8453,  oft: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a', expectStargate: false },
  { symbol: 'weETH',   chainId: 10,    oft: '0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff', expectStargate: false },
  { symbol: 'rsETH',   chainId: 1,     oft: '0x85d456b2dff1fd8245387c0bfb64dfb700e98ef3', expectStargate: false },
  { symbol: 'rsETH',   chainId: 42161, oft: '0x4186bfc76e2e237523cbc30fd220fe055156b41f', expectStargate: false },
  { symbol: 'rsETH',   chainId: 8453,  oft: '0x1bc71130a0e39942a7658878169764bbd8a45993', expectStargate: false },
  { symbol: 'rswETH',  chainId: 1,     oft: '0x1486d39646cdee84619bd05997319545a8575079', expectStargate: false },
  { symbol: 'rswETH',  chainId: 42161, oft: '0xb1fe27b32ffb5ce54e272c096547f1e86c19e72f', expectStargate: false },
  { symbol: 'USR',     chainId: 1,     oft: '0xd2ee2776f34ef4e7325745b06e6d464b08d4be0e', expectStargate: false },
  { symbol: 'USR',     chainId: 42161, oft: '0x2492d0006411af6c8bbb1c8afc1b0197350a79e9', expectStargate: false },
  { symbol: 'wstUSR',  chainId: 1,     oft: '0xab17c1fe647c37ceb9b96d1c27dd189bf8451978', expectStargate: false },
  { symbol: 'wstUSR',  chainId: 42161, oft: '0x66cfbd79257dc5217903a36293120282548e2254', expectStargate: false },
  { symbol: 'USDtb',   chainId: 1,     oft: '0xc708b6887db46005da033501f8aebee72d191a5d', expectStargate: false },
  { symbol: 'USDtb',   chainId: 42161, oft: '0xc708b6887db46005da033501f8aebee72d191a5d', expectStargate: false },
  { symbol: 'PYUSD',   chainId: 42161, oft: '0x3CD2b89C49D130C08f1d683225b2e5DeB63ff876', expectStargate: false },
  { symbol: 'USDF',    chainId: 1,     oft: '0xfa0e06b54986ad96de87a8c56fea76fbd8d493f8', expectStargate: false },
  { symbol: 'WFLOW',   chainId: 1,     oft: '0xc1b45896b5fc9422a8f779653808297bb4f546f9', expectStargate: false },
]

const clients: Record<number, PublicClient> = {}
for (const [id, cfg] of Object.entries(CHAINS)) {
  clients[Number(id)] = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) })
}

async function checkOne(entry: typeof ALL_OFTS[0]): Promise<{ pass: boolean; actual: string }> {
  const client = clients[entry.chainId]
  if (!client) return { pass: true, actual: 'SKIPPED (no RPC)' }

  try {
    const result = await client.readContract({
      address: entry.oft as `0x${string}`,
      abi: STARGATE_TYPE_ABI,
      functionName: 'stargateType',
    })
    return { pass: entry.expectStargate === true, actual: `OK (type=${result})` }
  } catch {
    return { pass: entry.expectStargate === false, actual: 'REVERTED' }
  }
}

async function main() {
  console.log('Testing stargateType() on all OFT_ROUTES entries...\n')

  let passed = 0
  let failed = 0

  // Run in batches of 5 to avoid rate limits
  for (let i = 0; i < ALL_OFTS.length; i += 5) {
    const batch = ALL_OFTS.slice(i, i + 5)
    const results = await Promise.all(batch.map(checkOne))

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j]
      const { pass, actual } = results[j]
      const icon = pass ? '✓' : '✗'
      const expect = entry.expectStargate ? 'STARGATE' : 'STANDARD'
      console.log(`  ${icon} ${entry.symbol.padEnd(8)} chain=${String(entry.chainId).padEnd(5)} expect=${expect.padEnd(8)} actual=${actual}`)
      if (pass) passed++; else failed++
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${ALL_OFTS.length} total`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
