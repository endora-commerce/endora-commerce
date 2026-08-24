---
'@endora-commerce/mod-promotions': minor
---

New package: the Promotions module, the fifth to leave `backend/src/modules/`
(feature 080, T040b) — and the second to publish a port interface.

Four subpaths, no root wildcard, every one of them compiled output (D-164):

- `@endora-commerce/mod-promotions` — the manifest. Isomorphic,
  `@endora-commerce/contracts` its only import, and where the generated manifest index reads
  the module's identity, its `dependencies` (`catalog`, `sales_channels`, `auth`,
  `currencies`, `dictionaries`, `orders`, `organizations`), its three permission codes, its
  two command-palette actions, its one setting and its activation control
  (`promotions.enabled`) from.
- `@endora-commerce/mod-promotions/backend` — `registerModule(ctx)` and the `entities` array
  the host's ORM registry spreads. **No entity class is exported by name** (D-168):
  `Promotion`, `PromotionRuleEntity`, `PromotionCoupon`, `CouponBatch`, `PromotionUsage` and
  `PromotionUsageCounter` are imported to build that array and nothing else, so
  `import type { PromotionUsage } from '@endora-commerce/mod-promotions/backend'` does not
  compile in a consumer's tree, whoever the consumer is.
- `@endora-commerce/mod-promotions/migrations` — the `migrations` array the platform's
  package loader reads, plus the three migration classes by name for the host's migration
  registry.
- `@endora-commerce/mod-promotions/ports` — the type-only port subpath (layout contract R8,
  D-169), publishing `PromotionUsageFinalizer` and the two shapes its signature names,
  `UsageContext` and `FinalizeAppliedPromotion`. The emitted module is `export {};`, which is
  what makes the subpath resolvable for a consumer whose toolchain does not elide the import,
  and what makes it *contract surface* under D-171. The implementation stays in the package's
  `src/backend/services/` and is reached through the container name `promotionUsageFinalizer`,
  never through this subpath.

`@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are
`@endora-commerce/contracts`, the three `@mikro-orm/*` packages and `fastify`: one copy of
`HttpError`, `GlobalEntity` and `effectiveState` in the host process, resolved by the
application rather than by this package.

## The port, and why it is on `./ports` rather than in `packages/contracts`

R8's test is not *"is this a real published port"* — `quote_requests` publishes two real ones
and both belong in `@endora-commerce/contracts`. The test is *"does this signature stop the
interface living in `packages/contracts`"* — and `PromotionUsageFinalizer.finalizeUsage`
takes the caller's MikroORM `EntityManager`, which `admin` and `storefront` both compile
`contracts` and so cannot. The `EntityManager` is the **first, required method parameter**,
never an optional context field: the optional spelling lets a caller hand a transaction to a
handler that ignores it and receive a silently non-atomic write.

For a consumer that means one specifier and no other change:

```ts
import type { PromotionUsageFinalizer } from '@endora-commerce/mod-promotions/ports';

const finalizer = lazyPort<PromotionUsageFinalizer>(ctx, 'promotionUsageFinalizer');
await finalizer.finalizeUsage(tx, { orderId, currency, ctx: usage, applied });
```

`finalizeUsage` bumps every scope counter with `update … where count < limit` on the caller's
own transaction, so two carts racing for a coupon's final use cannot both succeed (SC-005),
and a cap hit throws 409 so the placement rolls back with it.
`promotion_usages_order_fk` (`promotion_usages.order_id` -> `orders.id`, `on delete restrict`)
is what says so in the schema. A foreign key needs the **table** and never the owner's class
(D-169), so that constraint stands across the package boundary untouched, exactly as
`mod-credit-limits`' does.

The read half of the promotion seam is **not** here and does not move:
`PromotionApplyPort.applyToCart` takes a cart snapshot, names no ORM type, and stays published
by `@endora-commerce/contracts` under the same container name `carts` already resolves.
