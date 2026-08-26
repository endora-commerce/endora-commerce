---
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-inventory': minor
---

`customer_accounts` and `inventory` become workspace packages (feature 080,
T040b, batch six). Each ships `dist` and resolves through its own `exports`
map — the root for its manifest, `./backend` for `registerModule` plus the
`entities` array, `./migrations` for its migration classes, and, for
`inventory`, a type-only `./ports` — exactly as the fifty-nine packages before
them.

**`./backend` publishes the `entities` array and no entity class by name**
(D-168). A consumer that needs `CustomerAccount`, `CustomerGroup` or
`PasswordResetToken` as a runtime class takes it off that array by name:

```ts
import { entities } from '@endora-commerce/mod-customer-accounts/backend';
import { entityNamed } from '<host>/packages/package-entity-lookup.js';

const CustomerAccount = entityNamed<CustomerAccountRow>(
  entities,
  'CustomerAccount',
  '@endora-commerce/mod-customer-accounts/backend',
);
```

The `CustomerAccountsCradle` type moves with it and is named at
`@endora-commerce/mod-customer-accounts/backend`.

**This is the first package to declare another module package as a
devDependency.** `@endora-commerce/mod-organizations` is reached only by
`import type` at `@endora-commerce/mod-organizations/ports`, whose emitted
module exports no runtime binding, so the manifest generator renders it into
`devDependencies` at `workspace:*` and leaves `peerDependencies` alone (R4 as
narrowed for contract surface). Nothing of `organizations` appears in this
package's emitted `.js`; the implementation is still resolved at runtime through
the container name `personalOrganizationProvisionPort`, so the gate that answers
503 `MODULE_DISABLED` when `organizations` is switched off is the registration
and not a call anybody has to remember to write.

No exported symbol changed shape. What changed is where a consumer names it.

**`@endora-commerce/mod-inventory` publishes a `./ports` subpath.** It is
type-only: `tsc` emits `export {};`, and it is where a consumer names
`InventoryReservationApplyPort` instead of reaching into the owner's directory.

```ts
import type { InventoryReservationApplyPort } from '@endora-commerce/mod-inventory/ports';
```

**It also publishes two runtime bindings by name on `./backend`**, beside the
`entities` array: `WarehouseChannelReconciler` and `DEFAULT_WAREHOUSE_ID`. D-168
keeps entity classes off that door; a service and a constant are not entities,
and the development catalog seed must hold the *same* reconciler the platform
composed rather than a second copy evaluated from source (D-160.6.1) — the shape
`price_lists` already ships as `DefaultPriceListMigrator` / `DEFAULT_PRICE_LIST_ID`.

No exported symbol changed shape. What changed is where a consumer names it.
