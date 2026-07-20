# sales_channels

Owns the **sales channel** entity and the one canonical way a request's channel
is resolved. A single deployment serves multiple channels; catalog visibility,
related/cross-sell/up-sell links, promotions/coupons, pricing, CMS, mega-menu and
blog are all scoped to the request's channel through the `sales_channel_*`
membership bridges.

## The single resolution contract (feature 053 / FR-002)

The **canonical resolver middleware** (`middleware/sales-channel-resolver.ts`)
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
