---
title: Declared extension columns
description: How an installed module package adds its own columns to an extensible core table — declaration, generated DDL, ledger, accessor, admin reads, uninstall and drop.
sidebar_label: Declared extension columns
---

# Declared extension columns

An installed module package can add a few columns of its own **to a core table** — an ERP
code on an organization, say — without editing core, without a hand-written `alter table`, and
without losing them on the next platform upgrade. It declares them; the platform does the rest.

This is rung **D2** of the data ladder on
[The customisation ladder](./customisation-ladder.md). Try the lower rungs first: an operator
can add a runtime custom field without any code (D0), and a side table your module owns (D1)
needs nothing from the host at all. Reach for declared columns when the value belongs on the
host row — read with it, indexed with it, unique across it.

## What you may extend

The **extensible tables** are exactly the tables that carry custom fields — they are derived
from the custom-field host bindings, never listed a second time. In this release one is open:

| Table | Owning module |
| --- | --- |
| `organizations` | `organizations` |

The other eight custom-field hosts (`customer_accounts`, `orders`, `quote_requests`,
`products`, `categories`, `crm_opportunities`, `projects`, `tasks`) open in a later release. A
declaration on a table that is not open is refused when the platform discovers the package,
and the message lists the tables that are.

## The rules

- **Only an installed package declares.** A module package of the platform's own repository
  owns its tables or uses a side table, and a per-deployment overlay module ships no schema;
  the generator refuses both.
- **You must depend on the host.** The host's owning module must be in your manifest's
  `dependencies` closure, or the declaration is refused (`host-not-a-dependency`).
- **The columns are yours, and only yours.** Their physical names are
  `x_<moduleId>_<snake_case(key)>`; only your module's code writes them, through the accessor
  below, inside a Command or a command hook. The host keeps the table, its constraints and every
  column you did not declare.
- **Additive only.** A column is `text`, `varchar` (with `length`), `boolean`, `smallint`,
  `integer`, `bigint`, `numeric` (with `precision` and `scale`), `date`, `timestamptz`, `uuid` or
  `jsonb` (with a Zod `schema`). It is nullable, or NOT NULL with a constant `default`;
  `timestamptz` and `jsonb` are always nullable. `index: true` builds a btree index,
  `index: 'unique'` a unique partial index over the non-null values (nullable columns only).
  At most 32 columns per declaration; a physical name over 63 bytes is refused.
- **Changing a column is not offered.** Changing a key's type, nullability or default is refused
  (`non-additive-change`) — declare a new key instead. Removing a key marks its column
  orphaned; it is not dropped.
- **Not offered (yet):** list filters and sorting on extension columns, extension input on core
  HTTP write bodies, search, exports, PDFs, storefront responses and events. A declaration that
  asks for `filterable` or `sortable` is refused as `not-offered-yet`.

## The worked example

The package `acme_erp` adds three columns to `organizations`. Its sources are the platform's own
test fixture, type-checked on every run, so this page cannot drift from what compiles.

The declaration:

<!-- verbatim-from: backend/test/fixtures/installed-packages/mod-acme-erp/src/backend/columns.ts -->

```ts
export const acmeOrganizationColumns = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  adminReads: true,
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
    onboardedVia: { type: 'text', nullable: true },
  },
});
```

The package's `./backend` export lists it beside its entities:

<!-- verbatim-from: backend/test/fixtures/installed-packages/mod-acme-erp/src/backend/index.ts -->

```ts
export const schemaExtensions = [acmeOrganizationColumns];
export const entities = [];
```

Its manifest depends on the host: `dependencies: ['organizations']`.

After `pnpm install` and `migrate`, `organizations` carries `x_acme_erp_erp_code`,
`x_acme_erp_credit_tier` and `x_acme_erp_onboarded_via`, a unique partial index on the first,
and the platform's `schema_extensions` ledger records every element. The core `Organization`
entity, its responses and its audit entries are unchanged.

### Writing, from a Command

`extensionColumns(declaration, em)` returns `get(id)`, `load(ids)` and `set(id, patch)`. `set`
issues one UPDATE of the changed columns only, never inserts a row, refuses to run outside a
transaction, and returns the changed **keys** — never their values — for the audit entry:

<!-- verbatim-from: backend/test/fixtures/installed-packages/mod-acme-erp/src/backend/sync-erp-code.ts -->

```ts
export function syncErpCode(organizationId: string, erpCode: string): Command<void> {
  return {
    action: 'acme_erp.organization.sync',
    objectType: 'organization',
    objectId: organizationId,
    async run({ em }) {
      const { changedFields } = await extensionColumns(acmeOrganizationColumns, em).set(
        organizationId,
        columnExtensionPatchSchema(acmeOrganizationColumns).parse({ erpCode }),
      );
      // audit-state D-288: names, never values.
      return { result: undefined, after: { extensions: { acme_erp: { changedFields } } } };
    },
  };
}
```

`ColumnExtensionValues<typeof acmeOrganizationColumns>` is the inferred row type
(`{ erpCode: string | null; creditTier: number; onboardedVia: string | null }`), and
`columnExtensionSchema` / `columnExtensionPatchSchema` are the matching Zod schemas.

Every accessor method is gated on your module being present: while it is switched off, every
call throws `ModuleDisabledError` and the columns keep their values.

### Back-filling, from your own migration

The generated step runs at the head of your module's migration block, so your own migrations run
after it and may back-fill your columns — and only your columns:

<!-- verbatim-from: backend/test/fixtures/installed-packages/mod-acme-erp/src/migrations/20261201T090000_acme_erp_backfill_credit_tier.ts -->

```ts
export class Migration20261201T090000AcmeErpBackfillCreditTier extends Migration {
  override async up(): Promise<void> {
    this.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1 where "vat_status" = 'valid'`);
  }
}
```

### Reading, on the admin screens

With `adminReads: true` (the default is `false`), the organizations admin detail and list reads
accept `?extensions=acme_erp` and attach the values to each record:

```
GET /api/v1/admin/organizations/<id>?extensions=acme_erp
→ { "data": { …, "extensions": { "acme_erp": { "erpCode": "ERP-42", "creditTier": 0, "onboardedVia": null } } } }
```

A list of fifty organizations costs one extra query per named module, not one per row. A module
that is switched off, not installed or not exposing the host is simply absent from
`extensions`, without an error; without the parameter the response is unchanged. Your
package's admin zone on the organization detail screen is the place to show them — there is no
new UI slot.

## Migrating, upgrading and verifying

The platform turns your declarations into one generated migration step,
`Migration10000101T000000AcmeErpSchemaExtensions<hash12>`, which is pending exactly when the
declarations change. The step reconciles them with the ledger — adds what is missing, adopts a
matching column that already exists, re-attaches an orphaned one with an unchanged spec, and
refuses anything non-additive. `migrate up` and lifecycle `install` check every declared column
and index inside the migration transaction, so a run that loses one rolls back, and the backend
refuses to boot on drift, naming the module, the column, the table and the last executed
migration of the table's owner.

Core keeps its side of the bargain in CI: every core migration is applied in order to a fresh
database carrying sample extension columns on each open extensible table, and a migration that
loses one fails the build.

**Operator note.** Adding a nullable or constant-defaulted column is a catalog-only change in
PostgreSQL. Building an index takes a lock on the table for the length of the build, during
`migrate`; plan large tables accordingly.

## Uninstalling and dropping

```bash
pnpm --filter backend run module:schema-extensions list
pnpm --filter backend run module:uninstall acme_erp --hard                 # columns kept, ledger: orphaned
pnpm --filter backend run module:schema-extensions drop acme_erp           # prints the plan
pnpm --filter backend run module:schema-extensions drop acme_erp --confirm # drops, one audit entry
```

Uninstalling your module keeps its columns and their values; only an explicit, audited
`drop … --confirm` removes them, and only for elements that are orphaned and no longer
declared. Uninstalling the host while your module is installed is refused with
`dependents-block`.

## What a package migration may not do

Declaring is the only route onto a core table. Every migration an installed package ships runs
inside the platform's foreign-schema guard, which refuses — and rolls the `migrate` run back —
any statement that writes a table your module does not own: an `alter table "organizations"`,
an index on it, an `insert` into `orders`, and the same through `getEntityManager()`. Your own
tables, the platform's tables and the back-fill of your own `x_<moduleId>_*` columns on a host
you declare are allowed; the rules are on [Migrations](./migrations.md), under *The
foreign-schema guard*.

To see what a release would refuse before upgrading to it:

```bash
pnpm --filter backend run module:schema-extensions audit-packages
```

## Packaging

There are no instance-local packages yet: build your module, `pnpm pack` it and install the
tarball into the instance, as for any other module package.
