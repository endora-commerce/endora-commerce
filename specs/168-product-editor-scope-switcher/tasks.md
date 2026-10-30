# Tasks: three-level product scope model and one scope switcher for the product editor

**Input**: `specs/168-product-editor-scope-switcher/` — `spec.md`, `plan.md`, `research.md` (R#), `data-model.md`,
`contracts/`, `quickstart.md`.
**Tests**: required. Constitution III (TDD, non-negotiable) and the brief: every implementation task is preceded by
a failing test (marked **RED**) in the same phase, and every FR is traced to a test (*Traceability* below).
**One release** (spec round 3): phases are build order, not ship order.

## Phase 1 findings (2026-10-30, S1)

- **T001 — id and drift.** `specs/168-*` is absent on `origin/master` (4b670e6a4, merge of #547). The branch's
  merge base **is** `origin/master`'s tip: `git log $(git merge-base HEAD origin/master)..origin/master` is empty,
  so there is no upstream drift in `catalog`, `seo`, `search`, `import_export`, `pim_connector` or the named
  contracts files since the plan was written. 166 and 167 are ancestors of the base.
- **T002 — baseline.** `bash scripts/setup-worktree.sh` + `pnpm run build:packages` (5 m 39 s). Green, run one at a
  time: `backend/test/contract/catalog/product-scopes-api.test.ts` 19/19,
  `backend/test/contract/catalog/scope-completeness-gate.test.ts` 17/17,
  `admin/test/modules/catalog/product-scope-*` 4 files 69/69; `pnpm --filter @endora-commerce/mod-catalog run
  typecheck` green. `pnpm -r run typecheck` is outside the builder's resource budget; the fork CI run on the
  branch tip is the whole-tree gate.
- **T003 — Before column.** The listing bench is recorded in `quickstart.md`. The search-index and editor
  scope-switch rows were **not measured**: `backend/test/perf/` holds no search-index fixture (nothing under it
  reaches Meilisearch) and the editor measurement needs the full dev stack. Both are reproducible later from the
  fixed base `4b670e6a4`, so T139 measures Before and After in one run on the same host.

## Format

`- [ ] T### [P?] [US#?] (S#) Description with file path`

- **[P]** — parallelisable: different files from every other open task of the phase, no dependency on one.
- **[US#]** — the user story (user-story phases only).
- **(S#)** — the stream / builder: **S1** backend core, **S2** integrations and readers, **S3** editor (plan
  *Delivery shape*). Phases 1–2 are S1 alone; the streams fork at checkpoint **C1**. File ownership: S1 owns the
  contracts barrel, `packages/modules/catalog/src/backend/**`, catalog migrations and manifest, generated
  registries, the lockfile, `AGENTS.md`, changesets; S2 owns `seo/src/backend`, `search`, `pim_connector`,
  `import_export`, every reader module of `contracts/readers.md` §1, `admin-kit` product-browser,
  `page-builder-admin`, `storefront`; S3 owns `catalog/src/admin/**`, catalog `i18n/` (after C1),
  `admin-kit` scoped-field, `seo/src/admin/**`, `admin/test/modules/{catalog,seo}`. A task touching another
  stream's file says so and the owner applies it.
- **IDs T143–T148 were added by spec round 6, T149–T150 by the pre-build reviews**; they sit in the phase where they run, not in numeric order.
- **Prototype gate**: every S3 task waits for **T143** (owner-reviewed clickable prototype); S1 and S2 do not.
- Paths: `packages/modules/<id>/…` modules; `backend/test/{unit,contract,integration,perf}/<module>/…` backend
  tests (`[PG]` = needs Postgres); module unit tests sit beside their subjects (`*.test.ts`, no `test/` dir).

Run only the tests related to a change while iterating (`specs/conventions/backend-test-suite.md`); the complete
suite is CI's. Every migration task regenerates and commits `composer:generate`, `manifests:generate` and
`pnpm install --lockfile-only` output in the same commit (AGENTS.md *traps*).

---

## Phase 1: Setup

**Purpose**: a clean, measured starting point.

- [x] T001 (S1) Confirm `specs/168-*` is still free on `origin/master` and diff `origin/master` against the plan's base for upstream drift in `packages/modules/{catalog,seo,search,import_export,pim_connector}/src`, `packages/contracts/src/{catalog,product-scopes,product-value-resolver,seo,pim-*}.ts`; record findings at the top of this file
- [x] T002 (S1) Stand the worktree up (`bash scripts/setup-worktree.sh && pnpm run build:packages`), run `pnpm -r run typecheck` and the 163 scope suites (`backend/test/contract/catalog/product-scopes-api.test.ts`, `…/scope-completeness-gate.test.ts`, `admin/test/modules/catalog/product-scope-*.test.tsx`) to record a green baseline
- [x] T003 [P] (S1) Record the "Before" column of `specs/168-product-editor-scope-switcher/quickstart.md` § *Measurements*: editor scope-switch request count and p95 server time on the dev stack; search index bytes per channel and p95 query latency on the 163 perf fixture (`backend/test/perf/`), 1 and 3 languages; `backend/test/perf/catalog/listing-scoped-availability.bench.ts`

---

## Phase 2: Foundational (blocking — S1 alone, then checkpoint C1)

**Purpose**: the contracts, the schema and a compiling tree every stream builds on.

### Contracts — tests first

- [x] T004 [P] (S1) **RED** `packages/contracts/src/product-scope-model.test.ts`: `resolveScoped` matrix — presence wins whatever the value; an empty row stops the fallback; `levels` restriction ({G,C} ignores CL rows); sources `set` / `set_empty` / `inherited_channel` / `inherited_global` / `absent`; `PRODUCT_FIELD_SCOPE_SETS` equals `data-model.md` §9; `attributeScopeSet` per value type (FR-010…FR-015, FR-109)
- [x] T005 [P] (S1) **RED** `packages/contracts/src/scoped-write-encoding.cases.ts` (the shared case table, `contracts/write-encoding.md` §4) and `packages/contracts/src/scoped-write-encoding.test.ts`: JSON decoding, CSV decoding / encoding incl. every escape row and a property test `decode(encode(x)) = x`, `validateScopedWrite` refusals (FR-110…FR-113, SC-014) — includes every row of the formula-injection guard (`contracts/write-encoding.md` §3a, FR-118)
- [x] T006 [P] (S1) **RED** `packages/contracts/src/pim-locale-mapping.test.ts` (planner rules 1–7 of `contracts/pim-locale-mapping.md` §2; US4 #1, #2, #3, #5, #8; imports `SCOPED_WRITE_CASES`) and `packages/contracts/src/pim-field-path.test.ts` (locale / channel segments now invalid; whole-field paths valid) (FR-040…FR-047)

### Contracts — implementation

- [x] T007 (S1) Implement `packages/contracts/src/product-scope-model.ts` (R1) — makes T004 green
- [x] T008 (S1) Implement `packages/contracts/src/scoped-write-encoding.ts` (R3) — makes T005 green incl. the §3a formula guard
- [x] T009 (S1) Rewrite `packages/contracts/src/product-value-resolver.ts` on `resolveScoped` (no `global+language`, no `primaryLanguage`, no map picks); delete `packages/contracts/src/scoped-translations.ts`; update their tests
- [x] T010 (S1) Implement `packages/contracts/src/pim-locale-mapping.ts` (header: owner `pim_connector`) and shrink `pim-field-path.ts` / `pimFieldPathSchema` in `pim-connector.ts` (R13) — makes T006 green
- [x] T011 (S1) Add `packages/contracts/src/product-scoped-values.ts` (read / save / copy / preference schemas, `contracts/scoped-values-api.md`); rewrite `product-scopes.ts` (patch body on `scopedWrite`, `effectiveTexts`, `effectivePackagingUnitNames`, `ProductScopedWriteInput` v2, `scopeLevelSchema` without `language`, `AttributeScope` → `scopable`) and `product-url-keys.ts` (C / C×L keys, redirect per (C, L), conflict details with `channelId`)
- [x] T012 (S1) Rewrite the product shapes in `packages/contracts/src/catalog.ts` and `comparisons.ts` per `contracts/readers.md` §2 (`CatalogProductRecord`, packaging record, quick-search hit, `ProductImportRow` v2, admin request / response `name` / `description`, gallery / attachment / packaging scoped sub-fields removed, gallery role encoding)
- [x] T013 (S1) Rewrite `packages/contracts/src/seo.ts` (`SeoProductMetaPort` three levels, `SeoProductMetaWritePort<EM>`), add the `ImportProfile` section to `import-export.ts`, change `admin-contributions.ts` (new zone `product.editor.seo` with `ProductEditorSeoZoneProps`, zone `product.editor.seo.after` removed, `ProductEditorFieldZoneProps.scope?`), export everything from `packages/contracts/src/index.ts`
- [x] T014 (S1) Register the six error codes of `contracts/error-codes.md` in one commit: `packages/contracts/src/errors.ts`, `backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `errorCodes` in `packages/modules/catalog/src/manifest.ts` and `packages/modules/import_export/src/manifest.ts`, `errors.<CODE>` in both modules' `i18n/{en,pl}.json`, `composer:generate`

### Schema — tests first

- [ ] T015 (S1) **RED** `backend/test/integration/catalog/scope-model-migration.test.ts` [PG]: seed a database with 163-model rows (name / description maps in `en-US`, `pl-PL`, `de-DE`; a language-scoped attribute map; language URL keys and redirects; alt-text, attachment and packaging translation maps; 163 channel label / hidden rows; `min_order_quantity = 1` channel rows; editor preferences), run the four catalog migrations, assert they complete, a second run is a no-op, and the shapes of `data-model.md` §1–§7 (FR-020, FR-026, SC-002, US2 #7) — also seeds `min_order_quantity` 5, 1 and `null` channel rows, a non-object `name` row, an unwrapped `product_value_overrides.value`, and a language-scoped attribute map; asserts each constraint was added after its backfill (no violation), `scope_version = 0`, the exclusion constraint and every index of `data-model.md` §5–§8, and the composite FKs (an override pointing at another product's subject is refused)

### Schema — implementation (scaffold with `pnpm --filter backend run migration:new -- --module catalog --name <slug>`, in this order)

- [ ] T016 (S1) Migration `scope_model_texts` in `packages/modules/catalog/src/migrations/` (`data-model.md` §1–§3, §10) in exactly the 8-step order of `data-model.md` §1 (R22): collapse language-map `attribute_values` using `language_scoped` → drop admin-key indexes, generated columns, jsonb functions → convert `name` / `description` by add / update via a temporary `catalog_first_text(jsonb)` helper / not null / drop / rename, guarded by `data_type = 'jsonb'` and `jsonb_typeof(name) = 'object'` → recreate functions over text, generated columns, indexes → `scopable` from the old flags, then drop them → wrap unwrapped override rows, then CHECK `value ? 'v'` (keep `product_value_overrides_product_attr_idx`) → `scope_version` → empty editor preferences, then their CHECK; header notes the jsonb key-order dependence is dev-only. Re-grep raw SQL reading `name` (`effective-value.sql.ts`, `catalog-admin-search.service.ts`, `gallery-scopes.ts`, `attachment-packaging-scopes.ts`, `catalog-query.service.ts`)
- [ ] T017 (S1) Migration `scope_model_order_rules` (`data-model.md` §4): add the flag `default false` → backfill `overridden = true, value = case when 1 then null else value end where value is not null` → CHECK
- [ ] T018 (S1) Migration `scope_model_url_keys` (`data-model.md` §5): `create extension if not exists btree_gist`, the exclusion constraint, the four partial uniques, `(product_id)` / `(key)` indexes on keys and `(product_id)` on redirects
- [ ] T019 (S1) Migration `scope_model_media` (`data-model.md` §6–§7, statement order in §7): `unique (id, product_id)` on `gallery_items`, `product_attachments`, `product_packaging_units`; composite FKs (role holder nullable, `match simple`, cascade — docblock why); per-field type CHECKs; `(subject_id)` and `(product_id)` indexes; `alt_text` by add / update / drop / rename. Timestamps strictly increasing texts → order rules → URL keys → media — makes T015 green
- [x] T020 (S1) Entities in `packages/modules/catalog/src/backend/entities/`: change `product`, `product-attribute`, `product-channel-scope`, `product-url-key`, `product-url-redirect`, `gallery-item`, `product-attachment`, `product-packaging-unit`; add `gallery-item-scope-override`, `gallery-role-scope-override`, `product-attachment-scope-override`, `product-packaging-unit-scope-override`; delete `gallery-item-channel-label`, `gallery-item-channel-hidden`, `product-attachment-channel-hidden`; `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; grep `backend/test/**` and `admin/test/**` for the deleted entity files — no `@Unique` for constraints written as raw SQL; `scopeVersion` on `Product` (not ORM-versioned, written only through `bumpScopeVersion`)

### A compiling tree

- [ ] T021 (S1) Make catalog's backend compile on the new contracts: every map read in `packages/modules/catalog/src/backend/**` replaced by the Global string or a call the US2 / US3 tasks will rewrite, each marked `// 168-shim` (list the files in the commit body)
- [ ] T022 (S1) Make every other workspace member compile: the reader files of `contracts/readers.md` §1, `packages/modules/catalog/src/admin/**`, `packages/admin-kit`, `packages/page-builder-admin`, `storefront` — Global string, each marked `// 168-shim`; `pnpm -r run typecheck` green
- [ ] T023 (S1) Test helpers: `backend/test/helpers/` product factories take a string `name` / `description` and accept scoped rows per family (`seedScopedValues(productId, { field, scope, value | 'empty' })`); `admin/test/helpers/` builder for `ScopedValuesResponse`; grep `backend/test/helpers` for name maps
- [ ] T024 (S1) Rewrite the catalog demo seeders in `packages/modules/catalog/src/backend/demo/` to the new model (Global strings; channels B2B PL and Sklep PL, both Polish; C×L translations; an import-ready product set for `quickstart.md`) (FR-020, SC-002); `pnpm --filter backend run check:demo-data-budget`; green proof that every seed loads in the new model: `pnpm --filter backend exec vitest run test/integration/demo/demo-shop.test.ts test/integration/demo/demo-instance-shape.test.ts test/integration/demo/demo-reset-after-use.test.ts` [PG]
- [ ] T025 (S1) **Checkpoint C1**: `pnpm -r run typecheck`, `pnpm -r run lint`, contracts tests, T015 green; hand the catalog `i18n/{en,pl}.json` bundles to S3; contracts, migrations and the review outcomes of `plan.md` *Pre-build reviews* frozen (a later contract change is a coordinated commit by S1)

---

## Phase 3: User Story 1 — Saving a product never loses its text in any language (P1)

**Goal**: F1 / F2 regression tests on the new model (no old-model patch, round 3). They stay **RED** until US2,
US5, US6, US7 and US9 land; they are the acceptance of FR-004.
**Independent test**: spec US1 *Independent Test*.

- [ ] T026 [P] [US1] (S1) **RED** `backend/test/contract/catalog/scoped-values-save-isolation.test.ts` [PG]: seed name, description and a scopable text attribute at C×L in `en-US`, `pl-PL`, `de-DE`; save an unrelated field at another scope through `PUT …/scoped-values`; assert every other cell unchanged (FR-002, FR-003, FR-004, SC-001, US1 #1, #3)
- [ ] T027 [P] [US1] (S3, after T143) **RED** `admin/test/modules/catalog/product-editor-f1-f2-regression.test.tsx`: the editor at a scope with `de-DE` values; change an unrelated field and Save; the request carries only the staged cells; the attributes section never renders `[object Object]` or a serialised map at any scope (FR-002, FR-003, US1 #1–#3)

---

## Phase 4: User Story 2 — One three-level scope model for every field (P1) — S1

**Goal**: the model, its stores, the read endpoint and the save Command for catalog's families.
**Independent test**: spec US2 *Independent Test* (`quickstart.md` §1).

### Tests (RED)

- [ ] T028 [P] [US2] (S1) **RED** `packages/modules/catalog/src/backend/services/scoped-store-adapters.test.ts`: each store → `ScopedRow` (value overrides incl. `{"v": null}`; channel scope MOQ flag; gallery item, role, attachment and packaging overrides; orphan rows passed through for the caller to drop)
- [ ] T029 [P] [US2] (S1) **RED** `backend/test/contract/catalog/scoped-values-model.test.ts` [PG]: US2 #2, #4 (Language-only → 422), #5 (C name accepted, resolves for every language), #8 (C×L for audience / window / MOQ / returnable / non-text attribute → `FIELD_NOT_AT_SCOPE`), #9 (empty description stops the fallback); FR-017, FR-018 (non-member / unoffered → `SCOPE_INVALID`; orphan retained); SC-004 (a C×L write changes only that pair)
- [ ] T030 [P] [US2] (S1) **RED** `backend/test/integration/catalog/url-keys-three-levels.test.ts` [PG]: every row of `contracts/url-keys.md` §2–§4 — uniqueness per effective (C, L), Global key vs any key, orphan keeps reserving (P2 refused while P1's orphan holds it; re-adding P1 collides with nothing), redirects per (C, L), takeover, two-connection concurrency (FR-016) — rewritten for owner round 7: a key is one product's per channel across all languages (same product may repeat it), orphans included; G vs any key; parallel G and C×L writes of the same key from two connections serialise and exactly one wins; a residual exclusion violation maps to 409; redirect cap of 50 per (product, channel); `confirmTakeover` ignored on the connector port and CSV; negative grammar cases (`//host`, `/\host`, `..`, `%2f`, `:`, whitespace, upper case, non-ASCII) and redirect targets only through `productPath()`
- [ ] T031 [P] [US2] (S1) **RED** `backend/test/contract/catalog/scoped-values-encoding.test.ts` [PG]: runs `SCOPED_WRITE_CASES` against `PUT …/scoped-values` (FR-110…FR-113, SC-014)
- [ ] T032 [P] [US2] (S1) **RED** `backend/test/contract/catalog/scoped-values-families.test.ts` [PG]: alt text, hide image, gallery roles (incl. empty role), attachment name / description / hidden, packaging-unit name at G, C, C×L; Global hidden; role holder hidden at (C, L) resolves to none (FR-011, FR-012)
- [ ] T033 [P] [US2] (S1) **RED** update `packages/modules/catalog/src/backend/services/effective-value.sql.test.ts` and `storefront-value-overrides.test.ts` to the C×L → C → G chain with empty overrides; **RED** `packages/modules/catalog/src/backend/services/scope-completeness.test.ts` for FR-095 / FR-096 (a Global value satisfies every (C, L))

### Implementation

- [ ] T034 [US2] (S1) Implement `packages/modules/catalog/src/backend/services/scoped-store-adapters.ts` — T028 green
- [ ] T035 [US2] (S1) Rewrite `product-value-resolver.service.ts`, `effective-value.sql.ts`, `storefront-value-overrides.ts` and `scope-completeness.ts` in `packages/modules/catalog/src/backend/services/` on the new chain — T033 green
- [ ] T036 [US2] (S1) Implement `packages/modules/catalog/src/backend/services/scoped-values-read.service.ts` (`contracts/scoped-values-api.md` §2; `seo: null` until US10; completeness summary until US11 returns the C×L list only)
- [ ] T150 [P] [US2] (S1) **RED** `backend/test/contract/catalog/scoped-values-input-hardening.test.ts` [PG]: per subject type (gallery item, role target, attachment, packaging unit) an id of another product and an unknown id give the identical `subject_not_found`; unknown organisation id and an attribute outside the product's set → `invalid`; unknown keys in any `changes` object → 400; `__proto__` / `constructor` record keys refused; every length cap and the cell cap; body over `bodyLimit` → 413; an over-4-KiB description is audited as `{ truncated, length, sha256 }`; redirects inserted and a takeover's deleted redirects appear in the audit (R21)
- [ ] T037 [US2] (S1) Implement `packages/modules/catalog/src/backend/services/scoped-values-save.service.ts`: scope resolution, `FIELD_NOT_AT_SCOPE`, `validateScopedWrite`, per-family writers (product row at Global with `GLOBAL_ONLY_FIELD` elsewhere, scope rows, value overrides, family overrides), version compare-and-set on `products.scope_version` through one `bumpScopeVersion` helper as the **first statement** of the Command, before the audit capture (R7; tests: two saves in a row, two saves inside one millisecond, a structural Command flushing a loaded `Product`, an inventory writer flushing a `Product` — none changes or trips the version); subject binding and bounds of R21 (`.strict()` bodies, regex record keys parsed into a `Map`, length caps, route `bodyLimit`), audit cells capped at 4 KiB with length + sha256, side effects listed in before / after
- [ ] T038 [US2] (S1) Command `product.scoped_values.save` in `packages/modules/catalog/src/backend/commands/scoped-values.commands.ts` (capture, before / after projection keyed `field@scope`, `product.updated.v1` with `changedFields`); routes `GET` / `PUT /api/v1/admin/catalog/products/:id/scoped-values` in `routes.admin.ts` (`catalog:read` / `catalog:write`); wiring in `src/backend/index.ts` — T029, T031, T032 green
- [ ] T039 [US2] (S1) Rewrite `url-key.service.ts`, `url-key-resolution.service.ts`, `routes.admin.url-keys.ts`, `routes.public.url-keys.ts` per `contracts/url-keys.md`; the save's URL-key step uses the service under its advisory locks — T030 green — every key writer (product create, slug `PATCH`, bulk edit, CSV, connector, overview reset) goes through `UrlKeyService.lockAndCheck` (`contracts/url-keys.md` §3)
- [ ] T149 [US2] (S1) **RED then green** `backend/test/unit/catalog/url-key-writer-ownership.test.ts`: walks `packages/modules/*/src` and fails when anything other than `UrlKeyService` writes `product_url_keys`, `product_url_redirects` or `products.slug` (ORM or SQL), and when a key writer of the list in `contracts/url-keys.md` §3 does not call `lockAndCheck`; prints its read line, fails on an empty population
- [ ] T040 [US2] (S1) Rewrite `product-scopes.service.ts` (`PATCH …/scopes` on the write encoding, MOQ overridden flag) and its unit test
- [ ] T041 [US2] (S1) Rewrite `gallery-scopes.ts`, `gallery.service.ts`, `attachment-packaging-scopes.ts`, `attachment.service.ts`, `packaging-unit.service.ts` on the adapters; remove scoped sub-fields from the gallery / attachment / packaging routes (collection operations stay)
- [ ] T042 [US2] (S1) Attribute flag: `commands/attribute-commands.ts`, `services/catalog-attribute-read.service.ts` (`scopeLevels`), `services/attribute-scope-preview.ts` (scopable → not scopable and text → non-text previews) and their tests (FR-012)
- [ ] T043 [US2] (S1) Remove `GET` / `PATCH …/value-overrides` and `GET …/scope-context` with `product-overrides.service.ts` and `product-scope-context.service.ts`; grep `backend/test/**`, `admin/**` and the module-removal ledger for every reference to the deleted files and routes
- [ ] T044 [US2] (S1) `product-editor-preferences.service.ts` and `routes.admin.ts`: `GET` / `PUT …/editor-preference` with R8 validation (`contracts/scoped-values-api.md` §5); test `backend/test/contract/catalog/editor-preference.test.ts` [PG] (RED first) — the PUT is UI state, not a Command (XIII does not apply; R8)
- [ ] T045 [US2] (S1) `scope-overview.service.ts`: Language row and level removed, new chain, orphans (FR-100 backend half, FR-101); update `scope-overview.service.test.ts` first
- [ ] T046 [US2] (S1) Remove every `// 168-shim` in `packages/modules/catalog/src/backend/**`: `catalog-query.service.ts`, `catalog-quick-search.service.ts`, `catalog-product-read.service.ts`, `catalog-admin.service.ts` (product POST / PATCH with string name, scoped fields on the encoding, optional `version`), `catalog-bulk-update.service.ts`, `bulk-operation.service.ts` (scoped status encoding), `admin-search-provider.ts`, `prompt-tools.ts`, the admin-name-key paging (`pageProductsByAdminName`: one key)
- [ ] T047 [US2] (S1) Sweep `backend/test/{contract,integration,unit,perf}/catalog/**` and `packages/modules/catalog/src/**/*.test.ts` to the new model (delete tests of removed routes; fix `'{"en-US"…}'` SQL literals); catalog suites green

**Checkpoint C2 (backend half)**: T026, T028–T033 green except the SEO and editor parts.

---

## Phase 5: User Story 3 — Every reader shows the value of the buyer's channel and language (P1) — S2 (port: S1)

**Goal**: no reader reads a per-language product map; snapshots keep their value.
**Independent test**: spec US3 *Independent Test*; one test per reader below.

### Tests (RED)

- [ ] T048 [P] [US3] (S2) **RED** `backend/test/unit/catalog/no-per-language-product-maps.test.ts` per `contracts/readers.md` §3 (fails on today's shims and maps; prints its read line; fails on an empty population) (FR-034, SC-003)
- [ ] T049 [P] [US3] (S1) **RED** `backend/test/integration/catalog/effective-texts-port.test.ts` [PG]: `effectiveTexts` and `effectivePackagingUnitNames` at C×L, C, G fallback and empty override (FR-030, FR-031)
- [ ] T050 [P] [US3] (S2) **RED** `backend/test/integration/carts/effective-text-lines.test.ts` [PG]: basket line name, minimum-order messages, upsell at B2B PL × pl vs Sklep PL × pl; snapshot kept after the override changes (FR-030, FR-032, US3 #1–#3)
- [ ] T051 [P] [US3] (S2) **RED** `backend/test/integration/orders/effective-text-snapshot.test.ts` [PG]
- [ ] T052 [P] [US3] (S2) **RED** `backend/test/integration/quote_requests/effective-text-snapshot.test.ts` [PG] (incl. the packaging-unit name snapshot)
- [ ] T053 [P] [US3] (S2) **RED** `backend/test/integration/comparisons/effective-text.test.ts` [PG]
- [ ] T054 [P] [US3] (S2) **RED** `backend/test/integration/inventory/effective-text-alerts.test.ts` [PG]: operator alerts Global; back-in-stock e-mail at the subscription's channel and language
- [ ] T055 [P] [US3] (S2) **RED** `backend/test/integration/product_feeds/effective-text-feed.test.ts` [PG]
- [ ] T056 [P] [US3] (S2) **RED** `backend/test/integration/quick_order/effective-text-search.test.ts` [PG]
- [ ] T057 [P] [US3] (S2) **RED** `backend/test/integration/seo/effective-text-derived-meta.test.ts` [PG]: derived title / description and sitemap entries use the (C, L) text; an empty SEO title / description override yields the derived value (round 6, US10 #4)
- [ ] T058 [P] [US3] (S2) **RED** `backend/test/integration/price_lists/product-lines-global-name.test.ts` [PG]: price-book product lines page and search by the Global name (one admin key)
- [ ] T059 [P] [US3] (S2) **RED** `backend/test/integration/search/language-restricted-match.test.ts` (Meilisearch): Polish shopper "drill" does not find "Wiertarka X"; finds it by "wiertarka"; C×L vs Global per channel (FR-033) — plus a language not offered by the channel is refused before interpolation, and a product inactive at (C, L) is absent
- [ ] T060 [P] [US3] (S2) **RED** package tests: `packages/admin-kit/src/components/product-browser/product-line.test.ts`, `packages/page-builder-admin/src/chrome/CatalogPickers.test.tsx` — Global string (FR-031)
- [ ] T061 [P] [US3] (S2) **RED** `storefront/test/catalog/pdp-scoped-texts.test.ts`: PDP name, description (empty override renders none, US2 #9), alt text (empty override → `alt=""`, round 6), attachments and packaging at (C, L)

### Implementation

- [ ] T062 [US3] (S1) Implement `effectiveTexts` / `effectivePackagingUnitNames` in `packages/modules/catalog/src/backend/services/product-availability.service.ts` (replacing `effectiveNames`) and the port registration in `src/backend/index.ts` — T049 green
- [ ] T063 [P] [US3] (S2) carts: `cart-line-meta.ts`, `cart-service.ts`, `cart-minimums.ts`, `cart-upsell-service.ts`, `cart-admin-service.ts`, `routes.ts` in `packages/modules/carts/src/backend/` — T050 green
- [ ] T064 [P] [US3] (S2) orders: `packages/modules/orders/src/backend/services/order-service.ts` (+ compile-verify `order-api-intake-service.ts`, `placement-minimums.ts`, `preview-line-availability.ts`, `returnable-at-purchase.ts`) — T051 green
- [ ] T065 [P] [US3] (S2) quote_requests: `rfq-service.ts`, `rfq-admin-service.ts`, `packaging-resolution.ts` in `packages/modules/quote_requests/src/backend/services/` — T052 green
- [ ] T066 [P] [US3] (S2) comparisons: `packages/modules/comparisons/src/backend/services/comparison-service.ts`, `src/admin/document-blocks/canvas.tsx` — T053 green
- [ ] T067 [P] [US3] (S2) inventory: `availability-worker.ts`, `low-stock-alert-service.ts`, `availability-notification-service.ts` in `packages/modules/inventory/src/backend/services/` — T054 green
- [ ] T068 [P] [US3] (S2) product_feeds: `feed-generation.service.ts`, `routes.admin.ts`, `src/admin/components/TemplatePreviewController.tsx` in `packages/modules/product_feeds/` — T055 green
- [ ] T069 [P] [US3] (S2) quick_order: `packages/modules/quick_order/src/backend/routes.ts` — T056 green
- [ ] T070 [P] [US3] (S2) seo reader half: `meta-tag-resolver.service.ts`, `sitemap-generator.service.ts` in `packages/modules/seo/src/backend/services/` — T057 green
- [ ] T071 [P] [US3] (S2) price_lists: `packages/modules/price_lists/src/backend/services/price-book-reads.ts`, `attribute-eligibility.ts` (`scopeLevels`) — T058 green
- [ ] T072 [P] [US3] (S2) Global-string readers: `packages/modules/crm/src/backend/services/reference-service.ts`, `crm/src/admin/lib/references.ts`, `packages/modules/cms/src/admin/components/admin-catalog-preview-map.ts`, `packages/modules/audit_logs/src/backend/services/recent-activity-service.ts` (string or legacy map), `packages/admin-kit/src/components/product-browser/{product-line.ts,ProductBrowserDialog.tsx}`, `packages/page-builder-admin/src/{chrome/CatalogPickers.tsx,email/EmailEditorPane.tsx}` — T060 green
- [ ] T073 [P] [US3] (S2) Compile-verify and de-shim `shopping_lists`, `promotions`, `tasks`, `projects`, `platform`, `comparisons` contracts consumers
- [ ] T074 [US3] (S2) Search: `search-indexer.ts` (`texts.<L>` for every channel language, settings), `search-availability.ts` and `plugin.ts` (reindex boot check, pre-168 fallback logged), `search-query.service.ts` (`attributesToSearchOn` on `texts.<L>`, hit display) in `packages/modules/search/src/backend/` per `contracts/search-index.md`; update the indexer unit tests first — T059 green
- [ ] T075 [US3] (S2) Storefront: `storefront/app/(catalog)/p/[slug]/page.tsx`, `storefront/lib/api/catalog.ts` — an empty alt override renders `alt=""`, never the asset's alt text (round 6) — T061 green
- [ ] T076 [US3] (S2) Sweep each reader module's tests in `backend/test/{contract,integration}/<module>/` and `admin/test/modules/<module>/` to string names; remove the last `// 168-shim` outside catalog admin — T048 green except catalog admin files (S3 removes those in US5)

**Checkpoint C3**: readers green, T048 green (allow-list holds only S3's pending admin files, each named).

---

## Phase 6: User Story 4 — PIM and import write translations only where they are mapped (P2) — S2 (catalog side: S1)

**Goal**: the mapping contract, port v2, import profiles and the CSV grammar.
**Independent test**: spec US4 *Independent Test* (`quickstart.md` §3).

### Tests (RED)

- [ ] T077 [P] [US4] (S1) **RED** `backend/test/contract/catalog/scope-write-port-v2.test.ts` [PG]: only named cells touched; Global-only writes keep operator overrides (US4 #6, FR-044); per-cell refusals; `seo:*` refused; one audit entry per product; version bumped — plus the allowlist (`audience`, `product.*`, `seo:*`, roles, hidden, MOQ, returnable → `not_supported`), unregistered `source` refused, > 2 000 cells refused, duplicate cells refused, subject ids of another product → `subject_not_found` (R13a, R21)
- [ ] T078 [P] [US4] (S2) **RED** `backend/test/integration/import_export/import-profiles-migration.test.ts` [PG] and `backend/test/contract/import_export/import-profiles.test.ts` [PG]: CRUD, `catalog:write` gate (a `catalog:read` admin gets 403 on every profile route), one audit entry per Command, `IMPORT_PROFILE_NAME_TAKEN`, `IMPORT_PROFILE_NOT_FOUND` (FR-048)
- [ ] T079 [P] [US4] (S2) **RED** `backend/test/integration/import_export/products-csv-encoding.test.ts` [PG] (imports `SCOPED_WRITE_CASES`; US4 #9; FR-110…FR-113, SC-014) — plus the formula guard on text vs numeric columns (FR-118)
- [ ] T080 [P] [US4] (S2) **RED** `backend/test/integration/import_export/products-csv-mapping.test.ts` [PG]: US4 #1–#5, #8; unmapped-locale warning names the locale and product count (SC-005); `IMPORT_CELL_CONFLICT`; `IMPORT_PROFILE_REQUIRED`; header with an unknown channel → file error (FR-040…FR-043, FR-047) — plus header fuzz: ambiguous header, duplicate after normalisation, over-long codes, injection characters in codes → file error; caps (10 MiB, 50 000 rows, 500 columns); profile snapshot (an edit during the run has no effect); profile with `entity` ≠ `products` refused
- [ ] T081 [P] [US4] (S2) **RED** `backend/test/integration/import_export/products-csv-roundtrip.test.ts` [PG]: export → re-import unchanged writes 0 values; `INHERIT` / `NULL` / escaped text exported (FR-043, FR-114) — the file includes texts starting with `=`, `+`, `-`, `@`, TAB, CR and `'`; re-import is still a no-op (FR-118)
- [ ] T082 [P] [US4] (S2) **RED** `admin/test/modules/import_export/import-profiles.test.tsx`: profiles section, mapping editor, required profile on products import

### Implementation

- [ ] T083 [US4] (S1) `packages/modules/catalog/src/backend/services/catalog-write-ports.ts`: `catalogProductScopeWritePort` v2 on the save service's writers, Command `product.scoped_values.import` — T077 green with the R13a allowlist, registered `source`, call caps and duplicate refusal
- [ ] T084 [US4] (S1) `catalog-bulk-import.service.ts`: `ProductImportRow` v2 (scope cells) through the same writers; `exportScopedValues()` on `catalogBulkImportPort` replacing `exportScopedStatuses()`
- [ ] T085 [US4] (S2) `import_export` package: `./migrations` export in `packages/modules/import_export/package.json`, `src/migrations/index.ts`, scaffold `--module import_export --name import_profiles`, entity `src/backend/entities/import-profile.entity.ts`; `composer:generate`, `manifests:generate`, lockfile — T078 migration half green — `./migrations` export modelled on `packages/modules/seo/package.json:29`; class `Migration<STAMP>ImportExportImportProfiles`; `lower(name)` unique index as raw SQL
- [ ] T086 [US4] (S2) `src/backend/services/import-profile.service.ts`, Commands `import_profile.create/update/delete` (`src/backend/commands/import-profile.commands.ts`, `commandBus` from the container), routes in `src/backend/routes.ts` gated `requireAdmin('catalog:write')` behind the any-of gate, wiring in `src/backend/index.ts` — T078 green
- [ ] T087 [US4] (S2) `src/backend/services/adapters/products.adapter.ts` and `csv-codec.ts`: header grammar, `decodeCsvScopedCell`, `planLocaleWrites` with the profile, report warnings and field errors, `IMPORT_PROFILE_REQUIRED`; export through `encodeCsvScopedCell` with Global + scope columns and no profile (FR-043, round 6) — T079–T081 green — formula guard on export / import of text columns (FR-118); dry run (`dryRun=true`) and per-column `NULL` / `INHERIT` counts in every report (spec round 7); anchored header grammar and caps; per-product transactions; profile snapshot
- [ ] T088 [US4] (S2) Admin: Import profiles section and the required profile `Select` in `packages/modules/import_export/src/admin/pages/ImportExportPage.tsx` (admin-kit primitives; `catalog:write` only) — T082 green — dry run first, showing per-column `NULL` / `INHERIT` counts and warnings before "Apply"
- [ ] T089 [US4] (S2) `import_export` manifest: activation setting description (profiles are kept when off), `open-import-export-center` keywords (`profile`, `profil`, `mapping`, `mapowanie`); `i18n/{en,pl}.json` (`importProfiles.*`); off-state test `backend/test/contract/import_export/import-profiles-off-state.test.ts` [PG] (RED first: routes refused, section and action absent, profiles back after re-activation) (XVII)
- [ ] T090 [US4] (S2) `pim_connector`: manifest description (owns the locale-mapping contract and the whole-field grammar), `i18n/{en,pl}.json`, connector-author page in `packages/modules/pim_connector/docs/` (mapping, source language for Global, port v2, encoding, grammar) (FR-045, FR-046)

---

## Gate G-S3: prototype review before the editor stream (spec round 6)

- [x] T143 (designer + owner; coordinator tracks) Build a clickable prototype of the editor with `endora-commerce-designer` against `contracts/editor-ui.md` and `.claude/skills/ux-laws/SKILL.md`: the scope bar (switcher, banner, read-only line), `ScopedField` in every state (the "Use value from <parent scope>" checkbox, inheritance markers and source lines, empty override, Global only, not at this scope), the Save / Discard / Stay dialog and the "Applies immediately" labels; the owner reviews it; record the approval and any changes to `contracts/editor-ui.md` in a `docs(168)` commit. **No S3 task starts before this is checked**; S1 and S2 continue in parallel
  - Approved by the owner 2026-10-30 — prototype <https://claude.ai/artifact/6NSyfVSv3q4haqokHCCiU4>; outcome recorded in `contracts/editor-ui.md` §11.

---

## Phase 7: User Story 5 — One switcher sets the scope of the whole editor (P2) — S3

**Goal**: one scope bar; every tab at the editor scope; URL state.
**Independent test**: spec US5 *Independent Test*.

- [ ] T091 [P] [US5] (S3) **RED** `admin/test/modules/catalog/product-editor-scope-switcher.test.tsx`: US5 #1–#6; language names not codes; combobox past 8 options; banner text + icon + live region mounted empty first; `aria-busy` during a switch, no stale values (FR-050…FR-055, FR-057); no other scope selector in the DOM (SC-006)
- [ ] T092 [P] [US5] (S3) **RED** `admin/test/modules/catalog/product-editor-scope-url.test.tsx`: URL is the truth; preference seeds a URL without scope; invalid / stale scope → nearest valid scope with an announcement (FR-056, spec *Edge Cases*)
- [ ] T093 [US5] (S3) `packages/modules/catalog/src/admin/lib/scoped-editor-store.ts` (+ `scoped-editor-store.test.ts`, RED first) and `lib/scoped-values-api.ts` (GET / PUT / copy / preference clients replacing the editor's use of `product-scopes-api.ts` and `product-url-keys-api.ts`)
- [ ] T094 [US5] (S3) `packages/modules/catalog/src/admin/components/ProductScopeBar.tsx` (`contracts/editor-ui.md` §2)
- [ ] T095 [US5] (S3) Restructure `packages/modules/catalog/src/admin/pages/ProductEditor.tsx`: load through the read endpoint, URL state, every tab at the scope; delete `ProductScopeEditor.tsx`, the gallery Scope / Language selects, `ProductUrlKeysPanel`'s "Add override", `AttachmentScopesDialog.tsx`, the packaging translations dialog, `lib/product-scope-drafts.ts`, `lib/media-scopes.ts`; grep `admin/test/**` for every deleted file; remove the remaining `// 168-shim` in catalog admin — T091, T092 green
- [ ] T096 [US5] (S3) Tab labels into `packages/modules/catalog/i18n/{en,pl}.json` and the WAI-ARIA tabs pattern (FR-105, FR-107); test `admin/test/modules/catalog/product-editor-tabs.test.tsx` (RED first)

---

## Phase 8: User Story 6 — Each scoped field says whether it inherits (P2) — S3

**Goal**: one `ScopedField`, one polarity, empty overrides allowed only where FR-062 allows.
**Independent test**: spec US6 *Independent Test*.

- [ ] T097 [P] [US6] (S3) **RED** `packages/admin-kit/src/components/scoped-field/ScopedField.test.tsx`: every state of `contracts/editor-ui.md` §4; accessible names include the field; source line is the description; read-only not disabled (FR-060…FR-065)
- [ ] T098 [US6] (S3) Implement `packages/admin-kit/src/components/scoped-field/ScopedField.tsx`, export from `packages/admin-kit/src/components/index.ts`, kit strings in both languages — T097 green
- [ ] T099 [P] [US6] (S3) **RED** `admin/test/modules/catalog/product-editor-scoped-field.test.tsx`: US6 #1–#8 on text, select, date and list fields; clearing name refused naming the field; clearing description stages `empty`
- [ ] T100 [US6] (S3) Details and order rules on `ScopedField`: name, description, status, window, audience, MOQ, returnable in `pages/ProductEditor.tsx`, `components/ProductScopeControls.tsx` (reduced to field renderers), `components/ProductOrderRulesCard.tsx`; "Inherit (…)" options and opposite-polarity checkboxes retired (FR-063)
- [ ] T101 [US6] (S3) Media, attachments, packaging and URL key on `ScopedField`: `components/ProductGallerySection.tsx`, `components/ProductAttachmentsSection.tsx`, `components/PackagingUnitsEditor.tsx`, `components/ProductUrlKeysPanel.tsx` — T099 green
- [ ] T102 [US6] (S3) Global-only and not-at-this-scope states on every tab, the all-global-tab notice, "Edit at Global" / "Edit at <scope>" jumps (FR-081, FR-082)

---

## Phase 9: User Story 7 — One atomic Save of the current scope (P2) — S1 backend, S3 UI

**Goal**: one Save, one Command, one audit entry, all or nothing; Save / Discard / Stay.
**Independent test**: spec US7 *Independent Test* (SEO part completes in US10).

- [ ] T103 [P] [US7] (S1) **RED** `backend/test/contract/catalog/scoped-values-save.test.ts` [PG]: one audit entry with every cell's before / after (FR-072, SC-008); `changedFields`; warn-mode warnings (US7 #3, FR-098); re-applying the audit before-state through the API restores 100% of the fields (US7 #5, FR-074, SC-008); `409 VERSION_CONFLICT` writes nothing (US7 #6)
- [ ] T104 [P] [US7] (S1) **RED** `backend/test/contract/catalog/scoped-values-save-atomicity.test.ts` [PG]: failure injected in each family writer, a late `URL_KEY_TAKEN`, a refuse-mode gate → nothing written, no audit entry, no event (FR-071, FR-073, FR-076, SC-007)
- [ ] T105 [US7] (S1) Order the save: gate before any write, then the fixed write order; failure-injection seam for tests; audit projection carries a complete, re-applicable before-state — T103, T104 green
- [ ] T106 [P] [US7] (S3) **RED** `admin/test/modules/catalog/product-editor-save.test.tsx`: US7 #1–#6 UI half; Save / Discard / Stay (FR-075); staged changes survive tab switches (FR-083); the unsaved-changes prompt counts every staged change; per-field errors and per-pair gate refusal
- [ ] T107 [US7] (S3) Header Save, error mapping, switch-guard `ModalDialog`, `useUnsavedChangesPrompt` on the store; retire every per-section Save and auto-save that writes a scoped value or the product row (FR-070, round 6) — T106 green
- [ ] T144 [P] [US7] (S1) **RED** `backend/test/contract/catalog/scoped-values-version-immediate-actions.test.ts` [PG]: read the version; run every immediate action (add / remove / reorder a variant, bundle slot, grouped item, link, gallery item, attachment, packaging unit; replace an image asset; a price-book row write through `price_lists`; a channel-membership add; a stock change through `inventory`); then a Save with the **old** version → 200 and the staged cells written; a Save naming the removed gallery item's alt text → `422 SCOPED_VALUE_INVALID` `subject_not_found`, nothing written (FR-070, spec *Edge Cases*, R7)
- [ ] T145 [US7] (S1) Make T144 green in `packages/modules/catalog/src/backend/services/` (`gallery.service.ts`, `attachment.service.ts`, `packaging-unit.service.ts`, `product-link.service.ts`, `grouped.service.ts`, `bundle.service.ts`, variant writers in `catalog-admin.service.ts`): no structural Command marks the `Product` entity dirty or writes `products.scope_version`; `bumpScopeVersion` is called only by the scoped-value / product-row writers; `subject_not_found` in `scoped-values-save.service.ts`. A gap in another module (none expected: those cannot write `products`) goes to its owning stream
- [ ] T146 [P] [US7] (S3) **RED** `admin/test/modules/catalog/product-editor-immediate-actions.test.tsx`: staged scoped edits survive an immediate action on every tab; each immediate control is labelled "Applies immediately"; an immediate action neither stages nor saves; staged cells of a removed subject are dropped with an announced notice; the next Save sends the version read before the immediate action and succeeds (FR-070, US7 #7, spec *Edge Cases*)
- [ ] T147 [US7] (S3) "Applies immediately" labels on every structural / price-book / membership / stock control in `packages/modules/catalog/src/admin/**` (and through the existing zones for `price_lists`, `sales_channels`, `inventory` contributions — the label is rendered by the host around the zone); store refresh of one family without clearing `staged`; drop-and-announce for removed subjects — T146 green

---

## Phase 10: User Story 8 — Read-only access and fields that cannot change at this scope (P2)

**Goal**: one `catalog:write` check governs the editor (fixes F4); staged work is safe (F5).
**Independent test**: spec US8 *Independent Test*.

- [ ] T108 [P] [US8] (S1) **RED** `backend/test/contract/catalog/scoped-values-permissions.test.ts` [PG]: `catalog:read` reads every scope and gets 403 on `PUT …/scoped-values`, `POST …/copy`, `PATCH …/scopes`; no product write route accepts a `catalog:read` caller (FR-080, SC-010)
- [ ] T109 [P] [US8] (S3) **RED** `admin/test/modules/catalog/product-editor-read-only.test.tsx`: US8 #1–#5
- [ ] T110 [US8] (S3) Read-only mode from the session's permissions: no checkboxes (source text only), no Save / Archive / Restore / Duplicate / Delete; global actions say they are global (FR-080, FR-084) — T109 green; T108 green (backend gates already in place; fix any gap in `routes.admin.ts` via S1)

---

## Phase 11: User Story 9 — Scopable user attributes per scope (P2)

**Goal**: attribute inputs at every scope the model allows; "Copy to other channels".
**Independent test**: spec US9 *Independent Test*.

- [ ] T111 [P] [US9] (S3) **RED** `admin/test/modules/catalog/product-editor-attributes-scoped.test.tsx`: US9 #1–#3 for string, number, date, select, multiselect, boolean (FR-085)
- [ ] T112 [US9] (S3) Rewrite `packages/modules/catalog/src/admin/components/ProductAttributesTab.tsx` on `ScopedField` per value type — T111 green
- [ ] T113 [US9] (S3) "Scopable" flag with the scope-change preview in `packages/modules/catalog/src/admin/pages/AttributesManager.tsx` and `lib/attribute-scope.ts`; test `admin/test/modules/catalog/AttributesManager.scopable.test.tsx` (RED first) (FR-012)
- [ ] T114 [P] [US9] (S1) **RED** `backend/test/contract/catalog/scoped-values-copy.test.ts` [PG]: `dryRun` lists overwrites; copy writes every target in one Command and one audit entry; `empty` only for optional fields; `source_inherits`; invalid target → `SCOPE_INVALID`; version CAS (FR-086) — plus `toChannelIds` deduplicated, `urlKey` and non-text fields `not_supported`, dry run side-effect free (R21)
- [ ] T115 [US9] (S1) Command `product.scoped_values.copy_to_channels` and `POST …/scoped-values/copy` in `commands/scoped-values.commands.ts` / `routes.admin.ts` — T114 green
- [ ] T116 [US9] (S3) Copy dialog (`contracts/editor-ui.md` §8) in `packages/modules/catalog/src/admin/components/CopyToChannelsDialog.tsx` with `admin/test/modules/catalog/product-editor-copy.test.tsx` (RED first)

---

## Phase 12: User Story 10 — SEO fields inline at the editor scope (P2) — S2 backend, S1 catalog side, S3 UI

**Goal**: SEO read and written at the editor scope through `seo`'s ports, atomically.
**Independent test**: spec US10 *Independent Test*.

- [ ] T117 [P] [US10] (S2) **RED** `backend/test/integration/seo/product-meta-three-levels-migration.test.ts` [PG]: product locale-only rows removed, CHECK and the Global partial unique; category / CMS-page rows untouched; idempotent (FR-020, FR-026)
- [ ] T118 [US10] (S2) Scaffold `--module seo --name product_meta_three_levels` in `packages/modules/seo/src/migrations/` in the R22 order (delete locale-only product rows → drop old CHECK → new CHECK → Global partial unique → plain `(entity_type, entity_id)` index), entity notes in `seo-meta-override.entity.ts`, generated artefacts — T117 green
- [ ] T119 [P] [US10] (S2) **RED** `backend/test/contract/seo/product-meta-write-port.test.ts` [PG]: `applyWithin` writes on the caller's em, no flush, no audit, rolled back with the caller; refusals; `readWithin` (FR-091). Before writing the port, read the `check:command-coverage`, `check:transaction-context` and `check:port-shape` rows of `specs/conventions/check-inventory.md` (research R9, *Check estate*) — plus `ogImageUrl` other than http(s) (`javascript:`, `data:`) refused
- [ ] T120 [P] [US10] (S2) **RED** `backend/test/contract/seo/product-meta-read-relaxed.test.ts` [PG]: `catalog:read` → 200 on `GET …/seo/meta/product/:id` at G / C / C×L; 403 on `GET …/seo/meta/category/:id` and `…/cms_page/:id`; permission inventory sees the literal (FR-093, research R9 review) — plus the generic `PUT` / `DELETE …/seo/meta/product/:id` refused `422`; route-order regression (static product GET wins); `readScoped` with an invalid scope → 422
- [ ] T121 [US10] (S2) `seo` backend: `readScoped`, three-level `resolveForProduct` (an empty override yields the derived value, round 6) and `listScopesForProduct` in `meta-tag-resolver.service.ts`; `SeoProductMetaWritePort` implementation; `providePort('seoProductMetaWritePort', …)` in `src/backend/index.ts` (`// command-coverage-ignore:` marker naming catalog's Command on the caller-transaction writes; `em.execute` only; run `check:command-coverage`, `check:transaction-context`, `check:port-shape`); the static product GET route in `routes.ts`; product three-level addressing in PUT / DELETE — T119, T120 green — generic route refuses product writes; `ogImageUrl` scheme check at write and escaped, re-checked at render
- [ ] T122 [P] [US10] (S1) **RED** `backend/test/contract/catalog/scoped-values-seo.test.ts` [PG] (SEO title + name in one save, one transaction, one audit entry incl. SEO; injected SEO failure → neither written) and `backend/test/contract/catalog/scoped-values-seo-off.test.ts` [PG] (`seo` off: read `seo: null`, save without SEO succeeds, save with SEO `503 MODULE_DISABLED` and nothing written; full restoration on re-activation) (FR-090…FR-092, XVII)
- [ ] T123 [US10] (S1) Catalog: `nonBindingDependencies` `refuses-without` entry for `seoProductMetaWritePort` in `packages/modules/catalog/src/manifest.ts`; read endpoint's `seo` block behind `effectiveState.isPresent('seo')`; save step 8 with `lazyPort` inside the Command; `check:port-dependencies`, `check:port-catches` — T122 green
- [ ] T124 [P] [US10] (S3) **RED** `admin/test/modules/seo/product-seo-section.test.tsx` (fields at the scope with sources, staging through `onStage`, read-only mode) and `admin/test/modules/catalog/product-editor-seo-off.test.tsx` (no contributor → no SEO tab, no request, no error)
- [ ] T125 [US10] (S3) `packages/modules/seo/src/admin/zones/ProductSeoSection.tsx` contributed to `product.editor.seo` in `seo/src/admin/index.ts`; delete `ProductSeoLink.tsx` and its contribution; host mount and tab visibility in `ProductEditor.tsx` — T124 green
- [ ] T148 [P] [US10] (S3) **RED** `admin/test/modules/seo/seo-screen-product-link.test.tsx`: `/seo` edits categories and CMS pages; a product shows only a link to `/catalog/products/:id?tab=seo` (FR-094, US10 #5)
- [ ] T126 [US10] (S3) `/seo` screen: `packages/modules/seo/src/admin/pages/SeoMetaScopeEditor.tsx` / `SeoPage.tsx` keep category / CMS-page scopes; the product mode is replaced by the link (FR-094); `seo/i18n/{en,pl}.json` UI keys; catalog-side `whenAbsent` wording handed to S1 — T148 green

---

## Phase 13: User Story 11 — What is missing at the current scope (P3)

**Goal**: the gate's missing values named at the editor scope.
**Independent test**: spec US11 *Independent Test*.

- [ ] T127 [P] [US11] (S1) **RED** `backend/test/contract/catalog/scoped-values-completeness.test.ts` [PG]: summary at C×L, C (fields × languages) and G (count of incomplete pairs); a Global value satisfies every (C, L) (FR-095…FR-097)
- [ ] T128 [US11] (S1) Completeness summary per level in `scoped-values-read.service.ts` — T127 green
- [ ] T129 [P] [US11] (S3) **RED** `admin/test/modules/catalog/product-editor-completeness.test.tsx`: US11 #1–#3; links focus the field; warn-mode warnings announced (FR-097, FR-098)
- [ ] T130 [US11] (S3) Completeness markers and summaries in `ProductScopeBar.tsx` and `ScopedField` usage (`contracts/editor-ui.md` §9) — T129 green

---

## Phase 14: User Story 12 — The scope map switches the editor scope (P3) — S3

**Goal**: real links from the overview into the editor; delivers 163 L7.
**Independent test**: spec US12 *Independent Test*.

- [ ] T131 [P] [US12] (S3) **RED** `admin/test/modules/catalog/product-scope-overview-links.test.tsx`: US12 #1–#4; links are `<a href>`; the Language row is gone; the guard dialog fires with staged changes (FR-100, FR-101, FR-075)
- [ ] T132 [US12] (S3) `packages/modules/catalog/src/admin/components/ProductScopeOverview.tsx` and `lib/scope-overview.ts`: "Edit at <scope>" links, field links with `&field=`, Language row removed, resets and orphan deletion kept — T131 green

---

## Phase 15: Polish and cross-cutting

- [ ] T133 [P] (S3) Field zone scope props (FR-106): host passes `scope` and `languageCodes: null` to `product.editor.field.after`; `admin/test/modules/catalog/product-editor-field-zone.test.tsx` (RED first) proves a contributor ignoring `scope` still renders
- [ ] T134 [P] (S3) **SC-013** `admin/test/modules/catalog/product-editor-a11y.test.tsx`: axe-core at G, C and C×L, read-only and with errors — 0 violations
- [ ] T135 [P] (S1) Palette (FR-108, XVI): `open-products` keywords (`scope`, `zakres`, `kanał`, `język`, `translation`, `tłumaczenie`) in `packages/modules/catalog/src/manifest.ts` and both catalog bundles (via S3); run `pnpm --filter backend run check:action-route-permissions`, `pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts`
- [ ] T136 [P] (S2/S3) i18n sweep (FR-105): `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`; every new string in `en` and `pl` for catalog, seo, import_export, pim_connector, admin-kit; `pnpm run check:language`
- [ ] T137 [P] (S1) Docs (en) and Polish mirrors per `specs/conventions/module-documentation.md`: `packages/modules/catalog/docs/` (three-level scopes, "Use value from <parent scope>", empty overrides, URL keys and redirects, the write encoding stated against JSON Merge Patch and Magento — FR-115), `import_export/docs/` (profiles, CSV grammar), `seo/docs/` (inline SEO, relaxed read), `search/docs/` (reindex, language-restricted match), `pim_connector/docs/` (T090); `docs/i18n/pl/…` and `docs/translation-cache/pl/…`
- [ ] T138 [P] (S1) Changesets in `.changeset/` per plan *Compatibility and release*: `minor` with BREAKING bodies for contracts, mod-catalog, mod-seo, mod-search, mod-import-export, mod-pim-connector, admin-kit, page-builder-admin (in-place `null` change FR-116 with old and new call; removed routes; name / description strings; grammar; reindex); `patch` for each reader package; the R20 follow-up list in the contracts body (FR-117); `pnpm --filter backend run check:release-intent`
- [ ] T139 [P] (S2) Measurements "After" column of `quickstart.md` § *Measurements*: search index bytes and p95 latency (1 and 3 languages, `contracts/search-index.md` §4), listing bench vs 163 SC-004 (+10%), editor scope switch (SC-012: one request, no slower than a product page load)
- [ ] T140 (all) Fixture sweep and stale-reference trap: grep `backend/test`, `admin/test`, `storefront/test`, `packages/*/src/**/*.test.*` for `'{"en-US"`, product `name: {`, `nameTranslations`, `altText: {`, deleted file names and removed routes (`value-overrides`, `scope-context`, `ProductScopeEditor`, `AttachmentScopesDialog`, `ProductSeoLink`, the three 163 entities); re-derive the module-removal ledger entries the deletions free (AGENTS.md *traps*)
- [ ] T141 (S1) Final gate, recording which suites ran: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm run check:naming && pnpm run check:language`, `pnpm --filter backend run check:module-boundary`, `check:port-dependencies`, `check:port-catches`, `check:port-shape`, `check:transaction-context`, `check:command-coverage`, `check:off-state-coverage`, `check:admin-zones`, `check:error-translations`, `check:module-docs`, `check:docs-translations`, `check:demo-data-budget`, `check:test-ownership`, `check:entry-presence`, `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts test/unit/db/fk-dependency-drift.test.ts test/unit/db/migrations-registry.test.ts`, `manifests:check`, `pnpm --filter '!backend' run test`, the targeted suites of `quickstart.md` §5, T048 with an empty allow-list for 168 shims; the demo suites `backend/test/integration/demo/{demo-shop,demo-instance-shape,demo-reset-after-use}.test.ts` (SC-002); walk `quickstart.md` §0–§4 on the dev stack
- [ ] T142 (S1) Prepare (in the merge-request description, not files) the follow-up issue bodies: research R20 rows 1–7 (FR-117) and "Restore this save" on the save's audit entry (FR-074 follow-up, round 6), and `seo_meta_overrides` rows left by a deleted product (R22)

---

## Dependencies and execution order

```text
Phase 1 ─► Phase 2 (S1) ─► C1 ─┬─► US2 (S1) ─────────────┬─► US7 backend (S1) ─► US10 catalog side (S1) ─► US11 backend (S1)
                               │        │                │        ▲                      ▲
                               │        ├─► US3 port (S1)┘        │                      │
                               │        │                         │                      │
                               ├─► US3 readers + search (S2) ─► US4 (S2; T083–T084 S1 after US2) ─► US10 seo backend (S2)
                               │
                               └─► T143 prototype gate ─► US5 (S3, API mocked) ─► US6 ─► US7 UI ─► US8 ─► US9 ─► US10 UI ─► US11 UI ─► US12
US1's tests (T026 S1, T027 S3) are written at C1 and turn green after US2 + US5–US7 + US9.
Polish after every story; T141 last.
```

- **Within a story**: RED tests → services / models → routes → UI → the story's green tests.
- **Cross-stream joins**: S3 switches from mocks to the live endpoints at **C2** (after T038, T105); US10's UI (T125)
  needs T123 (S1) and T121 (S2); US4's catalog half (T083, T084) needs US2's save service (T037).
- **Shared-file hand-offs**: the catalog manifest (T123, T135) and `routes.admin.ts` are S1's; S3 sends its catalog
  manifest keyword change and S2 its `whenAbsent` wording to S1. Catalog i18n bundles are S3's after C1.

## Parallel examples

- **Phase 2**: T004, T005, T006 together (three contract test files); then T007, T008, T010 together.
- **US2**: T028–T033 together (six test files); T039, T040, T041, T042 in parallel after T037.
- **US3 (S2)**: T050–T061 together; then T063–T073 together (one module each); T074 and T075 after their tests.
- **US4**: T078–T082 together; T085 → T086 → T087, with T088 in parallel to T087.
- **Three builders at once after C1**: S1 on US2, S2 on US3 readers, S3 on US5 — disjoint files by the ownership
  rule above.

## Implementation strategy

One release (round 3), so "MVP" is an internal milestone, not a ship: **Phases 1–2 + US2 + US3** make the model and
every reader correct (the P1 data-safety core); **US5 + US6 + US7** then make US1's regression tests green — the
first point at which the editor is usable end to end and the natural mid-feature review. US4 and US8–US10 complete
P2; US11–US12 (P3) and Polish finish the release. The prototype gate T143 opens S3; S1 and S2 do not wait for it.

## Traceability (every FR and SC → task)

| Requirement | Tasks |
| --- | --- |
| FR-001 (removed), FR-021…FR-025 (removed) | — |
| FR-002, FR-003, FR-004, SC-001 | T026, T027 |
| FR-010, FR-011, FR-012, FR-013, FR-014, FR-015 | T004, T007, T029, T032, T035 (FR-012 attributes: T042, T113; FR-013 round-6 exceptions: T057, T061, T075, T121) |
| FR-016 | T018, T030, T039, T149 |
| FR-017, FR-018, SC-004 | T029 |
| FR-020, FR-026, SC-002 | T015–T019, T024, T078, T117 |
| FR-030, FR-031, FR-032, SC-003 | T049–T058, T060–T073, T075 |
| FR-033 | T059, T074 |
| FR-034 | T048, T076, T141 |
| FR-040, FR-041, FR-042, FR-044, FR-046, FR-047, SC-005 | T006, T010, T077, T080, T083 |
| FR-043, FR-114 | T081, T084, T087 |
| FR-116 softening (dry run counts, round 7) | T080, T087, T088 |
| FR-045 | T090 (contract delivered; connector screens external) |
| FR-048 | T078, T082, T085–T089 |
| FR-050…FR-055, FR-057, SC-006 | T091, T094, T095 |
| FR-056 | T044, T092, T093 |
| FR-060…FR-065, SC-009 | T097–T102 |
| FR-070, FR-071, FR-072, FR-073, FR-074, FR-076, SC-007, SC-008 | T038, T103–T107, T144–T147 |
| FR-075 | T106, T107, T131 |
| FR-077 | T040, T046 |
| FR-080, FR-084, SC-010 | T108–T110 |
| FR-081, FR-082 | T102 |
| FR-083 | T106, T107 |
| FR-085 | T111, T112 |
| FR-086 | T114–T116 |
| FR-090, FR-091, FR-092 | T119, T121–T125 (US10 #4 SEO empty → derived: T057, T121) |
| FR-093 | T120, T121 |
| FR-094 | T148, T126 |
| FR-095, FR-096 | T033, T035, T127 |
| FR-097, FR-098 | T103, T127–T130 |
| FR-100, FR-101 | T045, T131, T132 |
| FR-105 | T014, T096, T136 |
| FR-106 | T133 |
| FR-107 | T096 |
| FR-108 | T135 |
| FR-109 | T004, T036 |
| FR-110, FR-111, FR-112, FR-113, SC-014 | T005, T008, T031, T079, T006 |
| FR-118 (formula guard) | T005, T008, T079, T081, T087 |
| Security review (R13a, R21) | T037, T059, T077, T080, T083, T114, T119–T121, T150 |
| Schema review (R7, R22) | T015–T019, T037 |
| FR-115 | T137 |
| FR-116 | T011, T040, T138 |
| FR-117 | T138, T142 |
| SC-011 | T141 (`quickstart.md` §4 walk, timed) |
| SC-012 | T003, T139 |
| SC-013 | T134 |
| Prototype gate (spec *Assumptions*, round 6) | T143 |
