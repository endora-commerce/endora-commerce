# Contract: readers of product text (FR-030…FR-034, SC-003)

Decision: research R10. Measured 2026-10-30 by grep over `packages/modules/*/src`, `packages/{admin-kit,
page-builder-admin,cms-components,contracts,platform}/src`, `admin/src`, `storefront/{app,lib,components}`, tests
excluded, for: index access on a product `name` / `description`; `pick*` helpers applied to them; `name as Record`;
SQL `->>` on product name; `nameTranslations` / `descriptionTranslations` / `altText` maps; `effectiveNames` /
`localizedNames`; plus every consumer of `CatalogProductRecord`, `CatalogQuickSearchHit`,
`CatalogPackagingUnitRecord`, `comparisonProductSummarySchema`, `ProductImportRow`. The type change of §2 is the
authoritative instrument: after it, `pnpm -r run typecheck` names every remaining reader.

## 1. Population and the change per reader

Scope column: what the reader resolves at. **(C, L)** = the document's / request's channel and language through
`catalogProductAvailabilityPort.effectiveTexts` / `effectivePackagingUnitNames`; **G** = the Global string from the
record (FR-031: a reader with no channel).

| Module / package | File | Today | 168 | Scope |
| --- | --- | --- | --- | --- |
| carts | `src/backend/services/cart-line-meta.ts` | `effectiveNames` ∥ `pickLocalized(p.name, lang)` | `effectiveTexts` only | (C, L) |
| carts | `src/backend/services/cart-service.ts` (531-542, 687-711) | same | `effectiveTexts` | (C, L) |
| carts | `src/backend/services/cart-minimums.ts` (202, 408) | `pickLocalized(product.name, …)` | `effectiveTexts` | (C, L) |
| carts | `src/backend/services/cart-upsell-service.ts:168` | `name['en-US']` | `effectiveTexts` | (C, L) |
| carts | `src/backend/services/cart-admin-service.ts:439` | `name['en-US']` | Global string | G |
| carts | `src/backend/routes.ts:293` | `effectiveNames` | `effectiveTexts` | (C, L) |
| comparisons | `src/backend/services/comparison-service.ts`; contracts `comparisonProductSummarySchema.name` | map | `name: string`, effective | (C, L) |
| comparisons | `src/admin/document-blocks/canvas.tsx:89` | `pick(product.name, language)` | string | — |
| crm | `src/backend/services/reference-service.ts:96`, `src/admin/lib/references.ts:38` | `productLabel(name map, …)` | Global string | G |
| import_export | `src/backend/services/adapters/products.adapter.ts` | `name['en-US']` | CSV grammar (`import-profiles-and-csv.md`) | all |
| inventory | `availability-worker.ts:82`, `low-stock-alert-service.ts:93, 141`, `availability-notification-service.ts:367, 418` | `name['en-US'] ?? first` | Global string (operator alerts); the buyer back-in-stock e-mail: `effectiveTexts` at the subscription's channel and language | G / (C, L) |
| orders | `src/backend/services/order-service.ts:2837` | `pickLocalized` | `effectiveTexts` | (C, L) |
| orders | `order-api-intake-service.ts`, `placement-minimums.ts`, `preview-line-availability.ts`, `returnable-at-purchase.ts` | record consumers | verify (compile) | — |
| price_lists | `src/backend/services/price-book-reads.ts:653` | `pickName(product.name, lang, sku)` | Global string; `pageProductsByAdminName` loses its language argument (data-model §1) | G |
| product_feeds | `src/backend/services/feed-generation.service.ts`, `src/backend/routes.admin.ts:105, 183`, `src/admin/components/TemplatePreviewController.tsx` | map picks | feed: `effectiveTexts` at the feed's channel and language; admin preview: Global | (C, L) / G |
| quick_order | `src/backend/routes.ts:144` | `hit.effectiveName \|\| hit.name['en-US']` | `hit.name` is the effective string | (C, L) |
| quote_requests | `rfq-service.ts:269, 1569`, `rfq-admin-service.ts`, `packaging-resolution.ts:28` | `effectiveNames` ∥ `pickLocalized`; `nameTranslations` | `effectiveTexts`, `effectivePackagingUnitNames` | (C, L) |
| search | `search-indexer.ts`, `search-query.service.ts` | `pickLocale`, `localizedNames`, `pickLang` | `search-index.md` | (C, L) per L |
| seo | `meta-tag-resolver.service.ts:320-321`, `sitemap-generator.service.ts` | `pickLocale(product.name, locale)` | `effectiveTexts` at (C, L) for the derived fallback | (C, L) |
| cms (admin) | `src/admin/components/admin-catalog-preview-map.ts:40-45` | `pickAdminLocalizedName` | Global string | G |
| audit_logs | `src/backend/services/recent-activity-service.ts:360` | `name as Record` from an audit state | accept both: string (168 entries) or map (older entries) | — |
| shopping_lists, promotions, tasks, projects | `catalogProductReadPort` consumers | record consumers | verify (compile) | — |
| admin-kit | `components/product-browser/product-line.ts:17`, `ProductBrowserDialog.tsx:112` | `name['en-US']`, `name['pl-PL']` | Global string | G |
| page-builder-admin | `src/chrome/CatalogPickers.tsx`, `src/email/EmailEditorPane.tsx` | `pickName(name map \| string)` | string only | G |
| storefront | PDP alt / attachments / packaging (`app/(catalog)/p/[slug]/page.tsx`, `lib/api/catalog.ts`) | already receives resolved strings | verify; empty-override rendering per owner Q1 | (C, L) |
| catalog | ~26 files (services, admin, `effective-value.sql.ts`, `storefront-value-overrides.ts`, `catalog-query.service.ts`, …) | maps, `pickLang`, four-level resolver | rewritten in US2 / US3 | — |

**Not readers (corrections to the spec's starting list).** `returns`, `pwa`: no product text map (snapshots /
events only). `projects`: its hits are its own dictionary names. `assets_library`: the asset's **own** `altText`
map — not a product value; stays (FR-117), used as the gallery alt's derived fallback. `platform`: no product text
(verify by compile). Category, attribute-label, attribute-set, bundle-slot, attachment-type and option-label maps
are not product values and stay per-language maps.

## 2. Shapes that change (the compile-time instrument)

| Shape | Before | After |
| --- | --- | --- |
| `CatalogProductRecord.name` / `.description` | `Record<string,string>` | `string` / `string \| null` (Global) |
| `CatalogPackagingUnitRecord.nameTranslations` | `Record<string,string>` | removed |
| `CatalogQuickSearchHit.name` | map + `effectiveName` | `name: string` (effective at the search scope) |
| `comparisonProductSummarySchema.name` | `multilingualStringSchema` | `z.string()` |
| `ProductImportRow.name` / `.description` | maps | removed; scope cells (`import-profiles-and-csv.md`) |
| admin product request / response `name` / `description` | `multilingualStringSchema` | `z.string()` / `z.string().nullable()` |
| `CatalogProductAvailabilityPort.effectiveNames` | `Map<id, string>` | replaced by `effectiveTexts` → `Map<id, { name: string; description: string \| null }>`; plus `effectivePackagingUnitNames(unitIds, scope) → Map<unitId, string \| null>` |
| `galleryItemSchema.altText`, `productAttachmentSchema.nameTranslations` / `.descriptionTranslations`, `packagingUnitSchema.nameTranslations`, `translationMapPatchSchema` (`scoped-translations.ts`) | maps | removed; scoped sub-fields only through `scoped-values-api.md` |
| `AttributeScope { channelScoped, languageScoped }` | two flags | `scopable: boolean` + derived `scopeLevels` |
| `ResolvedSource` | five values incl. `global+language` | `ScopedSource` (data-model §0) |

## 3. The regression guard (FR-034)

`backend/test/unit/catalog/no-per-language-product-maps.test.ts` walks the population of §1's header and fails on
any of:

- identifiers: `nameTranslations`, `descriptionTranslations`, `localizedNames`, `effectiveNames`,
  `translationMapPatchSchema`, `global+language`, `168-shim`, `channelScoped`, `languageScoped`,
  `gallery_item_channel_labels`, `gallery_item_channel_hidden`, `product_attachment_channel_hidden`,
  `name_translations`, `description_translations`;
- patterns on product shapes: `/\b(product|p|item|hit|record|row)\??\.(name|description)\??\[/`,
  `/pick\w*\(\s*(\w+\??\.)*(name|description)\b/` in files importing a catalog product type,
  `/(products|p)\."?(name|description)"?\s*->>/`, `/alt_text\s*->/`;

with an allow-list limited to non-product maps (category, attribute label, option label, attribute set, bundle
slot, attachment type, payment / delivery method, CMS) **by file**, each entry carrying a reason. It prints
`[no-per-language-product-maps] read: files=<n> sites=<m>` and fails when `files` is 0.
