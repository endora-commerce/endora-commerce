# Implementation Plan: Side-table entity extensions as a platform mechanism (D1)

**Branch**: `spec/187-side-table-extensions` | **Date**: 2026-11-23 | **Spec**: `spec.md`
**Ruling**: D-294 (owner rulings OR-1 – OR-10 of 2026-11-23; architect rulings research R-1 – R-16; R-17 records OR-10)

## Summary

A module declares, in its manifest, `extends: [{ entity: '<owner>.<Entity>', table: '<own table>' }]`
for a table it owns whose single-column primary key is a cascading foreign key to an extensible
host's primary key. The platform checks the declaration statically (host extensible, owner a
dependency), against discovered MikroORM 7 metadata (table owned, single `uuid` key, host-following
tenancy), and against the catalog in one query (foreign key equals the key, references the host key,
cascades) — inside the `migrate` transaction and at boot, beside the D2 verifier. Undeclared side
tables are reported (warn in 0.113.0, refuse from the release after). `module:schema-extensions`
lists side tables as `entity-extension` rows. A declaring module may register one bulk loader per host;
the nine aggregate read ports accept `include: ['extensions.<moduleId>']` and attach the loader's
values through the kernel service `entityExtensionReads` — one call per read, skipped when the
module is absent, `422` when nothing in the build provides the key. Writes stay with the module's own
Commands and spec 176 `beforeCommit` hooks. No core entity, core migration or new dependency.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17
**Primary Dependencies**: MikroORM **7.2.11** after #1866 (`@mikro-orm/core`, `postgresql`,
`migrations`, `@mikro-orm/decorators/legacy`), Zod 4. **No new dependency.**
**Storage**: PostgreSQL catalogs (`pg_constraint`, `pg_class`, `pg_namespace`); no new table
**Testing**: Vitest; platform unit tests co-located under `packages/platform/src/**`; database tests in
`backend/test/integration/db/`; port contract tests in `backend/test/contract/<host module>/`
**Target Platform**: the backend and every instance (installed packages, overlays)
**Project Type**: platform mechanism in a pnpm monorepo
**Performance Goals**: one catalog query per verification; one SQL statement per included module per
port call (SC-003, SC-004)
**Constraints**: no change to core entity classes or core migrations (OR-4); origin-agnostic rules
(OR-5); written against MikroORM 7 (OR-6); entity freeze of #1866 respected (nothing here merges
before it)
**Scale/Scope**: 9 hosts, ≤ 16 declarations per module, ≤ 8 includes per read

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS, with the two amendments of FR-071.*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | PASS + amendment | The side table is the declaring module's own table, entity and migrations; it reaches the host only by a foreign key and through the host's published port; the host never learns its extenders (loader registry is the platform's). Amendment: side tables on extensible hosts are declared and verified (FR-071) |
| II API-first | PASS | `EntityExtensionDeclarationSchema`, `EntityExtensionIncludeSchema`, `EntityExtensionReadOptions`, `WithEntityExtensions`, the error code and the binding field land in `packages/contracts` first (Phase A/B1 first tasks) |
| III TDD (NN) | PASS | every implementation task in `tasks.md` is preceded by its failing test; FR → test map below |
| IV YAGNI | PASS | no dependency; no ledger rows (R-8); no write API (R-13); no generated DDL (FR-082); admin HTTP deferred (FR-080, owner ruling OR-10; cost of the alternative in R-17) |
| V / VI / VIII | PASS | naming per `check:naming`; English artefacts; Polish only in docs twins and the one error string |
| IX UI reuse | N/A | no UI in this feature (the reference module's admin zone is spec 190's) |
| X Queues | N/A | no long-running work |
| XI Tenancy (NN) | PASS + amendment | host-following classifications (R-6, M5) refused otherwise at boot and `migrate`; loader receives only host-authorised ids under the caller's context (R-12); no "no-organization" path. Owner confirmed the derived form (OR-9, OQ-187-1 = A) |
| XII Channels (NN) | N/A | no channel-scoped read added; a channel-scoped host read port keeps its own scoping and the loader sees only what it returns |
| XIII Command Bus (NN) | PASS | no platform write path; writes are the module's Commands or 176 hooks with names-only audit notes (FR-060) |
| XIV Custom fields | PASS | D1 is developer schema, not operator runtime extension; the guide states when custom fields (D0) are the answer |
| XV Untouched core | PASS | no core file edited by an instance; overlays declare on the same terms once spec 190 lets them own schema (OR-5, OR-7); XV's schema sentence is spec 190's to amend |
| XVI Palette | N/A | no admin screen (CLI only) |
| XVII Toggleable (NN) | PASS | absent module: loader skipped (key absent), hooks skipped, rows kept; 422 depends on the build only, never on either presence axis (R-10); off-state test (T049) |

## Project Structure

### Documentation (this feature)

```text
specs/187-side-table-extensions/
├── spec.md  plan.md  research.md  data-model.md  tasks.md
├── checklists/requirements.md
└── contracts/
    ├── entity-extension-declaration.md
    ├── verification-rules.md
    ├── extension-attributes-read-ports.md
    └── schema-extensions-cli.md
```

No `quickstart.md`: the worked example is the reference overlay module of #1856, owned by
`specs/190-overlay-full-modules/`; a second example here would be the duplicate the brief rules out.

### Source code (new unless marked *edit*)

```text
packages/contracts/src/modules.ts                          edit: EntityExtensionDeclarationSchema, `extends`
packages/contracts/src/custom-fields.ts                    edit: `entityClassName` on each binding
packages/contracts/src/entity-extensions.ts                include schema, read options, WithEntityExtensions
packages/contracts/src/errors.ts                           edit: ENTITY_EXTENSION_UNCLAIMED
packages/contracts/src/{organizations,customer-accounts,orders,quote-requests,catalog,crm,projects,tasks}.ts
                                                           edit (B1/B2): `options?` on record-returning read methods
packages/platform/src/kernel/schema-extensions/extensible-hosts.ts   edit: ENTITY_EXTENSION_HOSTS
packages/platform/src/kernel/entity-extensions/
  errors.ts  declarations.ts  registry.ts  loaders.ts  reads.ts  index.ts
packages/platform/src/kernel/module-context.ts             edit: entityExtensionLoaders sink
packages/platform/src/kernel/index.ts                      edit: published names (loader entry type, errors)
packages/platform/src/lifecycle/manifest-registry.ts       edit: E2–E4 over the composition
packages/platform/src/lifecycle/commands/schema-extensions.ts   edit: entity-extension rows, audit-packages lines
packages/platform/src/db/entity-extension-metadata.ts      M1–M5 in afterDiscovered
packages/platform/src/db/entity-extension-verifier.ts      P1–P4, U1–U2, policy constant
packages/platform/src/db/mikro-orm.config.ts               edit: `entityExtensions` input, afterDiscovered chain
packages/platform/src/db/migrate.ts                        edit: verifier inside migrateUpVerified
packages/platform/src/composition/compose-app.ts           edit: boot verifier; register entityExtensionReads
backend/src/db/…                                           edit: binding supplies resolved declarations
packages/modules/quote_requests/src/manifest.ts            edit: `extends` for its two side tables
packages/modules/<9 host modules>/src/backend/…            edit (B1/B2): ports call entityExtensionReads.attach
packages/modules/_i18n/i18n/{en,pl}.json                   edit: errors.ENTITY_EXTENSION_UNCLAIMED
backend/test/fixtures/installed-packages/mod-acme-links/   test fixture (package origin)
backend/test/integration/db/entity-extension-*.test.ts     database tests
backend/test/integration/db/schema-extension-preservation.test.ts   edit: sample side tables (FR-070)
specs/conventions/module-migrations.md                     edit: item 4b
.specify/memory/constitution.md                            edit: I and XI sentences, MINOR bump
docs/docs/architecture/side-table-extensions.md (+ docs/i18n/pl/…)   new published guide
docs/docs/architecture/{customisation-ladder,schema-extensions,migrations}.md (+ PL)   edit
docs/sidebars.js                                           edit: the new page beside schema-extensions
```

**Structure Decision**: Extend the D2 machinery's homes rather than add a module — the declaration
is manifest schema (`contracts`), the checks sit beside D2's verifier in `platform/src/db/`, the
loader registry beside the command-hook registry in `platform/src/kernel/`. The platform owns the
mechanism because it spans every module and origin; no domain module owns "extension of another
module's aggregate" (Principle I's "justify a new module by domain ownership" — there is none).

## Design decisions (full reasoning in research.md)

1. Manifest declaration, `<owner>.<Entity>` host reference, bindings gain the class name — R-1, R-2.
2. All nine hosts open for declarations at once; read ports land host by host — R-3, FR-058.
3. Metadata from v7 discovered metadata in `afterDiscovered`, never decorators — R-4.
4. One catalog query; in the migrate transaction and at boot, beside D2 — R-5.
5. Host-following tenancy; no copied tenant key — R-6 (OR-9).
6. Undeclared: physical detection; owned → warn then refuse; unowned → warn — R-7.
7. No ledger rows; list rows derived — R-8.
8. One loader per (module, host) through the module context; `extensions.<moduleId>` — R-9.
9. 422 from the build, absent from presence — R-10.
10. Optional trailing `options` on record-returning read methods — R-11; loader on authorised ids and
    the port's `em` — R-12.
11. No write API — R-13. Rule home: `module-migrations.md` item 4b — R-14.

## Phases and release rule

| Phase | Content | Depends on | Mergeable alone? |
| --- | --- | --- | --- |
| **0 — prerequisites** | #1866 merged (v7); T001 confirms `afterDiscovered` and raw `execute` in 7.2.11 inside the #1862 spike | #1866 | — |
| **A — declaration and checks (#1834)** | contracts schema + binding field; static rules; metadata rules; physical verifier at migrate and boot; undeclared at `warn`; `quote_requests` declares; CLI rows; preservation sample tables; package fixture | 0 | yes |
| **B1 — read-side mechanism + `organizations` (#1835)** | contracts include types + error code; loader sink; `entityExtensionReads`; `OrganizationDetailsPort` gains `options`; off-state test | A | yes |
| **B2 — the other eight hosts (#1835)** | one task per host port, each after `specs/186-aggregate-ports/`' task for that aggregate | B1, 186 per host | yes, per host |
| **C — convention, guide, constitution (#1836)** | `module-migrations.md` 4b; published page EN + PL citing #1856's sources; ladder, schema-extensions, migrations pages; constitution I + XI | A, B1, #1856 (spec 190) | yes |
| **D — refusal (OR-8)** | `ENTITY_EXTENSION_UNDECLARED_POLICY = 'refuse'` + test + changeset | A released once | yes |

**Release rule**: A and B1 ship in **0.113.0**, after #1866 — #1856 (spec 190) needs both. B2 rows ship
with their aggregate's port release. C closes when #1856 merges (it may be the release after if #1856
is). D ships in the release after the one that carried A, never the same one.

## Coordination with the sibling specs

| Sibling | What crosses | Rule |
| --- | --- | --- |
| `specs/186-aggregate-ports/` (D-293) | the nine aggregates' ports | 186 owns port surfaces; 187 adds only `options?` to record-returning read methods; if 186 reshapes a read port, 187's row moves to it (`contracts/extension-attributes-read-ports.md` §4). `CustomerAccountReadPort` and `CatalogProductReadPort` have no by-id record method; 187 does not add one |
| `specs/190-overlay-full-modules/` (D-297) | overlay schema (#1850), overlay `x_*` (#1853), reference overlay (#1856), constitution XV | 187's rules are origin-agnostic and need nothing from 190 to merge; the overlay integration leg (T022) and the guide (C) wait for #1850 / #1856. 190 owns XV; 187 amends I and XI; the second to merge re-bases its version bump (178 R-A3) |
| `specs/176-command-hooks-outbox/` (merged) | `beforeCommit`, `noteAuditChanges`, `ORGANIZATION_HOOKABLE_ACTIONS.create` | consumed unchanged |
| `specs/178-extensible-columns/` (merged) | `afterDiscovered`, verifier, `module:schema-extensions`, preservation test | extended beside, never altered in meaning |
| `specs/188-policy-points/`, `specs/189-command-middleware/`, `specs/191-membership-join-requests/` | none technical | — |

## Test plan (FR → test; each fails first)

| FR | Test |
| --- | --- |
| 001, 005 | `packages/contracts/src/modules.test.ts` cases for `extends` (shape, max, duplicate table); `packages/platform/src/kernel/entity-extensions/declarations.test.ts` origin equivalence |
| 002 – 004 | `declarations.test.ts` E2 – E4 with synthetic manifests; M0 in `entity-extension-metadata.test.ts` and over the real composition in `entity-extension-core-composition.test.ts` |
| 010 – 013 | `packages/platform/src/db/entity-extension-metadata.test.ts` (ORM `connect: false`, one case per M-rule and per row of the tenancy table, including `QuoteRequestOrgPolicy` and `QuoteRequestAccountPolicy` shapes) |
| 020 – 023 | `backend/test/integration/db/entity-extension-verifier.test.ts`: each P-rule at migrate (rollback asserted) and boot; query count = 1 |
| 030 – 032 | same file: U1 under both policies, U2 warn-only; `entity-extension-core-composition.test.ts` asserts zero findings for this repository; `entity-extension-verifier.test.ts` asserts the policy value |
| 040 – 042 | `packages/platform/src/lifecycle/commands/schema-extensions.test.ts` (rows, `--json`, `--module`, ledger untouched); `audit-packages` case over the fixture |
| 050 – 057 | `packages/platform/src/kernel/entity-extensions/reads.test.ts` (unit: no include, dedupe, > 8, unclaimed 422 before loaders, absent skip, null fill, dropped extra ids, schema failure 500, sequential single call); `loaders.test.ts` (L1 – L3) |
| 058 | `backend/test/contract/organizations/organization-details-port-extensions.test.ts` (B1), one per host in B2: byte-identical without include, one statement for 50 records |
| 060 – 062 | `backend/test/integration/organizations/entity-extension-off-state.test.ts` (hook skipped, rows kept, responses and audit byte-identical on / off / absent, restore); cascade on hard delete; `dependents-block` |
| 070 | `schema-extension-preservation.test.ts` sample side tables |
| 071 – 072 | `check:doc-snippets` (verbatim-from), `check:docs-translations`, `agents-router.test.ts` unchanged, constitution version line reviewed |

## Generated artefacts, changesets, documentation

- `composer:generate`: only if the fixture or a module adds an entity (`mod-acme-links` is an
  installed-package fixture and contributes nothing to committed registries). `manifests:generate` +
  `pnpm install --lockfile-only` after `quote_requests`' manifest edit (the `endora` block is rendered
  from the manifest), run anyway per the AGENTS trap.
- Changesets: `@endora-commerce/contracts` `minor` (manifest field, binding field, include types,
  error code, optional read-port parameters); `@endora-commerce/platform` `minor` (mechanism; note:
  "an undeclared side table is a warning in this release and refused in the next"); `mod-quote-requests`
  `patch` (declarations); each host module `minor` in its B-phase; Phase D `minor` on platform with the
  refusal note.
- Docs: published guide + ladder + schema-extensions + migrations (EN + PL); convention item 4b;
  constitution I and XI.
- **Not run**: `.specify/scripts/bash/update-agent-context.sh` — five sibling specs are being written in
  parallel and the script rewrites `AGENTS.md`'s appendix; there is no new dependency to record anyway.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| No new runtime dependency | — | — |
| A second `afterDiscovered` rule beside D2's | metadata facts exist only after discovery under v7 | reading decorators is removed in v7 (R-4) |
| A policy constant flipped one release later | OR-8 (warn, then refuse) | refusing now breaks existing instances on upgrade |

## Risks

1. **MikroORM 7 hook surface** — if `afterDiscovered` changed in 7.2.11, the metadata rules move to a
   post-init check on `orm.getMetadata()` before the first query (same facts, one call site per init
   path). T001 decides before Phase A starts.
2. **Undeclared findings in client instances** — instances with hand-made side tables get a warning in
   0.113.0 and a refusal in the next. Mitigation: `module:schema-extensions list` shows them; the release
   note names the one-line fix; `unowned` residue is never refused.
3. **Owner rulings settled** — tenancy is OR-9, and admin HTTP reads are deferred by OR-10. The
   default-on tenancy filter (B) is a possible follow-up, and it would land inside `tenancy/` only after
   #1866's rewrite of that directory. Admin `?extensions=` for side tables is a later non-breaking
   extension, and R-17 records its cost.
4. **186 reshaping read ports** — B2 rows follow 186; a port that 186 replaces moves the work, it does
   not duplicate it.
5. **Physical scan false positives** — a core table with a single-column PK that is a cascading FK to a
   host and is *not* an extension in spirit would need a declaration or a reason; T003 measures the
   catalog of a fresh database before the policy is chosen per table (today's entity scan finds only
   `quote_requests`' two).
6. **Loader misuse** — a loader that widens scope would leak; the guide forbids it and the reference
   module's test asserts no scope change, but nothing structural prevents it (same as any port
   implementation).

## Handoff summary for `endora-commerce-dev`

Start only after #1866 is on `master`. Do T001 (spike confirmation, nothing kept in the tree), then
Phase A in task order — contracts first, then static rules, metadata rules (unit, `connect: false`),
physical verifier (integration), CLI, `quote_requests` declarations, preservation. Then B1 (loader sink,
`entityExtensionReads`, `OrganizationDetailsPort`). Build packages after each package edit
(`pnpm run build:packages`), run `manifests:generate` + `pnpm install --lockfile-only` after the
`quote_requests` manifest edit, grep `backend/test/**` for every symbol you rename. Do not edit any core
entity class or migration. B2 waits for each aggregate's task in `specs/186-aggregate-ports/`; C waits for
#1856. Every owner question is settled (OR-9 tenancy, OR-10 admin HTTP deferred), so no task is
conditional.
