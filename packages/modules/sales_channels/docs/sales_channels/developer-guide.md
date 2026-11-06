---
title: Developer guide
sidebar_position: 3
---

# Developer guide — Sales channels

How a backend module integrates with the Sales Channels module: scoping queries by the resolved channel, managing memberships, and reading channel context from request handlers.

## Reading the resolved channel inside a route

The resolver middleware resolves the sales channel of every request under `/api/v1/*` and stores it (a `CachedChannel` view of the row) on the request's platform scope, not on the request object. Read it with the helpers the platform kernel publishes:

```ts
import { getResolvedChannel } from '@endora-commerce/platform/kernel';

app.get('/api/v1/storefront/products', async () => {
  const channel = getResolvedChannel();
  return productService.list({ salesChannelId: channel.id });
});
```

`getResolvedChannel()` throws (`500`) when the resolver did not run on the path; `currentSalesChannel()`, from the same barrel, returns `null` instead. Neither needs the `FastifyRequest`, so a service deep in the call chain can read the channel without having it threaded through. (`getResolvedChannel` still accepts a request argument for older call sites and ignores it.)

Outside the request lifecycle (background jobs, CLI scripts), resolve the `salesChannelResolutionPort` from the container and call `getByCode(code)` or `getSystemDefault()`; type it with `SalesChannelResolutionPort` from `@endora-commerce/platform/kernel`. The `SalesChannelResolverService` class behind it is not published.

## Channel access: routes that must stay open

Every non-admin `/api/v1/*` request is checked against the channel-access rule after its channel is resolved: an anonymous request is accepted only on a channel open to anonymous visitors (`403 SALES_CHANNEL_SIGN_IN_REQUIRED` otherwise), a customer request only on a channel assigned to the customer's Organization (`403 SALES_CHANNEL_NOT_PERMITTED` otherwise). Administrator and API-key requests are not checked. A route of yours is therefore refused on a closed store unless it says otherwise.

A route whose caller is not a shopper of the store — or has to reach it to become one — declares that on the route:

```ts
app.post(
  '/api/v1/payments/acme/notify',
  { config: { salesChannelAccess: 'open' } },
  async (request, reply) => {
    // Still resolved to a channel, and still behind this route's own guards.
  },
);
```

**Declare it on every provider callback your module receives** — a payment gateway's notification, a carrier's status webhook, a return URL a provider redirects a browser to. Those requests arrive without a session and usually without a storefront channel, so they are anonymous requests on the system-default channel: the moment an operator closes that channel to anonymous visitors, an undeclared callback is refused with `403` and the provider's notifications stop arriving. The same applies to links in e-mails that must work for someone who is not signed in (confirmation, unsubscribe) and to anything a sign-in or registration form needs before the visitor has an account.

Do not declare it on anything that shows or changes a store's catalogue, prices, basket or orders: those are exactly what the rule protects. Individual (B2C) self-registration is deliberately *not* open, because it signs the visitor in at once.

`'open'` skips the access step only. The request is still resolved to a channel (an unknown or inactive channel is still refused), and the route's own guards — `requireCustomer`, `requireAdmin`, a signature check — still run. In this repository the set of open routes is held by `backend/test/contract/sales_channels/channel-access-open-routes.test.ts` against the ledger `backend/test/helpers/channel-access-open-routes.ts`, which gives a reason for each route; adding an open route means adding its ledger entry.

### Checking the rule yourself

A path that creates a customer session outside the shared sign-in routes must refuse before it creates one. Resolve the `salesChannelAccessPort` from the container, typed with `SalesChannelAccessPort` from `@endora-commerce/platform/kernel`:

```ts
const { salesChannelAccessPort } = ctx.cradle<YourCradle>();

// Throws the 403 SALES_CHANNEL_NOT_PERMITTED refusal, with details.channelCode.
await salesChannelAccessPort.assertCustomerMayUse(account.organizationId, channel.id);

// Or read the decision, or the channels an Organization may use (cached).
const decision = await salesChannelAccessPort.decide(actor, channel);
const permitted = await salesChannelAccessPort.permittedChannelIds(organizationId);
```

The port is provided by the kernel; it needs no manifest dependency.

### Where assignments live

The assignment is the channel's `organization` membership — the `sales_channel_organizations` bridge — written only through `salesChannelMembershipPort`, which also drops the access cache for the Organization before it reports the change. The per-customer record (`sales_channel_customer_accounts`) takes no part in access: it stays registered as a bridge and is neither read nor written by the rule. Grant access by assigning the customer's Organization, never by writing a per-customer row.

## Adding a channel-scoped entity to your module

Channel scoping has two layers:

1. **Schema** — the entity gains a many-to-many relationship to `sales_channels` via a new bridge table `sales_channel_<entity>` (composite primary key on both ids, `ON DELETE CASCADE` on both sides). Add the table in your module's next migration.
2. **Service** — every read path of the entity that should be filtered by channel takes a `salesChannelId` parameter and joins through the bridge table. Every create / update path that lands a new entity calls `bindToDefaultIfEmpty(entityType, entity.id)` on the `salesChannelMembershipPort` after `persistAndFlush` so newly-created entities default to the system-default channel.

Then add the member to the contract's `ChannelMemberEntityTypeSchema` enum, and **declare the bridge from your own module**: export the `{ entityType, table, entityIdColumn }` triple from `src/backend/index.ts` and register it from a boot hook —

```ts
ctx.onBoot(() => {
  const { salesChannelBridgeRegistry } = ctx.cradle<YourCradle>();
  for (const bridge of salesChannelBridges) salesChannelBridgeRegistry.register(bridge);
});
```

The bidirectional admin routes then pick it up automatically — no per-module routes needed. The platform deliberately holds no map of the bridges: it used to, total over the enum, which meant a membership call for a member whose module an instance never installed ran SQL against a relation that is not there. A member no module registered now refuses with `503 MODULE_DISABLED` before the database is reached, and the enum stays the published *vocabulary* while the registry decides which members are live.

## Mutating memberships

`SalesChannelMembershipService` is the single mutator for every bridge table. A module reaches it as the `salesChannelMembershipPort` container entry, typed with `SalesChannelMembershipPort` from `@endora-commerce/platform/kernel`; the class itself is not published. Direct INSERT / DELETE on `sales_channel_*` from anywhere else is forbidden, and `check:module-boundary` is what enforces it: it resolves every `sales_channel_*` table to its owner from the DDL and reports a module that writes one in raw SQL.

```ts
const result = await membershipService.addToChannel(channelId, 'product', productId);
// result.changed is false on idempotent re-add.

const removed = await membershipService.removeFromChannel(channelId, 'product', productId, {
  fallbackToDefault: true,
});
// throws ENTITY_WOULD_HAVE_ZERO_CHANNELS if it would orphan the entity AND fallbackToDefault is false.
```

## The Default channel guarantee

The `DefaultChannelReconciler` runs at every backend boot, from the platform's composition (`packages/platform/src/composition/compose-app.ts`), and therefore also in the integration-test server. Three branches:

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

## Storefront URLs and the language prefix {#storefront-urls}

Every storefront page URL carries the language as its first segment. Never compose one by
hand — the derivation lives in `@endora-commerce/contracts`:

- `channelUrlLanguages(channel)` / `channelUrlLanguageAliases(channel)` — the derived
  prefix of every channel language (and split aliases). `channel` is any
  `ChannelUrlFacts` (`languages`, `defaultLanguage`, `prefixDefaultLanguage`); the cached
  channel (`getResolvedChannel()`, `SalesChannelResolutionPort`) satisfies it.
- `storefrontPagePath({ path, languageCode, channel })` — a logical path (`/c/tools`,
  `/verify?token=…`) under the language's prefix; throws on a language the channel lacks.
- `storefrontPagePathFor({ path, channel, requestedLanguage })` — for messages: the
  requested language when the channel serves it, else the channel default; the logical
  path when no channel is known. **Every e-mail, redirect or feed that links a storefront
  page goes through this or `productPath`.**
- `productPath({ key, languageCode, channel })` — a product page. It used to take
  `channelDefaultLanguage` and append `?lang=`; it now takes `channel` and never appends
  `?lang=`. `productDefaultPath(key)` is the unprefixed `x-default` target.

`GET /api/v1/storefront/sales-channel` answers `prefixDefaultLanguage`, `urlLanguages` and
`urlLanguageAliases`, so a headless storefront never re-derives them. The admin channel
shapes carry `prefixDefaultLanguage`; it is written by the audited identity Command.

## Testing your channel-aware code

Use the existing `setupBackendServer()` test harness — it boots the full stack with a fresh `default` channel reconciled against the test seed (`en-US` / `PLN`). For raw-DB-level tests, use `setupTestDb()` and call `DefaultChannelReconciler.run()` yourself, optionally overriding the bootstrap defaults if your test seeds different language/currency codes.

The repo's existing precedent for channel-aware integration tests (transactional rollback, parameterised entity types, raw-SQL fixtures decoupled from owning-module entity classes) is in:

- `backend/test/integration/sales_channels/bidirectional-membership-every-bridge.test.ts` — table-driven over all 9 bridges.
- `backend/test/integration/sales_channels/at-least-one-channel-invariant.test.ts` — enforcement of the at-least-one-channel invariant.
- `backend/test/contract/sales_channels/admin-membership.contract.test.ts` — HTTP-side cover.
