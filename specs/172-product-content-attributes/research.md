# Research: Product content attributes

**Feature**: `specs/172-product-content-attributes/` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

Every decision below is stated as *decision → rationale → alternatives rejected*. Line numbers
are measured on `master` at `aaaf3ee87` and are pointers, not contracts — re-read before editing.
The direct precedent is commit `fcf6daa76` (category page content); it has no spec directory, so
the code it landed is the reference.

There is no `[NEEDS CLARIFICATION]` left. The points where the design has to say something the
spec did not, or where the spec's wording does not survive contact with the code, are collected
in **R-20** and repeated in the plan's *Deviations* section. The owner ruled on four of them at
the plan stage on 2026-11-04 (spec OR-5 – OR-8): attribute deletion for every type (**R-21**),
product deletion as a soft delete (R-16, R-20 (2)), category content left as it is while the CMS
is off (R-13), and the portless CMS presence probe (R-13).

---

## R-1 — Storage: a catalogue-owned side table, not the attribute-value bag

**Decision.** A new catalogue table `product_content_values`, one row per product × content
attribute, holding the per-language envelope `{ "languages": { "<code>": <document> } }` (the
shape `categoryContentEnvelopeSchema` validates, `packages/contracts/src/catalog.ts:1408`) plus a
small derived `summary` column. Keyed by `product_id` → `products(id)` and `product_attribute_id`
→ `product_attributes(id)` (the catalogue's own extension row,
`packages/modules/catalog/src/backend/entities/product-attribute.entity.ts`), both `on delete
cascade`, unique on the pair. `@GlobalEntity()` like `Product` and `ProductAttribute`.

**Rationale.**
- FR-011 is a population statement: *no* consumer of ordinary attribute values may receive a
  document. Today that population reads `products.attribute_values` from at least nine places
  (`catalog-query.service.ts:2252` detail, `:1340` and `:2754` listings, `coerceAttributeValues`,
  `search` indexing, `catalog-bulk-update.service.ts:314`, `scope-overview.service.ts:166`,
  `scope-completeness.ts:114`, the external API through `getProductByIdOrSlug`). A separate table
  makes the exclusion **structural** — every one of them is right by not changing — instead of a
  filter each must remember.
- A document may weigh 1 MiB (`CATEGORY_CONTENT_MAX_BYTES`, `catalog.ts:1371`); the product list
  reads select `attribute_values` wholesale, so storing documents there would break SC-006 on the
  first product that carried one.
- Both FKs stay inside `catalog`, so `fk-dependency-drift.test.ts` and `check:module-boundary`
  have nothing to say and no manifest `dependencies` change (`module-migrations.md` items 4/4a).
- `product_attribute_id` rather than `custom_field_definition_id`: the extension row is the
  catalogue's (cascade from its own delete Command), while the definition is `custom_fields`' — an
  FK to it would be a cross-module FK from a new table for no gain. Set membership is
  definition-keyed (`attribute_set_attributes.custom_field_definition_id`), so membership reads
  join through `product_attributes.custom_field_definition_id`, as
  `buildVisibleAttributesProjection` already does (`catalog-query.service.ts:2942-2958`).

**Alternatives rejected.**
- *A `jsonb` column on `products`* (the category shape, `category.entity.ts:102`, `lazy: true`).
  One column for N attributes means one lazy blob of up to N MiB; every save rewrites every
  attribute's document; per-attribute cascade on attribute delete becomes a JSON surgery; and the
  last-save-wins rule of the spec's edge cases would be per product instead of per attribute.
- *Inside `products.attribute_values`* with a type marker. Fails FR-011 by construction — every
  reader above would need a filter — and inflates list reads.
- *A table owned by `cms`*. `catalog` is `nonDeactivatable` (`catalog/src/manifest.ts:411`) and
  `cms` is switchable (`cms/src/manifest.ts:465`); the data would vanish from the catalogue's
  reach whenever an operator switched the CMS off, and the catalogue would need an edge it may not
  declare (`admin-contributions.ts:501-516` states the same reasoning for categories).
- *A new module* (`product_content`). The requirement is a new value type of an existing
  catalogue concept, with no owner other than the catalogue; a module would need a lifecycle edge
  to `catalog` and a port for every read the PDP makes, for code that is one table and one screen.

## R-2 — Empty languages are dropped on write; an all-empty value deletes the row

**Decision.** The save normalises the envelope: a language whose document has no block (the
existing `hasPageBuilderBlocks`, `catalog-query.service.ts:117`) is removed; if none remains, the
row is deleted (a `null` content is the same as "no value"). The audit records the languages
before and after.

**Rationale.** FR-013 makes "no block" mean empty everywhere. Normalising once on write means
the admin card status, the FR-007 product count and the storefront all read one fact, and the
count on attribute delete is not inflated by rows an operator emptied.

**Alternatives rejected.** *Store as sent and interpret on read* (the category precedent stores
empty documents and skips them in `getCategoryPageContent`, `catalog-query.service.ts:2703-2716`)
— works for one reader; here there are three (card, delete count, PDP) and each would re-derive.

## R-3 — A stored per-language summary for the admin card

**Decision.** `summary jsonb not null` on the row: `{ "<language>": { "blocks": n, "excerpt":
string | null } }`, computed on save by a pure function `summarisePageBuilderDocument(document)`
(top-level block count, first text-bearing prop — `text`, `title`, `heading`, `body`, `html`,
tags stripped, whitespace folded, cut at 120 characters).

**Rationale.** The spec's assumption: *"the product form neither loads the storefront renderer
nor the documents of every language at full size"*. The card list reads `summary` only; the
documents are read by the editing screen alone.

**Alternatives rejected.** *Compute on read from the documents* — loads up to N MiB into the
product editor. *Compute in SQL with jsonpath* — the "first text" rule is per-block-shape and
would be an unreadable jsonpath nobody can unit-test.

## R-4 — The value type: `page_builder`, added to all three attribute type vocabularies

**Decision.** One new member, spelled `page_builder`, in each of the three vocabularies an
attribute type lives in, because the catalogue maps between them bijectively
(`attribute-type-mapping.ts:60-121`):
1. `customFieldValueTypeSchema` (`packages/contracts/src/custom-fields.ts:38`) — the definition's
   generic type;
2. `attributeValueTypeSchema` (`catalog.ts:73`) — the legacy DB form `CatalogAttributeView.valueType`
   carries;
3. `apiAttributeTypeSchema` (`catalog.ts:90`) — the admin API's `type`.

`legacyToCfType('page_builder')` → `{ cfValueType: 'page_builder', selectDisplay: null,
numericKind: null }`; `cfToLegacyValueType('page_builder', …)` → `'page_builder'`;
`apiAttributeTypeOf('page_builder', _)` → `'page_builder'`.

**Rationale.**
- The type has to be visible on the **definition**, not only on the catalogue's extension row:
  `product_feeds` reads product field definitions through `customFieldDefinitionReadPort.listForEntity('product')`
  and may not read `product_attributes` (`product_feeds/src/backend/plugin.ts:849`,
  `field-source-catalogue.ts:104-108`). A discriminator only the catalogue can see is one the
  feeds picker cannot honour.
- The legacy and API forms are what every in-tree consumer reads
  (`CatalogAttributeView.valueType`, `serializeAdminAttribute`), so an out-of-tree connector
  reading `catalogAttributeReadPort` sees the type too (R-14).
- `varchar(16)` with no CHECK (`custom_fields/src/migrations/20260718T200338_custom_fields_init.ts:26`;
  no constraint anywhere) — `page_builder` is 12 characters, so **no `custom_fields` migration**.

**Exhaustiveness sweep** (who must change because the enums grew):

| Site | Today | Change |
| --- | --- | --- |
| `contracts/src/custom-fields.ts:249` `CUSTOM_FIELD_FILTER_OPERATORS` (a `Record<CustomFieldValueType,…>`) | 6 keys | `page_builder: []` — every filter on such a field is refused, never ignored |
| `contracts/src/catalog.ts:114` `apiAttributeTypeOf` | exhaustive switch | `case 'page_builder': return 'page_builder'` |
| `catalog/.../attribute-type-mapping.ts:60` `legacyToCfType` (`never` default) and `:99` `cfToLegacyValueType` | exhaustive | add the case to both, plus `CfAttributeValueType` / `DbAttributeValueType` |
| `custom_fields/.../custom-field-value.service.ts:178` `coerce` | `default` → `wrong_type` | explicit `case 'page_builder'` → `wrong_type` "Page Builder content is not a field value" (keeps the default for truly unknown types) |
| `custom_fields/.../custom-field-list-filter.service.ts:56` `predicates` | `default: []` | explicit case → `[]` (unreachable: R-5 refuses the filter first) |
| `custom_fields/src/admin/components/DefinitionForm.tsx:17` `VALUE_TYPES` | hand list of 6 | **unchanged** — the generic form must not offer it (FR-002); a test pins that |
| `comparisons/.../comparable-attribute-projection.ts:90,137`, `price_lists/.../attribute-eligibility.ts:33`, `promotions/.../promotion-service.ts:590` | switches with `default` / allow-sets | no change needed — reached only through flags R-6 holds off; the type checker is the confirmation |
| `storefront/components/attributes/ParametryTab.tsx` (`valueType: string`) | string | none |
| `catalog/src/admin/components/ProductAttributesTab.tsx:31` local `ValueType` union and `default` → text input | text input for unknown | add `page_builder` → the card (R-10); never the text input |

**Alternatives rejected.**
- *A catalogue-only marker* (a boolean `isContent` on `product_attributes`, CF type `text`). The
  feeds picker and every definition reader would see a `text` field; the generic value validator
  would accept a string for it; FR-002 ("every other host neither offers nor accepts") would have
  nothing to attach to.
- *`content` / `rich_content` / `document`*. `content` collides with the Page Builder tree's own
  `content` key and with `categories.content`; `page_builder` names the editor the spec names and
  is the term the UI already uses ("Page Builder content").
- *Adding only the CF member and deriving the legacy/API forms ad hoc.* The three vocabularies are
  bijective by design (feature 061 §R7); breaking that is how `apiAttributeTypeOf`'s comment says
  drift starts.

## R-5 — FR-002: admissibility is a registry marker on the entity type

**Decision.** `SupportedEntityMeta` (`custom_fields/.../custom-field-registry.ts:4`) gains an
optional marker `pageBuilderValues?: true`, set on `product` only (`:87`). The apply seam
(`custom-field-definition-apply.ts`, `applyCreate` at `:240`, `applyUpdate` at `:288`) refuses a
`page_builder` definition on any type without the marker with a new definition failure code
`value_type_unsupported` (added to `CUSTOM_FIELD_DEFINITION_ERROR_CODES`, `custom-fields.ts:457`).
The generic admin service (`custom-field-definition.service.ts`) goes through the same apply
functions, so the generic `POST /api/v1/admin/custom-fields/definitions` refuses it too.

**Rationale.** The registry already carries exactly this kind of per-type opt-in (`listFilter`,
`carryTargets`, `managedBy`) and its doc comment states the rule: *"consumers ask only whether
the type offers the option, never which module uses it."* A literal `entityType === 'product'`
in the apply seam would be the second hard-coded host list in the module.

**Alternatives rejected.** *Refuse in the catalogue only* — the generic route would still accept
it for an order or a customer (FR-002, US1 #5). *A Zod refine on `createCustomFieldDefinitionSchema`*
— the schema knows the entity type on create but not on patch, and the registry is the module's
own fact, not the contract's.

## R-6 — FR-003/004/005: capability rules are one pure function called by both Commands

**Decision.** `content-attribute-rules.ts` (catalogue backend) exports
`assertContentAttributeShape(input)` which, for a `page_builder` attribute, refuses with `400
VALIDATION_FAILED` and `details: [{ path: '<flag>', issue: 'not available for Page Builder
content' }]` any of: `isSearchable`, `isFilterable`, `isVariantAxis`, `displayAsSlider`,
`isComparable`, `quickSearchable`, `isPromoRule`, `isPriceRule`, `massEditable`, `isRequired`,
`isVisibleOnProductPage`, `channelScoped` set `true`, and `languageScoped` set `false`. On create
an omitted `languageScoped` is written `true`. The same module exports
`assertTypeChangeAllowed(from, to)` → `409 VALIDATION_FAILED` when exactly one side is
`page_builder`. Both are called from `createAttributeCommand` / `updateAttributeCommand`
(`commands/attribute-commands.ts:168`, `:276`) with the **effective** post-patch flags, so a PATCH
that only switches one flag on is judged against the stored type. As defence in depth the apply
seam refuses a `valueType` patch to or from `page_builder` with the existing `value_type_locked`
code (`custom-field-definition-apply.ts:295`), whatever the stored values.

**Rationale.** Every flag write funnels through these two Commands (the admin flag grid PATCHes
the attribute, `AttributesManager.tsx:272`; scope changes go through `updateAttributeByIdOrKey` →
`updateAttributeCommand`, `catalog-admin.service.ts:1462`). Naming the capability in `details`
is what US1 #2 asks.

**What holding the flags off buys** — the exclusions it makes structural, which is why R-15 is
short:

| Flag held off | Consumers that therefore never see the attribute |
| --- | --- |
| `isSearchable`, `quickSearchable` | `search` indexing, `catalog-quick-search.service.ts`, quick order |
| `isFilterable`, `displayAsSlider` | storefront filter sidebar (`getFilters`), filter facets |
| `isComparable` | `comparisons` (`catalog-query.service.ts` `comparableAttributeKeys`) |
| `isPromoRule` | `promotions` criterion picker (`CatalogPromoAttributePort`) |
| `isPriceRule` | `price_lists` rule picker (`attribute-eligibility.ts`) |
| `massEditable` | bulk edit picker (`/attributes/by-flag?flag=isMassEditable`) and its pre-flight refusal (`catalog-bulk-update.service.ts:163-170`, `ATTRIBUTE_NOT_MASS_EDITABLE`) |
| `channelScoped` | per-channel overrides (`product-overrides.service.ts:186`) |
| `isVisibleOnProductPage` | the "Parametry" projection (`buildVisibleAttributesProjection`) |
| `isRequired` | required-value guard and scope completeness (`scope-completeness.ts:158`) |

**Alternatives rejected.** *Silently coerce the flags to their forced values.* US1 #2 asks for a
refusal naming the capability, and a silent coercion would let an integration believe it had
made the attribute searchable.

## R-7 — FR-014: the ordinary attribute-values path refuses content keys at one guard

**Decision.** `assertAttributeValueKeysAllowed` (`catalog-admin.service.ts:2130`) refuses any key
whose view is `page_builder` — **before** the `existingKeys` exemption, so a resend cannot smuggle
one — with `400 ATTRIBUTE_VALUE_REJECTED` and `details: [{ path: 'attributeValues.<key>', issue:
'Page Builder content is edited on the product content screen' }]`.

**Rationale.** It is the one guard every product write crosses: admin create (`:440`) and update
(`:704`), the integration upsert `PUT /api/v1/catalog/products/by-sku/:sku`
(`routes.api-key.ts:50`, via `createProduct` / `updateProductAudited`), and the write port
`pim_ergonode` uses (`catalog-write-ports.ts:39-43`). Product values are not run through
`custom_fields`' `validateAndMerge` (the guard checks keys only), so this is the place, not the
CF coercer.

**Alternatives rejected.** *Rely on R-4's `coerce` refusal.* Catalogue product values never pass
through it.

## R-8 — Admin read/write API: product-scoped content routes beside the category pair

**Decision.** Three routes on `catalog`'s admin plugin (`routes.admin.ts`), gated
`catalog:read` / `catalog:write`, plus a usage read for the delete dialog — full shapes in
`contracts/admin-api.md`:
- `GET  /api/v1/admin/catalog/products/:id/content` — the card list (summaries only);
- `GET  /api/v1/admin/catalog/products/:id/content/:attributeKey` — one envelope;
- `PUT  /api/v1/admin/catalog/products/:id/content/:attributeKey` — replace one envelope;
- `GET  /api/v1/admin/catalog/attributes/:idOrKey/usage` — set, value and content counts.

The PUT declares a route-level `bodyLimit` of `PAGE_BUILDER_CONTENT_MAX_BYTES + 65_536`.

**Rationale.** Mirrors `GET/PUT /api/v1/admin/catalog/categories/:id/content`
(`routes.admin.ts:1221-1241`). Addressed by attribute **key** because keys are immutable once
created (`updateCustomFieldDefinitionSchema` omits `key`, `custom-fields.ts:158`) and the admin route `/catalog/products/:id/content/:attributeKey`
is readable and linkable. The route body limit is what makes the oversize answer the envelope's
own error ("must not exceed 1048576 bytes") rather than Fastify's 413 "Request body is too large",
which the platform translates without naming any limit (`packages/platform/src/http/error-envelope.ts:373-394`)
— the spec's edge case asks for an error that names the limit; the category route has the same gap
and is left as it is.

**Alternatives rejected.** *A key on the product PATCH* — the spec's edge case requires that the
product form and the content never write each other. *One PUT for all attributes of a product* —
last-save-wins must be per attribute.

## R-9 — Audit and events: `product.content.update`, `product.content.updated.v1`

**Decision.** The PUT runs `CommandBus.run` with `action: 'product.content.update'`,
`objectType: 'product'`, `objectId: <productId>`, `before: { attributeKey, languages: [...] }`,
`after: { attributeKey, languages: [...] }` — never the documents. Its event is a new
`product.content.updated.v1` `{ productId, attributeKey }`, declared on the catalogue's product
event map (`CatalogEvents`, `catalog-admin.service.ts:27`). `catalog` subscribes to it and calls
`catalogProductPageRevalidation.productChanged(productId)` (the existing handler,
`index.ts:1315-1318`). Audit label `auditLog.product.content.update` in `catalog`'s `en`/`pl`
bundles (the viewer resolves `auditLog.<action>` in the action's module namespace,
`audit_logs/src/admin/pages/AuditLogViewer.tsx:366-373`).

**Rationale.** FR-024, FR-035. `product.updated.v1` is subscribed by `search` (re-index),
`seo`, `price_lists` and `catalog` (`grep` of `ctx.subscribe('product.updated.v1'`); emitting it
would re-index the product on every paragraph — the reason `category.content.updated.v1` exists
(`category-admin.service.ts:41-51`). Product pages are tagged per key and the revalidation service
already knows every key of a product (`product-page-revalidation.ts`), so the next page load shows
the change (FR-035) without touching the shared product tag.

**Alternatives rejected.** *Reuse `product.updated.v1` with `changedFields: ['content']`* —
every subscriber would have to learn to ignore it. *No event, flush inline* — the flush is a
post-commit concern the Command Bus already sequences.

## R-10 — Admin surfaces: a new zone, a new screen, a card in the attributes tab

**Decision.**
- **Zone** `product.content.editor` in `AdminZoneNameSchema` with
  `ProductContentEditorZoneProps { productId, attributeKey, language, data, onChange }`,
  modelled member-for-member on `category.content.editor` / `CategoryContentEditorZoneProps`
  (`admin-contributions.ts:495-517`, `:629-637`).
- **Contributor** `cms`: `zones/ProductContentEditor.tsx`, the twin of
  `zones/CategoryContentEditor.tsx`, registered in `cms/src/admin/index.ts` zones (`:206-224`) with
  `requiredPermission: READ_PERMISSION`. It passes `activeLanguage={language}` (Translate,
  feature 151) and `resource={{ type: 'catalog_product_content', id: productId }}` (the translate
  request's audit context, `cms.ts:1303-1309`).
- **Host screen** `catalog/src/admin/pages/ProductContentPage.tsx` at
  `/catalog/products/:id/content/:attributeKey` (`READ_PERMISSION`), the twin of
  `CategoryContentPage.tsx`: `ContentLanguageTabs`, a ref-held draft, one Save for every edited
  language, `useUnsavedChangesPrompt`, read-only text without `catalog:write`, the "no editor"
  alert when `useAdminZone(...)` counts zero contributors.
- **Card** in `ProductAttributesTab.tsx`: a `page_builder` member renders `ProductContentCard`
  (label, per-language status chips, block count + excerpt, **Edit content** link) in the grid's
  position order, spanning both columns. It never mounts `product.editor.field.after` (no
  connector protection on a value no connector maps, FR-042).

**Rationale.** FR-020–FR-026 and FR-050. `catalog` may not name `cms` (it is
`nonDeactivatable`; a declared edge would make `cms.enabled` a dead switch,
`module-composition.md` item 4a); a zone is what disappears with `cms.enabled` and with a role
lacking `cms:read` on its own (Z15), which gives the spec's edge case ("can edit the catalogue
but lacks the CMS read permission → the same notice") for free.

The card decides "editor available" with the same `useAdminZone('product.content.editor', …)`
count, so card and screen cannot disagree. It offers **Edit content** only when (a) the product
is saved (FR-026), (b) an editor is available (FR-050), and (c) the Details tab's attribute set
equals the saved one — otherwise the content screen would answer the PUT with FR-012's refusal;
the card says "save the product to edit content for this attribute set" instead.

**Alternatives rejected.** *Generalise `category.content.editor` with a discriminator.* Z13: two
places are two members, and a contributor matching on a prop it must know the meaning of is the
coupling the zone exists to avoid. *An inline canvas or a drawer* — rejected by the spec's own
assumption (a canvas needs a page's width).

## R-11 — Storefront API: content on the product detail, opt-in by `include=content`

**Decision.** `GET /api/v1/catalog/products/:idOrSlug` accepts `?include=content`
(`productDetailQuerySchema`, Zod, refuses any other value). Only then does the response carry
`contentAttributes: Array<{ key, language, content }>` — current-set content attributes with a
non-empty document in the resolved language, ordered by `attribute_set_attributes.position`, ties
by key. Built by a new `CatalogQueryService.getProductPageContent(productId, attributeSetId, ctx)`
called from the public route handler (`routes.public.ts:304-322`) **after**
`getProductByIdOrSlug` has resolved visibility; never from `routes.external.ts:96` or the other
three internal callers. The storefront's `getProductBySlug` gains an `include` option and only
`productById` in `app/(catalog)/p/[slug]/resolution.ts:61` passes it.

**Rationale.**
- FR-036: `getProductBySlug` is also called by the shopping-list page
  (`app/(account)/shopping-lists/[id]/page.tsx:110`, one read **per line**), Page Builder block
  data (`lib/page-builder/block-data.ts:77`) and draft minimums (`lib/api/catalog.ts:206`). Always
  including content would put up to N MiB into each of those reads. An opt-in keeps every other
  response byte-identical and gives the PDP its own Data Cache entry (the URL differs).
- FR-042: the external API reuses `getProductByIdOrSlug` (`routes.external.ts:100`), so content
  inside that method would leak to integrations; a separate method called by one route cannot.
- Visibility, channel and audience are `getProductByIdOrSlug`'s (FR edge case "adds no visibility
  rule of its own", Principles XI/XII) — the content read happens only after it returned a product.

**Alternatives rejected.** *A separate `GET /api/v1/catalog/products/:id/content`* (the category
shape) — FR-036 says content is exposed on the response that already carries the description,
and a second request per PDP doubles the page's catalogue round-trips. *Always include* — see
above.

## R-12 — Language resolution: one helper shared with category content

**Decision.** Extract the candidate walk of `getCategoryPageContent`
(`catalog-query.service.ts:2703-2717`: `ctx.preferredLanguage`, `ctx.resolvedChannel.defaultLanguage`,
`'en-US'`, `'en'`, then every stored key; skip a language with no block) into
`resolvePageBuilderLanguage(languages, ctx)` in a new `services/page-builder-content.ts`, together
with `hasPageBuilderBlocks` (moved from `catalog-query.service.ts:117`, re-exported there for its
existing importers) and the R-2/R-3 functions. Category and product content both call it.

**Rationale.** FR-033 says "in the order the category content uses"; one function makes that a
fact rather than a promise, and the category tests then cover the product path too.

**Alternatives rejected.** *A copy in the product method* — two derivations of one rule.

## R-13 — CMS off (FR-050–052): the backend omits, the storefront also checks

**Decision.**
1. **Backend (authoritative).** `getProductPageContent` returns `[]` when
   `effectiveState.isPresent('cms')` is false, injected into `CatalogQueryService` from
   `catalog`'s `index.ts` as `isPageBuilderPresent: () => effectiveState.isPresent('cms')` —
   the shape `index.ts` already uses for `seo`, `search` and `inventory` (`index.ts:441`, `:500`,
   `:517`).
2. **Storefront (cache window).** The PDP renders content only when
   `modules.isPresent('cms')` from `getServerContext()` (`lib/server-context.ts:41`) — the precedent
   is `lib/api/blog.ts:155` (`modules.isPresent('catalog')`).
3. **Admin.** The zone count (R-10). The content routes stay up (the catalogue owns them) so the
   card still shows per-language status with CMS off (FR-050).

Stored rows are never touched by any of it (FR-050, FR-052, SC-004).

**Rationale.** The backend decision is what any API consumer gets (Principle II — a third-party
storefront must not render content the operator switched off). The storefront check exists
because the PDP read is cached for 60 s under product tags (`lib/api/catalog.ts:129`), while an
activation flip flushes only `modules:presence` (`packages/platform/src/lifecycle/commands/activation.commands.ts:221`);
without it, switching the CMS off would leave content on cached pages for up to a minute. Both
read the same effective state, so they cannot disagree except inside that window, where the
storefront's answer is the fresher one.

**Why the backend probe is not a lifecycle edge.** `catalog` calls no `cms` port, so there is no
`lazyPort` edge for `check:port-dependencies` to classify, and a `dependencies` entry is
forbidden (dead switch). The probe answers `false` for a CMS that is not installed at all, which
is the right answer. The only manifest spelling for a soft edge (`nonBindingDependencies`)
requires a port `name`, and this edge has none.

**Owner ruling OR-8 (2026-11-04).** The portless probe is accepted. The code that wires it — the
`isPageBuilderPresent` injection in `packages/modules/catalog/src/backend/index.ts` — **must**
carry a comment stating why no port and no dependency is declared. The comment gives three
reasons. `catalog` is `nonDeactivatable`, so a `dependencies` entry on `cms` would make
`cms.enabled` a dead switch (`module-composition.md` item 4a). `cms` is deactivatable, so its
absence is a normal state. The probe gates only a projection of `catalog`'s own data (the PDP's
`contentAttributes`). It calls no `cms` code and reads no `cms` data, so there is no port to
declare. A reviewer who meets the probe reads the ruling there rather than re-raising it.

**Divergence from the precedent, deliberately.** Category content **keeps rendering** with the
CMS off — the zone comment says so (`admin-contributions.ts:515-516`), and the storefront category
page does not check (`app/(catalog)/c/[slug]/page.tsx:102,179`); the base blocks are not owned by
`cms`, so `withPresence` does not hide them (`storefront/lib/page-builder/config.ts:61-90`). The
spec requires the stricter rule for products (FR-051). **Owner ruling OR-7 (2026-11-04)**: the
inconsistency is accepted. Aligning categories is out of scope and goes into a follow-up issue
(spec § *Follow-ups*; a non-code task in `tasks.md` opens it). Both module documentation pages
state the difference.

**Alternatives rejected.** *Storefront only* — fails Principle II for other consumers. *Backend
only* — a minute of stale content after a switch-off, on the most cached page of the shop.
*Flush product tags on a CMS activation flip* — the platform's activation command would have to
learn which modules' caches depend on which other modules; that is the coupling Principle XVII
forbids the platform to hold.

## R-14 — PIM/ERP connectors and the external API (FR-042)

**Decision.**
- **Outbound product data**: structural — content is not in `attribute_values`, and the external
  detail/list (`routes.external.ts`) never calls `getProductPageContent`.
- **Mapping offers (in tree)**: the integration-facing attribute-set read
  `GET /api/v1/catalog/attribute-sets/:id` (`routes.api-key.ts:95-102`) omits `page_builder`
  members (`getSetDetail(id, { includeContent: false })`); the admin read of the same set keeps
  them (the attributes tab needs them, OR-2).
- **Inbound**: R-7's guard refuses a value through the integration upsert and the write port,
  with `ATTRIBUTE_VALUE_REJECTED` naming the key — rejected and reported, never stored.
- **Out-of-tree connectors** (`pim_ergonode` and the ERP adapters are not in this repository;
  `pim_connector` / `erp_connector` here are exclusivity registries only,
  `pim_connector/src/backend/services/pim-connector-registry.service.ts`): they read
  `catalogAttributeReadPort`, whose views now carry `valueType: 'page_builder'`. Their mapping
  pickers must skip that type; this repository cannot test it. The changeset for
  `@endora-commerce/contracts` says so for the consumer.

**Alternatives rejected.** *Drop content attributes from `catalogAttributeReadPort.listAll()`.*
The same registration serves `catalog`'s own admin and services (`index.ts:999-1015`, and four
in-module `lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort')` reads); a
filtered port would hide the attribute from the attributes screen it is created on.

## R-15 — The remaining phase-1 exclusions (FR-040–FR-046), each with its place and proof

| FR | Consumer | Where the refuse/omit happens | Proof (test) |
| --- | --- | --- | --- |
| FR-040 | Per-channel overrides | `channelScoped` forced off (R-6) → `product-overrides.service.ts:186` refuses an override for a non-channel-scoped attribute; R-1 means there is no value to override | contract: PUT a channel override for the content key → refused |
| FR-041 export | `import_export` products | The products CSV has **no attribute columns at all** (`products.adapter.ts:29-38`, `EXPORT_HEADER`), and content is not on `CatalogProductRecord` — structural | contract: export a catalogue with content → header and cells carry no content key, no document text |
| FR-041 import | `import_export` products | New: `CatalogBulkImportPort.contentAttributeKeys()` (catalog-owned port `import_export` already resolves); `productsAdapter.importRows` pushes `{ index, reason: 'content attribute "<key>" cannot be imported' }` for every row with a non-empty cell under such a column, then validates the row's other cells as today | contract: CSV with a `buying_guide` column → per-row error naming the attribute; nothing stored |
| FR-042 | PIM/ERP, external API | R-14 | contract: external detail has no `contentAttributes`; api-key set read omits the member; by-sku upsert with the key → 400 naming it |
| FR-043 | Bulk edit | `massEditable` forced off → not in `/attributes/by-flag?flag=isMassEditable` (`ProductsBulkEditDialog.tsx:252`), and the pre-flight refuses `ATTRIBUTE_NOT_MASS_EDITABLE` (`catalog-bulk-update.service.ts:163-170`) | contract: bulk request naming the key → refused; by-flag list omits it |
| FR-044 | `product_feeds` | `listProductFieldDefinitions` (`product_feeds/src/backend/plugin.ts:849`) filters `valueType === 'page_builder'` — one function feeds both the picker (`routes.templates.ts:140`) and the save-time key check (`listProductFieldKeys`, `:858`), so it is not offered **and** a template naming it is refused. `FeedCriteriaPanel.tsx:80` (reads the catalogue's attribute list) filters the type out of its picker. Generation reads `attribute_values`, so a feed can never carry a document | co-located unit on `buildFieldSourceCatalogue` input; contract: template save with the key → refused; admin test on the criteria picker |
| FR-045 | Storefront search, quick-order search, admin product search | `isSearchable`/`quickSearchable` off + R-1 (indexers read `attribute_values`); the admin search provider matches name/SKU (`admin-search-provider.ts`) | contract: listing `?q=<word only in content>` → no hit (postgres backend); quick-search port → no hit; co-located `admin-search-provider.test.ts` asserts no content field in the query |
| FR-046 | Promotions, price lists, comparison, filters | flags off (R-6): `CatalogPromoAttributePort`, `attribute-eligibility.ts:33`, `comparableAttributeKeys`, `getFilters` | contract: each picker endpoint omits the content attribute |
| FR-047 | — | the table above | — |

**Alternative rejected for FR-041 import.** *A file-level header refusal* (the
`refusedHeader` mechanism, `import-export-service.ts:165-171`). It is static per adapter, and the
spec asks for a per-row error naming the attribute. See R-20 (3) for what "processed as today"
can and cannot mean.

## R-16 — Lifecycle: duplicate, set membership, delete, attribute delete

**Decision.**
- **Duplicate (FR-060).** Inside the `product.duplicate` Command's transaction, after the new
  product row is flushed (`catalog-admin.service.ts:932-990`): `insert into product_content_values
  (id, product_id, product_attribute_id, content, summary, created_at, updated_at) select
  gen_random_uuid(), ?, product_attribute_id, content, summary, now(), now() from
  product_content_values where product_id = ?`. The audit `after` gains `contentAttributeCount`.
- **Set membership (FR-061).** Nothing is written. Every read joins
  `attribute_set_attributes` on the product's **current** set, so a non-member's row is invisible
  to the card list, the editing screen (404) and the PDP, and reappears when the attribute is a
  member again.
- **Product delete (FR-062, owner ruling OR-6).** The product delete is a **soft** delete
  (`deletedAt`, `catalog-admin.service.ts:1359-1407`), and it stays one. Content rows stay with the
  soft-deleted row. The FK cascade removes them physically when the product row is purged. The
  asset-reference descriptor and every read skip `p.deleted_at is not null`, so the content is
  unreachable and its assets are no longer reported (US6 #3). Note: no code path in the tree
  purges a soft-deleted product today, and `product.delete` has no undo or un-delete. Until a purge
  exists, the rows simply persist with their product, like every other row of a deleted product.
  This feature does not add a purge (spec, out of scope).
- **Attribute delete (FR-007 – FR-009, owner ruling OR-5).** For every attribute type; the
  per-consumer decisions are **R-21**. For a content attribute, `deleteAttributeCommand`
  (`attribute-commands.ts:394`) deletes the attribute's content rows explicitly before it removes
  the extension, and records `before.productContentCount = N` in the audit row. The FK cascade is
  the backstop. The admin learns N before confirming from `GET …/attributes/:idOrKey/usage` (R-8).

**Rationale.** Duplicating inside the Command makes the copy atomic with the product row; the
existing bridge copies after the Command (`:993` onwards) predate that option and are not moved by
this feature.

## R-17 — Asset references (FR-063): kind `product_content`

**Decision.** `assetReferenceKindSchema` (`contracts/src/assets-library.ts:30`) gains
`product_content`. `asset-references.ts` registers a sixth descriptor, `productContentDescriptor`,
the `categoryContentDescriptor` query (`asset-references.ts:162-189`) over
`product_content_values pcv join products p on p.id = pcv.product_id where p.deleted_at is null`
— one statement per batch, `strict $.**` walk, `textArrayLiteral` binding — answering
`{ kind: 'product_content', entityId: <productId>, label: 'Product "<name>" — content "<attribute key>"' }`.

**Rationale.** Same idiom, same safety (UUID-stripped literal), same feature-166 batching; the
`entityId` is the product, so the "in use by" dialog names the product (US6 #5).

## R-18 — Storefront rendering, and the "Parametry" defect (FR-030–039)

**Decision.**
- Extract the tab construction of `app/(catalog)/p/[slug]/page.tsx:214-283` into a pure
  `storefront/lib/catalog/product-tabs.ts` (`productTabPlan(product, { pageBuilderPresent })` →
  which tabs, and what the description tab holds) plus two components:
  `components/catalog/ProductDescriptionPanel.tsx` (plain description, then each content
  attribute through `ProductContent`) and `components/catalog/ProductContent.tsx`, the twin of
  `components/CategoryContent.tsx` — `PageBuilderRender` with the resolved `language`, no
  heading (OR-4), nothing when the document has no block.
- **"Opis"** is added when `product.description` is non-empty **or** at least one content
  attribute renders (FR-031). A document of only switched-off modules' blocks: the backend
  cannot know which blocks a storefront draws, so "renders" is decided as "has a block" (FR-013);
  `withPresence` turns an absent module's block into an empty span. The spec's edge case asks that
  such a document not make an otherwise empty tab appear; see R-20 (4).
- **"Parametry"**: the raw `product.attributeValues` table (`page.tsx:239-268`) and
  `hasAttributeValues` (`:220`) are deleted; the tab is added only when `visibleAttributes` is
  non-empty (FR-038, FR-039). `ParametryTab` is unchanged.

**Rationale.** A pure plan function is what makes FR-031/FR-039 unit-testable without rendering
an RSC page; the repository's PDP tests already test extracted pieces
(`test/catalog/pdp-minimum.test.tsx` imports `lib/orderMinimum`).

## R-19 — Tests: where each kind lands

**Decision.** Follow the current tree, as feature 170 does:
- **Pure unit tests co-located** beside their subject as `*.test.ts` in the module package
  (normative: AGENTS.md repo map, citing the pre-migration `specs/106-module-owned-tests/contracts/module-test-ownership.md` §2),
  run by `pnpm --filter '!backend' run test` (each package's `vitest.config.ts`) — e.g.
  `packages/modules/catalog/src/backend/services/page-builder-content.test.ts`,
  `packages/contracts/src/product-content.test.ts`.
- **HTTP contract tests** in `backend/test/contract/<module>/` and **integration tests** (real
  Postgres, cross-module) in `backend/test/integration/<module>/` — the complete suite, which a
  merge request pipeline does **not** run (D-198); run them locally.
- **Admin component tests** in `admin/test/modules/<module>/` (`admin` workspace vitest).
- **Storefront tests** in `storefront/test/catalog/` and `storefront/test/components/`.

The per-FR map is in `plan.md` § *Test plan*.

## R-20 — Where the spec cannot be met as worded, and what the design does instead

1. **There is no attribute delete action in the admin today.** `AttributesManager.tsx` deletes
   options (`:824`) but never an attribute; the only caller of `DELETE
   /api/v1/admin/catalog/attributes/:idOrKey` is the API. FR-007 ("tell the operator how many
   products carry content for it before confirmation") therefore needs a **new** delete action on
   the attributes screen. The plan adds it for every attribute type, with a confirmation dialog fed
   by the new usage read. **Resolved by owner ruling OR-5**: the scope growth is accepted, and the
   spec now states it (FR-007 – FR-009). The per-consumer design is R-21.
2. **"Deleting a product MUST delete its content values" (the former FR-062 wording)** — product
   delete is a soft delete. Physically deleting up to N MiB of documents in that Command would
   either be unrecoverable or put the documents into the audit row (forbidden by FR-024's spirit).
   The design meets every observable clause of US6 #3: the content is unreachable everywhere and
   its assets are no longer reported. The rows go with the product row's cascade. **Resolved by
   owner ruling OR-6**: product deletion stays a soft delete, and FR-062 is reworded to the
   observable outcome.
3. **FR-041 import, "the rest of the row processed as today".** The products import is
   all-or-nothing: any row error answers `imported: 0` (`products.adapter.ts:162`). The design
   reports the per-row error naming the attribute and still validates the row's other cells, so the
   operator sees every problem at once; "as today" therefore means "the file is not imported while
   any row has an error", which is today's behaviour. No partial import is introduced.
4. **A document holding only blocks of switched-off modules** "does not on its own make an
   otherwise empty Opis tab appear". The backend decides non-emptiness by "has a block" (FR-013);
   whether a block draws is a storefront fact (`withPresence` over `blockPresenceOf(modules)`).
   The storefront plan therefore filters a content attribute out when **every** top-level block's
   owner segment (`<moduleId>.<Name>`) is in `modules.absentIds` — the same owner rule
   `composeStorefrontConfig` applies (`storefront/lib/page-builder/config.ts:78-82`). Base blocks
   (no owner segment) always count as drawing. Covered by a storefront test.
5. **FR-027 "audit labels".** Implemented as `auditLog.product.content.update` (R-9). Note that the
   precedent's `category.content.update` has no label today and renders its raw action name; not
   fixed here.
6. **FR-026 (unsaved product).** The attributes tab is hidden for a new product
   (`ProductEditor.tsx:558`, `show: !isNew`), so the card's "save first" state is reachable only if
   that changes. The card still implements it (the tab component already accepts an absent
   `productId`, `ProductAttributesTab.tsx:69-73`), and the admin test drives the component directly.

## R-21 — Attribute deletion for every type (FR-007 – FR-009, owner ruling OR-5)

**Decision.** The attributes screen gets a **Delete** row action for every attribute type. It is
fed by `GET /api/v1/admin/catalog/attributes/:idOrKey/usage` and executed by the existing
`DELETE /api/v1/admin/catalog/attributes/:idOrKey`, which runs the existing
`catalog.attribute.delete` Command (`attribute-commands.ts:394`). That Command still removes the
extension row and then the definition and its options through the apply seam
(`applyDeleteDefinition`, `custom_fields/.../custom-field-definition-apply.ts:370`) on **one**
EntityManager. So definition, extension and options go in one transaction and one audit row.
That part does not change.

For each thing that references an attribute, the design decides **refuse** (the delete is
refused while the reference exists), **cascade** (the reference is deleted in the same Command),
or **inert** (the reference stays, matches nothing, and is not the catalogue's to remove). The
evidence is the code at `aaaf3ee87`:

| Referencing data | Owner | Keyed by | Today's delete | Decision | Evidence and rationale |
| --- | --- | --- | --- | --- | --- |
| Attribute-set membership (`attribute_set_attributes`) | `catalog` | definition id | refuse (409) | **refuse**, unchanged | Removing an attribute from a set is a deliberate operator act with its own screen (`attribute-sets.md`). Cascading would silently re-shape every product form of that set. |
| Product baseline values (`products.attribute_values ? key`) | `catalog` | key | refuse (409), counting **every** product row, soft-deleted included | **refuse**, counting **non-deleted** products only (change) | Values are operator-authored data. FR-006 of feature 012 refuses deleting them by side effect, and that rule is kept. The guard today has no `deleted_at` filter. Soft deletion has no undo and no purge (R-16), so one deleted product that ever held a value would make the attribute undeletable forever, and the operator could not clear it. The usage read and the guard use **one** query, so the dialog and the refusal cannot disagree. A soft-deleted product's stale key stays in its JSONB. It is unreachable, as its content rows are (OR-6). |
| Per-sales-channel values (`product_value_overrides.attribute_key`) | `catalog` | key, no FK (`product-value-override.entity.ts:18-24`) | **not checked** (rows were orphaned) | **refuse** (new), non-deleted products | Same class of data as baseline values (feature 022). An override can exist without a baseline value, so today's guard misses it. The orphaned rows would revive under any later attribute reusing the key. Counted into `productValueCount`. |
| Variant values (`product_variants.variant_attribute_values ? key`) | `catalog` | key | **not checked** | **refuse** (new), variants of non-deleted products | Set membership can be removed while variants exist (`attribute-set.service.ts` has no axis guard). Cascading would strip a variant axis value and could make two variants identical. Counted into `productValueCount`. |
| Product content (`product_content_values`) | `catalog` | extension id, FK cascade | n/a (new table) | **cascade** | FR-007, as the spec states it. Explicit delete in the Command plus `on delete cascade` as backstop. `before.productContentCount` goes in the audit row, but no document does. |
| Option rows (`custom_field_options`) | `custom_fields` | definition id | cascade (`applyDeleteDefinition`) | **cascade**, unchanged | Options are part of the definition, not references to it. Option-in-use is already covered: options in use mean product values, and the guard refuses those. |
| Custom-field definition + catalogue extension | `custom_fields` + `catalog` | — | deleted together in one Command | **deleted together**, unchanged | Feature 061's total 1:1 invariant (`attribute-commands.ts:30-35`). |
| Promotion conditions and criteria (`promotions`, JSON `attributeKey`) | `promotions` | key | not checked | **inert** — neither refuse nor cascade | `catalog` may not read `promotions`' tables (Principle I), and `promotions` publishes no reference port. Evaluation already fails closed: an unknown key is skipped with `attribute_not_found` and the condition is `false` (`promotion-rule-service.ts:81-90`, `promotion-rule-evaluator.ts:52-55`). Saving a promotion that names an unknown key is refused (`promotion-service.ts:575-581`). |
| Price-list rows (`price_list_matrix_entries.attribute_key`) | `price_lists` | key | not checked | **inert** | Documented behaviour of feature 148 FR-007, kept by 160 (`attribute-eligibility.ts:3-21`): a row whose attribute is `attribute_not_found` is inert and resumes if an attribute qualifies again. The delete now emits `attribute.updated.v1`, so `price_lists` recomputes its surface for the key (`price_lists/src/backend/index.ts:393-397`). |
| Feed selection rules and template field bindings (`product_feeds`) | `product_feeds` | key | not checked | **inert** | Selection rules fail closed: an unknown key throws `UnknownSelectionFieldError` and the run records a configuration error. It never matches everything (`selection-rule-compiler.ts:42-58`, FR-029 of the feeds feature). A template field bound to the key renders empty, because no product holds a value — the refusal above guarantees that (`item-field-resolver.ts:221-227`). |
| Search index settings (Meilisearch filterable/searchable attributes) | `search` | key | **not refreshed** (delete emitted no event) | **refresh** — the delete Command emits `attribute.updated.v1` `{ attributeKey, isSearchable: false, isFilterable: false }` (change) | `search` rebuilds attribute settings on that event (`search/src/backend/index.ts:252`, `search-event-subscriber.ts:176`). Without it a deleted filterable key stays in the index settings. Reusing the existing event needs no subscriber change. The payload's flags are what the key is now. |
| Product-list saved views (`product_list_saved_views.filters`) | `catalog` | — | — | **no reference** | Filters hold `status`, `type` and `q` only (`product-list-saved-view.entity.ts:40-42`). |
| Bulk-edit undo snapshots (`BulkOperationRevertRecord`, `bulk-operation.entity.ts`) | `catalog` | key inside a JSON snapshot | — | **no change** | Undo is conflict-aware: it restores only where the current value still equals the operation's `after` (`bulk-operation.service.ts`, feature 054 §R3/§R5). Clearing values before deletion makes those differ, so an undo after deletion reports a conflict and writes nothing. |
| Filter position, flags, scopes | `catalog` (`product_attributes`) | extension row | deleted with the row | **cascade**, unchanged | Columns of the extension row itself. |
| Custom-field definitions cache (Redis) | `custom_fields` | entity type | `publishInvalidate('product')` post-commit (`catalog-admin.service.ts:1979`) | unchanged | Lifecycle pub/sub invalidation already in place. |

The confirmation dialog states the inert row as one static sentence, `attributes.delete.foreignRules`:
"Promotion conditions, price-list rows and feed rules that use this attribute stop matching
products." `catalog` cannot count those references without new ports into three modules, and
none of them is wrong after the deletion.

**Usage read shape** (contracts/admin-api.md §2): `attributeSetCount`, `productValueCount` (distinct
non-deleted products with a baseline value, a channel override or a variant value — the guard's
own query), `productContentCount`.

**Alternatives rejected.**
- *Cascade product values.* It contradicts feature 012 FR-006. The values may be the only copy of
  operator data, and a bulk "clear" already exists for mass-editable attributes. Making delete a
  bulk eraser is a decision for its own feature.
- *Refuse on foreign references (promotions, price lists, feeds).* `catalog` would need a new
  reference port from each, through a registry like the asset-reference one (feature 166). That is
  three modules' worth of contract for references that already fail closed. It is also no worse
  than what switching off `isPromoRule` / `isPriceRule` does today, which those modules already
  handle as inert.
- *Cascade foreign references through an `attribute.deleted.v1` event.* That deletes operator
  configuration in three modules on a catalogue click, irreversibly. Inert rows can be fixed by the
  operator, but deleted ones cannot be restored.
- *A new `attribute.deleted.v1` event for search.* That needs a new subscription in `search` and
  `price_lists` for exactly the reaction `attribute.updated.v1` already triggers.
- *Keep counting soft-deleted products in the guard.* The operator cannot clear them and nothing
  purges them, so the dialog would show a permanent blocker with no action.
