# Implementation Plan: Product content attributes (Page Builder documents on the product page)

**Branch**: `feat/172-product-content-attributes` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/172-product-content-attributes/spec.md` (owner rulings OR-1 – OR-8 — OR-5 – OR-8 given at the plan stage on 2026-11-04; no open questions)

## Summary

A product attribute may now have the value type **`page_builder`**: a Page Builder document per
language, authored on the product in the admin and rendered in the product page's "Opis" tab.
The feature extends the **catalogue** (no new module), following the category-content precedent
(`fcf6daa76`) seam for seam:

- **Definition** — `page_builder` joins the three bijective attribute type vocabularies
  (custom-field, legacy, API). `custom_fields` admits it only for entity types carrying a new
  registry marker (`product` alone); the catalogue holds every capability flag off, language
  scoping on, and the type immutable — one pure rule function, called by both attribute Commands.
- **Storage** — a new catalogue table `product_content_values` (one row per product × content
  attribute, the category envelope, a derived per-language summary), apart from
  `products.attribute_values`, so search, feeds, comparison, promotions, price lists, carts,
  quotes, list reads and "Parametry" are excluded **by construction**; the ordinary value path
  refuses a content key at the one guard every product write crosses.
- **Admin** — a compact card per content attribute in the product's attributes tab, a
  dedicated editing screen `/catalog/products/:id/content/:attributeKey` that `catalog` owns, and a
  new admin zone `product.content.editor` that `cms` fills with its Page Builder (Translate
  included). Saves run as the audited Command `product.content.update` and emit
  `product.content.updated.v1`, which drops the product's storefront page cache and re-indexes
  nothing.
- **Storefront** — `GET /api/v1/catalog/products/:idOrSlug?include=content` carries the resolved
  documents (only for the PDP); the page renders them below the description through the single
  `PageBuilderRender` boundary, server-side. The "Parametry" tab loses its raw dump of every
  attribute value (the disclosure defect) and appears only when a visible attribute has a value.
- **CMS off** — content is kept; the admin shows status and a notice; the backend omits content
  and the storefront also checks presence to close its cache window.
- **Exclusions** — every phase-1 exclusion (FR-040 – FR-046) has a named refuse/omit point and a
  test (research R-15).
- **Attribute delete, every type (OR-5)** — the attributes screen gains a Delete action for every
  attribute type, with a usage-fed confirmation (`GET …/attributes/:idOrKey/usage`). The existing
  `catalog.attribute.delete` Command keeps deleting the definition, extension and options together.
  It now also refuses on channel overrides and variant values, counts non-deleted products only,
  cascades content, and emits `attribute.updated.v1` so `search` and `price_lists` refresh.
  Promotion, price-list and feed references are left inert under their owners' fail-closed rules
  (research R-21).

No new runtime, dev or workspace dependency.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17, React 19
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, `@puckeditor/core` (through `cms`' `PageBuilderEditor` and the storefront's `PageBuilderRender`), Next.js 15, admin-kit primitives (`ContentLanguageTabs`, `useUnsavedChangesPrompt`, `AdminZone`/`useAdminZone`). No new runtime, dev or workspace dependency.
**Storage**: PostgreSQL — one new `catalog` table `product_content_values` (jsonb `content` + `summary`); no change to any existing table; no `custom_fields` migration (`value_type` is an unconstrained `varchar(16)`)
**Testing**: Vitest — co-located package unit tests (`contracts`, `catalog`, `custom_fields`, `import_export`, `product_feeds`), backend contract + integration (real Postgres), admin component tests (`admin/test/modules/*`), storefront SSR tests (`storefront/test/*`)
**Target Platform**: backend API (Fastify), admin (Vite SPA), storefront (Next.js App Router, SSR)
**Project Type**: web monorepo (pnpm workspaces)
**Performance Goals**: product list and search responses byte-identical with or without content (SC-006); a PDP pays one extra indexed query pair (rows for one product + set positions) and only when `include=content`; the admin card reads summaries, never documents
**Constraints**: ≤ 1 MiB per product × attribute across languages (FR-012); content in the server-rendered HTML (SC-007); a save visible on the next PDP load (FR-035) without a re-index or feed regeneration; stored content byte-identical across a CMS off/on cycle (SC-004)
**Scale/Scope**: catalogues of 10⁴–10⁵ products, a handful of content attributes per set; 1 table, 4 admin routes, 1 public query parameter, 1 zone, 1 admin screen, 1 card, 1 Command, 1 event, 1 asset-reference kind, ~33 i18n keys × 2 languages, 0 permissions, 0 palette actions, 0 settings

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design. Verdict at the end.*

| Principle | How this design meets it |
| --- | --- |
| **I. Modular architecture (NN)** | `catalog` owns the table, entity, migration, routes, Command, event, screen, card, i18n, docs and tests. It names no module: the editor arrives through a zone `cms` contributes (`catalog` is `nonDeactivatable`, `cms` switchable — a declared edge would be a dead switch, `module-composition.md` 4a). `cms` gains one contribution and no import of `catalog`. `custom_fields` gains a registry marker and refusals in its own apply seam. `import_export` reads a new method of a port it already resolves (`catalogBulkImportPort`); `product_feeds` filters a definition list it already reads. No new `lazyPort` edge, no manifest `dependencies` change, no cross-module FK or SQL (both FKs are `catalog`'s own). Detachable: removing the feature is one table and a set of additive enum members. |
| **II. API-first** | Every shape is a Zod schema in `packages/contracts` before a consumer (data-model §3): envelope, PUT body, admin reads, usage read, PDP `contentAttributes`, `productDetailQuerySchema`. The public change is additive and opt-in (`include=content`); without it the PDP response is byte-identical. The CMS-off rule is decided by the backend so any API client gets it (R-13). Enum growth is versioned through a `minor` changeset in `0.x`. |
| **III. TDD (NN)** | Every FR traces to a named test below (*Test plan*); `tasks.md` must order each RED before its GREEN. |
| IV. YAGNI & minimal dependencies | No dependency. No restricted palette (OR-3), no variant-level content, no per-channel values, no versioning, no new setting (the 1 MiB ceiling is a fixed product rule shared with categories). The stored `summary` (R-3) is the one derived column, justified by the spec's own constraint on the product form. |
| V. TypeScript everywhere | Strict TS; request bodies and the new query parameter parsed with Zod; the zone props typed in contracts. |
| VI. Naming (NN) | Table `product_content_values` (plural snake), FKs `product_id` / `product_attribute_id`, value type `page_builder`, routes kebab/`:param`, JSON camelCase, event `product.content.updated.v1`, action `product.content.update`, zone `product.content.editor` (host's words, Z14), migration class `Migration<STAMP>CatalogProductContentValues`. |
| VII. SEO & performance | Content is server-rendered inside the PDP (SC-007); list and search reads unchanged (SC-006). |
| VIII. English (NN) | Specs, code, comments and English docs in English; Polish only in bundles and the PL docs mirror. |
| IX. UI reuse | Screen is `CategoryContentPage`'s twin on admin-kit primitives; card on existing `Card`/badge primitives; storefront `ProductContent` is `CategoryContent`'s twin on `PageBuilderRender`. No new design-system primitive. |
| X. Queue consumers | Not applicable — no long-running or repeatable work. The revalidation runs through the existing debounced `ProductPageRevalidation`. |
| **XI. Multi-tenant isolation (NN)** | `ProductContentValue` is `@GlobalEntity()`, as `Product` and `ProductAttribute` are — catalogue data is platform-global, and there is no "no-organization" path because no customer-scoped data is involved. Customers reach content **only** through `getProductByIdOrSlug`, which already applies the organisation restriction (`allowedOrganizationIds`), audience and visibility; the content read runs after it and adds no read path around it. Admin reads/writes are `catalog:read`/`catalog:write`, as for the product itself. |
| **XII. Sales-channel scoping (NN)** | Same argument: the product's channel membership and per-channel status are resolved by the existing detail read from the resolved request channel; content has no channel dimension (`channelScoped` is forced off, FR-040) and is attached only to a response that already passed the channel checks. The language fallback uses `ctx.resolvedChannel.defaultLanguage` — the sanctioned resolved channel, no bridge read. |
| **XIII. Command Bus auditing (NN)** | Content save = `product.content.update` Command (audit: product, attribute, languages; never documents). Attribute delete — now offered for every type (OR-5) — removes content inside the existing `catalog.attribute.delete` Command (`before.productContentCount`), with the definition, extension and options in the same transaction and audit row. Duplicate copies content inside the existing `product.duplicate` Command's transaction. Attribute create/update refusals happen inside their Commands. No write outside `CommandBus.run`. |
| XIV. Entity-agnostic extensibility | The requirement is a new *kind* of attribute value, expressed as a runtime custom-field value type on the existing product-host definition (no bespoke column on `products`). The value lives in its own table rather than the definition-keyed value bag because of size and consumer isolation (R-1) — recorded in Complexity Tracking. |
| **XV. Untouched core & overlay** | Core feature, generic: no deployment data, no client name. A deployment customises with its own attributes and documents; an overlay gains nothing it must edit core for. |
| **XVI. Command palette** | No new top-level surface: the editing screen is a parameterised detail route (outside `palette-coverage.test.ts` by definition), reached from the product's attributes tab, exactly like `/catalog/categories/:id/content`. The attributes screen keeps its existing action. `catalog` keeps ≥ 1 own action (`module-without-action`). |
| **XVII. Operator-toggleable modules (NN)** | `catalog` is `nonDeactivatable` and gains no edge. `cms` off: its zone contribution is filtered by presence and permission (admin shows status + notice, no canvas, no save); the backend omits `contentAttributes` (`effectiveState.isPresent('cms')`, effective state, fails closed; portless probe accepted by owner ruling **OR-8**, with a code comment stating why no port or dependency is declared); the storefront also hides via `modules.isPresent('cms')`. Off is non-destructive — no row is touched — and reversible with no operator action. Off-state test covers operator deactivation and platform unavailability, with restoration (`product-content-cms-off.test.ts`). |

**Cross-cutting checklist** (architect brief): admin permission manifest — **no new code**
(FR-023), the inventory test still runs; command palette — none needed (XVI above); pl+en i18n —
~33 catalogue keys (admin-surfaces §7) plus the audit label; Settings — none (no configuration;
no secret); auditing via Command Bus — XIII above; tenant scoping — XI above; Redis cache
invalidation — none needed: the catalogue keeps no Redis cache of products or content, and the
attribute definitions cache in `custom_fields` is already invalidated by every attribute Command
(`catalog-admin.service.ts` publishes it post-commit); the storefront Data Cache is dropped through
`ProductPageRevalidation` on `product.content.updated.v1`.

**Gate (pre-research)**: PASS. **Gate (post-design)**: PASS — no violation; one design entry in
Complexity Tracking for transparency.

## Project Structure

### Documentation (this feature)

```text
specs/172-product-content-attributes/
├── spec.md
├── plan.md                                  # this file
├── research.md                              # R-1 … R-20
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-api.md
│   ├── storefront-api-and-pdp.md
│   ├── admin-surfaces.md
│   └── foreign-module-changes.md
├── checklists/requirements.md               # from /speckit.specify
└── tasks.md                                 # /speckit.tasks — not written here
```

### Source code (repository root)

```text
packages/contracts/src/
├── custom-fields.ts                 # page_builder; filter operators; value_type_unsupported
├── catalog.ts                       # page_builder ×2; apiAttributeTypeOf; PAGE_BUILDER_CONTENT_MAX_BYTES;
│                                    # product-content schemas; productDetail.contentAttributes?; port method
├── assets-library.ts                # product_content
├── admin-contributions.ts           # product.content.editor + ProductContentEditorZoneProps
└── product-content.test.ts          # NEW co-located unit tests

packages/modules/catalog/
├── src/backend/
│   ├── entities/product-content-value.entity.ts                 # NEW
│   ├── commands/attribute-commands.ts                           # rules; delete: content cascade, overrides/variants refusal, live-only count, event
│   ├── commands/product-content-commands.ts                     # NEW product.content.update
│   ├── services/content-attribute-rules.ts (+ .test.ts)         # NEW R-6
│   ├── services/page-builder-content.ts (+ .test.ts)            # NEW R-2/R-3/R-12 (hasPageBuilderBlocks moves here)
│   ├── services/product-content.service.ts (+ .test.ts)         # NEW admin reads/writes, duplicate copy, usage
│   ├── services/attribute-type-mapping.ts                       # page_builder ⇄
│   ├── services/attribute-cf-type-mapping.test.ts               # extended
│   ├── services/catalog-admin.service.ts                        # R-7 guard; duplicate; attribute usage (shared with the delete guard)
│   ├── services/catalog-query.service.ts                        # getProductPageContent; category uses shared resolver
│   ├── services/catalog-bulk-import.service.ts                  # contentAttributeKeys()
│   ├── services/attribute-set.service.ts                        # getSetDetail(…, { includeContent })
│   ├── services/asset-references.ts                             # productContentDescriptor
│   ├── routes.admin.ts                                          # 4 routes
│   ├── routes.public.ts                                         # include=content
│   ├── routes.api-key.ts                                        # set read omits content members
│   └── index.ts                                                 # register service; isPageBuilderPresent (+ OR-8 comment); subscribe event
├── src/migrations/<STAMP>_catalog_product_content_values.ts     # NEW (migration:new) + index.ts entry
├── src/admin/
│   ├── index.ts                                                 # route /catalog/products/:id/content/:attributeKey
│   ├── pages/ProductContentPage.tsx                             # NEW
│   ├── pages/AttributesManager.tsx                              # type, locked flags, delete action (every type)
│   ├── components/ProductContentCard.tsx                        # NEW
│   └── components/ProductAttributesTab.tsx                      # page_builder → card
├── i18n/en.json, i18n/pl.json                                   # keys (admin-surfaces §7)
└── docs/catalog/product-content.md (NEW), docs/catalog/attributes.md, docs/catalog.md

packages/modules/cms/src/admin/
├── index.ts                                                     # zone contribution
└── zones/ProductContentEditor.tsx                               # NEW

packages/modules/custom_fields/src/backend/services/
├── custom-field-registry.ts                                     # pageBuilderValues marker
├── custom-field-definition-apply.ts                             # admissibility + type lock
├── custom-field-value.service.ts / custom-field-list-filter.service.ts  # explicit cases
└── page-builder-admissibility.test.ts                           # NEW co-located

packages/modules/import_export/src/backend/services/adapters/products.adapter.ts (+ .test.ts)
packages/modules/product_feeds/src/backend/plugin.ts, src/admin/components/FeedCriteriaPanel.tsx
packages/modules/product_feeds/src/backend/services/field-source-catalogue.test.ts (extended or NEW)

storefront/
├── app/(catalog)/p/[slug]/page.tsx                              # tabs from the plan; raw table removed
├── app/(catalog)/p/[slug]/resolution.ts                         # include content
├── lib/api/catalog.ts                                           # include option
├── lib/catalog/product-tabs.ts                                  # NEW pure plan
├── components/catalog/ProductContent.tsx                        # NEW
└── components/catalog/ProductDescriptionPanel.tsx               # NEW

backend/test/
├── contract/catalog/content-attribute-definition.contract.test.ts   # NEW
├── contract/catalog/product-content.contract.test.ts                # NEW
├── contract/catalog/product-content-exclusions.contract.test.ts     # NEW
├── contract/catalog/attribute-delete.contract.test.ts                # NEW (OR-5, every type)
├── contract/custom_fields/page-builder-admissibility.contract.test.ts # NEW
├── integration/catalog/product-content-cms-off.test.ts              # NEW
├── integration/catalog/attribute-delete-references.test.ts          # NEW (OR-5, FR-009)
├── integration/catalog/asset-references.test.ts                     # extended
└── fixtures/openapi-baseline.json                                   # regenerated

admin/test/modules/
├── catalog/AttributesManager.page-builder.test.tsx                  # NEW
├── catalog/AttributesManager.delete.test.tsx                        # NEW (OR-5)
├── catalog/ProductAttributesTab.content-cards.test.tsx              # NEW
├── catalog/ProductContentPage.test.tsx                              # NEW
├── cms/product-content-zone.test.tsx                                # NEW
├── product_feeds/… criteria picker test                             # NEW or extended
├── batch-fifteen-surfaces.module-owned-surface.test.tsx             # + route
└── batch-sixteen-surfaces.module-owned-surface.test.tsx             # + zone

storefront/test/
├── catalog/product-content.test.tsx                                 # NEW
├── catalog/product-tabs.test.ts                                     # NEW
└── catalog/product-cache-tags.test.ts                               # + include keeps tags

docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/catalog/{product-content.md (NEW), attributes.md}
docs/translation-cache/pl/packages--modules--catalog--docs--catalog--{product-content.md.json (NEW), attributes.md.json}
.changeset/172-*.md                                                  # see Release intent
```

**Structure decision**: extend `catalog` (domain owner) and the four modules whose own code must
know the new type (`custom_fields`, `cms`, `import_export`, `product_feeds`); everything else is
excluded structurally. No new module (research R-1).

## Design decisions (one line each; full reasoning in research.md)

| # | Decision |
| --- | --- |
| R-1 | Content in a new catalogue table keyed (product, product_attribute), never in `attribute_values`. |
| R-2 | Empty languages dropped on write; all-empty ⇒ no row. |
| R-3 | A derived per-language `summary` feeds the admin card; documents load only on the editing screen. |
| R-4 | `page_builder` added to the custom-field, legacy and API type vocabularies (bijective). |
| R-5 | `custom_fields` admits it only on entity types with the `pageBuilderValues` registry marker (product). |
| R-6 | One pure rule function refuses every excluded capability by name, forces language scoping, locks the type. |
| R-7 | `assertAttributeValueKeysAllowed` refuses a content key on every ordinary product write path. |
| R-8 | Four admin routes beside the category pair; PUT with a route body limit so the size refusal names 1 MiB. |
| R-9 | Command `product.content.update`; event `product.content.updated.v1` flushes PDP cache only. |
| R-10 | New zone `product.content.editor` filled by `cms`; `catalog` hosts screen and card; editor presence = zone count. |
| R-11 | PDP content is opt-in `?include=content` on the existing detail route, computed after visibility, never on the external API. |
| R-12 | One language resolver shared with category content. |
| R-13 | CMS off: backend omits (authoritative), storefront also checks (cache window); stricter than categories by spec, accepted (OR-7, follow-up issue); portless probe accepted with an explanatory comment (OR-8). |
| R-14 | Connectors: inbound refused by R-7, set read for integrations omits content members, outbound structurally absent. |
| R-15 | Each FR-040–046 exclusion has a named place and test (table in research). |
| R-16 | Duplicate copies in-Command; set membership is read-time; product soft-delete hides (OR-6); attribute delete removes. |
| R-17 | Asset reference kind `product_content`, jsonpath batch descriptor, skips soft-deleted products. |
| R-18 | Storefront tabs from a pure plan; "Parametry" raw table deleted. |
| R-19 | Unit tests co-located; contract/integration in `backend/test`; admin in `admin/test/modules`; storefront in `storefront/test`. |
| R-21 | Attribute delete for every type (OR-5): refuse on set membership and on values (baseline, channel override, variant) of non-deleted products; cascade content and options; promotion/price-list/feed references inert; emit `attribute.updated.v1`. |

## Deviations and corrections to the spec (also research R-20)

1. **FR-007 needed a delete action that did not exist.** The admin had no attribute delete. The
   plan adds one for every type, with a usage-fed confirmation. **Resolved by OR-5**: accepted, and
   the spec now carries it as FR-007 – FR-009. Design in research R-21. Two behaviour changes to the
   existing API delete follow from it, and both are recorded there: soft-deleted products no longer
   block, and channel overrides and variant values now do.
2. **FR-062 (product delete) is met observably, not physically.** **Resolved by OR-6**: product
   delete stays soft, and FR-062 is reworded to the observable outcome. No purge of soft-deleted
   products exists in the tree today, so "physically removed when purged" holds only once one
   exists. That is out of scope.
3. **FR-041 import "rest of the row processed as today"** = the row's other cells are still
   validated; the import stays all-or-nothing as it is today.
4. **"Only switched-off modules' blocks"** is decided on the storefront by owner segment (the
   backend cannot know which blocks a storefront draws).
5. **FR-051 is stricter than its precedent.** Category content keeps rendering with the CMS off;
   products will not. **Resolved by OR-7**: accepted. Aligning categories is a follow-up issue,
   opened by a non-code task in `tasks.md`.
6. **FR-026** is unreachable through the product editor today (the attributes tab is hidden for a
   new product); implemented and tested at component level.
7. **The portless `cms` presence probe** in `catalog`. **Resolved by OR-8**: accepted, with a code
   comment at the injection site (research R-13).

## Test plan (TDD — every FR to at least one test)

Suites: **U** = co-located package unit (`pnpm --filter '!backend' run test`), **BU** = backend
unit (`test:unit:fast`), **C** = backend contract, **I** = backend integration (C and I need the
services; not run by MR pipelines, D-198), **A** = admin, **S** = storefront.

| FR / SC | Test (file → case) | Suite |
| --- | --- | --- |
| FR-001, FR-004 | `content-attribute-definition.contract.test.ts` → create `type: page_builder`; read back `languageScoped: true`, every flag false | C |
| FR-002 | `custom_fields/.../page-builder-admissibility.test.ts` → apply refuses for order/organization/customer/category/quote_request/opportunity/project/task, accepts product; `page-builder-admissibility.contract.test.ts` → generic route 400; `AttributesManager`-independent `DefinitionForm` offers no Page Builder type | U, C, A |
| FR-003 | `content-attribute-rules.test.ts` → each of 12 flags refused by name; `content-attribute-definition.contract.test.ts` → create and PATCH with each flag → 400, `details[].path`, nothing stored | U, C |
| FR-005 | rules test + contract → type change both directions 409; apply seam `value_type_locked` | U, C |
| FR-006 | contract → add to set, reorder, position read back | C |
| FR-007 | `attribute-delete.contract.test.ts` → `/usage` counts for a `text`, a `select` and a `page_builder` attribute; delete of a content attribute removes its rows, audit `productContentCount`; `AttributesManager.delete.test.tsx` → Delete offered on every type, dialog shows each count | C, A |
| FR-008 | `attribute-delete.contract.test.ts` → refused (409, nothing changed) while in a set / with a baseline value / with only a channel override / with only a variant value; **not** refused by a soft-deleted product's value; `/usage` equals the guard; select delete removes definition, extension and options in one audit row; dialog confirm disabled with the blocking reason | C, A |
| FR-009 | `attribute-delete.contract.test.ts` → after delete, `attribute.updated.v1` emitted with the key and both flags `false`; `integration/catalog/attribute-delete-references.test.ts` → a promotion naming the key is kept and no longer matches, a price-list row on the key is kept and inert, a feed whose selection rule names the key records a configuration error, and no row is deleted in any of the three modules; `AttributesManager.delete.test.tsx` → dialog shows `attributes.delete.foreignRules` | C, I, A |
| FR-010, FR-012, FR-013 | `product-content.test.ts` (contracts) → schema strict, 1 MiB boundary (±1 byte), message names the limit; `page-builder-content.test.ts` → normalise drops empty languages, all-empty ⇒ null; `product-content.contract.test.ts` → PUT > 1 MiB → 400 naming the limit, nothing stored; PUT for non-member / non-content key → 400 `ATTRIBUTE_VALUE_REJECTED`; empty ⇒ row deleted | U, U, C |
| FR-011, FR-036, SC-006 | contract → list read and search response byte-identical before/after authoring content on every product; detail without `include` has no `contentAttributes` | C |
| FR-014 | contract → admin create, admin PATCH, api-key by-sku upsert, each with the content key → 400 naming it; `catalog-write-ports.test.ts` extended | C, U |
| FR-020, FR-026, FR-050 (card) | `ProductAttributesTab.content-cards.test.tsx` → card per member in position order, chips per language, summary, Edit link; unsaved product; set changed; no contributor ⇒ notice, no link | A |
| FR-021, FR-023 (UI), FR-050 (screen) | `ProductContentPage.test.tsx` → language switch incl. stored-only language, one PUT with all edited languages, unsaved prompt, read-only without `catalog:write`, no-editor notice without contributor, 404 message | A |
| FR-022, FR-025 | `cms/product-content-zone.test.tsx` → contribution renders `PageBuilderEditor` with `activeLanguage` and `resource`, reports `onChange`, never calls an API | A |
| FR-023 (API) | contract → GET without `catalog:read` 403, PUT without `catalog:write` 403; `permission-inventory.test.ts` green with no new code | C |
| FR-024 | contract → one audit row `product.content.update`, `before/after` = `{attributeKey, languages}`, no document bytes in the row; other attribute values and product fields unchanged | C |
| FR-027 | `registered-bundles-shape.test.ts`, `check:bundle-pairing`, `i18n:hardcoded` | BU |
| FR-030, FR-033, FR-037 | `catalog-query` path: contract → `include=content` order by position then key; language fallback chain (visitor, channel default, en-US, any), empty-language skip; no label in payload; `page-builder-content.test.ts` → resolver order; `product-content.test.tsx` → rendered in order, no heading | C, U, S |
| FR-031 | `product-tabs.test.ts` → description only / content only / both / neither | S |
| FR-032, FR-038, FR-039, SC-002, SC-003 | `product-tabs.test.ts` + `ParametryTab.test.tsx` → raw table gone, no key or raw value, tab only with a visible value, no content in "Parametry" ever | S |
| FR-034, SC-007 | `product-content.test.tsx` → `renderToString` contains the content; sanitised HTML block; switched-off module block not drawn | S |
| FR-035 | `product-content.contract.test.ts` → save emits `product.content.updated.v1` and **not** `product.updated.v1`; `product-page-revalidation.test.ts` / catalog index subscription → `productChanged(productId)` | C, U |
| FR-040 | `product-content-exclusions.contract.test.ts` → channel override for the key refused | C |
| FR-041 | `products.adapter.test.ts` → per-row error naming the key, other cells still validated; exclusions contract → export has no key/document | U, C |
| FR-042 | exclusions contract → external detail has no `contentAttributes`; api-key set detail omits the member; inbound refused (FR-014 cases) | C |
| FR-043 | exclusions contract → by-flag `isMassEditable` omits; bulk request with key → `ATTRIBUTE_NOT_MASS_EDITABLE` | C |
| FR-044 | `field-source-catalogue` / plugin unit → definition filtered; exclusions contract → template save with the key refused; admin criteria picker test | U, C, A |
| FR-045 | exclusions contract → `?q=<content-only word>` no hit; quick-search no hit; `admin-search-provider.test.ts` extended | C, U |
| FR-046 | exclusions contract → promotions attribute picker, price-list rule attributes, comparable keys, storefront filters each omit | C |
| FR-047 | the rows FR-040 – FR-046 above | — |
| FR-050 – FR-052, SC-004 | `product-content-cms-off.test.ts` → CMS deactivated (operator axis) **and** platform-unavailable: PDP `contentAttributes: []`, admin content routes still answer, `md5(content)` unchanged; reactivate → content returns; `product-content.test.tsx` → `modules.isPresent('cms') === false` hides and drops a content-only "Opis" | I, S |
| FR-060 | contract → duplicate carries identical rows; audit `contentAttributeCount` | C |
| FR-061 | contract → remove from set ⇒ admin GET 404, card list omits, PDP omits; re-add ⇒ back | C |
| FR-062 | contract → after the (soft) delete the product's content is unreachable through the admin content routes and the PDP, and the rows still exist; `asset-references.test.ts` → asset no longer referenced | C, I |
| FR-063 | `asset-references.test.ts` → `product_content` hit names the product; soft-deleted product not reported; delete blocked | I |
| SC-001 | quickstart walk-through (manual) | — |
| SC-005 | the FR-040 – FR-046 rows | — |

Existing tests that must move with the change: `attribute-cf-type-mapping.test.ts`,
`packages/contracts/test/attribute-type-mapping.unit.test.ts`, `custom-fields.test.ts`
(operator table), `category-content` tests (shared resolver), the two `batch-*-surfaces` admin
tests, `openapi-baseline.json`, any contract test enumerating `AdminZoneNameSchema` or
`assetReferenceKindSchema`. **Before finishing**: grep `backend/test/**` for every moved symbol
(`hasPageBuilderBlocks` moves files) — `test:unit:fast` will not see a broken import in the
contract or integration trees.

## Generated artefacts, changesets, documentation

**Regenerate and commit in the same merge request**

- `pnpm --filter backend run composer:generate` → `backend/src/db/migrations-registry.generated.ts`,
  `backend/src/db/entities-registry.generated.ts`, `docs/sidebars.modules.generated.js` (new docs
  page), `docs/docs/modules/module-map.generated.md` if the summary moves. `admin/src/modules.generated.ts`
  should not change (`catalog` and `cms` already ship admin layers) — `composer:check` confirms.
- `pnpm --filter backend run manifests:generate` then `pnpm install --lockfile-only` → module
  `package.json` files only if a new bare specifier appears (none expected); commit
  `pnpm-lock.yaml` if it moves.
- `backend/test/fixtures/openapi-baseline.json` — by its own regeneration procedure.
- Read sizes: leave drifted entries alone (`check-estate.md` § *When a read size is re-recorded*);
  re-record only an entry the band refuses.

**Changesets** (`release-intent.md`; lockstep `fixed` group; `0.x` ⇒ never `major`)

| Package | Level | Why |
| --- | --- | --- |
| `@endora-commerce/contracts` | minor | enum members added to three exported schemas (breaking for exhaustive consumers), new schemas, zone, reference kind, error code, port method; the body tells connector authors to skip `page_builder` |
| `@endora-commerce/mod-catalog` | minor | content attributes, routes, screen, card, PDP include, "Parametry" fix, attribute delete for every type (new refusals on overrides/variant values, soft-deleted products no longer block, `attribute.updated.v1` on delete) |
| `@endora-commerce/mod-cms` | minor | new zone contribution |
| `@endora-commerce/mod-custom-fields` | minor | `page_builder` admissibility rule |
| `@endora-commerce/mod-import-export` | patch | content columns refused per row |
| `@endora-commerce/mod-product-feeds` | patch | content attributes never offered |

`storefront`, `admin`, `backend`, `docs` are ignored by the config.

**Documentation** (`module-documentation.md`; EN source + PL materialised + translation cache, then
`check:docs-translations`)

- NEW `packages/modules/catalog/docs/catalog/product-content.md` (`title`, `description`):
  defining a content attribute, authoring, the "Opis" placement, Translate, CMS off, lifecycle,
  what phase 1 excludes. Link the category-content page relatively (same module); name the CMS
  module in prose (no sibling-module link, rule 1a).
- `packages/modules/catalog/docs/catalog/attributes.md`: the new type and its locked capabilities;
  the delete action and its usage dialog; the "Parametry" rule (only attributes marked visible).
- `packages/modules/catalog/docs/catalog.md`: one line in the page list.
- `packages/modules/catalog/docs/catalog/category-content.md`: one sentence that category content,
  unlike product content, keeps rendering while the CMS is off (OR-7).
- PL: `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/catalog/{product-content,attributes,category-content}.md`
  and `.../modules/catalog.md`, plus their entries under `docs/translation-cache/pl/`.

## Complexity Tracking

No constitution violation. One entry recorded for transparency:

| Design choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A dedicated `product_content_values` table instead of the definition-keyed `attribute_values` bag (Principle XIV's usual home for a runtime field's value) | FR-011 requires that no consumer of ordinary values ever sees a document; documents weigh up to 1 MiB; per-attribute last-save-wins and cascade | Storing in `attribute_values` makes nine readers each filter (and fail SC-006 on list reads); a `jsonb` column on `products` is one N-MiB blob with per-product, not per-attribute, writes (research R-1) |

**New runtime dependency**: none. **New dev or workspace dependency**: none.

## Risks

| Risk | Mitigation |
| --- | --- |
| Out-of-tree connectors (`pim_ergonode`, ERP adapters) offer `page_builder` attributes for mapping | Inbound refusal is in `catalog` (R-7), so nothing can be stored; the contracts changeset tells their authors; cannot be tested here |
| The `effectiveState.isPresent('cms')` probe in `catalog` may be read by a reviewer as an undeclared edge | **Accepted by OR-8.** The injection site carries a comment stating why no port or dependency is declared (catalog `nonDeactivatable`, cms deactivatable, the probe only gates a projection of catalogue data) |
| Adding enum members breaks an exhaustive consumer the type checker does not reach (a package outside `pnpm -r run typecheck`) | `pnpm -r run typecheck` covers every member; the changeset says `minor` and names the members |
| Moving `hasPageBuilderBlocks` breaks an importer in `backend/test/**` | Re-export from `catalog-query.service.ts`; grep `backend/test/**` before finishing |
| Category vs product CMS-off behaviour differs | **Accepted by OR-7.** Stated on both the product-content and the category-content pages; follow-up issue opened by a `tasks.md` task |
| Attribute delete now refuses on channel overrides and variant values that it used to ignore (OR-5) | An integration that deleted such attributes through the API gets a `409` naming the count. Recorded in the `mod-catalog` changeset body |

## Handoff summary for `endora-commerce-dev`

1. Contracts first (`custom-fields.ts`, `catalog.ts`, `assets-library.ts`, `admin-contributions.ts`)
   with `packages/contracts/src/product-content.test.ts` RED → GREEN; `pnpm run build:packages`.
2. `custom_fields` admissibility (R-5) with its co-located test.
3. `catalog` backend: rules (R-6) → type mapping (R-4) → migration + entity (data-model §2;
   `migration:new`, barrel, `composer:generate`) → `page-builder-content.ts` (R-2/R-3/R-12) →
   `product-content.service.ts` + Command + event + subscription (R-8/R-9) → R-7 guard →
   duplicate/delete/usage (R-16, R-21 — every attribute type) → asset descriptor (R-17) → PDP include + CMS probe (R-11/R-13) →
   api-key set read (R-14). Contract tests per row of the test plan, RED first.
4. `import_export`, `product_feeds` changes (R-15).
5. Admin: zone member in contracts → `cms` contribution → `ProductContentPage` → card → attributes
   screen (type, locked flags, delete dialog for every type) → i18n → surface tests.
6. Storefront: `product-tabs.ts` plan → components → page wiring → `include` option.
7. Docs EN + PL, changesets, regenerated artefacts, OpenAPI baseline.
8. Verify: typecheck, lint, `test:unit:fast`, `pnpm --filter '!backend' run test`, the contract and
   integration files listed in quickstart §6 locally, the `check:*` list there.

Do not assign a migration number; do not touch `cms`' or `custom_fields`' migrations; do not edit
generated files by hand; no palette action, no permission, no setting. The `isPageBuilderPresent` wiring carries the
OR-8 comment. Open the category-content follow-up issue (OR-7) — `tasks.md` has the task.
