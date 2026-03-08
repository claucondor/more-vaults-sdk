// MoreVaults SDK — React hooks (wagmi v2 + @tanstack/react-query v5)
// Peer dependencies: react >=18, wagmi >=2, @tanstack/react-query >=5

// --- Read hooks ---
export { useVaultStatus } from './useVaultStatus.js'
export type { VaultStatus } from './useVaultStatus.js'

export { useVaultMetadata } from './useVaultMetadata.js'
export type { VaultMetadata } from './useVaultMetadata.js'

export { useUserPosition } from './useUserPosition.js'
export type { UserPosition } from './useUserPosition.js'

export { useLzFee } from './useLzFee.js'

export { useAsyncRequestStatus } from './useAsyncRequestStatus.js'
export type { AsyncRequestStatusInfo } from './useAsyncRequestStatus.js'

// --- Action hooks ---
export { useOmniDeposit } from './useOmniDeposit.js'
export { useOmniRedeem } from './useOmniRedeem.js'
export { useDepositSimple } from './useDepositSimple.js'
export { useRedeemShares } from './useRedeemShares.js'

// --- Smart (auto-routing) hooks ---
export { useSmartDeposit } from './useSmartDeposit.js'
