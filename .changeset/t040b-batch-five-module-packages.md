---
'@endora-commerce/mod-admin-actions': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-megamenu': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-price-lists': minor
---

Six more modules become workspace packages (feature 080, T040b batch five):
`admin_actions`, `admin_roles`, `admin_users`, `megamenu`, `organizations` and
`price_lists`. Each ships `dist` and resolves through its own `exports` map — the
root for its manifest, `./backend` for `registerModule` plus the `entities`
array, `./migrations` for its migration classes where it owns any — exactly as
the fifty-three packages before them.

**`@endora-commerce/mod-organizations` publishes a `./ports` subpath.** It is
type-only: `tsc` emits `export {};`, and it is where a consumer names
`PersonalOrganizationProvisionApi` and `PersonalOrganizationProvisionInput`
instead of reaching into the owner's directory.

```ts
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
```

The implementation stays behind the container name
`personalOrganizationProvisionPort`, resolved with `lazyPort`, so the gate that
answers 503 `MODULE_DISABLED` when `organizations` is switched off is still the
registration and not a call anyone has to remember to write.

**Three packages publish a runtime binding by name, beside the `entities`
array.** D-168 keeps entity classes off `./backend`; these are not entities, and
each is exported because a host program must hold the *same* copy the platform
composed rather than a second one evaluated from source (D-160.6.1):

- `@endora-commerce/mod-admin-roles/backend` — `PermissionCatalogueService`,
  `listAssignablePermissionCodes`, and the inventory scanner
  (`ConstantResolver`, `defaultScanRoots`, `scanEnforcedPermissionCodes`,
  `scanEnforcedPermissionGates`). The acceptance instance probe and
  `check:action-route-permissions` read them.
- `@endora-commerce/mod-price-lists/backend` — `DefaultPriceListMigrator`,
  `DEFAULT_PRICE_LIST_ID` and `PriceListService`. The development catalog seed
  runs the migrator; a second copy would `em.create` a `PriceList` class the ORM
  never registered, which fails at the first insert rather than at load.

**Nothing about a module's behaviour changed.** No manifest `dependencies` array
moved, so the migration order is the same function of the same inputs: the
committed registry's `(moduleId, className)` declaration sequence and its
computed execution sequence are byte-identical to the merge base over all 164
entries.
