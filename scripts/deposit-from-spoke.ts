/**
 * E2E: Deposit 1 USDC from Ethereum (spoke) to Base (hub) via Stargate OFT compose.
 *
 * Full 2-TX Stargate flow:
 *   TX1 (Ethereum): depositFromSpoke → OFT.send with composeMsg
 *   [wait ~5-7 min for LZ delivery + compose to appear in composeQueue]
 *   TX2 (Base):     executeCompose → triggers deposit + LZ Read callback
 *   [wait ~5 min for async finalization]
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/deposit-from-spoke.ts
 */

import { createWalletClient, formatUnits, formatEther, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  depositFromSpoke,
  quoteDepositFromSpokeFee,
  waitForCompose,
  quoteComposeFee,
  executeCompose,
  waitForAsyncRequest,
  ERC20_ABI,
  VAULT_ABI,
  OFT_ROUTES,
  CHAIN_ID_TO_EID,
  LZ_TIMEOUTS,
} from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'

const VAULT         = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const HUB_CHAIN     = 8453    // Base
const SPOKE_CHAIN   = 1       // Ethereum
const DEPOSIT_AMOUNT = 1_000_000n // 1 USDC (6 decimals)

// Stargate USDC OFT on Ethereum
const SPOKE_OFT = OFT_ROUTES.stgUSDC[SPOKE_CHAIN].oft
const SPOKE_TOKEN = OFT_ROUTES.stgUSDC[SPOKE_CHAIN].token
const HUB_EID = CHAIN_ID_TO_EID[HUB_CHAIN]    // 30184
const SPOKE_EID = CHAIN_ID_TO_EID[SPOKE_CHAIN] // 30101

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) { console.error('Missing PRIVATE_KEY env var.'); process.exit(1) }

  const account = privateKeyToAccount(pk)

  // Clients
  const spokeClient = createChainClient(SPOKE_CHAIN)!
  const spokeWalletClient = createWalletClient({
    account, chain: spokeClient.chain, transport: createChainTransport(SPOKE_CHAIN)!,
  })
  const hubClient = createChainClient(HUB_CHAIN)!
  const hubWalletClient = createWalletClient({
    account, chain: hubClient.chain, transport: createChainTransport(HUB_CHAIN)!,
  })

  // Pre-flight: check balances
  const [spokeUSDC, spokeETH, hubETH, sharesBefore] = await Promise.all([
    spokeClient.readContract({ address: SPOKE_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
    spokeClient.getBalance({ address: account.address }),
    hubClient.getBalance({ address: account.address }),
    hubClient.readContract({ address: VAULT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  ])

  console.log('========================================')
  console.log('SPOKE DEPOSIT: Ethereum → Base (Stargate)')
  console.log('========================================')
  console.log(`Wallet:          ${account.address}`)
  console.log(`Vault:           ${VAULT}`)
  console.log(`USDC on Eth:     ${formatUnits(spokeUSDC, 6)}`)
  console.log(`ETH on Eth:      ${formatEther(spokeETH)}`)
  console.log(`ETH on Base:     ${formatEther(hubETH)}`)
  console.log(`Shares before:   ${sharesBefore}`)
  console.log(`Depositing:      ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC`)

  if (spokeUSDC < DEPOSIT_AMOUNT) {
    console.error(`\nNot enough USDC on Ethereum.`)
    process.exit(1)
  }

  // ── STEP 1: Quote LZ fee ──
  console.log('\n── Step 1: Quote LZ fee ──')
  const lzFee = await quoteDepositFromSpokeFee(
    spokeClient as any, VAULT, SPOKE_OFT, HUB_EID, SPOKE_EID,
    DEPOSIT_AMOUNT, account.address,
  )
  console.log(`LZ fee: ${formatEther(lzFee)} ETH`)

  if (spokeETH < lzFee + 500_000_000_000_000n) {
    console.error(`\nNot enough ETH on Ethereum for TX1.`)
    process.exit(1)
  }

  // ── STEP 2: TX1 — depositFromSpoke (on Ethereum) ──
  console.log('\n── Step 2: TX1 — depositFromSpoke (Ethereum) ──')
  const spokeResult = await depositFromSpoke(
    spokeWalletClient, spokeClient as any,
    VAULT, SPOKE_OFT, HUB_EID, SPOKE_EID,
    DEPOSIT_AMOUNT, account.address, lzFee,
  )

  console.log(`TX1:  ${spokeResult.txHash}`)
  console.log(`GUID: ${spokeResult.guid}`)
  console.log(`LZ:   https://layerzeroscan.com/tx/${spokeResult.guid}`)
  console.log(`Stargate 2-TX: composeData present = ${!!spokeResult.composeData}`)

  if (!spokeResult.composeData) {
    console.log('\nNo composeData — this is a standard OFT (1-TX flow). Done after LZ delivery.')
    process.exit(0)
  }

  // ── STEP 3: Wait for compose to appear on Base ──
  console.log('\n── Step 3: Wait for compose on Base ──')
  console.log(`Polling hub from block ${spokeResult.composeData.hubBlockStart}...`)

  const completeComposeData = await waitForCompose(
    hubClient as any,
    spokeResult.composeData,
    account.address,
    20_000,                          // poll every 20s
    LZ_TIMEOUTS.COMPOSE_DELIVERY,   // timeout 45 min
  )

  console.log(`Compose found!`)
  console.log(`  from:    ${completeComposeData.from}`)
  console.log(`  to:      ${completeComposeData.to}`)
  console.log(`  guid:    ${completeComposeData.guid}`)
  console.log(`  index:   ${completeComposeData.index}`)
  console.log(`  message: ${completeComposeData.message.slice(0, 42)}...`)

  // ── STEP 4: Quote compose fee ──
  console.log('\n── Step 4: Quote compose fee ──')
  const composeFee = await quoteComposeFee(
    hubClient as any, VAULT, SPOKE_EID, account.address,
  )
  console.log(`Compose fee: ${formatEther(composeFee)} ETH`)

  const hubETH2 = await hubClient.getBalance({ address: account.address })
  if (hubETH2 < composeFee + 300_000_000_000_000n) {
    console.error(`\nNot enough ETH on Base for TX2. Need ~${formatEther(composeFee)} ETH.`)
    process.exit(1)
  }

  // ── STEP 5: TX2 — executeCompose (on Base) ──
  console.log('\n── Step 5: TX2 — executeCompose (Base) ──')
  const composeResult = await executeCompose(
    hubWalletClient, hubClient as any,
    completeComposeData, composeFee,
  )
  console.log(`TX2: ${composeResult.txHash}`)

  // ── STEP 6: Wait for async finalization (LZ Read callback) ──
  console.log('\n── Step 6: Wait for async finalization ──')

  if (composeResult.guid) {
    console.log(`Async GUID from compose: ${composeResult.guid}`)
    console.log('Polling via waitForAsyncRequest...')

    const startTime = Date.now()
    const final = await waitForAsyncRequest(
      hubClient as any, VAULT, composeResult.guid,
      LZ_TIMEOUTS.POLL_INTERVAL, LZ_TIMEOUTS.LZ_READ_CALLBACK,
      (s) => {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        console.log(`[${elapsed}s] fulfilled=${s.fulfilled} finalized=${s.finalized} result=${s.result}`)
      },
    )
    console.log(`\nResult: ${final.status}`)
    if (final.status === 'completed') {
      console.log(`Shares minted: ${final.result}`)
    } else {
      console.log(`Deposit was refunded.`)
    }
  } else {
    console.log('No GUID from compose — sync vault or receipt parsing failed.')
    console.log('Shares should be available on hub immediately.')
  }

  // ── Final state ──
  const [sharesAfter, usdcAfterSpoke] = await Promise.all([
    hubClient.readContract({ address: VAULT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
    spokeClient.readContract({ address: SPOKE_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  ])

  console.log('\n========================================')
  console.log('SPOKE DEPOSIT COMPLETE')
  console.log('========================================')
  console.log(`TX1 (Eth):   ${spokeResult.txHash}`)
  console.log(`TX2 (Base):  ${composeResult.txHash}`)
  console.log(`USDC on Eth: ${formatUnits(spokeUSDC, 6)} → ${formatUnits(usdcAfterSpoke, 6)}`)
  console.log(`Shares:      ${sharesBefore} → ${sharesAfter} (delta: ${sharesAfter - sharesBefore})`)
}

main().catch(e => { console.error('\n--- ERROR ---\n', e); process.exit(1) })
