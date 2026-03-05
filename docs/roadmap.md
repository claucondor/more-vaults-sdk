# SDK Roadmap

## v0.2 — Wagmi hooks

Pre-built React hooks so frontend devs don't have to manage loading states, caching, or refetching manually.

```ts
const { data: status, isLoading } = useVaultStatus(vault)
const { data: position } = useUserPosition(vault, address)
const { deposit, isPending } = useDeposit(vault)
```

Hooks to add:
- `useVaultStatus(vault)` — wraps `getVaultStatus`, auto-refetches on block
- `useUserPosition(vault, user)` — wraps `getUserPosition`
- `useVaultSummary(vault)` — wraps `getVaultSummary` for dashboard cards
- `useDeposit(vault)` — wraps `smartDeposit`, exposes `isPending` / `isSuccess`
- `useRedeem(vault)` — wraps `redeemShares` / `redeemAsync`
- `useAsyncRequestStatus(vault, guid)` — polls `getAsyncRequestStatusLabel` until completed

## v0.2 — Multi-vault batch reads

Fetch status for multiple vaults in a single RPC call — useful for listing pages.

```ts
const statuses = await getMultipleVaultStatus(publicClient, [vault1, vault2, vault3])
```

Implementation: one Multicall3 batch with all reads interleaved, decoded per vault.

## v0.2 — APY estimate

Approximate APY based on share price history.

```ts
const { apy7d, apy30d } = await getVaultApy(publicClient, vault)
```

Options:
- On-chain: compare `convertToAssets(oneShare)` now vs N blocks ago
- Off-chain: index share price snapshots and expose via API

## v0.3 — Curator helpers

Functions for vault operators (not end users):

- `executeBridging(signer, vault, ...)` — repatriate funds from spokes to hub
- `setDepositCapacity(signer, vault, cap)` — update deposit cap
- `getSpokesDeployment(provider, vault)` — breakdown of funds per spoke chain

## v0.3 — Error recovery helpers

Helpers to handle the most common failure modes:

- `canFinalizeRequest(provider, vault, guid)` — check if async request is ready to execute
- `estimateRepatriationNeeded(provider, vault, redeemAmount)` — how much the curator needs to bridge back before a large redeem can go through

## Notes

- Wagmi hooks will be a separate entry point (`@oydual31/more-vaults-sdk/wagmi`) to keep the core viem/ethers packages lean
- All v0.2+ features are additive — no breaking changes to v0.1 API
