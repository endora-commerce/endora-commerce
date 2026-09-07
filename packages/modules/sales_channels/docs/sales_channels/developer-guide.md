---
title: Developer guide
sidebar_position: 3
---

# Developer guide — Sales Channels

How a backend module integrates with the Sales Channels module: scoping queries by the resolved channel, managing memberships, and reading channel context from request handlers.

## Reading the resolved channel inside a route

The resolver middleware decorates every request under `/api/v1/*` with `req.salesChannel` (a serialised `CachedChannel` view of the resolved row). Use the typed helper to keep the access pattern consistent:

```ts
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';

app.get('/api/v1/storefront/products', async (request) => {
  const channel = getResolvedChannel(request);
  return productService.list({ salesChannelId: channel.id });
});
```

Outside the request lifecycle (background jobs, CLI scripts), call `SalesChannelResolverService.getByCode(code)` or `getSystemDefault()` directly through the module's composition handle.

## Adding a channel-scoped entity to your module

Channel scoping has two layers:

1. **Schema** — the entity gains a many-to-many relationship to `sales_channels` via a new bridge table `sales_channel_<entity>` (composite primary key on both ids, `ON DELETE CASCADE` on both sides). Add the table in your module's next migration.
2. **Service** — every read path of the entity that should be filtered by channel takes a `salesChannelId` parameter and joins through the bridge table. Every create / update path that lands a new entity calls `SalesChannelMembershipService.bindToDefaultIfEmpty(entityType, entity.id)` after `persistAndFlush` so newly-created entities default to the system-default channel (FR-011).

Then register the entity type in the membership service's `BRIDGE_TABLES` map and in the contract's `ChannelMemberEntityTypeSchema` enum, and the bidirectional admin routes pick it up automatically — no per-module routes needed.

## Mutating memberships

`SalesChannelMembershipService` is the single mutator for every bridge table. Direct INSERT / DELETE on `sales_channel_*` from anywhere else is forbidden — the lint rule `no-unscoped-channel-query` is the safety net (it ships disabled and gets turned on once every existing call site has been threaded; see tasks.md T020 / T062).

```ts
const result = await membershipService.addToChannel(channelId, 'product', productId);
// result.changed is false on idempotent re-add.

const removed = await membershipService.removeFromChannel(channelId, 'product', productId, {
  fallbackToDefault: true,
});
// throws ENTITY_WOULD_HAVE_ZERO_CHANNELS if it would orphan the entity AND fallbackToDefault is false.
```

## The Default channel guarantee

The `DefaultChannelReconciler` runs at every backend boot from `composition.ts` (and from `test-server.ts` for integration tests). Three branches:

1. **Empty `sales_channels` table** — inserts a new `default` row sourced from `DEFAULT_SALES_CHANNEL_CODE` (env, default `default`).
2. **Rows exist but none has `system_default = true`** — promotes the lexically-first row, with a tie-break preferring the row whose `code = 'default'`.
3. **Exactly one row already has `system_default = true`** — no-op.

The reconciler never demotes, never deletes, and never edits identity. Code outside this module assumes the default exists; if you're writing infra-level code that runs before the reconciler, call `DefaultChannelReconciler.run()` first.

## Optimistic concurrency for identity edits

The `version` integer column on `sales_channels` increments by exactly 1 on every successful identity update. The PATCH endpoint requires the client's `expectedVersion` to match the row's current `version`, mismatch → HTTP 412 `STALE_SALES_CHANNEL_WRITE` with the current `version` in the error envelope so the client can refresh and retry.

Membership add / remove operations are idempotent by construction and do not bump the channel's `version`.

## Audit hooks

Every identity change, lifecycle change, and membership change writes one `audit_log_entries` row synchronously inside the same transaction. Action codes live in `@endora-commerce/contracts`:

```ts
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';

await auditLogService.record({
  action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
  // ...
});
```

Use the constants — never hardcode the strings — so a future enum / type rename ripples cleanly.

## Cache invalidation

`SalesChannelsCache` (process-local LRU + Redis) holds a `CachedChannel` per `code`. The cache is invalidated on every identity / lifecycle change via the existing `EventBus`:

- `sales_channels.identity_changed` → drops one entry by code.
- `sales_channels.lifecycle_changed` → drops one entry, or all entries when `invalidateAll: true` is set (used on hard delete).

Both drop the shared Redis entry first and the local one second, with the key marked for the whole operation so a concurrent read cannot re-pin the pre-change channel — and so a failed Redis drop leaves reads falling through to PostgreSQL rather than being served the value the invalidation was meant to remove. The `EventBus` is in-process, so a second instance converges through the local layer's 30 s window instead.

Membership lookups go through MikroORM directly (no cache layer); if you need them faster, add a Redis layer keyed by `(entityType, entityId)` with a short TTL — the hooks are already in place.

## Testing your channel-aware code

Use the existing `setupBackendServer()` test harness — it boots the full stack with a fresh `default` channel reconciled against the test seed (`en-US` / `PLN`). For raw-DB-level tests, use `setupTestDb()` and call `DefaultChannelReconciler.run()` yourself, optionally overriding the bootstrap defaults if your test seeds different language/currency codes.

The repo's existing precedent for channel-aware integration tests (transactional rollback, parameterised entity types, raw-SQL fixtures decoupled from owning-module entity classes) is in:

- `backend/test/integration/sales_channels/bidirectional-membership-every-bridge.test.ts` (T043) — table-driven over all 9 bridges.
- `backend/test/integration/sales_channels/at-least-one-channel-invariant.test.ts` (T022) — FR-008 enforcement.
- `backend/test/contract/sales_channels/admin-membership.contract.test.ts` (Phase 5b) — HTTP-side cover.
