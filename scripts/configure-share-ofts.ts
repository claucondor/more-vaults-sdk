/**
 * Configure SHARE_OFT peers and enforced options on both chains.
 *
 * - setPeer: links each OFT to its counterpart on the remote chain
 * - setEnforcedOptions: minimum gas for lzReceive on each side
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx scripts/configure-share-ofts.ts
 */
import { createPublicClient, createWalletClient, http, padHex, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const pk = process.env.PRIVATE_KEY as `0x${string}`
if (!pk) { console.error('Missing PRIVATE_KEY'); process.exit(1) }
const account = privateKeyToAccount(pk)
console.log('Signing as:', account.address)

// ── contracts ─────────────────────────────────────────────────────────────────
const SHARE_OFT_FLOW = '0x54b1b994c87E7C5DdC945E8A82020c7ECe9473a3' as const
const SHARE_OFT_ARB  = '0x92fb13069176e64D92DB72B22BDF1dC191BA8d7a' as const

// LZ Endpoint IDs
const EID_FLOW = 30336
const EID_ARB  = 30110

// Peer bytes32 = address left-padded to 32 bytes
const PEER_FLOW = padHex(SHARE_OFT_FLOW, { size: 32 })
const PEER_ARB  = padHex(SHARE_OFT_ARB,  { size: 32 })

// ── LZ options encoding ───────────────────────────────────────────────────────
// TYPE_3 options: 0x0003 | workerId(1) | len(2) | optType(1) | data
// lzReceive option: workerId=0x01, optType=0x01, data=uint128(gasLimit)
function lzReceiveOptions(gasLimit: bigint): `0x${string}` {
  // uint128 = 16 bytes
  const gasHex = gasLimit.toString(16).padStart(32, '0') // 16 bytes = 32 hex chars
  return `0x00030100110100000000000000000000${gasHex}` as `0x${string}`
}

const OPTIONS_200K = lzReceiveOptions(200_000n) // SEND
const OPTIONS_500K = lzReceiveOptions(500_000n) // SEND_AND_CALL

console.log('lzReceive 200k options:', OPTIONS_200K)
console.log('lzReceive 500k options:', OPTIONS_500K)

// ── ABIs ──────────────────────────────────────────────────────────────────────
const SET_PEER_ABI = [{
  name: 'setPeer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: '_eid', type: 'uint32' }, { name: '_peer', type: 'bytes32' }],
  outputs: [],
}] as const

const SET_ENFORCED_ABI = [{
  name: 'setEnforcedOptions', type: 'function', stateMutability: 'nonpayable',
  inputs: [{
    name: '_enforcedOptions', type: 'tuple[]',
    components: [
      { name: 'eid', type: 'uint32' },
      { name: 'msgType', type: 'uint16' },
      { name: 'options', type: 'bytes' },
    ],
  }],
  outputs: [],
}] as const

const OWNER_ABI = [{
  name: 'owner', type: 'function', stateMutability: 'view',
  inputs: [], outputs: [{ type: 'address' }],
}] as const

// ── chains ────────────────────────────────────────────────────────────────────
const flowChain = {
  id: 747, name: 'Flow EVM',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.evm.nodes.onflow.org'] } },
} as const

const arbChain = {
  id: 42161, name: 'Arbitrum One',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } },
} as const

const flowPub    = createPublicClient({ chain: flowChain, transport: http() })
const arbPub     = createPublicClient({ chain: arbChain,  transport: http() })
const flowWallet = createWalletClient({ account, chain: flowChain, transport: http() })
const arbWallet  = createWalletClient({ account, chain: arbChain,  transport: http() })

// ── verify ownership ──────────────────────────────────────────────────────────
const [ownerFlow, ownerArb, balFlow, balArb] = await Promise.all([
  flowPub.readContract({ address: SHARE_OFT_FLOW, abi: OWNER_ABI, functionName: 'owner' }),
  arbPub.readContract({  address: SHARE_OFT_ARB,  abi: OWNER_ABI, functionName: 'owner' }),
  flowPub.getBalance({ address: account.address }),
  arbPub.getBalance({  address: account.address }),
])
console.log('\nOwners:')
console.log('  SHARE_OFT_FLOW:', ownerFlow)
console.log('  SHARE_OFT_ARB: ', ownerArb)
console.log('Balances:')
console.log('  Flow EVM:', Number(balFlow) / 1e18, 'FLOW')
console.log('  Arbitrum:', Number(balArb)  / 1e18, 'ETH')
console.log()

// ── configure SHARE_OFT_FLOW ──────────────────────────────────────────────────
console.log('=== Configuring SHARE_OFT_FLOW (Flow EVM) ===')

console.log('setPeer(EID_ARB, SHARE_OFT_ARB)...')
const h1 = await flowWallet.writeContract({
  address: SHARE_OFT_FLOW, abi: SET_PEER_ABI, functionName: 'setPeer',
  args: [EID_ARB, PEER_ARB],
})
console.log('  TX:', h1)
await flowPub.waitForTransactionReceipt({ hash: h1 })
console.log('  confirmed ✓')

console.log('setEnforcedOptions(EID_ARB)...')
const h2 = await flowWallet.writeContract({
  address: SHARE_OFT_FLOW, abi: SET_ENFORCED_ABI, functionName: 'setEnforcedOptions',
  args: [[
    { eid: EID_ARB, msgType: 1, options: OPTIONS_200K }, // SEND
    { eid: EID_ARB, msgType: 2, options: OPTIONS_500K }, // SEND_AND_CALL
  ]],
})
console.log('  TX:', h2)
await flowPub.waitForTransactionReceipt({ hash: h2 })
console.log('  confirmed ✓')

// ── configure SHARE_OFT_ARB ───────────────────────────────────────────────────
console.log('\n=== Configuring SHARE_OFT_ARB (Arbitrum) ===')

console.log('setPeer(EID_FLOW, SHARE_OFT_FLOW)...')
const h3 = await arbWallet.writeContract({
  address: SHARE_OFT_ARB, abi: SET_PEER_ABI, functionName: 'setPeer',
  args: [EID_FLOW, PEER_FLOW],
})
console.log('  TX:', h3)
await arbPub.waitForTransactionReceipt({ hash: h3 })
console.log('  confirmed ✓')

console.log('setEnforcedOptions(EID_FLOW)...')
const h4 = await arbWallet.writeContract({
  address: SHARE_OFT_ARB, abi: SET_ENFORCED_ABI, functionName: 'setEnforcedOptions',
  args: [[
    { eid: EID_FLOW, msgType: 1, options: OPTIONS_200K },
    { eid: EID_FLOW, msgType: 2, options: OPTIONS_500K },
  ]],
})
console.log('  TX:', h4)
await arbPub.waitForTransactionReceipt({ hash: h4 })
console.log('  confirmed ✓')

console.log('\nDone — both SHARE_OFTs configured ✓')
