# sales_channels

Owns the **admin surface** for sales channels — CRUD, lifecycle and the
membership routes — and the nine `sales_channel_*` membership bridge tables and
their migration. A single deployment serves multiple channels; catalog
visibility, related/cross-sell/up-sell links, promotions/coupons, pricing, CMS,
mega-menu and blog are all scoped to the request's channel through those bridges.

## What lives in the kernel (feature 072, T019)

Channel *resolution* is a platform concern, not a module one: the resolution
order is a refusal contract (Constitution XII) and 49 call sites read the
resolved channel. So the `SalesChannel` entity, the resolver middleware and
resolver service, `SalesChannelMembershipService`, the cache and its invalidator
and `DefaultChannelReconciler` all live under
`backend/src/kernel/sales-channels/`. This module keeps
`services/sales-channels.service.ts` (admin CRUD, zero external importers) and
`routes.admin.ts`.

Nothing about the resolution order or the refusal behaviour changed with the
move; a module may import the kernel freely.

## The single resolution contract (feature 053 / FR-002)

The **canonical resolver middleware**
(`kernel/sales-channels/sales-channel-resolver.middleware.ts`)
runs as a Fastify `onRequest` hook on every `/api/v1/*` request (bypassing
`/api/v1/_health`). It resolves the channel **once**, in this order:

1. `X-Sales-Channel: <code>` header
2. `?salesChannel=<code>` query — storefront only; ignored on `/api/v1/admin/*`
3. `SALES_CHANNEL_HOST_MAP` host mapping
4. the **system-default** channel (`systemDefault = true`) — the single
   empty-channel fallback (the legacy `isPublic` fallback is retired)

It validates existence + active state (unknown → `UNKNOWN_SALES_CHANNEL`,
inactive → `INACTIVE_SALES_CHANNEL`), attaches the result to
`request.salesChannel` (a `CachedChannel`, backed by the LRU+Redis cache), and
echoes `X-Sales-Channel: <resolvedCode>` on the response.

### Consuming the channel — the one rule

Storefront-facing modules **MUST** read `request.salesChannel` (via
`getResolvedChannel(request)`) and **MUST NOT** re-parse the header/query/host or
re-query `SalesChannel` to derive the request channel. Routes hand services the
resolved channel object; services never re-resolve. Reading `channel.isPublic`
(price visibility) off the already-resolved channel is fine — it is a display
flag, not resolution.

This invariant is enforced by `backend/scripts/check-channel-resolution.ts`
(CI `--enforce`). Bridge membership is read only through
`SalesChannelMembershipService` (the `no-unscoped-channel-query` rule).

Full contract + consumption guide: `specs/053-sales-channel-scoping-unification/`
(`contracts/resolved-channel-context.md`, `contracts/header-dialect.md`,
`quickstart.md`).

### Notes

- The `X-Sales-Channel-Id` (UUID) header is **removed** — `X-Sales-Channel`
  (code) is the only dialect.
- Activation/deactivation invalidates the resolver cache through the
  `sales_channels.lifecycle_changed` pub/sub, so a channel goes offline on every
  surface within the cache TTL (one cache, all surfaces).
- Carts/quotes are assigned the system-default channel at creation, so no
  null-channel cart reaches pricing/checkout.
