# Contract: `module:schema-extensions` gains `entity-extension` rows (FR-040 – FR-042)

The command is `packages/platform/src/lifecycle/commands/schema-extensions.ts`; its verbs, arguments
and exit codes are unchanged. Side tables are **derived** on each run (research R-8), never read from
or written to the `schema_extensions` ledger.

## 1. `list`

The human output gains a second section after the ledger rows:

```text
Entity extensions (side tables)
module      origin   host                         table                         constraint                               status
acme_erp    package  organizations.Organization   acme_erp_organization_links   acme_erp_organization_links_org_fk       verified
quote_requests core  organizations.Organization   quote_request_org_policies    quote_request_org_policies_organization_fk verified
quote_requests core  customer_accounts.CustomerAccount quote_request_account_policies quote_request_account_policies_customer_account_fk verified
-           -        orders.Order                 legacy_order_flags            legacy_order_flags_order_fk              unowned
```

`--json` adds a key beside `elements`:

```ts
entityExtensions: Array<{
  kind: 'entity-extension';
  moduleId: string | null;                 // null for `unowned`
  origin: 'core' | 'package' | 'overlay' | null;
  host: string;                            // 'organizations.Organization'
  hostTable: string;
  table: string;
  constraint: string | null;               // the FK constraint name, null when missing
  status: 'verified' | 'undeclared' | 'unowned' | `violation:${string}`; // e.g. 'violation:foreign-key-not-cascade'
}>
```

`--module <id>` filters both sections by module. Rows are ordered by host, then table. `list` never
fails on a violation (it reports), exits 0, and issues the R-5 catalog query once.

## 2. `audit-packages`

Gains one line per `extends` entry of each installed package, with the static verdict (E1 – E4 of
`entity-extension-declaration.md` §3) — `ok` or the rule — and no database access. Exit code 65 when
any entry is refused, as for a foreign-schema finding today.

## 3. `drop`

Unchanged and not applicable: a side table is dropped by its own module's `down()` on
`module:uninstall --hard`. `drop` with a module that has only side tables prints
`<module> has no orphaned schema-extension elements; side tables are dropped by uninstalling the module`.

## 4. i18n

The command's output is English CLI text, like every existing line of `module:schema-extensions`,
which carries no bundle key today; this feature adds none. Whether operator CLI output should be
translated is not decided by `specs/conventions/module-i18n.md` and is not decided here.
