# Tasks: Product content attributes (Page Builder documents on the product page)

**Input**: `specs/172-product-content-attributes/` — spec.md (OR-1 – OR-8), plan.md, research.md
(R-1 – R-21), data-model.md, contracts/, quickstart.md
**Prerequisites**: plan.md, spec.md (both required); research.md, data-model.md, contracts/

**Tests**: required. Constitution III (TDD) is non-negotiable. Every implementation task names
the test task(s) it turns green, and that test task comes **before** it and must be seen to
**fail** first. Every FR maps to a test task in the *FR → test traceability* table at the end.

**Suites** (plan § *Test plan*): **U** = co-located package unit (`pnpm --filter '!backend' run
test`); **C** = backend contract, and **I** = backend integration. C and I are not run by merge
request pipelines (D-198), so run them locally on `pnpm run dev:infra:test`. **A** = admin (`pnpm
--filter admin exec vitest run …`); **S** = storefront (`pnpm --filter storefront exec vitest run
…`).

**Shell**: `export PATH=~/.nvm/versions/node/v22.22.2/bin:$PATH` first. After **every** edit to a
package (`packages/**`), run `pnpm run build:packages` before running anything that imports it
(AGENTS.md § Stack, D-164).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — a different file from every other open task in the same phase,
  with no dependency on an incomplete task.
- **[USn]**: the user story from spec.md.
- Paths are repository-relative.

---

## Phase 1: Setup

**Purpose**: a known-green baseline, so a red test later can be told apart from one that was red
before.

- [X] T001 Run `pnpm run build:packages`, `pnpm -r run typecheck`, and
  `pnpm --filter backend exec vitest run test/contract/catalog/category-content.test.ts
  test/contract/catalog/attributes-admin-v012.test.ts test/contract/catalog/product-detail-visible-attributes.test.ts`
  plus `pnpm --filter storefront exec vitest run test/catalog/category-content.test.tsx
  test/components/ParametryTab.test.tsx` on the branch before any change. Record any pre-existing
  failure in the merge request description; do not fix it here.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the shared vocabulary, storage and pure helpers that every story uses. No story can
start before this phase is green.

### Tests first (RED)

- [X] T002 [P] Write `packages/contracts/src/product-content.test.ts` (NEW, U). Cover:
  `page_builder` in `customFieldValueTypeSchema`, `attributeValueTypeSchema` and
  `apiAttributeTypeSchema`; `apiAttributeTypeOf('page_builder', …) === 'page_builder'`;
  `CUSTOM_FIELD_FILTER_OPERATORS.page_builder` deep-equals `[]`; `'value_type_unsupported'` in
  `CUSTOM_FIELD_DEFINITION_ERROR_CODES`; `PAGE_BUILDER_CONTENT_MAX_BYTES === 1_048_576 ===
  CATEGORY_CONTENT_MAX_BYTES`. For `productContentEnvelopeSchema`: strict, nullable, accepts exactly
  1 048 576 UTF-8 bytes and refuses 1 048 577 with a message containing `1048576`. Also cover
  `putProductContentRequestSchema`, `adminProductContentSchema`,
  `adminProductContentListSchema`, `adminAttributeUsageSchema`,
  `productPageContentAttributeSchema`, `productDetailQuerySchema` (refuses `include=other`), an
  optional `productDetailSchema.contentAttributes`, `'product_content'` in
  `assetReferenceKindSchema`, and `'product.content.editor'` in `AdminZoneNameSchema`
  (FR-010, FR-012 schema half). Run it and confirm it fails.
- [X] T003 [P] Extend the existing mapping tests so they fail without the new member:
  `packages/contracts/test/attribute-type-mapping.unit.test.ts` (bijection includes
  `page_builder`) and `packages/contracts/src/custom-fields.test.ts` (operator table has a
  `page_builder` row with no operator).
- [X] T004 [P] Extend `packages/modules/catalog/src/backend/services/attribute-cf-type-mapping.test.ts`
  (U): `legacyToCfType('page_builder')` → `{ cfValueType: 'page_builder', selectDisplay: null,
  numericKind: null }` and back through `cfToLegacyValueType`.
- [X] T005 [P] Write `packages/modules/catalog/src/backend/services/page-builder-content.test.ts`
  (NEW, U). Cover `hasPageBuilderBlocks`, and `normalisePageBuilderEnvelope`, which drops languages
  with no block and returns `null` when none remains (FR-013). Cover `summarisePageBuilderDocument`:
  top-level block count, then the first of `text`/`title`/`heading`/`body`/`html`, tags stripped,
  whitespace folded, cut at 120 characters, `null` when there is no text (R-3). Cover
  `pageBuilderEnvelopeBytes` (UTF-8 byte length of the JSON). Cover `resolvePageBuilderLanguage`
  order: `ctx.preferredLanguage`, then `ctx.resolvedChannel.defaultLanguage`, then `en-US`, then
  `en`, then every stored key, skipping a language with no block (FR-033, R-12).
- [X] T006 [P] Write `storefront/test/catalog/product-tabs.test.ts` (NEW, S). It pins **today's**
  tab decisions for `productTabPlan`: description tab present iff `description` is non-empty, and
  the attachments count. It does not pin the raw "Parametry" table, which US4 removes.

### Implementation (GREEN)

- [X] T007 Implement the contracts in `packages/contracts/src/custom-fields.ts`,
  `packages/contracts/src/catalog.ts` (the `CatalogBulkImportPort.contentAttributeKeys()` member
  too), `packages/contracts/src/assets-library.ts` and `packages/contracts/src/admin-contributions.ts`
  (`ProductContentEditorZoneProps`, the zone-props map entry, and a doc comment on the inverted
  direction, modelled on `category.content.editor`), per data-model §3–§4. Then run
  `pnpm run build:packages`. Turns T002 and T003 green.
- [X] T008 Add `page_builder` to `CfAttributeValueType`/`DbAttributeValueType`, `legacyToCfType`
  and `cfToLegacyValueType` in `packages/modules/catalog/src/backend/services/attribute-type-mapping.ts`.
  Add the matching explicit cases wherever `pnpm -r run typecheck` now reports a non-exhaustive
  switch (expected: research R-4 sweep table). Turns T004 green.
- [X] T009 Create `packages/modules/catalog/src/backend/services/page-builder-content.ts` with the
  T005 functions. **Move** `hasPageBuilderBlocks` there from
  `packages/modules/catalog/src/backend/services/catalog-query.service.ts`, and keep a re-export at
  the old site. Switch `getCategoryPageContent` to `resolvePageBuilderLanguage`. Turns T005 green;
  `backend/test/contract/catalog/category-content.test.ts` and
  `storefront/test/catalog/category-content.test.tsx` stay green. Then run
  `grep -rn "hasPageBuilderBlocks" backend/test packages --include=*.ts` and fix any importer
  (AGENTS.md trap: `test:unit:fast` does not see the contract and integration trees).
- [X] T010 Scaffold the migration with `pnpm --filter backend run migration:new -- --module catalog
  --name product_content_values`. Do not pick a number. Fill
  `packages/modules/catalog/src/migrations/<STAMP>_catalog_product_content_values.ts` per
  data-model §2: table, both FKs `on delete cascade`, `unique (product_id, product_attribute_id)`,
  `index (product_attribute_id)`, and `down` = drop table. Add the class to
  `packages/modules/catalog/src/migrations/index.ts`, in both the array and the named export.
- [X] T011 Create `packages/modules/catalog/src/backend/entities/product-content-value.entity.ts`
  (`@GlobalEntity()`, data-model §2). Register it wherever the catalogue's entity list is declared
  (follow `category.entity.ts`).
- [X] T012 Run `pnpm --filter backend run composer:generate`, then `composer:check`. Commit the
  regenerated `backend/src/db/migrations-registry.generated.ts` and
  `backend/src/db/entities-registry.generated.ts`, and never edit them by hand. Apply the migration
  locally (`migrate.ts up` or `pnpm run setup`).
- [X] T013 Extract the tab construction of `storefront/app/(catalog)/p/[slug]/page.tsx` into
  `storefront/lib/catalog/product-tabs.ts` (NEW) as `productTabPlan`, with no behaviour change, and
  make `page.tsx` consume it. Turns T006 green; the existing storefront suite stays green.

**Checkpoint**: contracts built, table migrated, helpers and tab plan in place. Stories can start.

---

## Phase 3: User Story 1 — Define a content attribute and add it to an attribute set (P1) — MVP

**Goal**: an operator creates a `page_builder` attribute with every excluded capability held off,
language scoping held on and the type locked, and puts it in a set. Only product hosts accept the
type. The definition-driven phase-1 exclusions hold.

**Independent test**: spec US1. Create one, try every excluded flag through the screen and the API,
add it to a set, read it back.

### Tests (RED)

- [X] T014 [P] [US1] Write `packages/modules/catalog/src/backend/services/content-attribute-rules.test.ts`
  (NEW, U). Each of the 12 flags (`isSearchable`, `isFilterable`, `isVariantAxis`,
  `displayAsSlider`, `isComparable`, `quickSearchable`, `isPromoRule`, `isPriceRule`,
  `massEditable`, `isRequired`, `isVisibleOnProductPage`, `channelScoped`) set `true` is refused
  with `details[].path` = the flag, one detail per offending flag. `languageScoped: false` is
  refused. An omitted `languageScoped` resolves to `true`. `assertTypeChangeAllowed` refuses both
  directions and allows non-`page_builder` changes (FR-003, FR-004, FR-005).
- [X] T015 [P] [US1] Write `packages/modules/custom_fields/src/backend/services/page-builder-admissibility.test.ts`
  (NEW, U). The registry marker `pageBuilderValues` is on `product` only. `applyCreate` refuses
  `page_builder` with `value_type_unsupported` for order, organization, customer, category,
  quote_request, opportunity, project and task, and accepts product. `applyUpdate` refuses a
  `valueType` change to or from `page_builder` with `value_type_locked`. `coerce` gives
  `page_builder` → `wrong_type`. List-filter predicates are `[]` (FR-002, FR-005).
- [X] T016 [P] [US1] Write `backend/test/contract/catalog/content-attribute-definition.contract.test.ts`
  (NEW, C). Create `type: 'page_builder'` and read back `languageScoped: true`, every flag `false`,
  and `type`/`valueType` `page_builder` (FR-001, FR-004). Create **and** PATCH with each flag,
  expecting `400 VALIDATION_FAILED` with `details[].path` and nothing stored (FR-003).
  `languageScoped: false` → 400. Non-empty options → 400. A type change in either direction → 409
  (FR-005). Add to a set, reorder, and read the position back (FR-006).
- [X] T017 [P] [US1] Write `backend/test/contract/custom_fields/page-builder-admissibility.contract.test.ts`
  (NEW, C). The generic `POST /api/v1/admin/custom-fields/definitions` with `entityType: 'order'`
  and `valueType: 'page_builder'` → 400 `value_type_unsupported`. A PATCH turning a product
  definition into `page_builder` → refused (FR-002).
- [X] T018 [P] [US1] Write `backend/test/contract/catalog/product-content-exclusions.contract.test.ts`
  (NEW, C), in a `describe('definition-driven exclusions')` block:
  - a channel-override write for the content key is refused (FR-040);
  - `/attributes/by-flag?flag=isMassEditable` omits it, and a bulk update naming it →
    `ATTRIBUTE_NOT_MASS_EDITABLE` (FR-043);
  - the promotions attribute picker, the price-list rule attributes, the comparable keys and
    `GET /api/v1/catalog/filters` each omit it (FR-046);
  - api-key `GET /api/v1/catalog/attribute-sets/:id` omits the member, while the admin read of the
    same set keeps it (FR-042, mapping offers);
  - the feed template field picker omits it, and saving a template that names it is refused
    (FR-044).
- [X] T019 [P] [US1] Write `admin/test/modules/catalog/AttributesManager.page-builder.test.tsx`
  (NEW, A). The type is offered. With it chosen, the excluded controls are not rendered, the
  language and CMS note shows, and the options editor is hidden. The row's inline flags are
  disabled, with the locked title. The type selector is disabled on edit in both directions (FR-001,
  FR-003, FR-005 UI).
- [X] T020 [P] [US1] Write `admin/test/modules/custom_fields/DefinitionForm.page-builder.test.tsx`
  (NEW, A): the generic definition form never offers a Page Builder type (FR-002 UI).
- [X] T021 [P] [US1] Write `packages/modules/product_feeds/src/backend/services/field-source-catalogue.test.ts`
  (NEW, U): the exported definition filter drops `valueType === 'page_builder'` (FR-044). Also
  write `admin/test/modules/product_feeds/FeedCriteriaPanel.page-builder.test.tsx` (NEW, A): the
  criteria picker never lists a `page_builder` attribute (FR-044).

### Implementation (GREEN)

- [X] T022 [US1] In `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts`,
  add the `pageBuilderValues?: true` marker and set it on `product`. In
  `custom-field-definition-apply.ts`, add the `value_type_unsupported` and `value_type_locked`
  refusals. In `custom-field-value.service.ts`, add the explicit `page_builder` → `wrong_type` case.
  In `custom-field-list-filter.service.ts`, add the explicit no-predicate case. Leave
  `src/admin/components/DefinitionForm.tsx` `VALUE_TYPES` **unchanged**. Turns T015, T017 and T020
  green.
- [X] T023 [US1] Create `packages/modules/catalog/src/backend/services/content-attribute-rules.ts`
  (R-6). Turns T014 green.
- [X] T024 [US1] Call the rules from `createAttributeCommand` and `updateAttributeCommand` in
  `packages/modules/catalog/src/backend/commands/attribute-commands.ts`, using the **effective**
  post-patch flags. Write `languageScoped: true` on create. Map `value_type_unsupported` to `400`
  in `toCatalogHttpError`. Turns T016 green.
- [X] T025 [US1] Add `getSetDetail(id, { includeContent })` to
  `packages/modules/catalog/src/backend/services/attribute-set.service.ts`, and pass
  `includeContent: false` from `packages/modules/catalog/src/backend/routes.api-key.ts`. Turns T018
  (FR-042 part) green.
- [X] T026 [US1] Add the `page_builder` filter to `listProductFieldDefinitions` in
  `packages/modules/product_feeds/src/backend/plugin.ts`, through a pure exported filter in
  `packages/modules/product_feeds/src/backend/services/field-source-catalogue.ts`. Add the type
  filter to `packages/modules/product_feeds/src/admin/components/FeedCriteriaPanel.tsx`. Turns T021
  and T018 (FR-044 part) green.
- [X] T027 [US1] In `packages/modules/catalog/src/admin/pages/AttributesManager.tsx`, add the type
  option, the hidden capability controls, the note, the locked inline flags and the disabled type
  selector (admin-surfaces §5). Add `attributes.type.pageBuilder`,
  `attributes.pageBuilder.languageNote` and `attributes.pageBuilder.flagsLocked` to
  `packages/modules/catalog/i18n/en.json` and `packages/modules/catalog/i18n/pl.json`. Turns T019
  green.
- [X] T028 [US1] Run T018 in full. Its FR-040, FR-043 and FR-046 parts must be green with **no**
  code change, because they are structural (R-6, R-15). If one is red, fix it at the place research
  R-15 names. Do not filter on the consumer side.

**Checkpoint**: US1 is independently demonstrable (quickstart §1).

---

## Phase 4: User Story 2 — Author a product's content in the admin (P1) — MVP

**Goal**: card per content attribute, dedicated editing screen with the `cms` canvas, audited save,
ordinary value path refusing content keys.

**Independent test**: spec US2. Open the editor from the card, author two languages, save, check
the card, the audit row, and that other values are unchanged.

### Tests (RED)

- [X] T029 [P] [US2] Write `backend/test/contract/catalog/product-content.contract.test.ts` (NEW, C),
  in a `describe('admin content routes')` block:
  - `GET …/products/:id/content` returns summaries only (no `content` key), with members in
    position order and ties by key; unknown or soft-deleted product → 404 `PRODUCT_NOT_FOUND`
    (FR-020 data);
  - `GET …/content/:attributeKey` returns the envelope or `null`;
  - `PUT` stores the normalised envelope;
  - a body > 1 MiB → 400 whose message contains `1048576`, with nothing stored (FR-012);
  - a non-member or non-content key → 400 `ATTRIBUTE_VALUE_REJECTED` (FR-012);
  - every language empty, or `null` → row deleted and `content: null` (FR-013);
  - a request without `catalog:read` → 403 on GET; without `catalog:write` → 403 on PUT (FR-023);
  - exactly one audit row `product.content.update`, `before`/`after` = `{ attributeKey,
    languages }`, and no document bytes in the row (FR-024);
  - the product's fields, its `attribute_values` and other attributes' content are unchanged (spec
    edge case), and the last save wins per attribute (FR-010);
  - `product.content.updated.v1` is emitted and `product.updated.v1` is **not** (FR-035).
- [X] T030 [P] [US2] Extend `backend/test/contract/catalog/product-content-exclusions.contract.test.ts`
  with a `describe('ordinary value path')` block. Admin create, admin PATCH and api-key
  `PUT /api/v1/catalog/products/by-sku/:sku`, each carrying the content key in `attributeValues`,
  → 400 `ATTRIBUTE_VALUE_REJECTED` naming `attributeValues.<key>`. The refusal applies even when
  the key is resent as "already stored" (FR-014, FR-042 inbound).
- [X] T031 [P] [US2] Extend `packages/modules/catalog/src/backend/services/catalog-write-ports.test.ts`
  (U): `createProduct` and `updateProduct` through the write port refuse a content key (FR-014,
  FR-042 inbound).
- [X] T032 [P] [US2] Extend `packages/modules/catalog/src/backend/services/product-page-revalidation.test.ts`
  (U): the `product.content.updated.v1` handler calls `productChanged(productId)` (FR-035).
- [X] T033 [P] [US2] Write `admin/test/modules/cms/product-content-zone.test.tsx` (NEW, A). The
  contribution renders `PageBuilderEditor` with `activeLanguage={language}`, `resource={{ type:
  'catalog_product_content', id: productId }}` and the `product:<id>:<key>:<lang>` content key, with
  no palette restriction. It forwards `onChange` and never calls an API (FR-022, FR-025).
- [X] T034 [P] [US2] Write `admin/test/modules/catalog/ProductContentPage.test.tsx` (NEW, A):
  - the language switch covers en-US, pl-PL and a stored-only language;
  - Save issues **one** PUT carrying every edited language, and shows the success message;
  - the unsaved-changes prompt appears when leaving with edits (US2 #4);
  - without `catalog:write` the screen is read-only and has no Save (FR-023 UI, US2 #5);
  - a 404 shows the not-available message with the back link;
  - a draft produced by Translate is stored only on Save (FR-021, FR-025).
- [X] T035 [P] [US2] Write `admin/test/modules/catalog/ProductAttributesTab.content-cards.test.tsx`
  (NEW, A):
  - one card per content member, in position order, spanning both columns, with per-language
    chips, the summary and an **Edit content** link to `/catalog/products/:id/content/:key`
    (FR-020);
  - an absent `productId` → `saveFirst`, no link (FR-026);
  - the Details set ≠ the saved set → `saveSetFirst`, no link;
  - an emptied language shows as empty (US2 #8);
  - never a text input, and never a `product.editor.field.after` mount.

### Implementation (GREEN)

- [X] T036 [US2] Create `packages/modules/catalog/src/backend/services/product-content.service.ts`
  (NEW). It provides the card list (reads `summary` only), the single read, the replace
  (normalise → size check → summary → upsert, or delete when empty), and the current-set membership
  check through `attribute_set_attributes` ⋈ `product_attributes`. Add a co-located
  `product-content.service.test.ts` (U) for its pure ordering and membership helpers. Write that
  test first, and watch it fail first.
- [X] T037 [US2] Create `packages/modules/catalog/src/backend/commands/product-content-commands.ts`
  (NEW) with the Command `product.content.update` (data-model §5). Declare
  `product.content.updated.v1` on `CatalogEvents` in
  `packages/modules/catalog/src/backend/services/catalog-admin.service.ts`.
- [X] T038 [US2] Add the three content routes to `packages/modules/catalog/src/backend/routes.admin.ts`:
  GET list, GET one, and PUT with `bodyLimit = PAGE_BUILDER_CONTENT_MAX_BYTES + 65_536`. Gate them
  `catalog:read`/`catalog:write` (contracts/admin-api.md §4–§5).
- [X] T039 [US2] In `packages/modules/catalog/src/backend/index.ts`, register the service and
  subscribe `product.content.updated.v1` → `catalogProductPageRevalidation.productChanged`. Turns
  T029 and T032 green.
- [X] T040 [US2] Make `assertAttributeValueKeysAllowed` in
  `packages/modules/catalog/src/backend/services/catalog-admin.service.ts` refuse a `page_builder`
  key **before** the `existingKeys` exemption (R-7). Turns T030 and T031 green.
- [X] T041 [US2] Create `packages/modules/cms/src/admin/zones/ProductContentEditor.tsx` (NEW, the
  twin of `CategoryContentEditor.tsx`). Register it in `packages/modules/cms/src/admin/index.ts`
  with `requiredPermission: READ_PERMISSION`. Turns T033 green.
- [X] T042 [US2] Create `packages/modules/catalog/src/admin/pages/ProductContentPage.tsx` (NEW, the
  twin of `CategoryContentPage.tsx`). Add the route `/catalog/products/:id/content/:attributeKey` in
  `packages/modules/catalog/src/admin/index.ts` (`READ_PERMISSION`). Turns T034 green.
- [X] T043 [US2] Create `packages/modules/catalog/src/admin/components/ProductContentCard.tsx` (NEW),
  and add the `page_builder` branch in
  `packages/modules/catalog/src/admin/components/ProductAttributesTab.tsx`. Turns T035 green.
- [X] T044 [US2] Add the `productContent.*` keys and `auditLog.product.content.update` to
  `packages/modules/catalog/i18n/en.json` and `pl.json` (admin-surfaces §7, FR-027).
- [X] T045 [US2] Extend `admin/test/modules/batch-fifteen-surfaces.module-owned-surface.test.tsx`
  with the new `catalog` route, and `admin/test/modules/batch-sixteen-surfaces.module-owned-surface.test.tsx`
  with the new `cms` zone. Run both, and also `check:admin-zones` and `check:admin-surface`.
- [X] T046 [US2] Verify FR-027 by running `pnpm --filter backend exec vitest run
  test/unit/_i18n/registered-bundles-shape.test.ts`, `pnpm --filter backend run
  check:bundle-pairing` and `pnpm --filter backend run i18n:hardcoded`.

**Checkpoint**: US1 + US2 = author-side MVP (quickstart §2).

---

## Phase 5: User Story 3 — Customers see the content in the "Opis" tab (P1) — MVP

**Goal**: the PDP carries resolved content via `?include=content`, rendered SSR below the
description, in set order, with no heading. Every other product read is untouched. The
stored-content exclusions hold.

**Independent test**: spec US3. Products with description and content, content only, and neither;
check tab presence, order, language, SSR HTML, and that "Parametry" holds none of it.

### Tests (RED)

- [X] T047 [US3] Extend `backend/test/contract/catalog/product-content.contract.test.ts` with a
  `describe('PDP include=content')` block:
  - with no `include`, the response has no `contentAttributes` key and is byte-identical to before
    authoring;
  - `include=content` orders by position, then key (FR-030);
  - the language falls back from visitor to channel default to `en-US` to any stored language, and
    an empty language is skipped (FR-033);
  - the payload carries no label (FR-037);
  - `include=other` → 400;
  - an invisible product → 404 / 410 as today, with no content read;
  - a product without a set → `[]`.
- [X] T048 [P] [US3] Extend `backend/test/contract/catalog/product-content-exclusions.contract.test.ts`
  with a `describe('stored content never leaks')` block:
  - `GET /api/v1/catalog/products` and the search response are byte-identical before and after
    authoring content on every product (FR-011, FR-036, SC-006);
  - `?q=<word only in content>` gets no hit, and quick search gets no hit (FR-045);
  - `GET /api/v1/external/catalog/products/:id` has no `contentAttributes` (FR-042 outbound);
  - a products export carries neither the key nor any document text (FR-041 export).
- [X] T049 [P] [US3] Extend `packages/modules/import_export/src/backend/services/adapters/products.adapter.test.ts`
  (U). A row with a non-empty cell under a content-attribute column gets a per-row error naming the
  attribute. The row's other cells are still validated, and nothing is imported (FR-041 import,
  R-20 (3)).
- [X] T050 [P] [US3] Extend `packages/modules/catalog/src/backend/admin-search-provider.test.ts` (U):
  the admin product search query touches no content table or field (FR-045).
- [X] T051 [P] [US3] Extend `storefront/test/catalog/product-tabs.test.ts` with the description
  rule:
  - the four cases description only, content only, both and neither (FR-031);
  - a content attribute counts as drawable only when it has a top-level block that has no owner
    segment or whose owner is not in `absentModuleIds` (R-20 (4));
  - content never appears in `parameters` (FR-032).
- [X] T052 [P] [US3] Write `storefront/test/catalog/product-content.test.tsx` (NEW, S):
  - `renderToString` contains every content attribute in the order received, under
    `data-product-content`, with no heading or label (FR-030, FR-037, SC-007);
  - an HTML block is sanitised, and a block owned by a switched-off module is not drawn (FR-034);
  - `?variant=` does not change the content.
- [X] T053 [P] [US3] Extend `storefront/test/catalog/product-cache-tags.test.ts`: the `include`
  option keeps the per-product tags, and only `productById` passes it (FR-035, FR-036).

### Implementation (GREEN)

- [X] T054 [US3] Add `getProductPageContent(productId, attributeSetId, ctx)` to
  `packages/modules/catalog/src/backend/services/catalog-query.service.ts`, using
  `resolvePageBuilderLanguage`. Leave the CMS presence branch to T068.
- [X] T055 [US3] In `packages/modules/catalog/src/backend/routes.public.ts`, parse
  `productDetailQuerySchema` and call `getProductPageContent` **after** `getProductByIdOrSlug`.
  Confirm that `routes.external.ts` and the other callers do not call it. Turns T047 and T048
  (FR-042 part) green.
- [X] T056 [US3] Implement `contentAttributeKeys()` in
  `packages/modules/catalog/src/backend/services/catalog-bulk-import.service.ts`, and the per-row
  refusal in `packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`.
  Turns T049 green.
- [X] T057 [US3] Add the `include` option to `getProductBySlug` in `storefront/lib/api/catalog.ts`,
  and pass `{ include: ['content'] }` from `productById` in
  `storefront/app/(catalog)/p/[slug]/resolution.ts` only. Turns T053 green.
- [X] T058 [P] [US3] Create `storefront/components/catalog/ProductContent.tsx` (NEW, the twin of
  `storefront/components/CategoryContent.tsx`) and `storefront/components/catalog/ProductDescriptionPanel.tsx`
  (NEW). Turns T052 green.
- [X] T059 [US3] Extend `storefront/lib/catalog/product-tabs.ts` with the description rule and the
  drawable rule, and wire `ProductDescriptionPanel` into `storefront/app/(catalog)/p/[slug]/page.tsx`
  with `absentModuleIds` from `getServerContext()`. Turns T051 green.
- [X] T060 [US3] Re-run T048. Its FR-011, FR-036 and FR-045 parts must be green structurally (R-1).
  Fix only at the place R-15 names.

**Checkpoint**: MVP complete (US1 – US3, quickstart §3).

---

## Phase 6: User Story 4 — "Parametry" shows only attributes marked visible (P1)

**Goal**: remove the raw `attributeValues` table and show the tab only when a visible attribute has
a value. Independent of US1 – US3. It can be pulled ahead of them, because it touches only the tab
plan extracted in T013 and the page.

**Independent test**: spec US4. One visible and one hidden attribute; then a product with only
hidden ones.

### Tests (RED)

- [X] T061 [P] [US4] Extend `storefront/test/catalog/product-tabs.test.ts`: `parameters` is
  non-null only when `visibleAttributes` is non-empty, and a product whose only values are hidden
  ones gets no "Parametry" tab (FR-039).
- [X] T062 [P] [US4] Extend `storefront/test/components/ParametryTab.test.tsx`: rows are labels and
  rendered values only, and no technical key or raw `String(value)` appears (FR-038).
- [X] T063 [P] [US4] Extend `backend/test/contract/catalog/product-detail-visible-attributes.test.ts`
  (C): `visibleAttributes` holds neither a hidden attribute nor a content attribute, across the
  seeded catalogue (SC-003, FR-032).

### Implementation (GREEN)

- [X] T064 [US4] Delete the raw table and `hasAttributeValues` from
  `storefront/app/(catalog)/p/[slug]/page.tsx`, and put the `parameters` rule in
  `storefront/lib/catalog/product-tabs.ts`. Leave `storefront/components/attributes/ParametryTab.tsx`
  unchanged. Turns T061 – T063 green.

---

## Phase 7: User Story 5 — Switching the CMS off is safe and reversible (P2)

**Goal**: with `cms` off, content is kept, the admin shows status and a notice, and the API and
storefront show nothing. Switching it back on restores everything.

**Independent test**: spec US5 / quickstart §4.

### Tests (RED)

- [X] T065 [P] [US5] Write `backend/test/integration/catalog/product-content-cms-off.test.ts` (NEW,
  I). Cover **both** axes: operator deactivation and platform unavailability.
  - The PDP `contentAttributes` is `[]` (FR-051 backend).
  - The admin card list and the single GET still answer (FR-050).
  - `md5(content::text)` is unchanged for every row (SC-004).
  - After reactivation, content returns and a PUT works with no operator action (FR-052).
  Run `check:off-state-coverage` afterwards.
- [X] T066 [P] [US5] Extend `admin/test/modules/catalog/ProductAttributesTab.content-cards.test.tsx`
  and `admin/test/modules/catalog/ProductContentPage.test.tsx` (A). With zero `product.content.editor`
  contributors (CMS off, or no `cms` read code), the card keeps its chips and shows
  `productContent.card.noEditor` with no link. The screen shows `productContent.noEditor.*` with no
  canvas and no Save (FR-050, spec edge case).
- [X] T067 [P] [US5] Extend `storefront/test/catalog/product-tabs.test.ts` and
  `storefront/test/catalog/product-content.test.tsx`. With `pageBuilderPresent: false`, no content
  renders, a content-only product has no "Opis", and the plain description is unaffected (FR-051
  storefront).

### Implementation (GREEN)

- [X] T068 [US5] In `packages/modules/catalog/src/backend/index.ts`, inject `isPageBuilderPresent:
  () => effectiveState.isPresent('cms')` into `CatalogQueryService`, and make
  `getProductPageContent` return `[]` when it is false. **Write the OR-8 comment at the injection
  site.** It must say that no port and no dependency is declared because `catalog` is
  `nonDeactivatable` (a `dependencies` entry on `cms` would be a dead switch), `cms` is
  deactivatable, and the probe calls no `cms` code and only gates a projection of `catalog`'s own
  data (research R-13). Turns T065 green. Then run `check:port-dependencies` and
  `check:module-boundary`.
- [X] T069 [US5] In `storefront/app/(catalog)/p/[slug]/page.tsx`, pass
  `pageBuilderPresent: modules.isPresent('cms')` from `getServerContext()` into `productTabPlan`.
  Confirm that the card and the screen take their editor availability from the
  `useAdminZone('product.content.editor', …)` count. Turns T066 and T067 green.

---

## Phase 8: User Story 6 — Content follows the product's lifecycle; attribute delete for every type (P3)

**Goal**: duplicate copies content, and set membership hides or reveals it. Soft delete hides it
(OR-6). Assets embedded in content are referenced. Attribute delete for **every** type is usage-fed,
refuses or cascades per research R-21, and leaves foreign rules inert (OR-5, FR-007 – FR-009).

**Independent test**: spec US6 #1 – #8 / quickstart §5.

### Tests (RED)

- [X] T070 [P] [US6] Write `backend/test/contract/catalog/attribute-delete.contract.test.ts` (NEW, C):
  - `GET …/attributes/:idOrKey/usage` for a `text`, a `select` and a `page_builder` attribute
    returns the three counts (FR-007);
  - delete is refused with 409 and nothing changed in four cases (FR-008):
    - the attribute is in a set;
    - a live product holds a baseline value;
    - a live product holds **only** a channel override (`product_value_overrides`) — new;
    - a live product holds **only** a variant value (`variant_attribute_values`) — new;
  - a **soft-deleted** product's value does **not** refuse it (behaviour change, R-21), and `/usage`
    always equals what the guard decides;
  - deleting a `select` attribute removes the definition, the extension and the options in **one**
    audit row (FR-008);
  - deleting a `page_builder` attribute removes its `product_content_values` rows, and the audit
    row has `before.productContentCount = N` (FR-007);
  - after commit, `attribute.updated.v1` is emitted with the key and both flags `false` (FR-009).
- [X] T071 [P] [US6] Write `backend/test/integration/catalog/attribute-delete-references.test.ts`
  (NEW, I). After an attribute is deleted:
  - a promotion whose condition names the key is still stored, and its condition no longer matches
    a cart line;
  - a price-list row on the key is still stored and no longer prices;
  - a feed whose selection rule names the key records a configuration error on its next run;
  - no row of `promotions`, `price_lists` or `product_feeds` is deleted (FR-009, R-21 "inert").
- [X] T072 [P] [US6] Write `admin/test/modules/catalog/AttributesManager.delete.test.tsx` (NEW, A):
  - **Delete** is offered on a row of every type;
  - the dialog loads `/usage`;
  - `inSets` and `hasValues` each disable confirm and say why;
  - `contentCount` is shown when its count is above zero, and `foreignRules` always;
  - confirm sends `DELETE`, a 409 raced in between shows the API message, and the list refreshes
    (FR-007 – FR-009 UI).
- [X] T073 [P] [US6] Extend `backend/test/contract/catalog/product-content.contract.test.ts` with a
  `describe('lifecycle')` block:
  - duplicating a product gives the copy identical content rows, and the audit `after` has
    `contentAttributeCount` (FR-060);
  - when the attribute is removed from the set, the admin GET answers 404, the list omits it and
    the PDP omits it; adding it back brings everything back (FR-061);
  - after a product (soft) delete, the content routes answer 404 `PRODUCT_NOT_FOUND`, the PDP
    answers 404, and the rows **still exist** in the table (FR-062, OR-6).
- [X] T074 [P] [US6] Extend `backend/test/integration/catalog/asset-references.test.ts` (I):
  - a `product_content` reference names the product (FR-063);
  - a soft-deleted product's content is not reported (FR-062);
  - deleting a referenced asset is blocked (US6 #5).

### Implementation (GREEN)

- [X] T075 [US6] Rework `deleteAttributeCommand` in
  `packages/modules/catalog/src/backend/commands/attribute-commands.ts` (R-21):
  - one shared usage query counts non-deleted products holding a baseline value, a channel override
    or a variant value;
  - the set refusal stays as it is, and the value refusal uses the shared query;
  - for a content attribute, delete its content rows before the extension, and record
    `before.productContentCount`;
  - extension, definition and options are still removed through the apply seam on the same
    EntityManager;
  - add `event: attribute.updated.v1 { attributeKey, isSearchable: false, isFilterable: false }`,
    and update the file's emission-points comment (`attribute-commands.ts:37-39`) to name delete.
- [X] T076 [US6] Add `getAttributeUsage(idOrKey)` to
  `packages/modules/catalog/src/backend/services/catalog-admin.service.ts`, reusing T075's query,
  and add the route `GET /api/v1/admin/catalog/attributes/:idOrKey/usage` (`catalog:read`) to
  `packages/modules/catalog/src/backend/routes.admin.ts`. Turns T070 green.
- [X] T077 [US6] Re-run the existing attribute-delete tests:
  `backend/test/contract/catalog/attributes-admin-v012.test.ts`,
  `backend/test/contract/catalog/attribute-command-orchestration.test.ts` and
  `backend/test/contract/catalog/attribute-searchable-reindex.test.ts`. Change an assertion only
  where it encoded the soft-deleted-blocks behaviour that OR-5 / R-21 changes, and cite R-21 in the
  test.
- [X] T078 [US6] Run T071. It must be green with **no** change in `promotions`, `price_lists` or
  `product_feeds`, because their fail-closed rules already exist. If one is red, stop and report
  instead of patching a foreign module.
- [X] T079 [US6] Copy content inside the `product.duplicate` Command's transaction in
  `packages/modules/catalog/src/backend/services/catalog-admin.service.ts` (R-16), and add
  `after.contentAttributeCount`. Make every content read require `p.deleted_at is null`. Turns T073
  green.
- [X] T080 [US6] Add `productContentDescriptor` to
  `packages/modules/catalog/src/backend/services/asset-references.ts` (R-17; skip
  `p.deleted_at is not null`). Turns T074 green.
- [X] T081 [US6] Add the Delete row action and its confirmation dialog to
  `packages/modules/catalog/src/admin/pages/AttributesManager.tsx` for every type. Add
  `attributes.delete.{action,title,inSets,hasValues,contentCount,foreignRules,confirm,error}` to
  `packages/modules/catalog/i18n/en.json` and `pl.json`. Turns T072 green.

---

## Phase 9: Polish and cross-cutting concerns

- [X] T082 [P] Write the English documentation:
  - `packages/modules/catalog/docs/catalog/product-content.md` (NEW, `title` + `description`
    front matter): defining a content attribute, authoring, the "Opis" placement, Translate, CMS
    off (stricter than categories, OR-7), lifecycle (soft delete, OR-6), and the phase-1
    exclusions;
  - `packages/modules/catalog/docs/catalog/attributes.md`: the new type and its locked
    capabilities; the Delete action for every type with its usage dialog, its refusals and the
    foreign-rules note (OR-5); and the "Parametry" rule;
  - `packages/modules/catalog/docs/catalog/category-content.md`: one sentence saying category
    content, unlike product content, keeps rendering while the CMS is off (OR-7);
  - `packages/modules/catalog/docs/catalog.md`: the page list.

  Name the CMS module in prose; do not link a sibling module (`module-documentation.md`).
- [X] T083 Write the Polish pages:
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/catalog/{product-content,attributes,category-content}.md`
  (product-content NEW) and `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/catalog.md`.
  Then run `pnpm --filter backend run docs:translations:pin` naming the four English sources, which
  writes or updates the `docs/translation-cache/pl/packages--modules--catalog--docs--catalog--*.json`
  pins. Then run `check:docs-translations`, `check:module-docs` and `check:doc-snippets`.
- [X] T084 Re-run `pnpm --filter backend run composer:generate` for the docs sidebar
  (`docs/sidebars.modules.generated.js`) and any module-map change, then run `composer:check`.
  `admin/src/modules.generated.ts` is expected not to move.
- [X] T085 Run `pnpm --filter backend run manifests:generate`, then `pnpm install --lockfile-only`.
  Keep any moved module `package.json` and `pnpm-lock.yaml` in the merge request, then run
  `manifests:check` and `pnpm install --frozen-lockfile`.
- [X] T086 Record the OpenAPI baseline:
  `UPDATE_OPENAPI_BASELINE=1 pnpm --filter backend exec vitest run test/contract/kernel/openapi-baseline.test.ts`.
  **Read the diff**. It may contain only the four new admin paths (three content routes and
  `/usage`) and the public `include` parameter. Then re-run the test without the variable.
- [X] T087 [P] Write the changesets (`specs/conventions/release-intent.md`, `0.x` ⇒ never `major`).
  One `.changeset/172-*.md` per release unit as in plan § *Changesets*:
  - `@endora-commerce/contracts` minor; the body tells connector authors to skip `page_builder`;
  - `@endora-commerce/mod-catalog` minor; the body names the attribute-delete behaviour changes
    (overrides and variant values now refuse, soft-deleted products no longer block,
    `attribute.updated.v1` on delete);
  - `@endora-commerce/mod-cms` minor;
  - `@endora-commerce/mod-custom-fields` minor;
  - `@endora-commerce/mod-import-export` patch;
  - `@endora-commerce/mod-product-feeds` patch.

  Review every body against `specs/conventions/commercial-data.md`, then run
  `check:release-intent`.
- [X] T088 [P] **Non-code — follow-up issue for OR-7.** Draft an issue titled "Category content
  should be hidden while the CMS module is off (align with product content, feature 172 FR-051)".
  The body states that category content still renders with the CMS off
  (`app/(catalog)/c/[slug]/page.tsx`, `admin-contributions.ts` zone comment), names the touched
  areas (catalogue category page read, storefront category page, `category-content.md` EN + PL),
  and cites spec OR-7. Hand the draft to the owner to file. Once it has a number, write the number
  into `specs/172-product-content-attributes/spec.md` § *Follow-ups*.
  *Status: drafted and handed to the owner (2026-11-04), not filed by the implementation; the
  issue number is written into the spec once the owner files it.*
- [X] T089 Check every moved or deleted symbol. Grep `backend/test/**` and `packages/**` for
  `hasPageBuilderBlocks` and for any test that enumerates `AdminZoneNameSchema`,
  `assetReferenceKindSchema`, `customFieldValueTypeSchema` or `attributeValueTypeSchema`, and
  update those in this merge request. Ask what is **derived** from the changed enums, not only what
  names them (AGENTS.md traps).
- [X] T090 Run the static checks: `pnpm run check:naming`, `pnpm run check:language`, then
  `pnpm --filter backend run` for each of `check:module-boundary`, `check:port-dependencies`,
  `check:port-catches`, `check:command-coverage`, `check:admin-zones`, `check:admin-surface`,
  `check:off-state-coverage`, `check:platform-surface`, `check:test-ownership`, `i18n:hardcoded`
  and `check:bundle-pairing`. If a read-size band refuses an entry, re-record only that entry, by
  re-measuring (`specs/conventions/check-estate.md` — read it first).
- [X] T091 Final verification. Report failures with their output.
  1. `pnpm run build:packages`.
  2. `pnpm -r run typecheck`.
  3. `pnpm -r run lint`.
  4. `pnpm --filter backend run test:unit:fast`.
  5. `pnpm --filter '!backend' run test`. This covers the touched packages `contracts`, `catalog`,
     `cms`, `custom_fields`, `import_export` and `product_feeds`, plus `admin` and `storefront`.
  6. **Locally, on `pnpm run dev:infra:test`** (D-198: merge request pipelines do not run them), run
     the contract and integration files from quickstart §6, which includes
     `attribute-delete.contract.test.ts`, `attribute-delete-references.test.ts`, the
     category-content contract, and `permission-inventory.test.ts` (green with no new permission
     code).
  7. `pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts test/modules/catalog
     test/modules/cms test/modules/custom_fields test/modules/product_feeds`.
- [ ] T092 Walk through quickstart §1 – §5 by hand, against `pnpm run setup` + `pnpm run dev`
  (SC-001). Stop before committing, so the owner can review (repository working agreement).

---

## Dependencies and execution order

```text
Phase 1 (T001)
  └─▶ Phase 2 Foundational (T002–T013)   ── blocks every story
        ├─▶ US1 (T014–T028)  P1
        │     └─▶ US2 (T029–T046)  P1   needs a content attribute to exist (US1 rules + type)
        │           └─▶ US3 (T047–T060)  P1   needs stored content (US2 service/routes)
        │                 └─▶ US5 (T065–T069)  P2   gates US3's projection and US2's card/screen
        ├─▶ US4 (T061–T064)  P1   independent — only needs T013; may be done first
        └─▶ US6 (T070–T081)  P3   attribute delete for non-content types needs only Phase 2;
                                    content parts (T073, T074, T079, T080) need US2
  all stories ─▶ Phase 9 Polish (T082–T092)
```

**Shared files, which force sequence and are never [P] together**:
- `attribute-commands.ts`: T024 (US1), then T075 (US6).
- `catalog-admin.service.ts`: T037 / T040 (US2), then T076 / T079 (US6).
- `routes.admin.ts`: T038, then T076.
- `catalog/src/backend/index.ts`: T039, then T068.
- `AttributesManager.tsx`: T027, then T081.
- catalog `i18n/*.json`: T027, then T044, then T081.
- `product-content.contract.test.ts`: T029, then T047, then T073.
- `product-content-exclusions.contract.test.ts`: T018, then T030, then T048.
- `product-tabs.ts` / `product-tabs.test.ts`: T013 / T006, then T059 / T051, then T064 / T061, then
  T069 / T067.
- `page.tsx`: T013, then T059, then T064, then T069.

## Parallel examples

- **Phase 2 tests**: T002, T003, T004, T005 and T006 together (five different files).
- **US1 tests**: T014 – T021 together. Then T022 (`custom_fields`), T023 (rules file), T025
  (`attribute-set.service.ts` + `routes.api-key.ts`) and T026 (`product_feeds`) in parallel. T024
  waits for T023, and T027 is independent.
- **US2 tests**: T029 – T035 together. Then T041 (`cms`) is parallel with T036 – T040 (`catalog`
  backend).
- **US3 tests**: T048 – T053 together, after T047 (which shares a file with T029). T058 is parallel
  with T054 – T056.
- **US6 tests**: T070 – T074 together.
- **Polish**: T082, T087 and T088 together.

## Implementation strategy

1. **MVP** = Phase 2 + US1 + US2 + US3. The operator can define, author and publish content.
   Validate with quickstart §1 – §3 before going on.
2. **US4** is a live disclosure defect (spec Context). It may ship first or with the MVP; it
   depends only on T013.
3. **US5** before any release that lets an operator switch the CMS off (Principle XVII). The
   backend probe and its OR-8 comment are part of it.
4. **US6** last. Its attribute delete for non-content types (T070 – T072, T075 – T078, T081) is
   independent of content and can be split into its own merge request if the review prefers.

## FR → test traceability

| FR / SC | Test task(s) |
| --- | --- |
| FR-001 | T016, T019 |
| FR-002 | T015, T017, T020 |
| FR-003 | T014, T016, T019 |
| FR-004 | T014, T016 |
| FR-005 | T014, T015, T016, T019 |
| FR-006 | T016 |
| FR-007 | T070, T072 |
| FR-008 | T070, T072 |
| FR-009 | T070, T071, T072 |
| FR-010 | T002, T029 |
| FR-011 | T048 |
| FR-012 | T002, T029 |
| FR-013 | T005, T029 |
| FR-014 | T030, T031 |
| FR-020 | T029, T035 |
| FR-021 | T034 |
| FR-022 | T033 |
| FR-023 | T029, T034 |
| FR-024 | T029 |
| FR-025 | T033, T034 |
| FR-026 | T035 |
| FR-027 | T046 |
| FR-030 | T047, T052 |
| FR-031 | T051 |
| FR-032 | T051, T063 |
| FR-033 | T005, T047 |
| FR-034 | T052 |
| FR-035 | T029, T032, T053 |
| FR-036 | T048, T053 |
| FR-037 | T047, T052 |
| FR-038 | T062 |
| FR-039 | T061 |
| FR-040 | T018 |
| FR-041 | T048, T049 |
| FR-042 | T018, T030, T031, T048 |
| FR-043 | T018 |
| FR-044 | T018, T021 |
| FR-045 | T048, T050 |
| FR-046 | T018 |
| FR-047 | the FR-040 – FR-046 rows |
| FR-050 | T065, T066 |
| FR-051 | T065, T067 |
| FR-052 | T065 |
| FR-060 | T073 |
| FR-061 | T073 |
| FR-062 | T073, T074 |
| FR-063 | T074 |
| SC-001 | T092 |
| SC-002 | T051, T052, T061 |
| SC-003 | T063 |
| SC-004 | T065 |
| SC-005 | T018, T030, T048, T049 |
| SC-006 | T048 |
| SC-007 | T052 |
