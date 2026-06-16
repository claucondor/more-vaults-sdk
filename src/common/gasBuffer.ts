/**
 * Configurable gas buffer for on-chain transactions.
 *
 * On-chain gas estimates can fall short for deep call stacks or LayerZero Read
 * operations, causing out-of-gas reverts. We pad the raw estimate by a buffer
 * expressed in basis points (bps): 4000 bps = +40%.
 *
 * The default is process-wide configurable via {@link setDefaultGasBufferBps},
 * and {@link applyGasBuffer} also accepts a per-call override.
 *
 * @module gasBuffer
 */

/** Default gas buffer in basis points. 4000 = +40% on top of the estimate. */
export const DEFAULT_GAS_BUFFER_BPS = 4000n

/** Basis-points denominator (100% = 10000 bps). */
const BPS_DENOMINATOR = 10000n

let currentDefaultBps = DEFAULT_GAS_BUFFER_BPS

/**
 * Override the process-wide default gas buffer.
 *
 * @param bps  Buffer in basis points (must be >= 0). e.g. 4000n = +40%.
 * @throws     RangeError if `bps` is negative.
 */
export function setDefaultGasBufferBps(bps: bigint): void {
  if (bps < 0n) throw new RangeError(`gas buffer bps must be >= 0, got ${bps}`)
  currentDefaultBps = bps
}

/** Read the current process-wide default gas buffer, in basis points. */
export function getDefaultGasBufferBps(): bigint {
  return currentDefaultBps
}

/**
 * Apply a gas buffer to a raw gas estimate.
 *
 * @param estimate   Raw gas estimate (units of gas).
 * @param bufferBps  Optional per-call override in basis points; falls back to
 *                   the process-wide default when omitted.
 * @returns          `estimate * (10000 + bps) / 10000`, rounded down (bigint).
 * @throws           RangeError if the effective buffer is negative.
 */
export function applyGasBuffer(estimate: bigint, bufferBps?: bigint): bigint {
  const bps = bufferBps ?? currentDefaultBps
  if (bps < 0n) throw new RangeError(`gas buffer bps must be >= 0, got ${bps}`)
  return (estimate * (BPS_DENOMINATOR + bps)) / BPS_DENOMINATOR
}
