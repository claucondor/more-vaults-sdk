/**
 * Unit tests for cross-chain compose helpers (ethers).
 *
 * Run with: npx tsx --test src/ethers/crossChainFlows.test.ts
 *
 * Mirrors the viem suite: builds a structurally-correct OFTComposeMsgCodec
 * message and asserts decodeComposeMessage round-trips every field.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AbiCoder, getAddress, zeroPadValue, toBeHex } from 'ethers'
import { decodeComposeMessage } from './crossChainFlows.js'
import { getLzEndpoint, DEFAULT_LZ_ENDPOINT, CHAIN_IDS } from './chains.js'

const SEND_PARAM_TUPLE =
  'tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)'

/** Assemble a ComposeSent `message` exactly like the on-chain OFTComposeMsgCodec. */
function buildComposeMessage(o: {
  srcEid: number
  amountLD: bigint
  depositor: string
  dstEid: number
  receiver: string
}): string {
  const nonce = toBeHex(0n, 8).slice(2)                         // bytes 0–7
  const srcEid = toBeHex(o.srcEid, 4).slice(2)                  // bytes 8–11
  const amountLD = toBeHex(o.amountLD, 32).slice(2)             // bytes 12–43
  const composeFrom = zeroPadValue(getAddress(o.depositor), 32).slice(2) // bytes 44–75
  const payload = AbiCoder.defaultAbiCoder().encode(
    [SEND_PARAM_TUPLE, 'uint256'],
    [
      [o.dstEid, zeroPadValue(getAddress(o.receiver), 32), o.amountLD, 0n, '0x', '0x', '0x'],
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
  const nonce = toBeHex(0n, 8).slice(2)
  const srcEid = toBeHex(30110, 4).slice(2)
  const amountLD = toBeHex(500n, 32).slice(2)
  const composeFrom = zeroPadValue(DEPOSITOR, 32).slice(2)
  const headerOnly = `0x${nonce}${srcEid}${amountLD}${composeFrom}`
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
