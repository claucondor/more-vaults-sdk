/**
 * Unit tests for cross-chain compose helpers (viem).
 *
 * Run with: npx tsx --test src/viem/crossChainFlows.test.ts
 *
 * decodeComposeMessage parses OFTComposeMsgCodec bytes by fixed offsets, so we
 * build a structurally-correct message and assert every field round-trips.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, getAddress, numberToHex, pad } from 'viem'
import { decodeComposeMessage } from './crossChainFlows.js'
import { getLzEndpoint, DEFAULT_LZ_ENDPOINT, CHAIN_IDS } from './chains.js'

const SEND_PARAM_COMPONENTS = [
  { name: 'dstEid', type: 'uint32' },
  { name: 'to', type: 'bytes32' },
  { name: 'amountLD', type: 'uint256' },
  { name: 'minAmountLD', type: 'uint256' },
  { name: 'extraOptions', type: 'bytes' },
  { name: 'composeMsg', type: 'bytes' },
  { name: 'oftCmd', type: 'bytes' },
] as const

/** Assemble a ComposeSent `message` exactly like the on-chain OFTComposeMsgCodec. */
function buildComposeMessage(o: {
  srcEid: number
  amountLD: bigint
  depositor: `0x${string}`
  dstEid: number
  receiver: `0x${string}`
}): `0x${string}` {
  const nonce = numberToHex(0n, { size: 8 }).slice(2)              // bytes 0–7
  const srcEid = numberToHex(o.srcEid, { size: 4 }).slice(2)       // bytes 8–11
  const amountLD = numberToHex(o.amountLD, { size: 32 }).slice(2)  // bytes 12–43
  const composeFrom = pad(getAddress(o.depositor), { size: 32 }).slice(2) // bytes 44–75
  const payload = encodeAbiParameters(
    [
      { name: 'sendParam', type: 'tuple', components: SEND_PARAM_COMPONENTS },
      { name: 'minMsgValue', type: 'uint256' },
    ],
    [
      {
        dstEid: o.dstEid,
        to: pad(getAddress(o.receiver), { size: 32 }),
        amountLD: o.amountLD,
        minAmountLD: 0n,
        extraOptions: '0x',
        composeMsg: '0x',
        oftCmd: '0x',
      },
      0n,
    ],
  ).slice(2)
  return `0x${nonce}${srcEid}${amountLD}${composeFrom}${payload}`
}

const DEPOSITOR = getAddress('0x1111111111111111111111111111111111111111')
const RECEIVER = getAddress('0x2222222222222222222222222222222222222222')

test('decodeComposeMessage extracts all fields from a well-formed message', () => {
  const msg = buildComposeMessage({ srcEid: 30110, amountLD: 123_456_789n, depositor: DEPOSITOR, dstEid: 30101, receiver: RECEIVER })
  const d = decodeComposeMessage(msg)
  assert.equal(d.srcEid, 30110)
  assert.equal(d.amountLD, 123_456_789n)
  assert.equal(d.depositor, DEPOSITOR)
  assert.equal(d.dstEid, 30101)
  assert.equal(d.receiver, RECEIVER)
})

test('decodeComposeMessage handles a large uint256 amountLD without truncation', () => {
  const big = 2n ** 200n + 7n
  const msg = buildComposeMessage({ srcEid: 1, amountLD: big, depositor: DEPOSITOR, dstEid: 2, receiver: RECEIVER })
  assert.equal(decodeComposeMessage(msg).amountLD, big)
})

test('decodeComposeMessage leaves dstEid/receiver undefined when payload is malformed', () => {
  // Header only (76 bytes), no valid SendParam payload → inner decode throws, fields stay undefined.
  const nonce = numberToHex(0n, { size: 8 }).slice(2)
  const srcEid = numberToHex(30110, { size: 4 }).slice(2)
  const amountLD = numberToHex(500n, { size: 32 }).slice(2)
  const composeFrom = pad(DEPOSITOR, { size: 32 }).slice(2)
  const headerOnly = `0x${nonce}${srcEid}${amountLD}${composeFrom}` as `0x${string}`
  const d = decodeComposeMessage(headerOnly)
  assert.equal(d.srcEid, 30110)
  assert.equal(d.amountLD, 500n)
  assert.equal(d.depositor, DEPOSITOR)
  assert.equal(d.dstEid, undefined)
  assert.equal(d.receiver, undefined)
})

test('getLzEndpoint returns the Flow EVM override and the default elsewhere', () => {
  assert.equal(getLzEndpoint(CHAIN_IDS.flowEVMMainnet).toLowerCase(), '0xcb566e3b6934fa77258d68ea18e931fa75e1aaaa')
  assert.equal(getLzEndpoint(1), DEFAULT_LZ_ENDPOINT)
  assert.equal(getLzEndpoint(42161), DEFAULT_LZ_ENDPOINT)
})
