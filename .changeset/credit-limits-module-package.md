---
'@endora-commerce/mod-credit-limits': minor
---

New package: the Credit Limits module, the fourth to leave `backend/src/modules/`
(feature 080, T040b) — and the first to publish a port interface.

Four subpaths, no root wildcard, every one of them compiled output (D-164):

- `@endora-commerce/mod-credit-limits` — the manifest. Isomorphic,
  `@endora-commerce/contracts` its only import, and where the generated manifest index reads
  the module's identity, its `dependencies` (`organizations`, `auth`, `orders`), its one
  setting and its activation control (`credit_limits.enabled`) from.
- `@endora-commerce/mod-credit-limits/backend` — `registerModule(ctx)` and the `entities`
  array the host's ORM registry spreads. **No entity class is exported by name** (D-168):
  `CreditLimit`, `CreditLimitReservation` and `CreditLimitReturnTopup` are imported to build
  that array and nothing else, so `import type { CreditLimitReservation } from
  '@endora-commerce/mod-credit-limits/backend'` does not compile in a consumer's tree,
  whoever the consumer is.
- `@endora-commerce/mod-credit-limits/migrations` — the `migrations` array the platform's
  package loader reads, plus the four migration classes by name for the host's migration
  registry.
- `@endora-commerce/mod-credit-limits/ports` — **the first real `./ports` subpath**
  (layout contract R8, D-169), publishing the interface `CreditLimitPort`. Type-only: the
  emitted module is `export {};`, which is what makes the subpath resolvable for a consumer
  whose toolchain does not elide the import, and what makes it *contract surface* under
  D-171. The implementation stays in the package's `src/backend/services/` and is reached
  through the container name `creditLimitService`, never through this subpath.

`@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are
`@endora-commerce/contracts`, `@mikro-orm/{core,migrations,postgresql}` and `fastify`. This
package takes no `zod` peer — it names no Zod type of its own, only schemas
`@endora-commerce/contracts` already exports.

The manifest id stays `credit_limits` — identity of record for the lifecycle registry, the
settings store, the `credit_limits:manage` permission code and the ownership of its four
migrations (D-142). The npm name is only how npm keeps names unique.

**What `./ports` is for, since this package is the first to answer it.** T050 shipped the
subpath and measured that nothing in the tree qualified for it yet: `quote_requests` publishes
two genuinely real ports and both are contract DTOs end to end, so both belong in
`@endora-commerce/contracts`. The qualifying test is not *"is this a real published port"* but
*"does this signature stop the interface living in `packages/contracts`"* — and
`CreditLimitPort.reserve` takes the caller's MikroORM `EntityManager`, which `admin` and
`storefront` both compile `contracts` and so cannot. The `EntityManager` is a **required
method parameter**, never an optional context field: the optional spelling lets a caller hand
a transaction to a handler that ignores it and receive a silently non-atomic write.

For a consumer that means one specifier and no other change:

```ts
import type { CreditLimitPort } from '@endora-commerce/mod-credit-limits/ports';

const creditLimit = lazyPort<CreditLimitPort>(ctx, 'creditLimitService');
await creditLimit.reserve({ organizationId, orderId, amount, currency, tx });
```

`reserve` holds a `PESSIMISTIC_WRITE` on the organization's credit row — or its owning
ancestor's — for the length of the caller's transaction, and
`credit_limit_reservations_order_fk` (`on delete restrict`) is what says so in the schema. A
foreign key needs the **table** and never the owner's class (D-169), so that constraint stands
across the package boundary untouched, exactly as `mod-blog`'s three cross-module ones do.
