/**
 * Unit tests for the configurable gas buffer.
 *
 * Run with: npx tsx --test src/common/gasBuffer.test.ts
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GAS_BUFFER_BPS,
  applyGasBuffer,
  getDefaultGasBufferBps,
  setDefaultGasBufferBps,
} from './gasBuffer.js'

beforeEach(() => {
  // Reset global state between tests so order does not matter.
  setDefaultGasBufferBps(DEFAULT_GAS_BUFFER_BPS)
})

test('default buffer is 40% (4000 bps)', () => {
  assert.equal(DEFAULT_GAS_BUFFER_BPS, 4000n)
  assert.equal(getDefaultGasBufferBps(), 4000n)
})

test('applyGasBuffer pads by the default 40%', () => {
  assert.equal(applyGasBuffer(100n), 140n)
  assert.equal(applyGasBuffer(1_000_000n), 1_400_000n)
})

test('default of 40% is larger than the previous hardcoded 30%', () => {
  const prev = (1_000_000n * 130n) / 100n // old behaviour
  assert.ok(applyGasBuffer(1_000_000n) > prev)
})

test('per-call override takes precedence over the global default', () => {
  assert.equal(applyGasBuffer(100n, 5000n), 150n) // +50%
  assert.equal(applyGasBuffer(100n, 0n), 100n) // no buffer
})

test('per-call override of 0 still disables the buffer (not falsy-ignored)', () => {
  // Guards against `bufferBps || default` bugs: 0n must be honoured.
  assert.equal(applyGasBuffer(200n, 0n), 200n)
})

test('setDefaultGasBufferBps changes subsequent default-based calls', () => {
  setDefaultGasBufferBps(2500n) // +25%
  assert.equal(getDefaultGasBufferBps(), 2500n)
  assert.equal(applyGasBuffer(1000n), 1250n)
})

test('rounds down (floor) on non-exact division', () => {
  // 7 * 14000 / 10000 = 9.8 -> 9
  assert.equal(applyGasBuffer(7n), 9n)
  // 333 * 14000 / 10000 = 466.2 -> 466
  assert.equal(applyGasBuffer(333n), 466n)
})

test('zero estimate stays zero', () => {
  assert.equal(applyGasBuffer(0n), 0n)
})

test('handles large estimates without overflow (bigint)', () => {
  const big = 30_000_000n
  assert.equal(applyGasBuffer(big), 42_000_000n)
})

test('negative buffer is rejected', () => {
  assert.throws(() => applyGasBuffer(100n, -1n), RangeError)
  assert.throws(() => setDefaultGasBufferBps(-1n), RangeError)
})
