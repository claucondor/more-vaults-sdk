// ─────────────────────────────────────────────────────────────────────────────
// Flow persistence — crash-recovery for cross-chain deposit flows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage adapter interface (async — supports localStorage today, remote tomorrow).
 * Implement this interface to plug in any storage backend.
 */
export interface FlowStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  del(key: string): Promise<void>
}

/**
 * Deposit flow state — discriminated union by phase.
 * Persisted after each phase so the flow can be resumed on reload.
 */
export type DepositFlowState =
  | {
      phase: 'spoke_sent'
      txHash: string
      /** Partial composeData from depositFromSpoke (message and from resolved later) */
      composeData: Record<string, unknown>
      /** As decimal string — bigint not JSON-safe */
      startBlock: string
      vault: string
      timestamp: number
    }
  | {
      phase: 'compose_found'
      /** Full composeData returned by waitForCompose */
      composeData: Record<string, unknown>
      timestamp: number
    }
  | {
      phase: 'hub_sent'
      guid: string
      vault: string
      composerSentGuid?: string
      tokensLocked?: { guid: string; vault: string; token: string; amount: string }
      timestamp: number
    }
  | { phase: 'done' }

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorageAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * localStorage-backed FlowStorage adapter.
 * Safe to instantiate in any environment — localStorage is only accessed at call time.
 */
export class LocalStorageAdapter implements FlowStorage {
  get(key: string): Promise<string | null> {
    return Promise.resolve(localStorage.getItem(key))
  }

  set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value)
    return Promise.resolve()
  }

  del(key: string): Promise<void> {
    localStorage.removeItem(key)
    return Promise.resolve()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default storage — auto-detected
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a LocalStorageAdapter when running in a browser environment,
 * or null in Node.js / non-browser environments.
 *
 * Used internally as the default storage — consumers can override by passing
 * their own FlowStorage implementation, or pass null to disable persistence.
 */
export function getDefaultStorage(): FlowStorage | null {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return new LocalStorageAdapter()
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON serialization — bigint-safe
// ─────────────────────────────────────────────────────────────────────────────

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { __bigint__: value.toString() }
  }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    '__bigint__' in (value as object) &&
    typeof (value as Record<string, unknown>).__bigint__ === 'string'
  ) {
    return BigInt((value as Record<string, unknown>).__bigint__ as string)
  }
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const FLOW_KEY_PREFIX = 'more-vaults:flow:'
const STALE_MS = 24 * 60 * 60 * 1000 // 24 hours

function flowKey(walletAddress: string): string {
  return `${FLOW_KEY_PREFIX}${walletAddress.toLowerCase()}`
}

/**
 * Persist the current deposit flow state for a wallet.
 */
export async function saveDepositFlow(
  storage: FlowStorage,
  walletAddress: string,
  state: DepositFlowState,
): Promise<void> {
  await storage.set(flowKey(walletAddress), JSON.stringify(state, replacer))
}

/**
 * Load a pending deposit flow for a wallet.
 * Returns null if there is no state, the flow is done, or the state is older than 24h.
 */
export async function loadDepositFlow(
  storage: FlowStorage,
  walletAddress: string,
): Promise<DepositFlowState | null> {
  const raw = await storage.get(flowKey(walletAddress))
  if (!raw) return null

  let state: DepositFlowState
  try {
    state = JSON.parse(raw, reviver) as DepositFlowState
  } catch {
    return null
  }

  if (state.phase === 'done') return null

  // Stale check — flows older than 24h are no longer resumable on-chain
  if ('timestamp' in state && Date.now() - state.timestamp > STALE_MS) return null

  return state
}

/**
 * Clear the persisted deposit flow for a wallet.
 * Call this when the flow completes or is explicitly cancelled.
 */
export async function clearDepositFlow(
  storage: FlowStorage,
  walletAddress: string,
): Promise<void> {
  await storage.del(flowKey(walletAddress))
}
