# Implementation Plan: three-level product scope model and one scope switcher for the product editor

**Branch**: `feat/168-product-editor-scope-switcher` (rebased on `origin/master` 2026-10-30) | **Date**: 2026-10-30 |
**Spec**: `specs/168-product-editor-scope-switcher/spec.md` (clarify rounds 1–5; exhausted)
**Input**: Feature specification above; issue #523; amends shipped `specs/163-product-data-scopes/`.
**Artifacts**: `research.md` (R0–R20), `data-model.md`, `contracts/` (10 documents), `quickstart.md`, `tasks.md`.

## Summary

Replace 163's four-level scope model (G → L → C → C×L) with **G → C → C×L** for every scopable product value,
backed by one pure resolver that distinguishes *no override* from an *empty override*; adapt every reader to the
effective value at (channel, language); give PIM connectors and the CSV import an explicit locale mapping and a
source language for Global; and rebuild the product editor around **one scope switcher, one per-field "Use value
from <parent scope>" control and one atomic Save** — SEO included through a `seo` write port joining catalog's
transaction.

Technical approach (research R1–R20):

- **One model, one resolver, several stores (R1, R2).** `packages/contracts/src/product-scope-model.ts` holds the
  scope vocabulary, the per-field scope sets (FR-011 / FR-012) and `resolveScoped`, where a row's presence wins
  whatever its value (fixes the empty-override blind spot of today's resolver). Typed availability columns stay
  typed (163 R1); name, description and attributes keep `product_value_overrides` (now accepting C rows and
  `{"v": null}`); gallery, attachments and packaging units get one `*_scope_overrides` table each with one shared
  column set; SEO stays in `seo_meta_overrides` with a Global product row and `''` = empty.
- **Global text is one string (FR-014).** `products.name` / `description` become `text`; the feature-161 admin
  name keys collapse from two per admin language to one pair (they are generated columns over `name`).
- **One write encoding (R3).** `scopedWrite()` (absent / `""` = no change, `null` = empty, `{inherit:true}` =
  inherit) and a CSV codec (`NULL`, `INHERIT`, backslash escape) in contracts, used by every write path and proven
  by one shared case table (SC-014). 163's `null` = inherit changes in place (FR-116).
- **One read endpoint, one save Command, one copy Command (R4–R6).** `GET|PUT …/products/:id/scoped-values`,
  `POST …/scoped-values/copy`; the save is one `CommandBus.run` with one audit entry carrying every cell's
  before / after, a version compare-and-set on `products.updated_at` (R7), the completeness gate before any write,
  and `seoProductMetaWritePort.applyWithin(em, …)` for SEO (R9).
- **Readers through catalog's ports (R10).** `CatalogProductRecord.name` becomes the Global string, and
  `effectiveTexts` / `effectivePackagingUnitNames` give (C, L) values; the type change is the compile-time
  instrument and a unit test guards casts and SQL (FR-034). 16 modules, 3 packages and the storefront are touched
  (`contracts/readers.md`).
- **Search (R11).** One index per channel; a document carries `texts.<L>` for every channel language; the query
  searches only the shopper's language.
- **URL keys (R12).** C and C×L keys, uniqueness per effective (C, L), orphans reserving, redirects per (C, L).
- **PIM and CSV (R13, R14).** `pim-locale-mapping.ts` (owned by `pim_connector`) with a pure planner and a
  whole-field protection filter; the path grammar shrinks; `catalogProductScopeWritePort` v2; a new
  `import_profiles` table in `import_export` (its first), gated `catalog:write`, written by Commands.
- **Editor (R17).** URL-state scope, `ScopedField` in admin-kit, one staged-change store, Save / Discard / Stay,
  per-tab selectors retired, SEO inline through a new `product.editor.seo` zone contributed by `seo`.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ, Meilisearch (backend); React 19 +
Vite through `@endora-commerce/admin-kit` and `@endora-commerce/admin-shell` (admin); Next.js 15 App Router
(storefront) — **no new runtime dependency**
**Storage**: PostgreSQL — catalog: `products.name` / `description` jsonb → text, one admin-key column pair replacing
four, `product_attributes.scopable`, `product_channel_scopes.min_order_quantity_overridden`, `product_url_keys` and
`product_url_redirects` recreated, `gallery_items.alt_text` → text and `.hidden`, `product_attachments.hidden`, four
new `*_scope_overrides` tables, three 163 channel tables and three translation columns dropped (four migrations);
seo: product rows of `seo_meta_overrides` re-scoped (one migration); import_export: `import_profiles` (one
migration, the module's first); Meilisearch — new document shape, one reindex per channel
**Testing**: Vitest — pure rules co-located in `packages/contracts/src/*.test.ts`; module unit tests beside their
subjects in `packages/modules/<id>/src/**`; `[PG]` contract / integration tests in
`backend/test/{contract,integration}/<module>/`; perf in `backend/test/perf/`; admin in `admin/test/modules/<id>/`;
admin-kit in its own package tests; storefront in `storefront/test/`
**Target Platform**: Linux server; backend, admin SPA, storefront
**Project Type**: web application — pnpm monorepo
**Performance Goals**: SC-012 — a scope switch is one request and no slower than a product page load (baseline
recorded by a Polish-phase task, research R17); storefront listing within 163 SC-004's +10% (bench re-run);
search index growth measured (≈ k× text payload for k channel languages, R11)
**Constraints**: no live data (FR-020); every write is one Command (XIII); every buyer seam keeps one not-found
answer (163); `seo` off must not break the editor (XVII); one release (round 3)
**Scale/Scope**: modules `catalog`, `seo`, `search`, `pim_connector`, `import_export` (owners) plus readers
`carts`, `comparisons`, `crm`, `inventory`, `orders`, `price_lists`, `product_feeds`, `quick_order`,
`quote_requests`, `cms`, `audit_logs`; packages `contracts`, `admin-kit`, `page-builder-admin`; `admin`;
`storefront` (verify). ~145 test files seed products and ~78 call the product API with name maps (fixture volume)

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — unchanged.*

| Principle | How the design satisfies it |
| --- | --- |
| I. Modular (NN) | catalog owns product data, the resolver's stores, the save / copy Commands and the read endpoint; `seo` owns its rows and writes them only through its own port (`applyWithin`), called by catalog through `lazyPort` + a `nonBindingDependencies` entry (`refuses-without`); readers use `catalogProductReadPort` / `catalogProductAvailabilityPort` (`effectiveTexts`); `pim_connector` owns the mapping contract; `import_export` owns profiles and reaches catalog through `catalogBulkImportPort`; `ScopedField` lives in admin-kit so `seo`'s admin imports nothing of catalog's. Each module migrates its own tables (FR-026) |
| II. API-first | Every shape is a Zod schema in `packages/contracts` first (`product-scope-model.ts`, `scoped-write-encoding.ts`, `product-scoped-values.ts`, `pim-locale-mapping.ts`, `seo.ts`, `import-export.ts`, `admin-contributions.ts`). Breaking changes owner-decided (round 1, FR-116 in place) and shipped as `minor` BREAKING changesets (D-225; R19) |
| III. TDD (NN) | Every phase opens with failing tests; every FR maps to a task (`tasks.md` *Traceability*); the F1 / F2 regression tests, the migration clean-run tests and the resolver tests are first (spec *Assumptions*) |
| IV. YAGNI / deps | No new dependency, no new permission code, no cache, no new event type; a timestamp is the version token (R7); profiles are a page section, not a new route (R14) |
| V / VI / VIII | TypeScript; names per conventions (`check:naming` — migration class tails start with the owning module segment); English everywhere except the Polish bundles / docs |
| VII. SEO | Effective URL keys per (C, L), permanent redirects per (C, L), no chains (R12); inline SEO per scope; storefront stays SSR |
| IX. UI reuse | admin-kit `Select`, `Combobox`, `Checkbox`, `Label`, `Badge`, `Alert`, `ModalDialog`, `StickyFormActions`, `useUnsavedChangesPrompt`; **one new kit primitive** `ScopedField`, generalising 163's `StatusRow` / `InheritedHint` because two modules (catalog, seo) render it — recorded under Complexity Tracking |
| X. Queues | No new worker; bulk scoped writes stay on the bulk-operation path (FR-077); the reindex runs through the existing search reindex job |
| XI. Tenancy (NN) | Scoped product data, SEO rows and import profiles are platform-global, like `products` (163 FR-083); no organisation path added or removed |
| XII. Channel scoping (NN) | Effective values are resolved at the request's resolved channel; membership read through the kernel accessor; a non-member or unoffered scope is refused (FR-018) or orphaned; cross-channel tests per reader (SC-003, SC-004) |
| XIII. Command Bus (NN) | `product.scoped_values.save`, `.copy_to_channels`, `.import` (connector port), `import_profile.create/update/delete`; one audit entry per save with every field's before / after, SEO included; `seo`'s write port records no audit of its own (no double audit); the audit before-state is a valid save body (FR-074) |
| XIV. Extensibility | Typed scope fields are core commerce fields (163 R1); user attributes keep runtime custom fields with one "scopable" flag |
| XV. Untouched core | Core feature; no overlay |
| XVI. Palette | The product editor stays reachable through `open-products` (keywords extended: scope, zakres, kanał, język); the profiles section lives on `/import-export`, reached by `open-import-export-center` (keywords extended); scope links are plain URLs |
| XVII. Toggleable (NN) | `catalog` non-deactivatable; `seo` off → SEO tab absent, read port not called, a save with SEO changes refused, others unaffected (off-state tests); `import_export` off → profile routes refused, section and action absent, profiles kept; `pim_connector` non-deactivatable (contract present by construction); `search` off → unchanged 163 behaviour |

**Verdict: PASS.** One addition is recorded under Complexity Tracking (a new admin-kit primitive); no violation.

## Readings of the spec (decisions the spec leaves to the plan)

- **"Left to the plan" items (checklist).** Import-profile permission = `catalog:write` for every profile route
  (R14); profile writes = three `import_profile.*` Commands (R14); palette = the existing `/import-export` action
  with extended keywords, no new route (R14); `product_editor_preferences` = `channel null` → G, `channel` +
  `language null` → C, both → C×L, table emptied once (R8).
- **FR-109's "set here, empty"** is `source: 'set_empty'`; "absent" (no value anywhere) is a fourth state the
  editor renders as "No value at any scope" (FR-065).
- **FR-074, FR-070, FR-043** — decided by the owner in round 6 (table below).
- **SC-012 baseline.** Measured by a Polish-phase task, not assumed.
- **The URL key is "required"** (FR-062 lists it) at every scope, so `NULL` is refused for it everywhere; inheriting
  is always `INHERIT`.

## Owner decisions from the plan's questions (spec Session 2026-10-30, round 6)

The five questions this plan raised were answered on 2026-10-30 and written into the spec (FR-013, FR-043,
FR-070, FR-074, new FR-094, US7, US10, SC-008):

| # | Decision | Where it lands |
| --- | --- | --- |
| Q1 | An empty override of one of the **five SEO fields** → the storefront uses the **derived value** (title from the effective name, description from the effective description), as when no SEO value exists. An empty **image alt text** → literally `alt=""` (decorative), never the asset library's alt text | `seoProductMetaPort.resolveForProduct` (T121, tested T119, T057); storefront PDP (T075, tested T061) |
| Q2 | The Save covers the **product row and every scoped field**. Structural operations (variants, bundle slots, links, images, attachments, packaging units: add / remove / reorder), **price-book rows, channel membership and warehouse stock** stay **immediate, individually audited actions**, labelled "applies immediately" | US7 (T107, T146, T147); version-token rule R7 (T144, T145) |
| Q3 | The product export uses **no import profile**: Global + per-scope columns, exact on re-import (FR-043; column grammar of `contracts/import-profiles-and-csv.md` §2.1 — the spec's `sklep_pl:pl` is an illustration, the plan keeps `name@<channel code>/<language>`) | T081, T087 |
| Q4 | The audit entry holds the **complete before-state, re-appliable through the API**; **no restore UI** in 168; "Restore this save" is a named follow-up | T103 (re-application test), T142 (follow-up text) |
| Q5 | `/seo` keeps categories and CMS pages; its **product mode is replaced by a link** to the editor's SEO tab (FR-094) | T126, tested T148 |

**Process decision — prototype gate.** A designer builds a clickable prototype of the editor (scope switcher,
"Use value from <parent scope>" checkbox, inheritance markers, plus the Save / Discard / Stay dialog and the
"applies immediately" labels), and the owner reviews it **before stream S3 starts**. S1 and S2 start in parallel
after C1. Task **T143** is the gate; every S3 task (US1's admin test T027 included) waits for it.

**Staged edits versus immediate actions (consistency issue raised by the product owner).** Decided in research
R7: **immediate actions do not bump the version token.** `products.updated_at` versions only what the Save
writes — the product row's own fields and every scoped value — so an immediate action taken from the editor
(or by anyone else) never makes the next Save answer 409. Staged edits survive immediate actions (spec *Edge
Cases*); staged cells whose subject an immediate action removed (an image, attachment or packaging unit) are
dropped by the editor with a notice, and refused by the server as `SCOPED_VALUE_INVALID` reason
`subject_not_found` if sent. Tests: T144 (backend: every immediate action, then a Save with the old version → 200)
and T146 (admin). Rejected: *the editor adopts a token returned by its own immediate actions* — it would still
409 after another admin's unrelated structural change, every immediate-action route in four modules (including
`price_lists`, `sales_channels`, `inventory`, which cannot write `products`) would have to return a catalog
version, and the token would stop meaning "the values this Save overwrites changed".

**Visible consequences already decided by the spec, for the owner to notice at acceptance:** admin lists and
pickers show the product's Global name whatever the admin UI language (FR-031; the feature-161 per-language admin
name keys collapse to one); category, attribute-label, option-label, attribute-set, bundle-slot and
attachment-type names stay per-language maps (FR-014 makes only product fields one Global string); the search index grows roughly with the
number of channel languages (R11) and needs one reindex on upgrade.

## Requirement → test (abridged; every FR maps to a task in `tasks.md` *Traceability*)

| FR / SC | Test |
| --- | --- |
| FR-002, FR-003, FR-004, SC-001 | `admin/test/modules/catalog/product-editor-f1-f2-regression.test.tsx`; `backend/test/contract/catalog/scoped-values-save-isolation.test.ts` [PG] |
| FR-010…FR-018, SC-004 | `packages/contracts/src/product-scope-model.test.ts`; `backend/test/contract/catalog/scoped-values-model.test.ts` [PG] |
| FR-016 | `backend/test/integration/catalog/url-keys-three-levels.test.ts` [PG] |
| FR-020, FR-026, SC-002 | `backend/test/integration/catalog/scope-model-migration.test.ts`, `…/seo/product-meta-three-levels-migration.test.ts`, `…/import_export/import-profiles-migration.test.ts` [PG] |
| FR-030…FR-032, SC-003 | one `[PG]` reader test per row of `contracts/readers.md` §1 (`backend/test/integration/<module>/effective-text-*.test.ts`) |
| FR-033 | `backend/test/integration/search/language-restricted-match.test.ts` |
| FR-034 | `backend/test/unit/catalog/no-per-language-product-maps.test.ts` |
| FR-040…FR-047, SC-005 | `packages/contracts/src/pim-locale-mapping.test.ts`, `pim-field-path.test.ts`; `backend/test/contract/catalog/scope-write-port-v2.test.ts` [PG] |
| FR-043, FR-048, FR-114 | `backend/test/contract/import_export/import-profiles.test.ts`, `backend/test/integration/import_export/products-csv-roundtrip.test.ts` [PG] |
| FR-050…FR-057 | `admin/test/modules/catalog/product-editor-scope-switcher.test.tsx`, `…-scope-url.test.tsx` |
| FR-060…FR-065 | `packages/admin-kit` `ScopedField.test.tsx`; `admin/test/modules/catalog/product-editor-scoped-field.test.tsx` |
| FR-070…FR-076, SC-007, SC-008 | `backend/test/contract/catalog/scoped-values-save.test.ts`, `…-save-atomicity.test.ts` [PG]; `admin/test/modules/catalog/product-editor-save.test.tsx` |
| FR-080…FR-084, SC-010 | `admin/test/modules/catalog/product-editor-read-only.test.tsx`; `backend/test/contract/catalog/scoped-values-permissions.test.ts` [PG] |
| FR-085, FR-086 | `admin/test/modules/catalog/product-editor-attributes-scoped.test.tsx`; `backend/test/contract/catalog/scoped-values-copy.test.ts` [PG] |
| FR-094 | `admin/test/modules/seo/seo-screen-product-link.test.tsx` |
| FR-070 immediate actions vs version | `backend/test/contract/catalog/scoped-values-version-immediate-actions.test.ts` [PG]; `admin/test/modules/catalog/product-editor-immediate-actions.test.tsx` |
| FR-090…FR-093 | `backend/test/contract/seo/product-meta-write-port.test.ts`, `…/seo/product-meta-read-relaxed.test.ts`, `…/catalog/scoped-values-seo-off.test.ts` [PG]; `admin/test/modules/seo/product-seo-section.test.tsx` |
| FR-095…FR-098 | `packages/modules/catalog/src/backend/services/scope-completeness.test.ts`; `backend/test/contract/catalog/scoped-values-completeness.test.ts` [PG] |
| FR-100, FR-101 | `admin/test/modules/catalog/product-scope-overview-links.test.tsx` |
| FR-105…FR-108 | `backend/test/unit/_i18n/registered-bundles-shape.test.ts`; `admin/test/unit/palette-coverage.test.ts`; zone-contract tests |
| FR-110…FR-117, SC-014 | `packages/contracts/src/scoped-write-encoding.test.ts` + the shared case table imported by the API, CSV and connector tests |
| SC-013 | `admin/test/modules/catalog/product-editor-a11y.test.tsx` (axe-core, existing devDependency) at G, C, C×L |

## Project Structure

### Documentation (this feature)

```text
specs/168-product-editor-scope-switcher/
├── spec.md, design-audit.md, checklists/requirements.md
├── plan.md            # this file
├── research.md        # R0–R20
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── scoped-values-api.md        # read, save, copy, preference; retired routes
│   ├── write-encoding.md           # FR-110…FR-117, the shared case table
│   ├── seo-ports.md                # read / write ports, zone, relaxed read
│   ├── url-keys.md                 # replaces 163 data-model §5
│   ├── readers.md                  # re-measured population, shapes, FR-034 guard
│   ├── search-index.md
│   ├── pim-locale-mapping.md       # mapping, planner, protection, scope write port v2
│   ├── import-profiles-and-csv.md
│   ├── editor-ui.md
│   └── error-codes.md
└── tasks.md
```

### Source code touched

```text
packages/contracts/src/
  product-scope-model.ts (+ .test.ts)            # new: scope vocabulary, scope sets, resolveScoped
  scoped-write-encoding.ts (+ .test.ts, .cases.ts) # new: scopedWrite, CSV codec, validateScopedWrite
  product-scoped-values.ts                       # new: read / save / copy schemas
  pim-locale-mapping.ts (+ .test.ts)             # new, owner pim_connector
  product-value-resolver.ts, product-scopes.ts, product-url-keys.ts, catalog.ts, seo.ts,
  pim-connector.ts, pim-field-path.ts, import-export.ts, comparisons.ts, admin-contributions.ts,
  scoped-translations.ts (removed), errors.ts, index.ts
packages/modules/catalog/
  src/manifest.ts                                # nonBindingDependencies (seoProductMetaWritePort), errorCodes, keywords
  src/migrations/<stamp>_catalog_scope_model_{texts,order_rules,url_keys,media}.ts
  src/backend/entities/{product,product-attribute,product-channel-scope,product-url-key,product-url-redirect,
                        gallery-item,product-attachment,product-packaging-unit}.entity.ts (changed),
                       {gallery-item-scope-override,gallery-role-scope-override,product-attachment-scope-override,
                        product-packaging-unit-scope-override}.entity.ts (new),
                       {gallery-item-channel-label,gallery-item-channel-hidden,product-attachment-channel-hidden}.entity.ts (removed)
  src/backend/commands/scoped-values.commands.ts (new)
  src/backend/services/{scoped-values-read,scoped-values-save,scoped-store-adapters}.ts (new),
                       product-value-resolver, product-overrides, product-scopes, url-key, url-key-resolution,
                       gallery, gallery-scopes, attachment, attachment-packaging-scopes, packaging-unit,
                       scope-completeness, scope-overview, effective-value.sql, storefront-value-overrides,
                       catalog-query, catalog-quick-search, catalog-admin, catalog-bulk-import, catalog-product-read,
                       catalog-write-ports, product-availability, product-editor-preferences, attribute-scope-preview,
                       admin-search-provider, demo/*
  src/backend/{index.ts,routes.admin.ts,routes.admin.url-keys.ts,routes.public.ts}
  src/admin/{pages/ProductEditor.tsx, components/*, lib/scoped-editor-store.ts (new), lib/*}
  i18n/{en,pl}.json; docs/catalog/*.md
packages/modules/seo/        migration, entity, port impls (read, write), routes, meta-tag-resolver, sitemap,
                             admin ProductSeoSection (new), SeoMetaScopeEditor, manifest, i18n, docs
packages/modules/search/     search-indexer.ts, search-query.service.ts, search-availability.ts, plugin.ts, docs
packages/modules/pim_connector/  manifest description, i18n, docs
packages/modules/import_export/  package.json (./migrations), src/migrations/ (new), entities/import-profile.entity.ts,
                             commands, services (profiles, adapters/products.adapter.ts), routes, admin, manifest, i18n, docs
packages/modules/{carts,comparisons,crm,inventory,orders,price_lists,product_feeds,quick_order,quote_requests,cms,
                  audit_logs}/  reader swaps (contracts/readers.md §1)
packages/admin-kit/src/components/{scoped-field/ (new), product-browser/}
packages/page-builder-admin/src/{chrome/CatalogPickers.tsx,email/EmailEditorPane.tsx}
storefront/                  verify + PDP alt `alt=""` for an empty override (round 6)
backend/test/{unit,contract,integration,perf}/…, admin/test/modules/{catalog,seo,import_export}/…
docs/docs/…, docs/i18n/pl/…, docs/translation-cache/pl/…
.changeset/*.md
```

**Structure Decision**: extend `catalog`, `seo`, `search`, `pim_connector` and `import_export`; **no new module**.
Scoped values are product data (catalog, by domain ownership); SEO rows stay `seo`'s; the mapping contract is the
shared PIM layer's; profiles are import configuration.

## Migrations (by owner; order by manifest graph, never by number)

1. `catalog` `scope_model_texts`, `scope_model_order_rules`, `scope_model_url_keys`, `scope_model_media`
   (`data-model.md` §1–§7) — scaffolded in this order so their timestamps order them within catalog.
2. `seo` `product_meta_three_levels` (§8) — after catalog by the graph (`seo` depends on `catalog`).
3. `import_export` `import_profiles` (§11) — the package first gains a `./migrations` export and
   `src/migrations/index.ts`; `manifests:generate` + `pnpm install --lockfile-only` in the same commit.

Each: scaffold → entity → `composer:generate` → `manifests:generate` → `pnpm install --lockfile-only` → commit the
artefacts together (AGENTS.md *traps*). Each is idempotent and has a clean-run test on a 163-model database.

## Delivery shape (details in `tasks.md`)

- **Phase 1–2 (one builder, S1).** Setup and the foundational contracts, migrations, entities, the resolver
  service and the shared test helpers — every stream depends on them. Fork after the Phase 2 checkpoint.
- **Streams (up to three builders, each in its own worktree).**
  - **S1 backend core** — catalog model services, URL keys, completeness, read endpoint, save / copy Commands,
    scope write port v2, catalog demo and catalog tests. Owns the shared files: contracts barrel,
    `catalog/src/backend/index.ts`, `routes.admin.ts`, catalog manifest, generated registries, lockfile,
    `AGENTS.md` appendix, changesets.
  - **S2 integrations and readers** — `seo` (backend + migration), `search`, `pim_connector`, `import_export`
    (backend + admin section), every reader module of `contracts/readers.md`, `admin-kit` product-browser,
    `page-builder-admin`, storefront.
  - **S3 editor** (starts after the prototype gate T143) — catalog admin (`src/admin/**`, catalog `i18n` UI keys — S1 hands its error-code keys over at
    the Phase 2 checkpoint, after which S3 owns the two bundles), admin-kit `ScopedField`, `seo`'s
    `ProductSeoSection` (UI only), admin tests. Builds against the Phase 2 contracts with the API mocked, then
    integrates when S1's read / save endpoints land (checkpoint C2).
- **Checkpoints.** C1 after Phase 2 (contracts and migrations frozen); C2 after US2 + US7 backend (endpoints
  live); C3 after US3 (readers green, FR-034 test green); C4 after the editor stories; final gate after Polish.
  Review after every checkpoint on a different model than the author.

## Risks

1. **Fixture volume.** ~145 test files seed products and ~78 call the product API with name maps; a JSON map
   string inserted into the new `text` column is accepted silently, so stale fixtures pass with odd names instead
   of failing. Mitigation: helpers in Phase 2 (typed product factories taking a string name), per-stream fixture
   tasks, and a grep task for `'{"en-US"` literals in SQL fixtures.
2. **Breadth of the type change.** `CatalogProductRecord.name` crosses 17 modules; a stream that rebases late meets
   compile errors in files it does not own. Mitigation: the type change lands in Phase 2 together with a
   **compile-only** shim per reader file (the Global string, marked `// 168-shim`) so the tree compiles at C1; S2
   replaces each shim with the proper (C, L) read; the FR-034 test forbids `168-shim` at the final gate.
3. **Search reindex.** New document shape; until reindexed, the boot check reindexes and the query falls back to
   the pre-168 search (logged). Release note + operator step.
4. **Atomic save across two modules.** The SEO write port must never fork or flush; a test asserts a thrown SEO
   write rolls back catalog rows and writes no audit entry (SC-007).
5. **URL-key rule rewrite.** The 163 rule table is replaced wholesale; concurrency covered by a two-connection test
   (163 precedent) and the orphan-reservation cases.
6. **External connectors** must adopt the v2 scope write port, the mapping contract and the shrunk path grammar;
   until they do, their per-locale values are written nowhere (FR-041, spec *Assumptions*). Release note.
7. **Admin UX scale.** The editor rewrite touches ~15 components; a11y regressions are caught by the axe test at
   three scopes (SC-013). The prototype gate (T143) may change S3's component breakdown; S3's tasks name files
   and behaviour, not layout, so a reviewed prototype changes layout inside the same tasks.
8. **Prototype gate latency.** S3 cannot start until the owner has reviewed the prototype; S1 and S2 are not
   blocked, and S3's first integration point (C2) needs S1's endpoints anyway.

## Compatibility and release

One release (round 3). Breaking changes are owner-decided and shipped as `minor` changesets with **BREAKING**
bodies (D-225 refuses `major` in `0.x`; 163 R30.6 precedent): `@endora-commerce/contracts`, `mod-catalog`,
`mod-seo`, `mod-search`, `mod-import-export`, `mod-pim-connector`, `admin-kit`, `page-builder-admin`; `patch` for
each reader module package whose code changes. Release notes (en + pl, `docs/`): the write encoding and its
in-place change of `null` (FR-115, FR-116), name / description as strings, removed routes, the reindex step, the
connector migration note (mapping, grammar, port v2), and the named follow-ups of research R20.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New admin-kit primitive `ScopedField` (Principle IX: reuse before adding) | Two modules (catalog, seo) render the same inherited-state control, and FR-060…FR-065 demand one polarity and one accessible pattern everywhere | Keeping it in catalog's admin forces `seo` to import catalog internals (Principle I); copying it into `seo` forks the control the spec wants unified |

**No new runtime, dev or workspace dependency.** `axe-core` for SC-013 is already an `admin` devDependency
(feature 147).

## Handoff summary (for `endora-commerce-dev`)

Build in `tasks.md` order; phases and streams are the unit of a builder spawn. Read first: `research.md` R1–R7 and
R9, `data-model.md` §0 and §9, `contracts/scoped-values-api.md`, `contracts/write-encoding.md`. Non-negotiables:

- A row's presence is the override; `{"v": null}` / `''` / `gallery_item_id null` are empty overrides; absence
  inherits. Never use an empty value to mean inherit (FR-062).
- No Language-only scope anywhere — data, API, resolver, UI (FR-010).
- Every scoped write path decodes with `scopedWrite` / `decodeCsvScopedCell` and validates with
  `validateScopedWrite`; the shared case table is imported, never copied.
- The save is **one** `CommandBus.run`; SEO goes through `seoProductMetaWritePort.applyWithin(em, …)` resolved with
  `lazyPort` inside the Command, never a nested Command, never a bare `catch`.
- Bump `products.updated_at` in every scoped write; compare-and-set it in save and copy.
- Readers resolve through `effectiveTexts` / `effectivePackagingUnitNames` at the document's (C, L), or use the
  Global string where there is no channel. No `pick*` over a product map survives, and no `168-shim`.
- Each module migrates its own tables; do not edit 163's migrations; regenerate and commit
  `composer:generate` / `manifests:generate` / lockfile in the same commit as a migration.
- Owner decisions of round 6 are binding: SEO empty → derived value, alt empty → `alt=""`; immediate actions are
  not staged and **never bump `products.updated_at`**; export uses no profile; no restore UI; `/seo` links products
  to the editor. S3 starts only after the prototype gate T143.
- Commits `git commit -s`, no AI trailer; English only; do not push without the coordinator.
