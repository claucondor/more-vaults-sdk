/**
 * Resume a spoke deposit from step 4: executeCompose + waitForAsyncRequest.
 * Use this when TX1 succeeded and compose was found but TX2 failed (e.g. insufficient ETH).
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/compose-and-wait.ts
 */

import { createWalletClient, formatUnits, formatEther, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  quoteComposeFee,
  executeCompose,
  waitForAsyncRequest,
  ERC20_ABI,
  VAULT_ABI,
  CHAIN_ID_TO_EID,
  LZ_TIMEOUTS,
} from '../src/viem/index.js'
import type { ComposeData } from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'

const VAULT     = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const HUB_CHAIN = 8453
const SPOKE_EID = CHAIN_ID_TO_EID[1] // Ethereum

// Compose data from the previous run
const composeData: ComposeData = {
  endpoint: '0x1a44076050125825900e736c501f859c50fe728c',
  from: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
  to: '0x96A4De4E80Cc13f084359961082F3daaa990aCC0',
  guid: '0x01f847e56cdee829a2921a812b6add49e11f01e3bb8232d9ee0027d81f8eb607',
  index: 0,
  message: '0x', // Will be filled from waitForCompose if needed
  isStargate: true,
  hubChainId: HUB_CHAIN,
  hubBlockStart: 43320217n,
}

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) { console.error('Missing PRIVATE_KEY env var.'); process.exit(1) }

  const account = privateKeyToAccount(pk)
  const hubClient = createChainClient(HUB_CHAIN)!
  const hubWalletClient = createWalletClient({
    account, chain: hubClient.chain, transport: createChainTransport(HUB_CHAIN)!,
  })

  const [ethBalance, sharesBefore] = await Promise.all([
    hubClient.getBalance({ address: account.address }),
    hubClient.readContract({ address: VAULT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  ])

  console.log(`Wallet:        ${account.address}`)
  console.log(`ETH on Base:   ${formatEther(ethBalance)}`)
  console.log(`Shares before: ${sharesBefore}`)

  // We need to get the full compose message — re-scan for it
  const { waitForCompose } = await import('../src/viem/index.js')

  console.log('\n── Scanning for compose message ──')
  const fullCompose = await waitForCompose(
    hubClient as any, composeData, account.address, 5_000, 30_000,
  )
  console.log(`Message: ${fullCompose.message.slice(0, 42)}...`)

  // Quote compose fee
  console.log('\n── Quote compose fee ──')
  const composeFee = await quoteComposeFee(
    hubClient as any, VAULT, SPOKE_EID, account.address,
  )
  console.log(`Compose fee: ${formatEther(composeFee)} ETH`)

  // Check if we have enough — minimal buffer for Base (gas is ~0.00001 ETH)
  const minBuffer = 50_000_000_000_000n // 0.00005 ETH
  if (ethBalance < composeFee + minBuffer) {
    console.error(`\nStill not enough ETH. Need ~${formatEther(composeFee + minBuffer)}, have ${formatEther(ethBalance)}`)
    process.exit(1)
  }

  // Execute compose
  console.log('\n── executeCompose ──')
  const result = await executeCompose(hubWalletClient, hubClient as any, fullCompose, composeFee)
  console.log(`TX2: ${result.txHash}`)
  if (result.guid) {
    console.log(`GUID: ${result.guid}`)
  }

  // Wait for async finalization
  if (result.guid) {
    console.log('\n── waitForAsyncRequest ──')
    const startTime = Date.now()
    const final = await waitForAsyncRequest(
      hubClient as any, VAULT, result.guid,
      LZ_TIMEOUTS.POLL_INTERVAL, LZ_TIMEOUTS.LZ_READ_CALLBACK,
      (s) => {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        console.log(`[${elapsed}s] fulfilled=${s.fulfilled} finalized=${s.finalized} result=${s.result}`)
      },
    )
    console.log(`\nResult: ${final.status}`)
    if (final.status === 'completed') {
      console.log(`Shares minted: ${final.result}`)
    }
  }

  const sharesAfter = await hubClient.readContract({
    address: VAULT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })
  console.log(`\nShares: ${sharesBefore} → ${sharesAfter} (delta: ${sharesAfter - sharesBefore})`)
}

main().catch(e => { console.error('\n--- ERROR ---\n', e); process.exit(1) })
