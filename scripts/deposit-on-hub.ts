/**
 * Deposit 1 USDC on the hub chain (Base) using smartDeposit + waitForAsyncRequest.
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/deposit-on-hub.ts
 */

import { createWalletClient, formatUnits, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  smartDeposit,
  waitForAsyncRequest,
  ERC20_ABI,
  VAULT_ABI,
  LZ_TIMEOUTS,
} from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'

const VAULT      = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const HUB_CHAIN  = 8453
const DEPOSIT_AMOUNT = 1_000_000n // 1 USDC (6 decimals)

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  const hubClient = createChainClient(HUB_CHAIN)!
  const hubWalletClient = createWalletClient({
    account,
    chain: hubClient.chain,
    transport: createChainTransport(HUB_CHAIN)!,
  })

  const vaultAsset = await hubClient.readContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'asset',
  }) as `0x${string}`

  const [usdcBalance, ethBalance, sharesBefore] = await Promise.all([
    hubClient.readContract({ address: vaultAsset, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
    hubClient.getBalance({ address: account.address }),
    hubClient.readContract({ address: VAULT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  ])

  console.log(`Wallet:       ${account.address}`)
  console.log(`Vault:        ${VAULT}`)
  console.log(`USDC on Base: ${formatUnits(usdcBalance, 6)}`)
  console.log(`ETH on Base:  ${formatEther(ethBalance)}`)
  console.log(`Shares before: ${sharesBefore}`)
  console.log(`Depositing:   ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC`)

  if (usdcBalance < DEPOSIT_AMOUNT) {
    console.error(`\nNot enough USDC. Need ${formatUnits(DEPOSIT_AMOUNT, 6)}, have ${formatUnits(usdcBalance, 6)}`)
    process.exit(1)
  }

  // smartDeposit auto-detects async vault
  const result = await smartDeposit(
    hubWalletClient,
    hubClient as any,
    { vault: VAULT },
    DEPOSIT_AMOUNT,
    account.address,
  )

  console.log(`\nTX: ${result.txHash}`)

  if ('guid' in result) {
    console.log(`Mode: ASYNC`)
    console.log(`GUID: ${result.guid}`)
    console.log(`LZ:   https://layerzeroscan.com/tx/${result.guid}`)
    console.log(`\nWaiting for finalization via GUID polling...`)

    const startTime = Date.now()
    const final = await waitForAsyncRequest(
      hubClient as any,
      VAULT,
      result.guid,
      LZ_TIMEOUTS.POLL_INTERVAL,
      LZ_TIMEOUTS.LZ_READ_CALLBACK,
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
    console.log(`Mode: SYNC`)
    console.log(`Shares: ${result.assets}`)
  }

  const sharesAfter = await hubClient.readContract({
    address: VAULT, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })

  console.log(`\nShares: ${sharesBefore} -> ${sharesAfter} (delta: ${sharesAfter - sharesBefore})`)
}

main().catch(e => { console.error('\n--- ERROR ---\n', e); process.exit(1) })
