# Research: three-level product scope model and one scope switcher

**Feature**: `specs/168-product-editor-scope-switcher/` | **Spec**: `spec.md` (clarify rounds 1–5, exhausted)
**Measured on**: `feat/168-product-editor-scope-switcher` rebased on `origin/master` (2026-10-30).
**Amends**: `specs/163-product-data-scopes/` (research R1–R30 there; cited as 163 R#).

Every decision below is stated as **Decision → Rationale → Rejected alternatives**. Owner decisions recorded in
the spec's Clarifications are inputs, not decisions of this document; where this document reads a requirement in
a way the spec does not spell out, it says so under *Readings*. Questions that change user-visible behaviour and
that the spec does not answer are **not** decided here — they are listed in `plan.md` § *Questions for the owner*.

---

## R0 — Findings from reading the tree (inputs to the decisions)

| # | Finding | Evidence |
| --- | --- | --- |
| F-a | The resolver skips an override row whose value is empty (`isNonEmpty(hit.value.v)`), so an empty override **cannot exist** today — FR-013 forbids exactly that | `packages/contracts/src/product-value-resolver.ts:117-134` |
| F-b | `product_value_overrides` already models the C scope (`language_code NULL`) and C×L; only the API refuses C for `name` / `description` (`SYSTEM_ATTRIBUTE_SCOPES` languageScoped) | `packages/modules/catalog/src/backend/entities/product-value-override.entity.ts`; `product-overrides.service.ts:194-201` |
| F-c | `products.name` is jsonb and feeds four **generated stored columns** (`admin_name_key_en/pl`, `admin_search_key_en/pl`) through `catalog_admin_display_name(jsonb, …)`; Postgres refuses `alter column … type` on a column a generated column depends on | `packages/modules/catalog/src/migrations/20261022T182523_catalog_admin_name_keys.ts`; `product.entity.ts:221-251` |
| F-d | `CatalogProductRecord.name/description` are `Record<string,string>` and cross into 17 modules through `catalogProductReadPort` | `packages/contracts/src/catalog.ts:2102-2112` |
| F-e | No product carries a version token; the only `VERSION_CONFLICT` in catalog is a residual unique-violation mapping and the bulk undo | `product-scopes.service.ts:863`; `routes.admin.ts:535` |
| F-f | The SEO meta GET is **one route for three entity types** (`product`, `category`, `cms_page`), gated `catalog:write` | `packages/modules/seo/src/backend/routes.ts:345-372` |
| F-g | `seo` declares `catalog` in `dependencies`; `catalog` is non-deactivatable and reaches `seo` through `nonBindingDependencies` (`seoProductMetaPort`, degrades-without) | `packages/modules/seo/src/manifest.ts`; `packages/modules/catalog/src/manifest.ts:303-319` |
| F-h | A port writing on the caller's transaction already exists: `AdminNotificationRecordPort<EM>.recordWithin(em, …)` (no fork, no flush) | `packages/contracts/src/admin-notifications.ts:94-112` |
| F-i | `import_export` has no table, no entity and no `migrations/` directory; its activation setting says "The module holds no data of its own" | `packages/modules/import_export/src/manifest.ts` |
| F-j | The products import is gated by `catalog:write` per entity (`importPermissionFor`) behind an any-of gate; the two palette actions both target `/import-export` with `catalog:write` | `packages/modules/import_export/src/backend/routes.ts:35-75`; `manifest.ts:132-153` |
| F-k | Search queries `localizedNames.<L>` **and** top-level `name` / `description` / `searchableOptions`; the top-level fields hold the default-language pick, so a Polish shopper typing "drill" matches the English name — FR-033 forbids it | `packages/modules/search/src/backend/services/search-query.service.ts:425-439`; `search-indexer.ts:835, 920-921` |
| F-l | No single-Command undo exists anywhere: the only undo is the bulk-operation undo; 163 FR-081 / Q-D settled "re-applying the audit before-state restores", with no UI | `routes.admin.ts:519-545`; `specs/163-product-data-scopes/spec.md` FR-081 |
| F-m | The PIM field-path grammar carries locale and channel segments for `attribute`, `seo`, `name`, `description` | `packages/contracts/src/pim-field-path.ts`; `pim-connector.ts:37-43` |
| F-n | `product_editor_preferences.lastLanguageCode = NULL` means "primary admin language" | `product-editor-preference.entity.ts` doc block |
| F-o | Test and seed volume: ~145 test files create products (`insert into products`, `em.create(Product…)`, helpers) and ~78 POST the admin product API with a name map; 12 module demo seeders exist | grep of `backend/test`, `admin/test`, `packages/modules/*/src/backend/demo` |

---

## R1 — One scope model and one resolver, several stores

**Decision.** One scope vocabulary and one pure resolver in `packages/contracts/src/product-scope-model.ts`:

- `ScopeRef = { level: 'global' } | { level: 'channel', channelId } | { level: 'channel_language', channelId, languageCode }`.
- A field family declares its **scope set** in one table, `PRODUCT_FIELD_SCOPE_SETS` (FR-011 / FR-012):
  `{G,C,CL}` for name, description, status, URL key, SEO fields, alt text, gallery roles, hide image, attachment
  name / description / hidden, packaging-unit name, scopable **text** attributes; `{G,C}` for audience, window,
  minimum order quantity, returnable, scopable non-text attributes (number, boolean, date, select, multiselect, …);
  `{G}` for non-scopable attributes and every global-only field.
- Every store hands the resolver rows of one shape, `ScopedRow<T> = { channelId, languageCode: string | null,
  value: { kind: 'value', value: T } | { kind: 'empty' } }`, plus the Global value.
- `resolveScoped({ global, rows, scope, levels })` walks C×L → C → G restricted to `levels`, and **a row's presence
  wins whatever its value** (fixes F-a). It returns `{ value, source }` with
  `source ∈ 'set' | 'set_empty' | 'inherited_channel' | 'inherited_global' | 'absent'` — the three states FR-109
  names plus "no value anywhere".

The old four-level `resolveAttribute` / `resolveAll` in `product-value-resolver.ts` are **rewritten in place** on
top of `resolveScoped` (no `global+language` source, no `primaryLanguage` context, no `pickLang` / `firstNonEmpty`
over a map), so every existing caller compiles against the new semantics or fails to compile.

**Rationale.** FR-011 / FR-109 demand one resolver shared by server and editor; the owner said "one way on the
backend; complex types keep their own models". A uniform *row shape* fed from each store gives one fallback chain
without forcing one table. The resolver living in `contracts` is the 163 / feature 022 precedent (shared by the
backend and the admin SPA).

**Rejected.**
- *One generic `product_scoped_values` EAV table for every field.* 163 R1 chose typed columns for status, window
  and audience because availability is evaluated in SQL on every listing (SC-004 of 163); an EAV row per field
  would put a jsonb probe in every availability predicate. Also contradicts "complex types keep their own models".
- *Keep `isNonEmpty` skipping and add a separate "empty" marker table.* Two lookups per field to answer one
  question; the row's presence already is the override.
- *A new resolver beside the old one.* Leaves the four-level function compiling and callable — the drift FR-034
  exists to prevent.

## R2 — Where each family stores Global, C and C×L

**Decision.** Per family (full columns in `data-model.md`):

| Family | Global | C and C×L | Empty override |
| --- | --- | --- | --- |
| Name, description | `products.name text not null`, `products.description text null` | `product_value_overrides` (`attribute_key` `name` / `description`; C = `language_code null`) | row with `value = {"v": null}` |
| User attributes | `products.attribute_values[key]` — a scalar (or array for multiselect), never a language map | `product_value_overrides` | `{"v": null}` |
| Status | `products.status` | `product_channel_scopes.status` (C), `product_channel_language_scopes` (C×L) | not allowed (select) |
| Window | `products.publish_from/until` | `product_channel_scopes.window_overridden` + pair | `null` bound = no limit (existing) |
| Audience | `products.visibility` + orgs | `product_channel_scopes.visibility` + orgs | not allowed (select) |
| Minimum order quantity | `products.min_order_quantity` (`null` = none) | `product_channel_scopes.min_order_quantity_overridden` + value (`null` = no minimum here) | `overridden = true, value = null` |
| Returnable | `products.returnable` | `product_channel_scopes.returnable` | not allowed (boolean) |
| URL key | `products.slug` | `product_url_keys` (`sales_channel_id not null`, `language_code null` = C) | not allowed (required) |
| SEO title / description / OG | `seo_meta_overrides` row with no channel and no locale (`entity_type = 'product'`) | same table, `(channel, null)` = C, `(channel, locale)` = C×L | column value `''` (seo's own model, R9) |
| Alt text, hide image | `gallery_items.alt_text text null`, `gallery_items.hidden boolean` | `gallery_item_scope_overrides` (field `alt_text` / `hidden`) | alt: `{"v": null}`; hidden: not allowed (boolean) |
| Gallery roles | `gallery_item_labels` (existing) | `gallery_role_scope_overrides` (`gallery_item_id null` = no image holds the role here) | `gallery_item_id = null` |
| Attachment name / description / hidden | `product_attachments.name`, `.description`, `.hidden` (new) | `product_attachment_scope_overrides` | name / description `{"v": null}`; hidden not allowed |
| Packaging-unit name | `product_packaging_units.name` | `product_packaging_unit_scope_overrides` | `{"v": null}` |

The four new `*_scope_overrides` tables share one column set — `(subject id, product_id, sales_channel_id,
language_code null, field, value jsonb)` with two partial uniques — so every family feeds `resolveScoped` through
one adapter. 163's `gallery_item_channel_labels`, `gallery_item_channel_hidden`, `product_attachment_channel_hidden`
and the `*_translations` / `alt_text` jsonb maps are dropped (FR-014, FR-020).

**Rationale.** Typed availability columns stay typed (163 R1). Text and complex families get one row per
(subject, field, scope) because "inherit" and "empty" must be distinguishable **per field** (FR-013): a typed
multi-column row can say "inherit" only with one flag per column. The `window_overridden` flag already in
`product_channel_scopes` is the precedent for the one typed field that needs it (minimum order quantity).

**Rejected.**
- *Typed override columns with a `<field>_set` flag each* for attachments and gallery. Two columns per field, a
  CHECK per pair, and a resolver adapter per table — more code for the same three states.
- *Keep 163's channel tables and add a language column.* Their primary keys (`(product, channel, label)`,
  `(item, channel)`) cannot hold a C×L row beside a C row without being recreated anyway, and presence-only hidden
  rows cannot express "shown here although hidden at the channel".
- *`1` keeps meaning "no minimum" at C* (163's encoding). FR-062 / round 5 says `NULL` = no minimum; export must
  write `NULL` for it (FR-114). A stored `1` would export as `1`.

## R3 — The write encoding (FR-110…FR-117)

**Decision.** One Zod combinator and one CSV codec in `packages/contracts/src/scoped-write-encoding.ts`:

- `scopedWrite(valueSchema)` = `z.union([valueSchema, z.null(), z.object({ inherit: z.literal(true) }).strict()])
  .optional()`, preprocessed so `""` becomes *absent* (no change). Decoded to
  `ScopedWriteOp<T> = { op: 'set', value: T } | { op: 'empty' } | { op: 'inherit' }` (absent = no op).
- `decodeCsvScopedCell(cell)` / `encodeCsvScopedCell(op | value)`: empty cell → no change; exactly `NULL` →
  empty; exactly `INHERIT` → inherit; a cell matching `^\\+(NULL|INHERIT)$` loses **one** leading backslash and is
  text; anything else is text verbatim. Export prepends one backslash to a text value matching
  `^\\*(NULL|INHERIT)$`, so every text round-trips (FR-112, FR-114).
- `validateScopedWrite(field, op, scope)` — the one place that refuses `empty` on a required field (name, URL key,
  required attribute), a single select or a boolean, and `inherit` at Global (FR-062, FR-113). Codes in
  `contracts/error-codes.md`.
- One shared case table, `packages/contracts/src/scoped-write-encoding.cases.ts`, exported and imported by three
  tests — the admin API, the CSV import and the `pim_connector` contract — which is SC-014's "one shared test
  table".

Every 168 write path uses it: the save request (`contracts/scoped-values-api.md`), the copy Command, the catalog
scope write port used by connectors (`contracts/pim-locale-mapping.md`), the CSV import and export
(`contracts/import-profiles-and-csv.md`) and the bulk scoped-status payload. 163's `null` = inherit is changed in
place (FR-116): `PatchProductScopesRequest`, `ProductScopeWriteInput`, `ScopedStatusCell`, the gallery role
`null`, `putProductUrlKeysRequestSchema` `key: null` — each is rewritten or retired (R5, R6).

**Rationale.** FR-110 asks for "one encoding" and SC-014 for "one shared test table run against the API, the CSV
import and the `pim_connector` contract" — a single module of truth is the only way three paths cannot drift.

**Rejected.** *Per-path parsers following a written rule* — three parsers, three interpretations of `\\NULL`.
*JSON Merge Patch* (`null` = remove) — the owner rejected it (FR-115).

## R4 — One read endpoint (FR-109)

**Decision.** `GET /api/v1/admin/catalog/products/:id/scoped-values?channelId=&languageCode=` behind
`catalog:read`, answered by a new `ScopedValuesReadService` in catalog. One response carries, for the requested
scope: every scoped field's `{ value, source, ownValue?, levels, supportedHere }`; every global-only field's value
(the editor's whole form); the gallery, attachments and packaging units with their scoped sub-fields; the URL key
with its source; SEO through `seoProductMetaPort.readScoped` (absent when `seo` is not present — probed with
`effectiveState.isPresent('seo')`, the 163 pattern); the completeness summary of FR-097 at that level; the valid
scopes of the product (FR-051); and the product's `version` (R7). Contract: `contracts/scoped-values-api.md`.

The endpoint replaces the editor's use of `…/scope-context`, `…/value-overrides` (GET), `…/scopes` (GET),
`…/url-keys` (GET), `…/gallery/channel-roles` and the SEO meta GET. Those routes stay for their other callers
except `…/value-overrides` (both verbs) and `…/scope-context`, whose only caller is the editor — removed.

**Rationale.** Owner round 2 chose one endpoint so a scope switch is one request (audit G2). Computing sources on
the server with the same `resolveScoped` the admin imports means the badge and the storefront cannot disagree.

**Rejected.** *Pure functions only, client assembles from 6–8 requests* — the owner rejected it (round 2).
*A GraphQL-style field selector* — no consumer needs partial reads; YAGNI.

## R5 — One atomic save Command (FR-070…FR-077, FR-091)

**Decision.** `PUT /api/v1/admin/catalog/products/:id/scoped-values` behind `catalog:write`, body
`{ scope, version, changes }`, runs **one** Command `product.scoped_values.save` through `CommandBus.run`:

1. `capture`: load the touched (field, scope) cells' current state (catalog stores) and the SEO cells through
   `seoProductMetaWritePort.readWithin(em, …)`.
2. Compare-and-set the version (R7) → `409 VERSION_CONFLICT`, nothing written.
3. Validate every change with `validateScopedWrite` and the scope rules (FR-012, FR-018) → `422` naming each
   field; nothing written.
4. If any change turns a (C, L) on: run the completeness gate (FR-076 / FR-095) **before** any write; *refuse*
   mode → `422 SCOPE_INCOMPLETE` with per-pair details; *warn* mode → continue and return warnings.
5. Write catalog stores in a fixed order (product row, scope rows, value overrides, family overrides, URL key
   under its advisory locks); then `seoProductMetaWritePort.applyWithin(em, …)` for SEO changes.
6. Return `before` / `after` as one projection keyed by `field@scope` (FR-072); one `product.updated.v1` event with
   the union of `changedFields`.

At Global the same Command also writes the product-row fields the header Save writes today (SKU, attribute set,
categories, visibility, status, window, stock flags, …), so "one Save" holds at every scope.

A failure in any step throws inside `em.transactional`, so the Command rolls back whole (FR-071, FR-073, SC-007).
Retired: the product `PATCH`'s use by the editor (the route stays for API clients, now with the R3 encoding for
its scoped fields and a `version` precondition optional), `PATCH …/value-overrides`, the editor's calls of
`PATCH …/scopes`, `PUT …/url-keys`, `PUT …/gallery/channel-roles`, gallery / attachment / packaging `PATCH`es for
scoped sub-fields, and the per-card auto-saves (audit F6).

**Rationale.** Owner decision B (one orchestrating Command); XIII requires one audit entry per Command; atomicity
across families is only possible on one transaction, which `CommandBus.run` already opens.

**Rejected.** *Audit option A (fixed-order per-endpoint Commands)* — rejected by the owner. *Running seo's own
`seo_meta_override.*` Commands from inside catalog's Command* — nested `CommandBus.run` forks a new transaction
and writes a second audit entry (FR-072 says one). *An outbox for SEO* — not atomic.

**Reading — "every per-section Save that writes product data" (FR-070).** The one Save covers the product row and
every scoped family. Collection editors that add, remove or reorder rows of a global-only list (variants, bundle
slots, grouped items, product links, images, attachments, packaging units, price-book rows contributed by
`price_lists`, channel membership contributed by `sales_channels`, per-warehouse stock) are not "saves" of a field
and keep their own audited actions. **This reading is user-visible; it is listed as owner question Q2 in
`plan.md`.** Nothing in the design depends on the answer except the scope of US7's UI tasks.

## R6 — "Copy this value to other channels in the same language" (FR-086)

**Decision.** `POST /api/v1/admin/catalog/products/:id/scoped-values/copy` behind `catalog:write`, body
`{ field, from: { channelId, languageCode }, toChannelIds, dryRun? }`, one Command
`product.scoped_values.copy_to_channels` with one audit entry. `dryRun: true` answers which targets hold an own
value that would be overwritten (the confirmation's list) and writes nothing. The copied value is the **saved own
value** at the source C×L (a value or empty); the action is offered only where the field has an own value there
and has no staged change. Targets must be member channels offering that language; others are refused per
target. Copying `empty` to a required field is refused (round 4).

**Rationale.** Owner round 2 / round 4. A separate Command because it writes scopes other than the editor scope
(FR-004 governs the save, not this).

**Rejected.** *Fold into the save Command* — FR-004 forbids a save touching other scopes. *Copy the effective
(possibly inherited) value* — "copy this value" on an inheriting field would silently freeze an inherited value
into N overrides; offering it only on an own value avoids the surprise.

## R7 — Optimistic concurrency token

**Decision.** `products.updated_at` (ISO string, millisecond precision) is the product's **version**. The read
endpoint returns it; the save and copy Commands compare-and-set it. **Precision is part of the contract**: the
column is `timestamptz` (microseconds, `core_foundation_init`), while the ORM and the API speak JavaScript `Date`
(milliseconds) — a CAS written with SQL `now()` would store microseconds that the next ISO round-trip cannot
match, and every second save would answer a spurious 409. So both sides are millisecond-truncated:
`update products set updated_at = :next where id = :id and date_trunc('milliseconds', updated_at) = :version`,
where `:next` is a JavaScript `Date` (never `now()`), strictly greater than `:version` (bumped by 1 ms when the
clock has not moved) → 0 rows → `409 VERSION_CONFLICT`. Every bump below uses the same helper
(`bumpProductVersion(em, productId, expected?)` in catalog).
Every catalog write that changes a scoped value of the product — save, copy, bulk scoped status, overview resets,
the scope write port (connectors), CSV import — bumps `products.updated_at` in its transaction, so the token
covers the whole scoped model.

**Rationale.** The column exists and is already touched by product-row writes; adding a `version int` column
buys nothing a timestamp at millisecond precision does not, given writes to one product are serialised by the
compare-and-set itself.

**Rejected.** *A `version integer` column* — a migration and an entity change for the same guarantee. *No token*
— US7 #6 / FR-073 name `409 VERSION_CONFLICT` explicitly.

## R8 — `product_editor_preferences` encoding (FR-056)

**Decision.** No column change. `last_channel_id NULL` (and `last_language_code NULL`) = **Global**;
`last_channel_id` set + `last_language_code NULL` = **Channel**; both set = **C×L**. The "primary admin language"
meaning is retired; the catalog texts migration empties the table (no live data, and old rows would be misread).
The PUT route validates the language is offered by the channel and the channel is a member (it validates only the
channel today). The URL (`?channel=&language=&tab=&field=`) is the source of truth; the preference only seeds a
URL that names no scope. A preference write is a UI preference, not a domain write: it stays outside the Command
Bus, as today.

**Rejected.** *A `level` column* (audit G3 option) — a migration to encode what the two nullable columns already
encode once "primary language" is gone. *Keep the old meaning and add a sentinel language code* — a magic value.

## R9 — SEO: storage, read port, write port, permission relaxation

**Decision.**

- **Storage (`seo` migration).** For `entity_type = 'product'` only: rows are G (no channel, no locale), C
  (channel, no locale) or C×L (both); locale-only product rows are deleted and refused by a CHECK; a partial
  unique holds one G row per product. Within a row a column `NULL` = inherit (no value at G) and `''` = a
  deliberately empty value. `category` and `cms_page` rows keep their current locale-scoped model (FR-117: scoped
  **product** values only).
- **Read port.** `SeoProductMetaPort` gains `readScoped(productId, scope)` returning each SEO field's
  `{ value, source, ownValue? }` through the same `resolveScoped`. 163's `resolveForProduct` is rewritten to the
  C×L → C → G chain (no L step) for the storefront.
- **Write port.** New port `seoProductMetaWritePort` (`SeoProductMetaWritePort<EM>`) with
  `readWithin(em, { productId, scope })` and `applyWithin(em, { productId, scope, changes }) → { before, after }`
  — writes on the caller's EntityManager with **no fork, no flush and no audit** (the `recordWithin` precedent,
  F-h), validates lengths and the encoding, and refuses `inherit` at G. Catalog declares it in
  `nonBindingDependencies` as **`refuses-without`**: "a product save that changes SEO fields is refused while SEO is
  off; saves without SEO changes are unaffected". The save resolves it only when `changes.seo` is non-empty, so a
  switched-off `seo` refuses exactly those saves (`503 MODULE_DISABLED`, rolled back) and no other (FR-092).
- **Admin.** `seo` contributes the inline SEO section to a new zone `product.editor.seo` (replacing the
  `ProductSeoLink` contribution to `product.editor.seo.after`); the section reads from the catalog read
  endpoint's `seo` block and stages through the zone's `onStage` prop (`contracts/editor-ui.md`). With `seo` off
  the zone has no contributor and the tab is not rendered.
- **Permission (FR-093).** A new static route `GET /api/v1/admin/seo/meta/product/:entityId` gated `catalog:read`
  (Fastify's static segment outranks `:entityType`); the generic `GET /api/v1/admin/seo/meta/:entityType/:entityId`
  keeps `catalog:write` for `category` and `cms_page`. The editor itself reads SEO through catalog's read endpoint
  (also `catalog:read`). Writes stay `catalog:write`.

**Security review of FR-093 (relaxing the product SEO read to `catalog:read`).**

| Question | Finding |
| --- | --- |
| What becomes readable, by whom | Product SEO title, description, OG title / description / image URL at every scope, by an admin holding `catalog:read` but not `catalog:write` |
| Is it already disclosed elsewhere | For live products, the effective values are emitted in the public storefront HTML. For off / unpublished / audience-restricted products and non-live scopes they are not public — but the same `catalog:read` holder already reads those products' names, descriptions, attributes, prices-context and URL keys through `catalog:read` routes, which are of the same or higher sensitivity |
| Cross-entity leak | The generic route serves `category` and `cms_page`; relaxing it would expose CMS page metadata to a role without CMS rights. **Mitigated** by relaxing only the product-specific route and the catalog read endpoint; the generic route's gate is unchanged |
| Injection / XSS | No new input path: reads only. The values are rendered by React text nodes in the admin (no `dangerouslySetInnerHTML`); `ogImageUrl` is shown as text and a link with `rel="noopener noreferrer"` |
| Enumeration | The route takes a product id like every `catalog:read` product route; the not-found answer is the same `404` |
| Tenancy (XI) | SEO overrides and products are platform-global; no organisation data is involved |
| Write side | Unchanged: `catalog:write`, and only through catalog's save Command or seo's own Commands |
| Verdict | **Accept.** Residual risk: none beyond what `catalog:read` already grants. Tests: a `catalog:read`-only admin reads product SEO (200) and is refused the category and CMS-page SEO GET (403); the inventory test proves the new literal is declared |

**Check estate for the caller-transaction writer.** `applyWithin` persists `seo_meta_overrides` rows without a
Command of its own, by design (one audit entry, FR-072). It must satisfy `check:command-coverage` (a
`// command-coverage-ignore: <reason>` marker naming the caller's Command, the shape
`admin_notifications`' `recordWithin` uses in `admin-notification-service.ts`), `check:transaction-context` (no
`getKnex()` / connection-level SQL inside it — `em.execute` only) and `check:port-shape` (the port type is generic
over `EM` with no `@mikro-orm` import in `packages/contracts`, the `AdminNotificationRecordPort<EM>` precedent; no
optional method). **Unverified at planning time**: the builder reads `specs/conventions/check-inventory.md` rows
for the three checks before writing the port (tasks T119, T121).

**Rejected.** *Relax the generic route to `catalog:read`* — leaks CMS-page metadata (above). *Have catalog read
`seo_meta_overrides` itself* — Principle I.

## R10 — Readers (FR-030…FR-034): re-measured population and the instrument

**Decision.**

- **Shapes.** `CatalogProductRecord.name: string` (Global) and `description: string | null`;
  `CatalogPackagingUnitRecord.nameTranslations` removed (`name` is Global); `CatalogQuickSearchHit.name: string`;
  `comparisonProductSummarySchema.name: string` (effective at the comparison's scope); `ProductImportRow` rewritten
  (R13). Admin product request / response: `name: string`, `description: string | null`.
- **Port.** `CatalogProductAvailabilityPort.effectiveNames` is generalised to
  `effectiveTexts(productIds, scope) → Map<id, { name, description }>` (both resolved C×L → C → G, empty override =
  `''` / `null`), and `effectivePackagingUnitNames(unitIds, scope)` is added. Snapshots (cart line, RFQ line,
  order line) take these at the document's scope (FR-032). A reader with no channel uses the Global string from
  the record (FR-031) — admin lists and pickers.
- **Instrument (FR-034).** The type change is the compile-time instrument: strict TypeScript rejects every
  `name['en-US']` / `pickLocalized(product.name, …)` on a string. A unit test,
  `backend/test/unit/catalog/no-per-language-product-maps.test.ts`, guards against `as` casts and SQL: it walks
  `packages/modules/*/src`, `packages/{admin-kit,page-builder-admin,cms-components,contracts}/src`, `admin/src` and
  `storefront/{app,lib,components}` and fails on the retired identifiers and SQL fragments listed in
  `contracts/readers.md` §3, printing what it read (`files=… sites=…`) and failing on an empty population. A test,
  not a `check-*` script: FR-034 allows either, and a test does not take on the check estate's inventory,
  estate-manifest and read-size obligations for a one-feature guard.
- **Population (re-measured, `contracts/readers.md` §1).** 16 modules plus 3 packages and the storefront read a
  product text map or a 163 per-language structure today: carts (6 files), comparisons (2 + contracts), crm (2),
  import_export (1), inventory (3), orders (2), price_lists (2), product_feeds (3), quick_order (1),
  quote_requests (4), search (3), seo (2), cms admin (1), audit_logs (1), shopping_lists and promotions (record
  consumers, verify), admin-kit (2), page-builder-admin (2), platform (verify), storefront (PDP alt / attachments,
  verify). The spec's list (crm, orders, search, seo, comparisons, returns, pwa, projects, quote_requests, admin-kit,
  assets_library, page-builder-admin, platform, catalog) differs: **returns, pwa, projects** read no product text
  map (they consume snapshots or `effectiveNames`; projects' hits are its own dictionary); **assets_library**'s
  `altText` map is the **asset's own** alt text — not a product value, out of 168 (FR-117) and kept as the gallery
  alt's derived fallback; **inventory, carts, price_lists, product_feeds, quick_order, cms, audit_logs** were
  missing from the spec's list.

**Rejected.** *Keep `name` as a map and add `globalName`* — leaves every old reader compiling. *A `check-*`
script* — see above.

## R11 — Search: one index per channel, per-language text, language-restricted match (FR-033)

**Decision.** The document keeps `id`, `sku`, the filter fields of 163 and non-text attributes, and replaces
`name`, `description`, `localizedNames`, `searchableOptions` and text `attributes.*` with
`texts: Record<L, { name, description, attributes: Record<key, string>, options: string[] }>` — one entry per
language the channel offers, each the effective text at (C, L) (C×L → C → G; an empty override contributes `''`).
A query searches **only** `texts.<L>.*` (the shopper's resolved language) plus `sku` and non-text searchable
attributes (`attributesToSearchOn`). Display fields for hits are read from `texts.<L>` too. Index settings:
`searchableAttributes = ['sku', 'texts', 'attributes']`; a settings change forces a reindex (release note).

**Index size (the measurement FR-033 asks for).** Per document: `base + Σ_{L ∈ C.languages} T(L)` where `T(L)` ≈
|name| + |description| + |searchable text attributes| + |option labels| in L. Before 168 a document carried
`T(default)` once plus `|name|` per live language (`localizedNames`). So the growth factor is ≈ `k` (the number of
channel languages) on the text part: a 2-language channel ~2×, a 4-language channel ~4× of the text payload.
Descriptions dominate (~0.5–4 KB each). At the perf fixture size (163 SC-004) with 2 languages that is an
estimated 1.6–2× of today's index bytes per channel. **No Meilisearch is available to this planning session**, so
the number is measured by the Polish-phase measurement task in `tasks.md` (perf: index bytes and p95 query latency before / after on the perf fixture,
1 and 3 languages) and recorded in `quickstart.md`.

**Rejected.** *One index per (channel, language)* — the owner chose one index per channel. *Keep top-level
`name` searchable* — matches the Global English string for a Polish shopper (F-k), against FR-033.

## R12 — URL keys and redirects in the three-level model (FR-016)

**Decision.** `products.slug` = Global key; `product_url_keys(product_id, sales_channel_id NOT NULL,
language_code NULL, key)` = C (language null) and C×L keys; `product_url_redirects(product_id, sales_channel_id
NOT NULL, language_code NOT NULL, key)`, unique `(sales_channel_id, language_code, key)`. Effective key at (C, L):
C×L row → C row → slug. Uniqueness: for every (C, L) that **either** product could be addressed at — member
channels and orphaned rows alike (orphans keep reserving, round 3) — two products' effective keys differ; a
Global key equals no other product's key at any scope or as a redirect. Writes take per-key advisory locks
(unchanged idiom). Redirects are inserted per (C, L) whose effective key changed, never chained. The full write
rule table replaces 163 data-model §5: `contracts/url-keys.md`.

**Rejected.** *Keep 163's language keys* — the Language scope is gone (FR-010). *Global-only redirects* — the
owner keyed redirects per (C, L) (round 3).

## R13 — PIM locale mapping contract and protection (FR-040…FR-047)

**Decision.**

- `packages/contracts/src/pim-locale-mapping.ts` (owner: `pim_connector`, stated in its header and in
  `pim_connector`'s manifest description): `pimLocaleMappingSchema = { sourceLanguageForGlobal: locale | null,
  entries: [{ sourceLocale, sourceChannel: string | null, targets: [{ channelId, languageCode }] (min 1) }] }`, and
  the pure planner `planLocaleWrites({ global, perLocale, mapping, validScopes })` →
  `{ writes: ScopedWrite[], unmapped: [{ locale, sourceChannel }], skipped: [{ target, reason }] }`. Non-localizable
  values and the source language for Global go to Global (FR-047); a per-locale value is written to its mapped
  targets only (FR-041); invalid targets are skipped and reported for that product (FR-042); an entry with a
  `sourceChannel` matches only that channel's values (US4 #3).
- `filterProtectedWrites(writes, protectedPaths)` drops every scope of a protected field (FR-046).
- The field-path grammar (`pimFieldPathSchema`, `canonicalisePimFieldPath`) loses its locale and channel
  segments: `attribute.<key>`, `seo.metaTitle|metaDescription|metaKeywords`, `name`, `description` — plus the
  unchanged `gallery.<n>`, `attachment.<uuid>`, `price.<uuid>.<CUR>`, `category.<uuid>`. A path with a locale or
  channel segment is invalid.
- Connectors (outside this repository) write through `catalogProductScopeWritePort.applyScopes` v2, which now
  accepts scoped text, attribute, SEO-free media and URL-key writes in the R3 encoding at named scopes and still
  "writes only the scopes named" (FR-044). Where each connector stores its mapping is that connector's business
  (FR-045).

**Rejected.** *A shared mapping editor contributed by `pim_connector`* — rejected by the owner (round 2).
*Per-scope protection paths* — rejected by the owner (round 3).

## R14 — Import profiles (FR-048) and the CSV grammar

**Decision.**

- Table `import_profiles` owned by `import_export` (its first migration; the package gains a `./migrations`
  export and `src/migrations/index.ts`), platform-global (`@GlobalEntity`, like catalogue configuration): `id`,
  `name` (unique), `entity` (`'products'`), `source_language_for_global` (nullable), `locale_mapping` (jsonb,
  validated with `pimLocaleMappingSchema` minus the source-language field), timestamps.
- **Permission (left to the plan by the checklist): `catalog:write` for every profile route**, read included —
  the code the products import entity already declares (`importPermissionFor('products')`, F-j); no new code
  (163 FR-084). Profiles exist only to import products, so anyone who can import can manage them and nobody else
  needs to see them.
- **Command Bus (left to the plan):** `import_profile.create` / `.update` / `.delete` through `commandBus`
  resolved from the container in `import_export`'s `registerModule`, one audit entry each, before / after = the
  row projection.
- **Command palette (left to the plan):** profiles are a section of the existing `/import-export` page, so no new
  admin route exists for `palette-coverage.test.ts` to demand an action for; the existing `open-import-export-center`
  action (`catalog:write`) gains the keywords `profile`, `profil`, `mapping`, `mapowanie`. XVI is satisfied by the
  page being reachable.
- The products import requires `profileId` (FR-048 "the operator MUST pick a profile"); an import without one is
  `422 IMPORT_PROFILE_REQUIRED`.
- **CSV columns:** Global `name`; scope columns `name@<channel code>` (C) and `name@<channel code>/<language>` (C×L);
  source-locale columns `name[<locale>]` and `name[<locale>|<source channel>]` mapped by the profile. The same for
  `description`, `attribute:<key>`, `status`, `urlKey`, and the {G,C} fields at `@<channel>` only. A scope column
  and a mapped locale column landing on the same (field, scope) in one row → row error `IMPORT_CELL_CONFLICT`.
  Export writes Global and scope columns (never locale columns) with the R3 encoding, so export → re-import of the
  unchanged file is a no-op (FR-114) — the profile's mapping is not needed to re-import an export.
- The activation setting's description is rewritten: switching off keeps profiles.

**Reading — FR-043's "the product export MUST follow the same mapping".** Read as: export and import share one
column grammar and encoding; export addresses scopes directly, so it needs no mapping and a mapping's
one-to-many targets are not inverted. **Listed as owner question Q3** because the spec's wording could also mean
"export per source locale through the profile".

**Rejected.** *A per-profile permission code* — no new code (FR-084 of 163). *Profiles in the Settings store* —
FR-048 names a table owned by `import_export`. *Hand-written audit* — XIII.

## R15 — User attribute flag (FR-012)

**Decision.** `product_attributes.scopable boolean not null default false` replaces `channel_scoped` /
`language_scoped`. The scope set is derived: scopable + text value type → {G,C,CL}; scopable + any other type →
{G,C}; not scopable → {G}. `attribute.update` (existing Command) handles the flag; 163's scope-change preview
(FR-090) previews scopable → not scopable (every override orphaned) and text → non-text value-type changes (C×L
rows orphaned). Readers of the two flags (`price_lists` attribute eligibility, `comparisons`, catalog services)
read the derived set from `CatalogAttributeView.scopeLevels`.

**Rejected.** *Keep two flags* — rejected by the owner (round 2).

## R16 — Completeness gate (FR-095…FR-098)

**Decision.** `scope-completeness.ts` checks name, URL key and every required attribute at each (C, L) along
C×L → C → G; a Global value counts at every (C, L) (FR-096); an **empty override** of a required field cannot
exist (refused at write), so the gate never meets one. The read endpoint returns the FR-097 summary for the
requested level: C×L → `missing[]` per field; C → the union over the channel's languages with the languages
named; G → the count of incomplete (C, L) pairs. The scope overview's per-cell `missing` is unchanged in shape.

## R17 — Admin editor architecture (US5…US12)

**Decision.** One editor state module, `packages/modules/catalog/src/admin/lib/scoped-editor-store.ts` (a reducer +
context, no new dependency): `{ scope, view (last read), staged: Map<fieldPath, ScopedWriteOp> }`; the staged map
belongs to the scope it was staged at and survives tab switches (FR-083); switching scope with staged changes
opens the Save / Discard / Stay `ModalDialog` (FR-075); the unsaved-changes prompt reads the same map. One
`ScopedField` wrapper (generalising 163's `StatusRow` and `InheritedHint`) renders label, "Use value from <parent
scope>" checkbox, source line (`aria-describedby`), read-only (not disabled) inherited control, "Global only"
and "not at this scope" states (FR-060…FR-065, FR-081, FR-082). The switcher is two admin-kit `Select`s (a
combobox past **8** options, FR-055) in a header bar with the warning `Alert` banner whose `role="status"`
region is mounted empty first (FR-053). URL state: `?scope=global|channel|cl&channel=<id>&language=<code>&tab=&field=`
validated against the product's valid scopes, falling back to the nearest valid scope with an announcement.
Retired components: `ProductScopeEditor` chips, `ProductScopeControls` panel Save, `ProductUrlKeysPanel`'s
"Add override", the gallery Scope / Language selects, `AttachmentScopesDialog`, the packaging translations dialog.
Detailed in `contracts/editor-ui.md`.

**SC-012 baseline.** No baseline was measured (checklist note). A Polish-phase measurement task in `tasks.md` records, on the dev stack, the p95 of
`GET /products/:id` + the editor's current 6–8 scope requests vs the one `scoped-values` request, and the scope
switch's time-to-settled in the browser; the criterion is met when the switch is no slower than a product page
load on the same machine.

## R18 — Migrations (FR-020, FR-026)

**Decision.** Scaffolded per owner with `pnpm --filter backend run migration:new -- --module <id> --name <slug>`
(no numbers), each idempotent (`if exists` / `if not exists`, guarded data statements), none with a data-preserving
`down` (FR-024 removed; `down` throws a clear "irreversible" error, the 163 R30.1 precedent of an honest down):

| Owner | `--name` | Content |
| --- | --- | --- |
| catalog | `scope_model_texts` | drop the four admin-key generated columns and their functions; `name` / `description` jsonb → text (Global = `en-US` value, else first non-empty, else SKU — keeps dev databases usable); recreate one `admin_name_key` / `admin_search_key` pair over the text name; `product_attributes.scopable` replaces the two flags; `product_value_overrides` CHECK `value ? 'v'`; `attribute_values` language maps collapsed to a scalar; `product_editor_preferences` emptied |
| catalog | `scope_model_order_rules` | `product_channel_scopes.min_order_quantity_overridden`; 163 `1`-means-none rows converted; CHECK rewritten |
| catalog | `scope_model_url_keys` | `product_url_keys` and `product_url_redirects` recreated in the R12 shape (language keys and redirects dropped) |
| catalog | `scope_model_media` | `gallery_items.alt_text` jsonb → text, `gallery_items.hidden`, `product_attachments.hidden`; drop `*_translations` and the three 163 channel tables; create the four `*_scope_overrides` tables |
| seo | `product_meta_three_levels` | delete product locale-only rows; CHECKs and the G partial unique (R9) |
| import_export | `import_profiles` | the profiles table (R14) |

Order is the manifest graph (catalog before seo; import_export depends on nothing it references by FK). Each
migration ships with a clean-run test on a database seeded with 163-model rows (SC-002).

**Rejected.** *One giant catalog migration* — reviewers and the clean-run tests are per family. *Amending 163's
migrations* — a database that already ran them never re-runs an edited body (163 R30.1).

## R19 — Release

**Decision.** Changesets per `specs/conventions/release-intent.md`: `minor` with a **BREAKING** body (D-225: no
`major` in `0.x`) for `@endora-commerce/contracts`, `mod-catalog`, `mod-seo`, `mod-search`, `mod-import-export`,
`mod-pim-connector`, `admin-kit`, `page-builder-admin`; `patch` for each reader module package whose code changes
(carts, comparisons, crm, inventory, orders, price_lists, product_feeds, quick_order, quote_requests, cms,
audit_logs). The BREAKING bodies name: the in-place change of `null` from "inherit" to "empty" (FR-116) with the
old and new call; `name` / `description` from map to string; removed routes (`…/value-overrides`,
`…/scope-context`); the PIM path grammar; the search document shape (reindex required). Release notes in
`docs/` (en + pl): the write encoding (FR-115), the reindex step, the connector migration note.

## R20 — Named follow-ups: `null = inherit` outside scoped product values (FR-117), re-measured

Grep of `packages/contracts/src` for `null`-means-inherit / fall-back semantics on 2026-10-30:

| # | Field | Where | In spec's list |
| --- | --- | --- | --- |
| 1 | Per-product stock mode override | `catalog.ts:2112` (`CatalogProductRecord.stockMode`), request `stockMode` | yes |
| 2 | Per-product fulfilment strategy override (`null` = global strategy) | `catalog.ts:705-724` (`fulfilmentStrategy`) | **new** |
| 3 | Organisation fulfilment / stock-reservation strategy | `organizations.ts:72-78` | yes |
| 4 | Organisation credit-inheritance mode (`null` = Settings default) | `organizations.ts:50`, `:138` | **new** |
| 5 | Variant base price per currency (`null` = the product's base) | `price-books.ts:258`, `:928`, `:971` | yes |
| 6 | Settings store `globalValue` (`null` → `defaultValue`) | `settings.ts:238` | **new** |
| 7 | CMS page translation fields — **blank** (not `null`) inherits the page's own field | `cms.ts:24-31` | **new** (the opposite polarity of FR-110: `""` = inherit) |

Excluded as not inheritance: column-picker `null` = default-visible set (`orders.ts:662`,
`saved-list-views.ts:84`). Each row stays as it is in 168; the plan lists them for the owner's follow-up issues.
