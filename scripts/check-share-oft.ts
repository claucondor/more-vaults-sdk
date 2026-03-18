import { type Address, getAddress, zeroAddress } from 'viem'
import { OMNI_FACTORY_ADDRESS, CHAIN_ID_TO_EID, OFT_ABI } from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT: Address = '0xaf46A54208CE9924B7577AFf146dfD65eB193861'

const FACTORY_COMPOSER_ABI = [{
  type: 'function', name: 'vaultComposer',
  inputs: [{ name: '_vault', type: 'address' }],
  outputs: [{ name: '', type: 'address' }],
  stateMutability: 'view',
}] as const

const COMPOSER_ABI = [{
  type: 'function', name: 'SHARE_OFT',
  inputs: [], outputs: [{ name: '', type: 'address' }],
  stateMutability: 'view',
}] as const

async function main() {
  const flowClient = createChainClient(747)!
  const arbClient  = createChainClient(42161)!

  // 1. Get composer on Flow hub
  const composer = await flowClient.readContract({
    address: OMNI_FACTORY_ADDRESS,
    abi: FACTORY_COMPOSER_ABI,
    functionName: 'vaultComposer',
    args: [VAULT],
  }) as Address
  console.log(`Composer (Flow):      ${composer}`)

  // 2. Get hub SHARE_OFT from composer
  const hubShareOft = await flowClient.readContract({
    address: composer,
    abi: COMPOSER_ABI,
    functionName: 'SHARE_OFT',
  }) as Address
  console.log(`SHARE_OFT (Flow hub): ${hubShareOft}`)

  // 3. Get Arbitrum peer of hub SHARE_OFT
  const arbEid = CHAIN_ID_TO_EID[42161]
  const arbPeerBytes32 = await flowClient.readContract({
    address: hubShareOft,
    abi: OFT_ABI,
    functionName: 'peers',
    args: [arbEid],
  }) as `0x${string}`
  const arbShareOft = getAddress(`0x${arbPeerBytes32.slice(-40)}`)
  console.log(`SHARE_OFT (Arbitrum): ${arbShareOft}  ${arbShareOft === zeroAddress ? '← NOT CONFIGURED' : ''}`)

  // 4. Verify Arbitrum side — does it have bytecode?
  if (arbShareOft !== zeroAddress) {
    const code = await arbClient.getBytecode({ address: arbShareOft })
    console.log(`  Arbitrum bytecode:  ${code && code !== '0x' ? 'YES' : 'NO (not deployed)'}`)
  } else {
    // Try reading SHARE_OFT directly on Arbitrum via factory composer
    try {
      const arbComposer = await arbClient.readContract({
        address: OMNI_FACTORY_ADDRESS,
        abi: FACTORY_COMPOSER_ABI,
        functionName: 'vaultComposer',
        args: [VAULT],
      }) as Address
      console.log(`Composer (Arbitrum):  ${arbComposer}`)
      if (arbComposer !== zeroAddress) {
        const arbShareOftDirect = await arbClient.readContract({
          address: arbComposer,
          abi: COMPOSER_ABI,
          functionName: 'SHARE_OFT',
        }) as Address
        console.log(`SHARE_OFT (Arbitrum direct): ${arbShareOftDirect}`)
      }
    } catch (e: any) {
      console.log(`  Arbitrum factory/composer: ${e.message}`)
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
