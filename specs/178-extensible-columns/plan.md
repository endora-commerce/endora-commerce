# Implementation Plan: Declared extension columns on core tables (S2)

**Branch**: `spec/178-extensible-columns` | **Date**: 2026-11-10 | **Spec**: `spec.md`

## Summary

An installed module package declares additive `x_<moduleId>_*` columns on a custom-field host table
with `defineColumnExtension`. The platform validates the declaration, synthesises one migration step
at the head of the declaring module's block that reconciles the declaration with a
`schema_extensions` ledger (additive DDL only), maps the columns through a private MikroORM
`EntitySchema` projection on the same table (core is blind to them), replaces MikroORM's
duplicate-table check with a ledger-aware `afterDiscovered` rule, verifies the physical schema inside
the migration transaction and at boot, and gives the module a typed, UPDATE-only accessor and opt-in
extension attributes on admin reads. Package migrations that write other modules' tables are refused
at run time (OD-17). Uninstall keeps the columns; an audited CLI command drops orphans.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17
**Primary Dependencies**: MikroORM 6.6.16 (`@mikro-orm/core`, `migrations`, `postgresql`), Zod 4,
umzug 3.8.2 (via MikroORM). **No new dependency.**
**Storage**: PostgreSQL ≥ 11 semantics relied on (catalog-only `add column … default`)
**Testing**: Vitest; platform unit tests co-located in `packages/platform/src/**`; DB tests in
`backend/test/integration/db/` and `backend/test/integration/organizations/`
**Constraints**: no change to core entity classes; boot verification ≤ 2 catalog queries
**Scale/Scope**: 9 host tables, 8 owning modules; ≤ 32 columns per declaration

## Constitution Check

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | PASS with amendment FR-090 | Column-granular ownership; host keeps table, constraints and undeclared columns; extension reaches core only via projection it owns; dependency required (V10) |
| II API-first | PASS | `ExtensionsQuerySchema`, `ExtensionAttributesSchema`, bindings in `packages/contracts` first |
| III TDD (NN) | PASS | `tasks.md` puts a failing test before each implementation task; FR → test map below |
| IV YAGNI | PASS | no dependency; deferred list FR-060–065 |
| V/VI/VIII | PASS | naming `x_<module>_<snake>`; English artefacts; PL only in docs translations |
| IX UI reuse | PASS | existing admin detail zones; no new component |
| X Queues | N/A | no long-running work |
| XI Tenancy (NN) | PASS | projection copies host classification + `org` filter on the schema (R-2); rule-scoped hosts attach only to already-authorised records; no "no-organization" path |
| XII Channels (NN) | N/A | no channel-scoped reads added |
| XIII Command Bus (NN) | PASS | accessor writes only inside a transaction; own Commands or 176 hooks; drop is a Command; ledger reconcile is migration (schema), not a domain write |
| XIV Custom fields | PASS with sentence FR-090 | S2 is developer schema, not operator runtime extension; custom fields stay rung 0 |
| XV Untouched core | PASS with amendment FR-090 | no core file edited by an instance; overlays still ship no schema |
| XVI Palette | N/A | no admin screen added (CLI only) |
| XVII Toggleable (NN) | PASS | accessor fails closed when off; attributes omitted; hooks skipped (176); columns inert and kept; off-state test |

## Project Structure

```text
specs/178-extensible-columns/
├── spec.md  research.md  plan.md  data-model.md  quickstart.md  tasks.md
└── contracts/
    ├── column-extension-declaration.md   ├── generated-ddl-and-ledger.md
    ├── orm-projection.md                 ├── extension-attributes.md
    ├── foreign-schema-guard.md           ├── command-hooks-dependency.md
    └── preservation-test.md
```

Source (new unless marked *edit*):

```text
packages/contracts/src/custom-fields.ts                 edit: CUSTOM_FIELD_HOST_BINDINGS
packages/contracts/src/schema-extensions.ts             ExtensionsQuerySchema, ExtensionAttributesSchema, ExtensibleHostTable
packages/contracts/src/organizations.ts (+8 hosts)      edit: optional `extensions` on admin records
packages/platform/src/kernel/schema-extensions/
  define.ts  types.ts  zod.ts  validate.ts  accessor.ts  reads.ts  extensible-hosts.ts  errors.ts
packages/platform/src/kernel/index.ts                   edit: exports
packages/platform/src/kernel/schema-extensions/schema-extension-element.entity.ts
packages/platform/src/migrations/<stamp>_core_schema_extensions_ledger.ts   (scaffolded)
packages/platform/src/migrations/foreign-write-exemptions.generated.ts      (generated)
packages/platform/src/db/schema-extension-projection.ts
packages/platform/src/db/table-mapping-rule.ts
packages/platform/src/db/schema-extension-migration.ts   synthetic entry + reconcile
packages/platform/src/db/schema-extension-verifier.ts
packages/platform/src/db/foreign-schema-guard.ts  sql-statement-targets.ts
packages/platform/src/db/mikro-orm.config.ts   configured-migrations.ts   migration-order.ts   migrate.ts   platform-schema.ts   edit
packages/platform/src/packages/package-runtime.ts      edit: read `schemaExtensions`
packages/platform/src/composition/compose-app.ts       edit: boot verifier, register `schemaExtensionReads`
packages/platform/src/lifecycle/services/orchestrator.ts  edit: install uses migrateUpVerified; host hard-uninstall marks rows dropped
packages/platform/src/lifecycle/commands/schema-extensions.ts
backend/src/lifecycle/scripts/schema-extensions.ts  + backend/package.json script `module:schema-extensions`
packages/modules/custom_fields/src/backend/services/host-storage-binding.ts  edit: read contracts
packages/modules/organizations/src/backend/routes.admin.ts                edit: ?extensions (Phase B)
(8 host route files)                                                     edit (Phase D)
backend/scripts/check-extensible-tables.ts  + inventory/estate rows
backend/scripts/generate-composer.ts (or its lib)    edit: render exemptions; refuse workspace schemaExtensions
backend/test/fixtures/installed-packages/mod-acme-erp/
backend/test/integration/db/schema-extension-*.test.ts
docs/docs/architecture/customisation-ladder.md, migrations.md (+ docs/i18n/pl/…)  edit
docs/docs/developers/schema-extensions.md (+ PL)   new developer page (path per module-documentation.md)
.specify/memory/constitution.md                    edit (FR-090)
specs/conventions/module-migrations.md, module-activation.md   edit (FR-092)
```

## Design decisions (full reasoning in research.md)

1. E2 projection, fields-limited, UPDATE-only, insert/delete refused — R-1.
2. Classification copied to registry **and** schema filters — R-2.
3. `afterDiscovered` table-mapping rule always paired with the check off — R-3.
4. Synthetic migration entry, stamp `10000101T000000`, hash-named, head of block — R-5.
5. Verifier inside the migration transaction; read-only at boot — R-6.
6. `schemaExtensions` code export on `./backend` — R-7.
7. Bindings move to contracts; extensible list derived — R-8.
8. Ownership structural, writes require a transaction — R-9.
9. Runtime foreign-write guard by class wrapping; static `check:extensible-tables` on MRs — R-10, R-11.

## Deviations from the brief (flagged)

- Generated DDL at the **head** of the declaring module's block, not after it (OD-178-1; accepted by
  the owner 2026-11-10, D-291).
- `index: 'unique'` is allowed on nullable columns only, as a partial index (unique + default would
  collide on every existing row).
- "Last core migration on that table" is reported as the last executed migration of the table's
  owning module (R-6).

## Phases (each mergeable; release rule below)

| Phase | Content | Depends on | Mergeable alone? |
| --- | --- | --- | --- |
| **A — mechanism** | declaration API, types, Zod; bindings in contracts; ledger; synthetic step + reconcile; projection + mapping rule; accessor; verifier (migrate + boot); orphan on `--hard`; drop CLI; fixture package; rollout constant `[]` (no host extensible yet) | — | yes, inert (no host rolled out) |
| **B — organizations** | rollout constant `['organizations']`; preservation test for it; `?extensions` on organizations admin reads; worked example end-to-end; off-state test; hook example (US3, only if 176 merged); constitution + ladder + migrations docs EN/PL; developer page | A; US3 also 176 | yes |
| **C — OD-17** | runtime foreign-schema guard; exemption artefact; parity test; `check:extensible-tables` | A | yes |
| **D — other 8 hosts** | rollout constant deleted; preservation over 9; `?extensions` on 8 hosts' admin reads | B | yes |

**Release rule**: B and C ship in the same release (OD-17: "the release that ships S2"). D ships in
a later release (OD-178-4, ruled by the owner 2026-11-10 as D-291: Phase D is out of this release).
A without B ships nothing user-visible.

**Owner rulings (D-291, 2026-11-10)**: every Open decision of `spec.md` was accepted as the architect
recommended — OD-178-1 head, OD-178-3 flush-time guard (Phase C), OD-178-4 Phase D in a later
release, OD-178-5 `adminReads` opt-in (default `false`), OD-178-6 HTTP `extensions` deferred; OD-29
uninstall keeps columns (orphaned) plus the audited drop command. See `spec.md` § *Decisions*.

## Test plan (FR → test)

| FR | Test (fails first) |
| --- | --- |
| 001–002 | `packages/platform/src/kernel/schema-extensions/define.test.ts` (type tests with `expectTypeOf`, Zod round trips) |
| 003–008 | `validate.test.ts` one case per rule V1–V12; `packages/platform/src/packages/package-runtime-schema-extensions.test.ts` (export shapes); composer refusal test in `backend/test/unit/scripts/` |
| 010–012 | `backend/test/unit/custom_fields/host-bindings.test.ts`; `extensible-hosts.test.ts`; FR-012 reconciliation in `check:extensible-tables` companion |
| 020–024 | `migration-order.test.ts` additions (head placement, reserved stamp); `backend/test/integration/db/schema-extension-reconcile.test.ts` (fresh, re-run idempotent, add key, remove key → orphaned, re-add, non-additive refused, adopt/mismatch) |
| 025–027 | `schema-extension-verifier.test.ts` (integration: drop column by hand → boot fails; in-run loss → rollback; query count) |
| 030–034 | `schema-extension-projection.test.ts`, `table-mapping-rule.test.ts` (unit, `connect: false`, ports the spike); `accessor.test.ts` integration (UPDATE SQL shape via query logger, no INSERT, delete refused, outside-tx refused, off → ModuleDisabledError, org filter); FR-034 lifecycle test |
| 040–042 | `backend/test/integration/organizations/schema-extension-hook.test.ts` (needs 176): custom hook, `columnExtensionHook` valid/invalid input, rollback on throw, off module skipped, names-only audit |
| 050–053 | contract tests per host: byte-identical without param, `extensions` with param, one extra query, off/absent omitted |
| 060–065 | `validate.test.ts` `not-offered-yet`; overlay refusal test |
| 070–072 | `foreign-schema-guard.test.ts` (unit, fake migrations), integration with fixture rogue package, parity test, check companion with red proofs |
| 080–082 | `schema-extension-preservation.test.ts`; `schema-extensions-cli.test.ts` (plan, confirm, still-declared, not-orphaned, audit entry); `dependents-block` test with fixture |
| 090–093 | `backend/test/unit/docs/` existing doc checks (`check:docs-translations`, `check:module-docs`); constitution version line asserted by existing governance test if any, else reviewed |
| SC-002 | `backend/test/integration/organizations/schema-extension-off-state.test.ts` |

## Generated artefacts, changesets, documentation

- `composer:generate`: renders `foreign-write-exemptions.generated.ts` (Phase C); commit it.
- New core migration → `composer:generate` registers it in `migrations-registry.generated.ts`; platform
  `PLATFORM_MIGRATION_ENTRIES` gets the class.
- `manifests:generate` + `pnpm install --lockfile-only` if any package `package.json` changes (none
  expected; run anyway as the AGENTS trap says).
- Changesets (`minor`): `@endora-commerce/platform` (new API; OD-17 refusal — breaking note: "a package
  migration writing another module's table now fails `migrate`"), `@endora-commerce/contracts`
  (bindings, schemas, optional `extensions`), `mod-custom-fields`, `mod-organizations` (B), the eight
  host modules (D), `@endora-commerce/cli` (estate entry).
- Docs: ladder + migrations (EN + PL), developer page (EN + PL), module pages of the 9 hosts get one
  line "accepts `?extensions=`" (EN + PL).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| No new runtime dependency | — | — |
| Second classifier of SQL write targets (platform, regex) beside `cli/sql-tables.ts` | platform has no `typescript` at run time and must judge installed packages | depending on `typescript` at runtime (≈ 23 MB) or skipping the instance side; held equal by the parity test |
| Synthetic migration entries | ordering, revert and history for generated DDL for free | segmented `up({to})` in every migrator caller |

## Risks

1. **Spec 176 is a draft**: reconciled against its contracts on 2026-11-10 (`noteAuditChanges`,
   `ctx.commandHooks`, `command.extensions`); only US3/FR-042 wait for it; re-reconcile at T046.
2. **Index builds lock large hosts** (`orders`, `products`) during `migrate`; documented; no
   `concurrently` in v1.
3. **`getEntityManager()` writes in package migrations** bypass the statement guard unless the
   flush wrapper (OD-178-3, ruled D-291) works; covered by a dedicated test before C merges.
4. **Existing paid/client packages doing foreign DDL** would fail `migrate` after upgrade (the
   working doc's open question). Mitigation: Phase C ships a dry-run report
   (`module:schema-extensions audit-packages`) usable on the previous release before upgrade; the
   release note names it.
5. **SchemaGenerator users** registering projections (R-4): unit test on test-kit.
6. **`catalog` rebuilds of `products` generated columns** are additive-safe today; the preservation
   test is the guard.
7. **Constitution version collision** with 176/177 amendments: whichever merges second re-bumps.
8. **Instance authoring friction**: no instance-local packages yet (OD-12); `pnpm pack` workflow
   documented.

## Handoff summary for `endora-commerce-dev`

Build in phase order A → (B ∥ C) → D, TDD per `tasks.md`. Start with the unit spike port
(`table-mapping-rule.test.ts`, `schema-extension-projection.test.ts`) — the spike code is preserved
outside the tree only as a description in research R-1/R-2/R-5/R-10. Do not edit any core entity
class. Read `contracts/command-hooks-dependency.md` against 176's published contracts before US3.
B and C must land in one release. Run `composer:generate` after adding the ledger migration and
after Phase C's artefact. Grep `backend/test/**` for every moved symbol (`hostStorageBinding`).
