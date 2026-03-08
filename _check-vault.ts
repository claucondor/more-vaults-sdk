import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { getVaultStatus as getViemStatus, getUserPosition, getVaultMetadata } from './src/viem/index.js'
import { getVaultStatus as getEthersStatus } from './src/ethers/index.js'
import { JsonRpcProvider } from 'ethers'

const VAULT  = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6'
const USER   = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2'
const RPC   = 'https://base-rpc.publicnode.com'

async function main() {
  const viemClient = createPublicClient({ chain: base, transport: http(RPC) })

  console.log('=== vault status ===')
  const viemStatus = await getViemStatus(viemClient, VAULT)
  console.log(JSON.stringify(viemStatus, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))

  console.log('\n=== user position ===')
  const pos = await getUserPosition(viemClient, VAULT, USER)
  console.log(JSON.stringify(pos, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))

  // Check which selectors the vault exposes
  const facets = await viemClient.readContract({
    address: VAULT as `0x${string}`,
    abi: [{ name: 'facets', type: 'function', inputs: [], outputs: [{ type: 'tuple[]', components: [{ name: 'facetAddress', type: 'address' }, { name: 'functionSelectors', type: 'bytes4[]' }] }], stateMutability: 'view' }] as const,
    functionName: 'facets',
  }).catch(() => null)

  console.log('\n=== role selectors present? ===')
  const HAS_ROLE  = '0x91d14854' // hasRole(bytes32,address)
  const GET_ROLE  = '0x248a9ca3' // getRoleAdmin(bytes32)
  const MAX_DEP   = '0x402d267d' // maxDeposit(address)
  if (facets) {
    for (const f of facets as { facetAddress: string; functionSelectors: string[] }[]) {
      const hits = f.functionSelectors.filter(s => [HAS_ROLE, GET_ROLE, MAX_DEP].includes(s))
      if (hits.length) console.log(f.facetAddress, hits)
    }
    console.log('total facets:', facets.length)
  } else {
    console.log('facets() not available')
  }
}
main()
