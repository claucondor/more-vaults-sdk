import { getAsyncRequestStatus } from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const GUID = '0x90FF99AADBED1FD1B3C596318F5A662C2128DCF96D2BE9A4427E34241D101E38' as const

async function main() {
  const hubClient = createChainClient(8453)!
  const status = await getAsyncRequestStatus(hubClient as any, VAULT, GUID)
  console.log('=== Async Request Status ===')
  console.log(`fulfilled: ${status.fulfilled}`)
  console.log(`finalized: ${status.finalized}`)
  console.log(`refunded:  ${status.refunded}`)
  console.log(`result:    ${status.result}`)
}

main().catch(e => { console.error(e); process.exit(1) })
