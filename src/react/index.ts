// MoreVaults SDK — React hooks (wagmi v2 + @tanstack/react-query v5)
// Peer dependencies: react >=18, wagmi >=2, @tanstack/react-query >=5

// --- Read hooks ---
export { useVaultStatus } from './useVaultStatus.js'
export type { VaultStatus } from './useVaultStatus.js'

export { useVaultMetadata } from './useVaultMetadata.js'
export type { VaultMetadata } from './useVaultMetadata.js'

export { useUserPosition } from './useUserPosition.js'
export type { UserPosition } from './useUserPosition.js'

export { useUserPositionMultiChain } from './useUserPositionMultiChain.js'
export type { MultiChainUserPosition } from './useUserPositionMultiChain.js'

export { useLzFee } from './useLzFee.js'

export { useAsyncRequestStatus } from './useAsyncRequestStatus.js'
export type { AsyncRequestStatusInfo } from './useAsyncRequestStatus.js'

export { useVaultTopology } from './useVaultTopology.js'
export type { VaultTopology } from './useVaultTopology.js'

// --- Action hooks ---
export { useOmniDeposit } from './useOmniDeposit.js'
export { useOmniRedeem } from './useOmniRedeem.js'
export { useDepositSimple } from './useDepositSimple.js'
export { useRedeemShares } from './useRedeemShares.js'

// --- Distribution ---
export { useVaultDistribution } from './useVaultDistribution.js'

// --- Smart (auto-routing) hooks ---
export { useSmartDeposit } from './useSmartDeposit.js'
export { useSmartRedeem } from './useSmartRedeem.js'

// --- Inbound Routes ---
export { useInboundRoutes, getRouteTokenDecimals } from './useInboundRoutes.js'

// --- Curator Read hooks ---
export { useCuratorVaultStatus } from './useCuratorVaultStatus.js'
export type { CuratorVaultStatus } from './useCuratorVaultStatus.js'

export { useVaultAnalysis } from './useVaultAnalysis.js'
export type { VaultAnalysis } from './useVaultAnalysis.js'

export { useVaultAssetBreakdown } from './useVaultAssetBreakdown.js'
export type { VaultAssetBreakdown } from './useVaultAssetBreakdown.js'

export { usePendingActions } from './usePendingActions.js'
export type { PendingAction } from './usePendingActions.js'

export { useIsCurator } from './useIsCurator.js'

export { useProtocolWhitelist } from './useProtocolWhitelist.js'

// --- Curator Write hooks ---
export { useSubmitActions } from './useSubmitActions.js'
export type { CuratorAction } from './useSubmitActions.js'

export { useExecuteActions } from './useExecuteActions.js'

export { useVetoActions } from './useVetoActions.js'

// --- Curator Bridge hooks ---
export { useCuratorBridgeQuote } from './useCuratorBridgeQuote.js'
export { useExecuteBridge } from './useExecuteBridge.js'

// --- Curator Sub-Vault hooks (Phase 5) ---
export { useSubVaultPositions } from './useSubVaultPositions.js'
export type { SubVaultPosition } from './useSubVaultPositions.js'

export { useVaultPortfolio } from './useVaultPortfolio.js'
export type { VaultPortfolio } from './useVaultPortfolio.js'

export { useVaultPortfolioMultiChain } from './useVaultPortfolioMultiChain.js'
export type { MultiChainPortfolio } from './useVaultPortfolioMultiChain.js'

export { useERC7540RequestStatus } from './useERC7540RequestStatus.js'
export type { ERC7540RequestStatus } from './useERC7540RequestStatus.js'
