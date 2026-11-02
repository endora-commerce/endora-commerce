# @endora-commerce/mod-catalog

## 0.109.0

### Minor Changes

- e03e6a9: **BREAKING — the admin screens follow the `active` | `inactive` status model, with Archive / Restore and an Archived filter.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **admin-kit product browser.** `ProductBrowserStatusFilter` is `'all' | 'active' | 'inactive' | 'archived'` (was `'all' | 'active' | 'draft' | 'inactive'`) and `ProductBrowserCounts` is `{ all, active, inactive, archived }` (was `{ all, active, draft, inactive }`). The browser no longer sends `includeArchived=1`: its first three tabs list products that are not archived, and the new Archived tab sends `archived=only`.
  - **admin-kit `ProductBrowserItem`** gains an optional `archivedAt` (absent reads as not archived), and **`ProductBrowserRules`** gains `blockArchived`: an archived product is then shown but not selectable, with the reason `archived` (`productBrowser.reason.archived`), whatever its status, and the browser offers no Archived tab. `ProductSelectabilityReason` gains `'archived'`; the new `isProductArchived(row)` reads `archivedAt`. With `rules`, `ProductPicker` names an archived product beside its status.
  - **`@endora-commerce/mod-i18n` (`core`)**: `productBrowser.tab.draft` and `productBrowser.status.draft` are removed; `productBrowser.tab.archived`, `productBrowser.status.archived` and `productBrowser.reason.archived` are added, in English and Polish.
  - **page-builder-admin** `CatalogPickers`' product status filter offers All, Active and Inactive; `Draft` is gone.
  - **catalog admin.** The product editor's status selector and the scope controls offer Active and Inactive; a new product starts Inactive and the create request carries the selected status. The editor offers **Archive** or **Restore** (with `catalog:write`) behind a confirmation, shows an archived product's state beside its status, and says that setting Active does not restore it. The product list has _All · Active · Inactive · Archived_ with the counts above, hides archived products unless the Archived tab is chosen, shows an Archived badge beside the status, and asks `resolve-ids` for the same population; a saved view stores the Archived tab as `archived: 'only'`, and a view saved with `status: 'draft'` opens as All. The bulk dialog's _Set status_ offers Active and Inactive, and the dialog offers bulk **Archive** (or **Restore** on the Archived tab) as its own confirmed action, with a per-product result and a link to the operation, where it can be undone.
  - **orders** — creating an order refuses archived products in the browser and the quick search. **blog** — the related-products picker names inactive and archived products separately. **product feeds** — the criteria's status rule no longer offers `draft`.

- 50338a6: The admin assistant can archive and restore products (product data scopes).

  - **New assistant tools** `catalog.archive_product` and `catalog.restore_product` (`catalog:write`), with the parameter schemas `ArchiveProductsParamsSchema` and `RestoreProductsParamsSchema`. Like every assistant change they are planned first and run only after the operator confirms. Each product runs the same audited Archive / Restore as the admin screens, recorded in the audit log under the confirming admin. More than 50 products run as the bulk Archive / Restore in the background, which can be undone from its operation page.
  - `catalog.set_product_status` still only switches products on or off. Its description now tells the assistant that it does not archive or restore, and names the new tools.
  - **Behaviour change — assistant search:** `catalog.search_products` now includes archived products and returns `archived` beside `status`, so an archived product can be found to restore it.
  - **prompt_actions documentation:** the tool catalogue lists every catalog tool, the two new ones included, and says that archiving is not a status.

- ff1c5da: A queued product bulk operation re-checks its requester when the worker starts it: the admin who queued it must still be an active administrator holding `catalog:write`, else the operation fails without writing any product. `catalog` now declares `admin_roles` in `dependencies` and resolves its `permissionService` port; `CatalogModuleOptions.permissionChecker` is the new optional option. A product bulk write with no known requester is refused when it is queued (the admin bulk-update route answers `401`), and a queued product write whose requester is empty or the all-zero placeholder fails at worker start instead of running as the system; `search_reindex`, which writes no product, is exempt.
- 36cdf11: The admin product editor sets a product's availability per sales channel and per channel × language.

  - **Scope controls** (Details tab, under the scope editor's channel switcher): status per channel and per channel × language with **Use inherited** and the source of the value shown, a publication window per channel (entered in the operator's local time, both ends included) and an audience rule per channel (mode and organization list as one value, with a warning naming organizations that are not members of the channel — the names come with the scopes answer, so an operator without `customers:read` sees them too). One **Save availability** sends every changed channel through `PATCH /api/v1/admin/catalog/products/:id/scopes`, carrying only the keys that changed; a refusal keeps the edits. A language setting the channel no longer offers is shown as ignored, with a way to remove it.
  - **Global publication window** on the Details tab, saved with the page Save through the product `PATCH` (`publishFrom` / `publishUntil`) only when it changed.
  - **Order rules per channel** (Inventory tab): minimum order quantity and **Returnable** per member channel, inheriting the global values; an empty minimum inherits and `1` means no minimum in that channel.
  - Scope controls and the order-rules card are **read-only without `catalog:write`** — the card's global controls included, which previously stayed editable and were refused on save.
  - The `open-products` palette action also answers to "scope", "zakres", "visibility per channel" and "publication window".

- b12a2a1: The admin product editor shows a product's scopes in one table, and the attribute form shows and narrows an attribute's scope.

  - **Scopes tab** (product editor): one row per sales channel and one column per language. Each cell says the status there, whether the product is live there now and where the status comes from, lists the values set for that channel and language and the channel and language values that apply there, and — where the completeness check would refuse switching the product on — what is missing ("Incomplete — missing: Name, Material"), with an icon and text rather than colour alone. Each value is reset to inherited where it is set: a channel value from its row, a language URL key from its column, a channel × language value from its cell; the reset calls the owning endpoint (`…/scopes`, `…/value-overrides` deletes or `…/url-keys`) with `null` for that one value. A product's own text in a language (its German description) is not an override and has no reset. Values that no longer apply (the product left the channel, the channel dropped the language, the attribute is no longer set per channel or language) are listed below the table with a reason and a **Delete** each. A product in no sales channel shows its values per language only. Read-only without `catalog:write`.
  - **Attribute form** (Attributes screen): **Value can differ per sales channel** and **Value can differ per language** for a user-defined attribute. Turning one off first asks `GET …/attributes/:key/scope-change-preview` and confirms with the number of values that will stop applying, in total and per channel ("No values … are affected" when none); cancelling sends nothing, and widening saves at once. A built-in attribute's scope is shown fixed. Read-only without `catalog:write`. The section appears only when the attribute answer carries both flags.
  - The attribute edit form now opens with the chosen attribute's stored values — it could keep the previous form's input, since both forms are the same component at the same place.

- 22604fa: Attachments per sales channel and language, packaging-unit names per language (product data scopes, FR-078, FR-079).

  - **Attachments:** create and update (`POST` / `PATCH /api/v1/admin/catalog/products/:productId/attachments…`) accept `nameTranslations` and `descriptionTranslations` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). A newly hidden channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing is always allowed. The admin DTO carries all three. The product page leaves out an attachment hidden in the request's channel and serves its name and description in the request's language, else the global ones.
  - **Packaging units:** create and update accept `nameTranslations` (the admin schemas stay strict). The admin DTO and `CatalogPackagingUnitRecord` carry it. The product page's `packagingUnits[].name` is the name in the request's language, else the global name.
  - **Basket snapshot:** a basket line ordered by a packaging unit stores the unit's name in the basket's language (`effectivePackagingUnitName`) and keeps it after a rename; the order line copies it. A buyer's quote-request line (create and draft edit) appends the unit's name in the request's language on its channel, else the global name, and keeps it; a line naming its unit by name and base quantity is still matched on the global name.
  - **Auditing:** these writes run the existing Commands `product_attachment.create` / `.update` and `packaging_unit.create` / `.update`, one audit entry per request. The route-level `attachment.create`, `attachment.update` and `product_packaging_unit` rows are no longer written beside them. The projections carry `productId`, the translations and `hiddenInChannels`; re-sending `before` without `productId` restores the row. They emit `product.updated.v1` with `changedFields: ['attachments']` / `['packagingUnits']`; a request that changes nothing writes and emits nothing. EN/PL audit labels added.
  - **Scope overview:** lists `attachments:hidden` per channel and `attachments:name`, `attachments:description`, `packagingUnits:name` per language.
  - **Contracts:** `ATTACHMENT_DESCRIPTION_TRANSLATION_MAX`.
  - **Migration** `catalog` `attachment_packaging_translations`: columns `product_attachments.name_translations`, `.description_translations`, `product_packaging_units.name_translations`, table `product_attachment_channel_hidden`. No backfill.

- 514cbf7: Bulk status per sales channel and language, and the completeness check when a product is switched on (product data scopes).

  - **Bulk scoped status:** `POST /api/v1/admin/catalog/products/bulk-update` accepts `fields.scopedStatus: { channelId, languageCode, value }` (`active`, `inactive` or `inherit`). Only that scope changes on each product, through the audited `product.scopes.update` Command (`product.updated.v1` `['scopedStatus']`); a product not in the channel, or a language the channel does not offer, is skipped as `scope_invalid`. It cannot be combined with `status`. The queued path records the scope's before-state and the bulk undo puts it back.
  - **New setting `catalog.scope_completeness_gate`** (`warn` by default, or `refuse`; one value for the platform) in a new `catalog` settings group. When an operator's status change — global, per channel or per channel × language, single or bulk — switches the product on where its name, URL key or a required language-dependent attribute is missing in that language, `warn` saves it and answers `warnings: [{ kind: 'completeness', channelId, languageCode, missing }]`; `refuse` answers `422 SCOPE_INCOMPLETE` with every failing pair and saves nothing, and a bulk edit skips such products as `completeness_gate`. Imports, connectors and the API-key upsert are never checked.
  - **API shape (additive):** `PATCH /api/v1/admin/catalog/products/:id` answers `{ data, warnings }`; the scopes `PATCH` carries completeness warnings in its existing `warnings`.
  - **Scope overview:** every cell of a member channel in a language it offers carries `missing` — what the check would report there, whatever the cell's status.
  - **Fix:** undoing a queued bulk Restore re-archives the products again; its revert record used to read a stale archived time, so every product was reported as changed since.

- 0e33ca9: The page editor's preview of a product listing shows the same line under each product name as the storefront, and the option says what each line is.

  - `@endora-commerce/contracts` exports `productSummaryText(description)` and `PRODUCT_SUMMARY_MAX_LENGTH`, moved from `@endora-commerce/mod-catalog`, which re-exports them from the same module path. The rule is unchanged.
  - `@endora-commerce/mod-cms`' admin preview maps a product's description to its card `summary` through it (`mapAdminProductToCmsSummary`), in the language its name is picked in. The summary line, and a Showcase card's default line, were always empty in the editor.
  - `catalog.ProductGrid` and `catalog.ProductSlider` label `cardTextLine` **Text under the product name**, with **Card style default (SKU; summary on Showcase)**, **Short description (from the product description)**, **SKU** and **None**, in English and Polish. The stored values are unchanged.

- 9ff8307: The product gallery per sales channel and its alt text per language (product data scopes, FR-076, FR-077).

  - **New admin routes:** `GET` / `PUT /api/v1/admin/catalog/products/:productId/gallery/channel-roles` (`catalog:read` / `catalog:write`) read and set a channel's own holder of `base_image`, `small_image` and `thumbnail` — keyed `baseImage`, `smallImage` and `thumbnail` in `roles` (`null` = use the global holder). `PATCH …/gallery/:itemId` accepts `altText` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). These writes run as the Command `product.media.update` — one audit entry per request whose `before` restores the item — and emit `product.updated.v1` with `changedFields: ['media']`. A channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing an override there is always allowed. The route-level `gallery.update` audit row is no longer written beside the Command's.
  - **Admin DTO:** gallery items carry `altText` and `hiddenInChannels`.
  - **Storefront reads:** the product page's `gallery`, the listing card's image (also for related products and grouped / bundle children) and the OG image follow the request's channel: a hidden image is never served there, also not through its legacy `product_assets` twin, and a role resolves to its channel holder. `gallery[].altText` is the product's alt text at the request's language, else the asset's.
  - **Contracts:** `translationAt`, `applyTranslationPatch`, `translationMapPatchSchema`, `effectivePackagingUnitName`, `galleryChannelRolesSchema`, `putGalleryChannelRolesRequestSchema`, `GALLERY_ALT_TEXT_MAX`, `SCOPED_CHANNELS_MAX`; `sameLanguage` now lives in `scoped-translations.ts` and is re-exported unchanged.
  - **Scope overview:** lists `media:roles` and `media:hidden` per channel, `media:altText` per language, and `seo:<field>` overrides at L, C and C × L (none while `seo` is off).
  - **Migration** `catalog` `product_media_scopes`: tables `gallery_item_channel_labels`, `gallery_item_channel_hidden`, column `gallery_items.alt_text`. No backfill.

- d560d58: Product data scopes per sales channel and language.

  - New error sentences in both bundles for `SCOPE_INVALID`, `SCOPE_INCOMPLETE`, `URL_KEY_TAKEN`, `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` and `URL_REDIRECT_NOT_FOUND`, declared in the module's `errorCodes`.
  - Migration `20261022T035133_catalog_product_scopes.ts` adds `product_channel_scopes` (per-channel status, publication window, audience, minimum order quantity and returnable flag; `NULL` inherits), `product_channel_language_scopes` (status per channel × language) and the global window `products.publish_from` / `products.publish_until`, with no backfill — with no rows, every product behaves as before. Both tables cascade on product hard delete and on sales channel delete. `CatalogProductRecord` now carries `publishFrom` / `publishUntil`.
  - **New admin routes** `GET|PATCH /api/v1/admin/catalog/products/:id/scopes` (`catalog:read` / `catalog:write`): read and write a product's status, publication window, audience, minimum order quantity and returnable flag per sales channel, and its status per channel × language. `null` removes an override; a value for a channel the product is not in, or a language the channel does not offer, is refused with `422 SCOPE_INVALID` (removing an orphaned override is always allowed); a window that does not start before it ends with `422 VALIDATION_FAILED` (`details.field = 'window'`). Each write is the audited Command `product.scopes.update`, whose before-state re-sent through the same route restores it, and emits `product.updated.v1` with `changedFields` among `scopedStatus`, `publicationWindow`, `audience`, `orderRules`. An audience override naming organizations outside the channel is saved with an `audience_non_members` warning. Both answers name the organizations the channel audience rules name (`data.organizations`, read through `organizationDetailsPort`; an unreadable one is left out). These values are stored and audited, and applied by the storefront reads below.
  - **Behaviour change for API clients:** `PATCH /api/v1/admin/catalog/products/:id` accepts `publishFrom` / `publishUntil` (the global publication window; `422 VALIDATION_FAILED`, `details.field = 'window'`, when it does not start before it ends), and its `product.update` audit states carry both bounds.
  - **Effective availability on the storefront reads.** The product listing (every ordering and the price range), the facet counts, the category tree counts, the product page, the links of a product, the children of a grouped product and the options of a bundle (including `POST …/bundle-configuration/validate`, which answers an unavailable option as `UNKNOWN_OPTION`) and the buyer quick search show a product only where it is effectively available: a member of the request's sales channel, effectively `active` at (channel, request language), inside its effective publication window (inclusive at both ends), and admitted by its effective audience rule. The request language is the first `Accept-Language` tag resolved against the channel's languages (else the channel default).
  - **Behaviour change for API clients:** a member product that is switched off there is no longer reachable by its URL — `GET /api/v1/catalog/products/:idOrSlug` answers `404 PRODUCT_NOT_FOUND`, the same answer as a product that does not exist. An archived product answers `410 PRODUCT_ARCHIVED` only to a caller inside its channel and audience, and `404` to anybody else.
  - New port `catalogProductAvailabilityPort` (`filterAvailable`, `describeChannelAvailability`, `effectiveNames`, `effectiveOrderRules`) for the other modules' acquisition seams. `CatalogQuickSearchService` now takes the membership and channel-resolution ports.
  - **Publication-window sweep:** a Job Scheduler `catalog.publication-window.sweep` (every 5 minutes, where the process consumes queues) emits `product.updated.v1` with `changedFields: ['publicationWindow']` for each product whose global or overridden channel window bound was crossed since the last sweep (watermark in Redis). No status is written.
  - `catalogProductFilterPort.listSellable` / `countSellable` accept `scope: { channelId, languageTag }`; with it the floor is effective availability there for the anonymous audience.
  - **Behaviour change for API clients — listing (Postgres path):** `sort=name` orders by the effective name shown at the request's channel and language (ties by id), no longer by slug; cursors issued under the old name ordering are discarded. Free text `q` also matches the effective name and the effective values of searchable attributes; `filter[attr.*]` and the facet counts use the effective values of the channel (feature 022 overrides) at the request language. The buyer quick search matches the effective name and returns it as `effectiveName`.

- 0e33ca9: Products carry a short plain-text summary, and the product listing blocks gain a showcase card for marketing pages.

  - `@endora-commerce/mod-catalog` derives `summary` from the product description already on the row — markup stripped, entities decoded, at most 160 characters cut at a word boundary with `…`, in the request language with the same channel override as the product page — and returns it on the storefront product list and product reads; `null` when there is no description. No extra query per product. `@endora-commerce/contracts` adds the optional `summary` to `productSummarySchema`.
  - `catalog.ProductGrid` and `catalog.ProductSlider` (rendered by `@endora-commerce/cms-components`, declared by `@endora-commerce/mod-catalog`) keep every option and default they had and add a header (heading, lead, button), `cardVariant` (`default` or `showcase`), a card link label `ctaLabel` and a `footerButton`. The slider takes the Carousel's options; a stored slider keeps its look through `productSliderFromLegacy` (arrows over the edges, dots below, pixel gap). The new texts are translatable, and the field labels ship in English and Polish.
  - `CmsProductCardView` accepts `variant: 'showcase'`: image on a neutral backdrop, name, summary and a "more" link labelled by `ctaLabel`, without price or SKU. `CmsProductSummary` gains the optional `summary`; `PRODUCT_CARD_VARIANTS` and the shared listing fields are exported from `components/catalog/product-listing-parts`.

- 634edd0: Scope overview and attribute scope-change preview (product data scopes).

  - **New admin route** `GET /api/v1/admin/catalog/products/:id/scope-overview` (`catalog:read`): a product's channels × languages. Each cell carries its effective status and where it comes from (`channel_language`, `channel`, `global`), whether the product is available there now (a member, the language offered, effectively on, inside its effective window, not archived — the audience is shown as a rule, not evaluated) and every field overridden at that cell with the level it comes from. Field names are the owning write's: `status`, `window`, `audience`, `minOrderQuantity`, `returnable`, `name`, `description`, `attribute:<key>`, `urlKey`. The channel rows and language columns list their own overrides; a value in a language other than the platform default is a language-level override. Overrides the resolution ignores are listed under `orphans` with a reason: `not_a_member`, `language_not_offered` or `attribute_scope_changed`. A product in no sales channel answers no channels and every active platform language. `cells[].missing` is not filled yet.
  - **New admin route** `GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview?channelScoped=&languageScoped=` (`catalog:read`): how many value overrides a change of a user-defined attribute's scope flags would orphan, in total and per sales channel. An absent flag keeps the current one; a widening answers 0; a system attribute or an unknown one answers `404 NOT_FOUND`; a flag other than `true` / `false` answers `400 VALIDATION_FAILED`. The attribute update itself is unchanged and keeps every override row.
  - **Behaviour change for API clients:** `PATCH /api/v1/admin/catalog/products/:id/value-overrides` now accepts a **delete** of an orphaned override — one on a sales channel the product is no longer in, in a language the channel no longer offers, of an attribute that is no longer channel-scoped, or of an attribute that no longer exists — instead of refusing it with `422 VALIDATION_FAILED`. Upserts are refused exactly as before; the delete is audited as `product.overrides_apply`.

- dcbd154: Scoped writes for connectors and importers.

  - New port `catalogProductScopeWritePort.applyScopes(productId, input, { source })`: writes only the scopes named — status per sales channel or channel × language, the global or a channel publication window, a channel audience, channel order rules, and URL keys per language or channel × language — so a connector writing global values removes no operator override. Status, window, audience and order rules go through the `product.scopes.update` Command. URL keys run in import mode: a key another product holds as a current key or a redirect is not written, the product keeps its previous key, and the outcome names the language, key and holder (`kind: 'current' | 'redirect'`); a redirect is never taken over. One `product.url_keys.update` audit entry per call (`source` recorded in its after-state). No completeness gate runs.
  - `catalogBulkImportPort.importProducts` takes `scopedStatus` cells and writes them in the same all-or-nothing Command (an empty cell removes the override; a value for a channel the product is not in, a language the channel does not offer or an unknown channel code rejects the file), announcing `product.updated.v1` `['scopedStatus']` per changed product after commit. New `catalogBulkImportPort.exportScopedStatuses()`.
  - New page _URL Keys and Redirects_ in the catalog documentation, with which scope every integration field is written at.

- 678fed1: Storefront resolution of product URL keys at the request's sales channel and language.

  - **New public route** `GET /api/v1/catalog/products/resolve/:key`. A key is valid only in its own language: the product's effective key at (channel, language) answers `{ kind: 'product', productId, key }`; any other of its current keys in that language, and its redirect keys there (a language-less redirect — a former global key — counts in every language), answer `200 { kind: 'redirect', key, languageCode, path }`, `path` built by `productPath()`. A key of no product, a key of another language, and a product unavailable to the caller there (out of the channel, outside the audience, off in the scope, outside its window) all answer the same `404 PRODUCT_NOT_FOUND`; an archived product answers `410 PRODUCT_ARCHIVED`. Redirects are served only while `seo` is effectively present. Signed-in callers' answers are `private, no-store`.
  - `GET /api/v1/catalog/products/:idOrSlug` now answers an id, a current key of the request language, else a product's global key (the handle CMS product blocks store) — never a redirect key.
  - The product detail carries `paths: { canonical, alternates }` — the page's URL at the request's channel and language, and one per channel language where the product is available to anonymous visitors.
  - `slug` on the listing, the product detail, grouped and bundle children and product-link tiles is the product's effective URL key at the request's channel and language.
  - New port `catalogProductUrlKeyReadPort.effectiveKeys(productIds, channelId)`.
  - `GET /api/v1/admin/catalog/products/:id/url-keys` omits `redirects` while `seo` is not effectively present; the rows stay and keep reserving their keys.

- ed54c82: Product URL keys per language and per sales channel × language, with permanent redirects.

  - Migration `20261022T054223_catalog_product_url_keys.ts` adds `product_url_keys` (a product's key per language, or per sales channel × language) and `product_url_redirects` (a former key and the product it redirects to; a language-less row is a former global key). The global key stays `products.slug`; no backfill. `product_url_keys` is indexed by product. Both tables cascade on product hard delete; channel keys also on sales channel delete.
  - **New admin routes** `GET|PUT /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read` / `catalog:write`) and `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`). A key is unique per language across every sales channel, the global key counting in every language where the product has no language key; a key another product holds is refused with `409 URL_KEY_TAKEN` naming it, and a key that is another product's redirect needs the operator's confirmation (`confirmTakeover`) after `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` naming the product that loses it. A soft-deleted product's global key stays taken (`products.slug` is unique across deleted rows) while its language and channel keys are released; a non-UUID `:id` is answered 404. A changed key stays as a redirect in its language; redirects store the product and never chain. Writes are the audited Commands `product.url_keys.update` (whose before-state re-sent through the route restores the keys) and `product.url_redirect.delete`, and emit `product.updated.v1` with `changedFields: ['urlKeys']`. Storefront resolution of these keys is not wired yet.
  - A new product's slug, on create and on duplicate, is now chosen free of every live product's language, channel and redirecting keys, under the keys' locks inside the create or duplicate Command; deleting a product removes its redirects.

- 22604fa: **BREAKING — `CatalogGalleryPort.listForProducts` and `CatalogGalleryPort.baseImageUrls` gain a required second parameter, `channelId: string | null`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. A caller passes the sales channel it serves, or `null` for the previous, global answer: `listForProducts(ids)` → `listForProducts(ids, channelId)`, `baseImageUrls(ids)` → `baseImageUrls(ids, channelId)`. An implementer of the port (an overlay replacing catalog's gallery) adds the parameter and leaves out the items hidden in that channel; with `null` it answers as before.

  A gallery image hidden in a sales channel no longer reaches that channel's product feeds or comparisons (product data scopes).

  - **Contracts:** `CatalogGalleryPort.listForProducts(productIds, channelId)` and `CatalogGalleryPort.baseImageUrls(productIds, channelId)` take the channel the caller serves; `null` keeps the global answer.
  - **catalog:** `listForProducts` leaves out the items hidden in the channel. `baseImageUrls` answers the channel's own `base_image` holder, else the global one, and `null` when that holder is hidden there. Each is still one statement per batch.
  - **product_feeds:** a feed's images are read in the feed's channel.
  - **comparisons:** the base-image column is read in the viewer's resolved channel.

- 0e33ca9: Alignment, gaps and text weights are set per breakpoint, beside each other on the Responsive tab, in every block that has them.

  Nothing changes for a stored page: a value stored as one alignment, one gap or one weight applies at every width and renders as before.

  - **Alignment** of `cms.Icons`, `cms.Social`, `cms.LogoStrip`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, `cms.Hero` and `cms.Tabs` is per breakpoint and reads **Left / Center / Right** (the tabs' third is **Stretch**). Alignments that differ write `data-align-md` / `data-align-lg` (and the classes the stylesheet reads); one alignment keeps today's markup.
  - **Gaps** of `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid` and `catalog.CategoryGrid` are a spacing step or **Custom gap (px)**, per breakpoint. A gap stored as a number reads as Custom with that number (`numericGapAsCustom`, carried by `resolveData`); gaps that differ go on `cmsc-pb-gap-tiers`. The grids' **Equal items height** is per breakpoint too, next to the columns and the view.
  - **Weights** — every block heading's, the feature list's and the hero's title weight and the media-and-text item title weight — are per breakpoint, right after the size. Weights that differ wrap the text in one `cmsc-pb-item-weight` span (`responsiveWeightProps`, `WeightSpan`); one weight stays the inline `font-weight`.
  - The registry's and the manifests' `responsiveFields` list the new responsive props.

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

- 3aba2e1: New command-palette action "Archived products" (product data scopes). It needs `catalog:read` and opens `/catalog/products/archived`, the product list's Archived tab. Search for it with "archived", "archive", "restore", "archiwum", "zarchiwizowane" or "przywróć".
- 1b4f2b7: A product's storefront page follows its availability at once. `catalog` now drops the storefront's cached product-page reads of a product — tagged by its id, slug, URL keys and former keys — after `product.updated.v1`, `product.archived.v1` and a product's `sales_channels.membership_changed`, and its keys after `product.deleted.v1`, through the storefront revalidate endpoint it already uses for categories (`STOREFRONT_BASE_URL` + `REVALIDATE_SECRET`; a no-op without them). Any `product.updated.v1` counts — a gallery, attachment, packaging-unit or name change drops the product's page as well, since the event does not say which writes change availability. A short trailing debounce (150 ms, at most 1 s) gathers a bulk operation into one call, chunked at 200 tags; past 500 pending products the shared `catalog:product` tag is dropped once instead; one call is in flight at a time. `product.deleted.v1` now carries `formerUrlKeys`, the redirect keys the deletion removed, so a deleted product's pages are dropped by key too (the shared tag only when its keys cannot be read). Best-effort: a failed key read or call is logged and never fails the write. Next keeps only a `200` in its Data Cache, so a product switched off, archived or moved out of a channel used to go on showing until the storefront restarted. The tag vocabulary is `CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS` (`product`, `productKey(key)`, `maxLength`), shared by both sides.
- dd6deb2: **BREAKING — the product status is `active` | `inactive`, and archiving is its own action.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **`productStatusSchema`** narrows from `draft | active | inactive` to `active | inactive`, and so do `ProductStatus`, `PRODUCT_SCOPE_STATUSES` / `productScopeStatusSchema` and the bulk `fields.scopedStatus.value` (still with `inherit`). `draft` is removed with no alias: send `'inactive'` where you sent `'draft'`.
  - **`coerceProductStatusWrite` and `productStatusWriteSchema` are removed.** Use `productStatusSchema`. The legacy `archived` write alias is gone with them: `status: 'archived'` is refused like `draft`, with `400 VALIDATION_FAILED`, on `POST` / `PATCH /api/v1/admin/catalog/products`, on the bulk update, on `POST …/products/resolve-ids` and on the API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku`.
  - **`inactive` no longer archives.** It is plain off at every scope; a status write neither sets nor clears `archivedAt`, and setting `active` never restores an archived product. To archive, call `POST /api/v1/admin/catalog/products/:id/archive` (and `…/restore` to bring it back), both behind `catalog:write`, or the bulk update with `fields: { archived: true }` (`false` restores) as the only field of the request. Each is an audited `product.archive` / `product.restore` Command; repeating one answers `200` and changes nothing.
  - **`product.archived.v1`** now means "archived by the Archive action", not "status moved to `inactive`": it is sent after `product.updated.v1` with `changedFields: ['archivedAt']`. Restore sends `product.updated.v1` with `['archivedAt']` only. A bulk-operation undo now announces every product it reverts (`product.updated.v1` with the restored fields, and `product.archived.v1` where it re-archives).
  - **Admin product list:** `counts.draft` → `counts.archived` (`counts` is `{ all, active, inactive, archived }`, the first three over products that are not archived); the `status=archived` filter → `archived=only` (`archived=exclude|include|only`, default `exclude`; `includeArchived=1` still means `include`); `status=draft`, `status=archived` or any unknown status answers `400 VALIDATION_FAILED`. `resolveProductIdsRequestSchema` gains the same `archived` mode (`productArchivedModeSchema`), whose default stays "include".
  - **New and duplicated products are `inactive`** (and a duplicate is never archived), where they used to be `draft`.
  - **`pairsTurningOn`** compares the effective status only: setting an archived product `active` turns its pairs on, and a Restore turns nothing on.
  - **`SetProductStatusParamsSchema`** (the assistant's `catalog.set_product_status`) and **`quickOrderSearchResultSchema.status`** take `active | inactive`; the assistant's status tool switches products on or off and never archives.
  - **Migration `product_status_drop_draft` (catalog).** Every product that is `inactive` at the upgrade stays archived — it keeps its `archived_at`, or gets its `updated_at` when it had none — and **needs an explicit Restore**: setting it `active` alone leaves it archived. `draft` becomes `inactive` in `products` and in both scope tables without archiving anything. The status column now refuses any other value (`products_status_check`) and defaults to `inactive`. Product-feed criteria stored with `status = draft` are not rewritten; they match nothing, as before.
  - **`errors.PRODUCT_ARCHIVED`** reads "Product is archived." / "Produkt jest zarchiwizowany.".

- 61fc321: The storefront language is part of the URL path (`/pl/p/wiertarka`, `/en/p/drill`, issue #396).

  **Upgrade note for operators: existing sales channels keep their addresses.** The migration
  `Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage` adds the per-channel setting
  _Prefix the default language in URLs_ and switches it **off** on every channel that exists when it
  runs, so default-language URLs stay unprefixed; channels created later start **on**. To adopt
  prefixes for the default language too, switch _Prefix the default language in URLs_ on in
  _Sales channels_ → the channel. Other languages are prefixed either way: a former
  `/p/<key>?lang=<L>` link answers a permanent redirect to `/<prefix>/p/<key>`. A CMS page whose slug
  starts with a channel language prefix can no longer be saved.

  `@endora-commerce/contracts`:

  - New: `channelUrlLanguages`, `channelUrlLanguageAliases`, `storefrontPagePath`,
    `storefrontPagePathFor`, `storefrontDefaultPath`, `channelUrlLanguageSchema`,
    `channelUrlLanguageAliasSchema`, `URL_LANGUAGE_PREFIX_PATTERN`, types `ChannelUrlFacts`,
    `ChannelUrlLanguage`, `ChannelUrlLanguageAlias`; `productDefaultPath(key)`.
  - **`productPath` takes the channel's URL facts and never appends `?lang=`:**
    `productPath({ key, languageCode, channelDefaultLanguage })` (`/p/drill?lang=en-US`) becomes
    `productPath({ key, languageCode, channel })` (`/en/p/drill`), where `channel` is any
    `{ languages, defaultLanguage, prefixDefaultLanguage }` — the cached channel satisfies it.
  - `productKeyResolutionSchema`'s `redirect` requires `permanent` (`false` for a key of another
    channel language, answered 307); `productPagePathsSchema` requires `xDefault`.
  - Sales channel shapes carry `prefixDefaultLanguage` (create defaults to `true`); the public
    channel read answers `prefixDefaultLanguage`, `urlLanguages` and `urlLanguageAliases`.
  - `cmsPageUrl` (163 R24) takes the channel's URL facts and composes the prefixed path:
    `cmsPageUrl({ path, languageCode, channelDefaultLanguage })` (`/about-us?lang=en-US`) becomes
    `cmsPageUrl({ path, languageCode, channel })` (`/en/about-us`). The resolved CMS page's `url` and
    `alternates`, and the storefront page index, therefore carry each language's own slug under its
    prefix.
  - `CmsPageRecord` gains optional `languages` and `translations` (the `seo` sitemap lists each
    language at its own slug); `cmsPageSummarySchema` gains an optional
    `shadowedByLanguagePrefix` (any of the page's slugs, per-language ones included).

  Emitters (catalog, seo sitemap, product feeds, organizations, customers, newsletter, comparisons,
  mfa, invoices) compose prefixed storefront URLs; the product feed `link` uses the product's key in
  the feed language; the invoice e-mail links the storefront order page; the admin password reset
  links `/password-reset/confirm`. `cms-components` localizes block links through the render
  context's `localizePath`.

- f261ed3: The sales channel's `isPublic` flag is retired in favour of the pricing display-mode chain
  (issue #492; closes #467). The flag was documented as anonymous-price visibility, but every read of
  it withheld prices from **everyone** on the channel, signed-in buyers included, beside a chain that
  already says "prices after sign-in" per channel: `pricing.unauthenticated_display_mode = none`.

  **Behaviour change.** Signed-in buyers on a channel that had `isPublic = false` now see prices
  according to the display-mode chain (their organization's override, else the channel's
  `pricing.default_display_mode`), where they used to see none — on the catalogue listing, the product
  page, product links, search, comparisons, and the price sort and range, which are no longer refused
  to them. Anonymous visitors on such a channel still see no prices: the migration below carries that
  half of the flag over. A channel that had `isPublic = false` **and** its own value for
  `pricing.unauthenticated_display_mode` keeps that value, so its anonymous visitors now see prices if
  that value is a priced mode. A new channel, the boot-time default channel included, no longer starts
  with prices hidden from everyone; it follows the chain like any other.

  The display-mode chain itself is unchanged (owner ruling of 2026-10-28): a product or category
  override takes precedence over the channel's `pricing.unauthenticated_display_mode`, also for
  anonymous visitors, so a product overridden to `gross_only` shows its price to guests on a channel
  whose guest mode is `none`. An organization override still applies to signed-in buyers only.

  - **`@endora-commerce/platform`.** New migration `Migration20261028T173317CoreSalesChannelsRetireIsPublic`
    (core): every channel with `is_public = false` and no value of its own for
    `pricing.unauthenticated_display_mode` gets `"none"` as its per-channel value, then
    `sales_channels.is_public` is dropped. It refuses — rather than migrating into showing prices — a
    database that has a non-public channel but no registered `pricing.unauthenticated_display_mode`
    setting; start the platform once on the previous release, so the settings reconciler registers
    it, and migrate again. Because the column is dropped, stop processes running the previous release
    before migrating. `SalesChannel.isPublic` and `CachedChannel.isPublic` are removed;
    `SALES_CHANNELS_CACHE_KEY_PREFIX` moves from `sales-channels:v3:` to `sales-channels:v4:`, so no
    process reads an entry cached in the other shape. The default-channel reconciler no longer sets
    the flag.
  - **`@endora-commerce/contracts`.** `ResolvedSearchChannel.isPublic` is removed — drop it from the
    context you hand `SearchQueryPort`. No public HTTP shape carried the flag, so no response changes
    shape. The `SALES_CHANNEL_AUDIT_ACTIONS` documentation now says who writes each row: the identity
    Commands (with `stateBefore` / `stateAfter` snapshots) since #484.
  - **`@endora-commerce/mod-catalog`.** `CatalogResolvedChannel.isPublic` and the `isPublic` field of
    `ProductLinkService`'s storefront context are removed. The catalogue no longer skips pricing on
    a channel: prices follow the viewer's display mode (a viewer whose mode is `none` gets the
    withheld answer, `resolvedPrice.displayMode: 'none'`, where the channel used to answer
    `resolvedPrice: null`). The price controls are refused only where the page's display mode is
    `none`; the reason "This sales channel does not publish prices…" is gone.
  - **`@endora-commerce/mod-search`.** The service's `ResolvedSearchChannel.isPublic` is removed, and
    hits are always resolved for the viewer.
  - **`@endora-commerce/mod-comparisons`.** A comparison is priced for the viewer on every channel.
  - **`@endora-commerce/mod-sales-channels`.** The channel form's _Open to anonymous visitors_ hint
    gains a second line pointing to the guest display mode, with a link to _Pricing settings_
    (`identity.anonymousAccess.pricesHint`, `identity.anonymousAccess.pricesLink`, English and
    Polish). New channels are no longer written with the flag.
  - **`@endora-commerce/mod-price-lists`, `@endora-commerce/mod-i18n`.** _Pricing settings_ states,
    under the two default modes, that a channel's own value wins over them and that a product or
    category override takes precedence over both, for anonymous visitors too
    (`priceLists.displayModes.settings.precedenceHint`).
  - **`@endora-commerce/demo-composition`.** The `pl_b2b_vip` channel is created without the flag and
    a new step, _the VIP channel hides prices until sign-in_, sets its
    `pricing.unauthenticated_display_mode` to `none`; its signed-in buyers see prices. `pl_retail`
    publishes prices to everyone, as before.
  - **`@endora-commerce/mod-settings`, `@endora-commerce/cli`.** Comments only: the cache-clear
    namespace names the new key prefix, and the channel-resolution rule no longer cites the flag.

- 302e5ce: A price-sorted or price-filtered catalogue cursor no longer reveals anything about a product the
  viewer may not see (issue #497). Such a cursor was base64 of JSON. A page cut by its scan budget
  continues from where its scan stopped, which can be a product hidden from the viewer, and under a
  price sort that position held the product's resolved price and id; a full page ended on its last
  card, whose price the viewer's display mode may withhold while the price order still ranks it.

  - **`@endora-commerce/mod-catalog`.** Every cursor the price walks issue —
    `GET /api/v1/catalog/products` and the external catalogue API with `sort=price`, `sort=-price`,
    or `minPrice` / `maxPrice` under another sort — is sealed: it decodes to nothing and cannot be
    altered or forged. Paging is unchanged: a budget-cut page is still short or empty with
    `hasMore: true`, the walk still moves forward, and it still meets every product it shows once.
    The module now resolves the container value `cursorSeal` (`CatalogCradle.cursorSeal`), and
    `CatalogQueryService` takes it as a new last constructor argument; a price walk without it
    throws. The default listing's cursor is unchanged.
  - **Cursors in flight.** A price-walk cursor of the old, readable format — a storefront link held
    across the upgrade — no longer continues the walk: it is discarded like any cursor that does not
    parse, and the listing answers its first page (`200`, not `400`). So does a cursor that was
    altered, and every price-walk cursor issued before the instance's `SESSION_COOKIE_SECRET` changes.
  - **`@endora-commerce/platform`.** New `createCursorSeal(secret)` on `./composition`: AES-256-GCM
    from `node:crypto`, its keys derived with HKDF from the secret, the purpose bound as additional
    data, the plaintext padded to 128-byte blocks so a token's length does not follow an amount's
    digits. Deterministic (a synthetic IV, an HMAC of purpose and payload): one position seals to
    one token, so a storefront's next-page link stays one URL a cache and a crawler can reuse.
    `composeApp` registers `cursorSeal: createCursorSeal(process.env.SESSION_COOKIE_SECRET)`; no new
    environment input. The key is derived on first use, so a composition without a session
    key is not refused, and a seal or an open without one throws.
  - **`@endora-commerce/test-kit`.** `composeTestServer` registers a `cursorSeal` with a pinned test
    key; a harness's own `values.cursorSeal` overrides it.

- b25d8be: A blog post's related products are shown as product cards priced for the viewer (issue #590).

  - **`@endora-commerce/contracts`** — `productListQuerySchema` gains an optional `ids`
    (`productListIdsSchema`: a comma-separated list of distinct uuids, at most
    `PRODUCT_LIST_MAX_IDS` = 24). `blogResolvedPostSchema` gains an optional `relatedProductIds`:
    the post's related products by id, in the editor's order, with no price. Additive; a payload
    without either still parses.
  - **Deprecated, removed in a later minor:** `blogProductCardSchema`, the `BlogProductCard` type and
    `blogResolvedPostSchema.relatedProducts`. No shipped composition ever filled them, and their
    `price` could not be a correct one: the post payload is cached per channel and language for
    every visitor. Read `relatedProductIds` and fetch the products from
    `GET /api/v1/catalog/products?ids=…` as the viewer instead.
  - **`@endora-commerce/mod-catalog`** — `GET /api/v1/catalog/products?ids=<id>,<id>` restricts the
    listing to the named products: the subset the viewer may see, priced like any listing card for
    that viewer, in the listing's order, always from PostgreSQL. More than 24 ids or a value that is
    not a uuid is `400 VALIDATION_FAILED`.
  - **`@endora-commerce/mod-blog`** — the storefront post payload carries `relatedProductIds`.
    `BlogStorefrontDeps.resolveProductCard` is deprecated: nothing reads what it produces any more,
    and it is removed in a later minor.

### Patch Changes

- 9b45768: `ModalDialog` takes two optional props: `widthClassName` replaces the panel's default `max-w-lg`, and `dismissOnScrim={false}` keeps a press on the scrim from closing a dialog that holds unsaved input (Escape and the dialog's own buttons still close it). Existing callers are unaffected. The product browser draws an archived product's status as a neutral outline beside the catalogue's Archived pill.

  The catalog's bulk edit is one `ModalDialog`: bulk Archive / Restore is confirmed in a second step of the same dialog, focus moves to the outcome's heading, an inline result no longer links to an operation page that does not exist, and a queued Archive / Restore says so and links to its operation. The product list keeps the archived empty-state copy for an unfiltered Archived tab, offers to repeat an empty search among archived products, and shows one coloured pill — Archived — on an archived row; the editor's archived notice carries its Restore action.

- f91e55f: The products list has its own address for the Archived tab, `/catalog/products/archived`, and follows the address after it has loaded: opening that address or a `?status=` link while the list is already on screen switches the tab. A saved view that held the removed Draft status still opens on All, and now says so once, until a tab is chosen or the note is dismissed.
- e4d86da: On the products list's Archived tab, a selection's action bar is **Restore** (primary), Bulk edit and Delete. Restore goes straight to the existing confirmation and summary; Bulk edit opens the form without repeating Restore. The placeholder Edit price is not offered there. Other tabs are unchanged, and Archive stays in the bulk edit dialog.
- 22604fa: The admin attribute response carries `channelScoped` and `languageScoped` (create, update, read and list), so the attribute editor shows the stored scope flags. `adminAttributeResponseSchema` declares both.
- cdf36fd: The products bulk edit offers **Set status in one channel**: a sales channel, optionally one of its languages, and Active, Inactive or Use inherited. It cannot be combined with Status — each is disabled while the other is chosen, and says why. The result names the scope it set, lists the products skipped because they are not in the channel (never added to it) or refused by the completeness check, and those switched on with values missing; the result table's headings and statuses are translated.
- 9d71126: The product editor says what the completeness check found when a Save changes the status. Where the change switched the product on with values missing, the page names them by sales channel and language ("B2C shop · DE: name, attribute material") instead of "Saved."; where the check refuses the change, it names every channel and language that blocked it, says the product's details were not saved and keeps the edits in the form. The error code never reaches the operator.
- 1a6c47e: The product editor's SEO tab gains a **URL keys** panel: the global key, a key per language and a key per sales channel and language (an empty field uses the inherited key; a key left behind by a channel the product left is shown as no longer used and can be removed), the storefront URL each channel and language ends up with, and — while the SEO module is on — the redirects old keys keep, each deletable after a confirmation. A key another product uses is refused naming that product; a key that is another product's redirect asks first, naming the product that loses it.
- bf60414: Product editor review fixes for product data scopes:

  - A save refused by the completeness check writes nothing — the staged channel overrides and gallery edits are written only after the product itself is accepted.
  - Staged gallery edits survive switching tabs and count as unsaved changes; while any are staged, adding or removing an image waits for Save. Removing an image and the image preview use the admin dialog.
  - The scope overview asks before resetting a text value or deleting a value that no longer applies; channel and language values sit in their own column and row; focus returns to the overview after a reset.
  - One vocabulary: **Use inherited** returns a value to the inherited one, **No longer applies** names a value the resolution ignores.
  - The URL keys panel works when the product's channels cannot be read, asks again when a confirmed takeover meets another redirect, marks a refused key's field and shows the inherited key as text.
  - Packaging units are read-only without `catalog:write`; the attachment and packaging-unit dialogs share their error wording, a saving state and a question before unsaved edits are dropped.
  - The bulk result names products by name and SKU and links a scoped-status row to the product's Scopes tab (`?tab=scopes` opens it); the scoped status has no preselected value.

- a76d6ee: - The product detail's `seo` block is `seo`'s per-field resolution at the request's sales channel and language (`seoProductMetaPort`, declared `degrades-without`): operator overrides — including per-language overrides saved before this release, which were stored but not shown — are now served; with `seo` switched off the derived metadata is served as before.
  - The product page answers `410 PRODUCT_ARCHIVED` only for an archived product (`archived_at` set). A product that is `inactive` and not archived answers the absent product's `404`.
- fd2ac2d: A sales channel's default language now counts as offered on every catalog write and admin read, as it already did on the storefront: a value override, a per-language scope status or a channel URL key in the channel's default language is accepted even when the channel's `languages` list omits it, and the product scopes, scope overview, URL keys and scope context responses list that default among the channel's languages instead of reporting rows in it as orphaned.
- 07f3764: Minimum order quantity and "returnable" per sales channel (product data scopes, FR-100).

  - **Behaviour change:** a product's channel override of its minimum order quantity or its returnable flag (`product_channel_scopes`, written through `PATCH /api/v1/admin/catalog/products/:id/scopes`) now applies in that channel. Adding to the basket (single, batch and quick-order build), the basket view, submitting a basket for approval, the checkout preview, placement, the admin order preview, quote requests (create, draft edit, resubmit, the operator's per-line warning) and the buyer's quick-order import judge the minimum of the basket's, order's or request's channel; a channel minimum of 1 means no minimum there. Placement stamps `order_items.returnable_at_purchase` from the order channel's flag, so returns follow it. Without an override nothing changes.
  - **Storefront read model:** `minOrderQuantity` on the product detail and listing summaries is the request channel's value.
  - **Contracts:** new `withChannelOrderRules(records, rules)` puts the rules of `catalogProductAvailabilityPort.effectiveOrderRules` into a set of product records for one seam; `CatalogProductRecord.minOrderQuantity` / `returnable` keep meaning the global values.

- 0e33ca9: The Carousel gains arrow placement per breakpoint, an arrow look, a grid layout and a category filter; carousel images gain a caption scrim, link tiles a ratio per breakpoint, and `cms.Tabs` a tab bar look.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Arrow placement per breakpoint.** `controlsPlacement` (`'below' | 'header' | 'overlay'`, or one per breakpoint) is a top-level, responsive prop on the Responsive tab of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`. It replaces the `placement` key inside `controls`. A placement stored there is still honoured, and the editor's `resolveData` moves it to `controlsPlacement` (`carouselPlacementMoved` in `carousel/carousel-parts`). For a stored slider, `contentSliderFromLegacy` now also writes `controlsPlacement`. `CarouselShell`'s `controlsPlacement` prop accepts a responsive value. Each placement in use is rendered once, and the stylesheet removes it where it does not apply (`cmsc-pb-carousel__controls--off-sm|md|lg`).
  - **Arrow look.** `controls.arrowVariant` (`default | outline | solid`), `arrowShape` (`round | square`), `arrowSize` (`s | m | l`, 32/36/44 px) and `arrowColor` (a brand token or a hex). They map to the `CarouselShell` props of the same names, rendered as root classes and `--pb-arrow-color`.
  - **Grid layout.** On the Carousel, `layout: 'carousel' | 'grid'` and `columns` (1–6, responsive). `CarouselShell` takes `layout` and `columns`: the grid is a list of items in `--pb-cols(-md|-lg)` columns, with no controls and no autoplay. In the editor, the action bar has no page navigation for a grid.
  - **Filter.** The Carousel's `filter` prop is `{show, allLabel, tags: [{tag, label}]}`. Every item block and `cms.Slide` take `tags` (comma-separated keys), written as `data-pb-tags`. The new `carousel/carousel-filter` module exports `parseItemTags`, `itemTagsAttribute`, `ITEM_TAGS_FIELD`, `carouselFilterFromProps` and `CarouselFilterBar`, and `CarouselShell` takes a `filter` prop. The bar is a `toolbar` of `aria-pressed` buttons with a single tab stop and a polite count. Filtering hides items in the browser only, so every item stays in the server HTML. `filter.allLabel` and `filter.tags[].label` are declared translatable. `CmsCarouselLabelText` gains `filter`, `filterAll` and `filterCount`.
  - **Caption scrim.** `cms.CarouselImage` gains `captionScrim: {kind: 'none' | 'gradient' | 'solid', strength}`, for captions placed over the image.
  - **Link tile ratio.** `cms.LinkTile.ratio` may differ per breakpoint, and is listed in the block's `responsiveFields`.
  - **Tab bar look.** `cms.Tabs` gains `tabStyle: {size, barBackground, barBorderColor, activeBackground, activeColor, inactiveBackground, inactiveColor}`. The colours are written as `--cmsc-tabs-*` custom properties, which fall back to today's colours. A bar background or border draws the bar, as a capsule around pills. On a narrow screen the tabs still wrap.
  - **`BoxStyled`** takes an `attributes` prop for `data-*` attributes.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels. The `controls.fields.placement` keys are replaced by `controlsPlacement`.

- 473ef09: Storefront links on the basket, the search results, comparisons and the quick-order type-ahead use the product's effective URL key at the request's sales channel and language (product data scopes), as the product page and the catalogue listing already did.

  - **Behaviour change for API clients:** `productSlug` of a basket line and of an up-sell candidate, `slug` of a Meilisearch result card, of a comparison column and of a quick-order search hit is the channel × language key, else the language key, else the global key. A product with its own key in a language used to be linked by its global key, which answers 404 in that language when `seo` is off. A basket line whose product is unavailable still has `productSlug: null`.
  - **Also:** a Meilisearch result card and a comparison column report the request channel's `minOrderQuantity`.
  - `search` and `comparisons` resolve `catalogProductUrlKeyReadPort`; `catalog` is already a dependency of both.

- 6789af2: Gallery labels and order are audited like the rest of a gallery item. A `PATCH …/gallery/:itemId` body carrying `labels` runs the Command `product.media.update`: the labels are replaced on the Command's transaction under the product row lock (a refused label rolls the whole write back), and the audit entry's `before` / `after` carry `labels`. With `?replace=true` the entry restores this item only, not the label another item lost. `PUT …/gallery/order` runs as `product.media.update` in one transaction, with `orderedGalleryItemIds` before and after, and announces `product.updated.v1` `['media']`; an unchanged order or label set writes nothing. Deleting a gallery item or an attachment writes one audit entry (`gallery_item.delete`, `product_attachment.delete`); the route-level `gallery.delete`, `gallery.reorder` and `attachment.delete` rows are no longer written beside them.
- 9a38360: **BREAKING — `cartViewLineSchema.productSlug` is `string | null | undefined`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. A basket line whose product is unavailable carries `productSlug: null`, so a reader that typed it as `string | undefined` must handle `null` (render the line without a product link); `productSku` is new beside it.

  Product data scopes reach the basket view and the two external API seams that did not follow them yet.

  - **Basket view:** a line whose product is no longer available at the basket's sales channel and language keeps its `productName` and `productSku`, reads `unavailable: true` (`unavailableReason: 'not_purchasable'`), and has `productSlug: null`, so the storefront shows it without a link to a product page that answers `404` there. Placing the order still refuses it. `cartViewLineSchema` types `productSlug` as nullable and gains `productSku`.
  - **External order intake** (`POST /api/v1/external/orders`): after the existing per-line checks, every line's product must be available at the key's sales channel (its default language) to the calling key's Organization — not switched off there, inside its publication window, admitted by the channel's audience rule. A product that is not answers what a product hidden from the bound Organization already answered: `404 PRODUCT_NOT_FOUND`, no name, nothing placed. An unknown or unpublished SKU keeps its per-line `422 VALIDATION_FAILED` (`SKU_NOT_IN_ASSORTMENT`), which takes precedence. The availability rule decides the status, so the SKU read no longer drops a product that is off globally: one that is on in the key's channel is orderable, one that is off there answers the `404`. `OrderApiIntakeService` takes `catalogAvailability`, and `place` takes the caller's `audience`.
  - **External bulk prices** (`POST /api/v1/external/catalog/prices`): a product not available to the calling key's Organization at the key's channel gets no price and reads `sku_not_in_assortment` — before, a product restricted away from that Organization was priced. `resolveBulkPrices` takes the caller's `audience`; the external catalogue namespace is mounted only with `catalog`'s own availability port.

- 0e33ca9: The dark scheme's decorative backdrop can be given as a URL, `cms.Tabs` can keep its tab bar in one scrolling line, and a `cms.Column` can distribute its blocks vertically and reorder them per breakpoint.

  Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

  - **Backdrop by URL.** The brand tokens' schemes gain an optional `decorativeUrl`, validated by the new `brandMediaUrlSchema` and `BRAND_MEDIA_URL_RE` in `@endora-commerce/contracts`. It accepts an `https:` URL, or a path starting with `/`, of up to 2048 characters, with no quotes, parentheses, backslashes, angle brackets or whitespace. The library asset (`decorativeAssetId`) wins when both are set. `brandTokensToCss` takes a new `mediaUrl` option, which rebases a `/path` (the storefront and the admin pass their API origin). It checks the stored value again and writes it as an escaped CSS string. The brand screen has a **Decorative backdrop URL** field under the dark scheme's asset picker. `@endora-commerce/page-builder-core/brand-tokens` re-exports `BRAND_MEDIA_URL_RE`.
  - **Scrolling tab bar.** `cms.Tabs` gains `barOverflow: 'wrap' | 'scroll'`. Unset, it wraps as before. `scroll` adds `cmsc-pb-tabs--scroll` and keeps the bar in one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The roles and the keyboard model are unchanged. A tab chosen with the pointer is scrolled into the bar's view. The tab focus ring (`.cmsc-pb-tabs__tab:focus-visible`), lost in an earlier stylesheet edit, is restored.
  - **Column distribution.** `cms.Column` gains `distribute`: `'start'` (the default), `'center'`, `'end'`, `'space-between'` or `'last-to-bottom'`. It is written as `data-pb-distribute`. The column's published block slot now carries the class `cmsc-pb-column-stack`.
  - **Block order per breakpoint.** `withHideOn` offers `stackOrder`: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. The field appears only when the block's parent is in the new `BLOCK_ORDER_PARENTS` export (`['cms.Column']`), through a `resolveFields` it now adds to every wrapped block, so no block's static fields change. The value is written on the wrapper as `data-pb-order` and `--pb-order(-md|-lg)`, and the stylesheet reads it as the CSS `order`. Only the visual order changes: the DOM and focus order stay the stored order. `STACK_ORDER_VALUES` and the `StackOrder` type are exported.

  The `cms`, `catalog`, `blog` and `newsletter` bundles carry the English and Polish labels.

- 0e33ca9: Product cards in listings can take an image box colour and a divider, a rich-text "read more" can open with a bare chevron, and buttons can span the full width per breakpoint.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Card image box and divider.** `catalog.ProductGrid` and `catalog.ProductSlider` gain `cardImageBackground` (a brand colour token or a hex value), `cardDivider` (`'none' | 'line'`) and `cardDividerColor`, which is shown only for a line. A colour is written as the image box's inline background. A line adds `cmsc-pb-product-card--divider`, a 1 px bottom border in the chosen colour or the neutral border colour; a showcase card also gets 16 px of padding above the line.
  - **Read more as a chevron.** The rich-text `readMore` node gains `summaryStyle` (`'text' | 'chevron'`, `'text'` by default). `chevron` adds the class `cmsc-read-more--chevron` to the `<details>`, the same through the DOM-free serializer and TipTap's, and is parsed back from it. The sanitiser is unchanged. The stylesheet turns the summary into a 44 px chevron control: its text stays as the accessible name, out of view. The rich-text toolbar gains **Read more as a chevron**.
  - **Full-width buttons per breakpoint.** `cms.Button` gains `fullWidth` (`'auto' | 'full'`, or one per breakpoint), a top-level prop on the Responsive tab. `cms.Hero`, `cms.MediaText`, `cms.CtaCard`, `cms.BackgroundPanel` and `cms.CarouselSplit` gain the block-level `buttonsFullWidth`, which stacks their buttons at the full width; `ButtonSpec` is unchanged. Both are listed in `responsiveFields`. The phone's width writes `cmsc-btn--full` on a button or `cmsc-btn-list--full` on a list; a larger breakpoint whose width differs adds a `--md-*` or `--lg-*` class.

  The `cms` and `catalog` bundles carry the English and Polish field labels.

- 0e33ca9: Carousels can stop at their ends instead of wrapping around, carousel image captions and link tile texts can change colour on hover, and a responsive value saved without a mobile value now applies from the breakpoint that has one.

  Nothing changes for a block that does not use the new options: no option is in any `defaultProps`, and the default markup and look are the ones the blocks had.

  - **Carousel ends.** `loop` (`boolean`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. Unset or `true` keeps today's wrap-around: the previous arrow on the first page goes to the last page, and the next arrow on the last page back to the first. With `false`, `CarouselShell` stops at the first and last page. The arrow at an end gets the native `disabled` attribute and keeps its name, so a screen reader announces it as unavailable. On the first page the previous arrow is already disabled in the server HTML. The arrows follow the scroll position. An arrow disabled while it has focus passes the focus to the other arrow. Autoplay stops on the last page.
  - **Disabled arrow look.** `controls.disabledArrowLook` (`'dim' | 'outline-light' | 'color'`) and `controls.disabledArrowColor` (a brand colour token or a hex value). `dim` is the default (`opacity: 0.4`). The other two looks set the root class `cmsc-pb-carousel--arrow-off-light` or `--arrow-off-color` (with `--pb-arrow-off-color`), and only a carousel that does not loop gets one.
  - **Hover colours.** `cms.CarouselImage.captionHoverColor` and `cms.LinkTile.titleHoverColor` / `labelHoverColor` take a brand colour token or a hex value. The colour applies on hover and on keyboard focus, with a 0.2 s colour transition, or none under reduced motion. Only an item given a colour gets the class (`cmsc-pb-carousel-image--hover-caption`, `cmsc-pb-link-tile--hover-title`, `--hover-label`) and the custom property.
  - **Responsive values without `base`.** `isResponsiveProp` now also accepts an object that holds only `tablet` and/or `desktop`. `normalizeResponsive` gives such a value the caller's fallback as its base, so the breakpoints below the first one with a value render as unset. Before, the whole value was read as unset. The editor's scoped field readers, `ResponsiveRatioControl` and the hand-rolled readers in `cms.Button`, block alignment and `cms.FeatureList` read it the same way. An object with any other key is still a plain value.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- 0e33ca9: The Carousel's filter bar gains an underlined-tabs style and an alignment, the controls below a carousel gain an alignment per breakpoint and the next arrow a style of its own, and carousel images and link tiles gain a text size and font, with a label style for link tiles.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Filter bar style and alignment.** The Carousel's `filter` gains `style: 'pills' | 'underline'` and `align: 'start' | 'center' | 'end'`. `carouselFilterFromProps` passes both through, `CarouselFilterBar` takes `variant` and `align`, and the new `filterBarClassName` writes `cmsc-pb-carousel__filter--underline` and `--align-center|end`. Both looks are the same `toolbar` of `aria-pressed` buttons with a single tab stop.
  - **Controls alignment.** `controlsAlign` (`'center' | 'start' | 'end' | 'between' | 'split'`, or one per breakpoint) is a top-level, responsive prop on the Responsive tab of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. `CarouselShell` takes `controlsAlign` and writes root classes `cmsc-pb-carousel--ctl-<value>` and `--ctl-md|lg-<value>` only where the value changes. `split` puts the previous and next arrows at the two ends of the row with the dots centred between them. The DOM order of the controls does not change.
  - **The next arrow's own style.** `controls.nextArrowVariant` (`'same' | 'default' | 'outline' | 'solid'`) maps to `CarouselShell`'s `nextArrowVariant`, a root class `cmsc-pb-carousel--next-arrow-<variant>`. Both arrows keep their markup; shape, size and colour stay shared.
  - **Carousel caption typography.** `cms.CarouselImage` gains `captionSize` and `captionSizePx` (a type token or Custom px, per breakpoint, on the Responsive tab) and `captionFont` (`'default' | 'heading' | 'body'`). A chosen size or font wraps the caption's text in `cmsc-pb-carousel-image__caption-text`.
  - **Link tile typography and label style.** `cms.LinkTile` gains `titleSize`/`titleSizePx`/`titleFont`, `labelSize`/`labelSizePx`/`labelFont` and `labelStyle` (`'link' | 'button' | 'none'`). A button label is a `span` carrying the primary button's classes (`cmsc-pb-link-tile__button`) inside the tile's single link.
  - **Shared helper.** The new `components/item-text` module exports `ItemText`, `itemFontField` and `itemFontFamily`.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- 0e33ca9: More layout and typography choices on existing page-builder blocks; with none of them chosen, every block renders as before.

  - `cms.Hero` gains `order`, a list of its elements (eyebrow, title, subheading, statement, text, buttons, social proof) rendered in that order, with the unlisted ones following in the default order, and `mediaWidth: 'content' | 'viewport'`, which lets image or video media reach the window's edges while the texts stay in the hero. Buttons or the social proof placed before another element keep a 20 px space below them.
  - `cms.Accordion` gains `titleLevel` (`none`, `h2`–`h6`: the trigger button inside that heading) and `titleSize` / `titleSizePx` (a type-scale token or Custom px, per breakpoint). Unset, the triggers are bare buttons with today's title.
  - `cms.Text`, `cms.Statement` and `cms.RichContent` gain `textMaxWidth` / `textMaxWidthPx`: a narrow, medium or wide measure or a Custom px per breakpoint, which follows the text's alignment. Unset, the text spans its column.
  - `catalog.ProductGrid` and `catalog.ProductSlider` gain `cardTextLine` (`default`, `summary`, `sku`, `none`), the one line under each card's name; `default` keeps the card style's own (the SKU, or the summary on the showcase card). `CmsProductCardView` accepts `textLine`.
  - The dark scheme's decorative backdrop is documented and tested as an animated SVG: each Section paints its own copy, and reduced motion is the SVG's own media query.

  `@endora-commerce/mod-cms` and `@endora-commerce/mod-catalog` add the field labels in English and Polish; in the page editor, a list whose item is a single choice is summarised by that choice's translated label.

- 0e33ca9: The tab size can differ per breakpoint, carousel arrows can be drawn arrows, inline rich text can hold an icon, and rich-text headings follow the brand type scale.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Tab size per breakpoint.** `cms.Tabs` gains `tabSize` (`'s' | 'm' | 'l'`, or one per breakpoint), a top-level prop on the Responsive tab, listed in the block's `responsiveFields`. It replaces the `size` key of `tabStyle` in the editor. A size stored in `tabStyle.size` still applies, and the editor's `resolveData` moves it to `tabSize` (`tabSizeMoved`). The phone's size writes the existing `cmsc-pb-tabs--size-s|l` class; a larger breakpoint whose size differs adds `cmsc-pb-tabs--size-md-*` or `cmsc-pb-tabs--size-lg-*`.
  - **Arrow icon.** `controls.arrowIcon` (`'chevron' | 'arrow'`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, and the `CarouselShell` prop `arrowIcon`. `arrow` draws the icon catalog's arrows as inline SVG hidden from assistive technology; the chevron glyphs stay the default.
  - **Inline icon.** `InlineRichText` accepts an `inlineIcon` node (`{type: 'inlineIcon', attrs: {name}}`, the name matching `INLINE_ICON_NAME_RE`), an icon of the page builder's catalog. `InlineRich` renders it as `1em` inline SVG with `aria-hidden`; an unknown name renders nothing. `inlineRichTextToPlain` drops it. The inline rich-text field gains an **Insert icon** button. `inlineIconNode` (in `rich-content-shared`) serializes it as an empty `span.cmsc-inline-icon[data-cms-icon]`, the same through the DOM-free serializer and TipTap's. Page translation carries it as one atomic tag.
  - **Rich-text headings follow the type scale.** For each heading level `h1`–`h6` whose type style is set, `brandTokensToCss` writes one rule giving the headings inside rich text (`cms.RichContent` and the blocks' rich bodies) that level's size, line height, weight and letter spacing. With no brand tokens it writes nothing.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels. The `blocks.tabs.fields.tabStyle.fields.size` keys are replaced by `blocks.tabs.fields.tabSize`.

- 0e33ca9: Block headings and item texts gain a weight, block headings and the hero title gain a maximum width per breakpoint, the controls below a carousel can line up with its first slide, and carousels and product cards now use the brand body font.

  Nothing changes for a block that does not use them: no option is in any `defaultProps`, and the default markup and look are the ones the blocks had.

  - **Brand body font on carousels and product cards.** `.cmsc-pb-carousel` and `.cmsc-pb-product-card` join the zero-specificity group that sets `font-family: var(--cmsb-font-body, inherit)`. The filter bar, the header lead, the controls and the card texts used to keep the storefront's font next to brand-font headings. With no brand font set they inherit the page's font, as before.
  - **Text weight.** `headingWeight` (`'default' | 300 | 400 | 500 | 600 | 700 | 800`) on every block whose heading is a `BlockHeading` with a size: `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.LinkList`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, and the carousel header of `cms.ContentSlider`, `catalog.ProductGrid`, `catalog.ProductSlider` and `blog.LatestPosts`. `cms.Hero` gains `titleWeight`, and `cms.FeatureList` gains `titleWeight` for its item titles. Item texts gain `cms.CarouselImage.captionWeight` and `cms.LinkTile.titleWeight`/`labelWeight`, as a property of the `ItemText` span. The product listings gain `cardTitleWeight`, which becomes `CmsProductCardView`'s new `nameWeight`. The new `textWeightField` and `textWeightCss` helpers are in `components/typography`.
  - **Heading measure.** `headingMaxWidth`/`headingMaxWidthPx` (a named measure or Custom px, per breakpoint, on the Responsive tab and in `responsiveFields`) on the same blocks except `cms.Statement`, whose `textMaxWidth` already holds its heading. `cms.Hero` gains `titleMaxWidth`/`titleMaxWidthPx`. `BlockHeading` takes `weight`, `maxWidth`, `maxWidthPx` and `align`. A held heading in a centred block stays centred (`data-align`). `section-parts` exports `blockHeadingStyleFields`, `blockHeadingStyle` and `isUnusedHeadingMaxWidthPx`.
  - **Controls aligned to the first slide.** `controlsAlignTo` (`'container' | 'slide'`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. It maps to `CarouselShell`'s `controlsAlignTo` and the root class `cmsc-pb-carousel--ctl-to-slide`. The rows below the track then take one slide's width, so with a bleeding track the controls end where the first slide ends.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- bdef54c: The product editor's SEO tab ends with a new admin zone, `product.editor.seo.after` (props: the product id). `seo` contributes the link to its meta-tag editor there, shown while `seo` is on and the admin holds `catalog:write`; `catalog` no longer names `seo`. The tab's former "Page title (preview)" input, which saved nothing, is gone.
- 3f697a3: The assistant's product mutation tools take at most `PROMPT_PRODUCT_IDS_MAX` (10 000, the bulk product route's cap) product ids: `AssignProductsToCategoryParamsSchema`, `RemoveProductsFromCategoryParamsSchema`, `SetProductStatusParamsSchema`, `SetProductsVisibilityParamsSchema`, `ArchiveProductsParamsSchema` and `RestoreProductsParamsSchema` refuse a longer `productIds`. `PROMPT_PRODUCT_IDS_MAX` is exported. Catalog's tools treat a repeated id as one product, so its preview no longer answers 404 and it is written once; a per-product failure reported to the assistant names only an `HttpError`'s message, `failed` otherwise.
- 3ccf23b: Carousel controls gain scheme-aware dots, an arrow glyph colour, per-breakpoint visibility and a place inside split slides.

  Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

  - **Dots.** The dots of the Carousel, the product slider and the latest posts carousel follow the colour scheme: in a dark scheme the current dot is the scheme's text colour over faint dots (before, both were fixed greys and the current dot was hard to tell apart).
  - **Solid arrows.** `controls.arrowGlyphColor` sets the icon colour of a solid arrow (white by default), so a white solid arrow can carry a dark icon.
  - **Per breakpoint.** `controls.hideArrowsOn` and `controls.hideDotsOn` (the "Hide on" control: mobile, tablet, desktop) hide the arrows or the dots at those widths; a row of controls left empty there is removed.
  - **Header without a heading.** Arrows placed in the header of a carousel with no heading now stand at the header's end, as they do beside a heading (before, at its start).
  - **Inside split slides.** The Carousel's `controlsPlacement` accepts `slide`: each split slide draws the arrows and dots at the end of its text column, and only the slide on screen has operable controls. A carousel of other items keeps its controls below the slides there. `CarouselSlideControls` is exported for blocks that want to draw them.
  - **Markup.** A new root custom property (`--pb-arrow-glyph`) and classes (`cmsc-pb-carousel--arrows-off-*`, `--dots-off-*`, `cmsc-pb-carousel__controls--slide`, `--slide-fallback`); the editor fields carry English and Polish labels.

- 3ccf23b: The button below a product grid or product slider can be centred or aligned right.

  `catalog.ProductGrid` and `catalog.ProductSlider` take `footerButtonAlign` (`start`, `center` or `end`, labelled Left, Center and Right), offered once the footer button has a label. Unset, the button stays at the start as before; the other values add `cmsc-pb-product-listing__footer--center` or `--end`.

- 3ccf23b: Carousel controls: the dots at the start with the arrows at the end, an aligned row inside split slides, and arrows that stay when every slide fits.

  Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

  - **Dots at the start, arrows at the end.** `controlsAlign` accepts `dots-start` per breakpoint (root `cmsc-pb-carousel--ctl(-md|-lg)-dots-start`) on the Carousel, the product slider and the latest posts carousel. The markup and its reading order are unchanged; the stylesheet moves the dots row first.
  - **Inside split slides.** A chosen `controlsAlign` now also aligns the controls drawn inside a split slide (`cmsc-pb-carousel__controls--al-*`, every breakpoint written). Unset, that row keeps its start alignment.
  - **Arrows when everything fits.** `controls.arrowsWhenFit` keeps the controls when every slide is already on screen: both arrows disabled (taking the disabled arrow look, on a looping carousel too) and the dots hidden with their space kept. Off, the controls hide as before. `CarouselShell` takes `keepArrowsWhenFit`.
  - The editor fields carry English and Polish labels.

- 3ccf23b: The product listings' header lead look.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Product grid and product slider.** `leadSize` / `leadSizePx` (per breakpoint), `leadWeight` and `leadColor` for the header's lead, as the latest posts block's lead.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Line heights, weights, sizes and spacing for the call-to-action card, stats, media and text, rich content, carousel headers, the link list, latest posts and the testimonial.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Call-to-action card.** `headingSpace` (a spacing step) sets the space below the heading. `bodyWeight` and `textMaxWidth` / `textMaxWidthPx` (per breakpoint) style the text.
  - **Stats.** `valueLineHeight` (per breakpoint, with a Custom value size).
  - **Media and text.** `featureBodySize` / `featureBodySizePx` (per breakpoint) and `featureBodyWeight` for every feature item's text.
  - **Rich content.** `textWeight`.
  - **Carousel headers.** `headingLineHeight` (per breakpoint, with a Custom heading size) on the carousel, the product slider and grid, and latest posts.
  - **Link list.** `titleLineHeight` (per breakpoint, with a Custom title size) for the row titles.
  - **Latest posts.** `leadWeight` for the header's lead.
  - **Testimonial.** `quoteSize` / `quoteSizePx` (per breakpoint).
  - The editor fields carry English and Polish labels.

- 4cb0a7d: Product data scopes — checkpoint C/E/Q review fixes.

  - **Platform:** new `withSystemScopeActingFor(adminUserId, reason, fn)` in `@endora-commerce/platform/tenancy` — a worker's system scope acting for the admin who queued the work, so its Commands are audited with that admin.
  - **Catalog — audit:** a queued bulk Archive / Restore and a queued bulk scoped-status edit audit each product with the admin who requested the operation (it was a null actor). The API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` of an existing product is now the audited `product.update` Command, its entry naming the key (`apiKeyId` in the after-state); it is still never checked by the completeness gate.
  - **Catalog — Archive / Restore** lock the product row, so a concurrent single and bulk Archive transition the product once: one audit entry, one `product.archived.v1`.
  - **Catalog:** a composition that cannot build the completeness gate logs one warning instead of running unchecked silently.
  - **SEO:** the cached sitemaps are marked stale on a change of the global status, archive, visibility or organization list, and on `product.archived.v1`, as they already were on the scoped values and URL keys.
  - **Behaviour change for API clients (contracts, SEO):** an override's `ogImageUrl` must be an `http(s)` URL or a path starting with a single `/` (`ogImageUrlSchema`); `javascript:`, `data:` and other schemes are refused with `400 VALIDATION_FAILED`. The read shape accepts any stored string.
  - **Contracts:** `effectiveOrderRules` and `effectiveKeys` are documented as applying no availability — a buyer-facing caller filters with `filterAvailable` first.

- f148418: The storefront probes that take a bare product id follow product data scopes per sales channel and language.

  - **Behaviour change for API clients — price and stock probes:** `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId`, `GET /api/v1/storefront/inventory/stock/:id` and both notify-when-available routes (`POST /api/v1/storefront/inventory/notify-when-available`, `POST /api/v1/catalog/products/:id/notify-when-available`) answer only about a product available at the request's channel and language to the caller now. A product that is switched off there, outside its publication window, sold on another channel or outside the channel's audience rule gets each route's existing `404`, the same body an id nobody sells gets; a notify-when-available request for such a product can no longer reach `409 PRODUCT_UNMANAGED_STOCK` or `422 PRODUCT_IN_STOCK`.
  - **Composition:** `price_lists`' plugin options and `inventory`'s plugin options take `catalogAvailability` (`catalogProductAvailabilityPort`), required; `AvailabilityNotificationService` takes it in place of the sales-channel membership port, and `SubscribeInput` gains `languageTag`.
  - **Caching:** `markPersonalisedPricing` now marks every response for an authenticated caller `private, no-store`, not only one naming an organisation; `GET /api/v1/catalog/filters` and `GET /api/v1/catalog/categories` call it, since their counts and tree follow the caller's audience. Anonymous responses stay unstamped.
  - **Product page:** an archived product answers `410` only where it would be available with the archive taken away; otherwise (switched off in that channel or language, outside its window) it answers the absent product's `404`.
  - **Buyer seams name their channel:** `CreateForCustomerOptions.salesChannelId` (and the draft-edit and resubmit options) carry the channel the buyer's route resolved; quick order's pasted-SKU lookup takes it too; the basket asks availability at its own channel. The audience-only answer remains only for callers outside a request.
  - **Helpers:** `@endora-commerce/contracts` exports `toScopeChannel`, `scopeLanguageOf` and `firstLanguageTag`. `BundleService.validateConfiguration` requires its availability filter.

- 4bc5c7f: Every asset reference these modules report is tagged with the `assetId` it points at, and each descriptor answers a batch of assets in one statement (`specs/166-asset-reference-visibility/`). The catalog's category content, CMS content and blog content scans used to run one JSON-path query per asset; each is now one query per batch, walking a document once however many assets are asked. Their references stay unrestricted: they never hide a library file.
- 91dfab5: Linking an existing library file by id refuses a file the administrator may not see in the library exactly as a missing one, and links nothing (`specs/166-asset-reference-visibility/` FR-006). This covers a product's gallery item, attachment and download file (on create), a category's main image, a blog post's and a blog category's main image, and a menu item's asset target and icon. Before, these links made such a file visible to every library reader. A file id that names no file now answers `404 NOT_FOUND` for the product download, the category image and the blog images, where it used to fail with a server error; the menu keeps its `400 MEGAMENU_ASSET_KIND_MISMATCH`.
- 9b3e7f0: The megamenu becomes the storefront's navigation bar (`specs/168-megamenu-navigation-bar/`, issue #522).

  **Breaking** (owner ruling: no backward compatibility for stored menus or the megamenu wire contract):

  - A top-level item is a **tab** and must carry a `presentation` — `link`, `dropdown`, `mega` or `catalog` — and may carry an `alignment` (`start`, `end`); no other item may carry either. `PUT /api/v1/admin/megamenu/menus/:id/items` refuses a tab without one, a tab of kind `asset`, `cms-block-embed` or `category-tree` (`400 MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`), a `link` tab with children or of kind `group` (`400 MEGAMENU_LINK_TAB_INVALID`), and an `external-link`, `button` or `group` with no label (`400 MEGAMENU_LABEL_REQUIRED`).
  - `ResolvedMenuItem.id` and `parentId` are strings, not uuids: a category a `category-tree` expands to has the id `<tree item id>:<category id>`. Tabs carry `presentation` and `alignment`. A `category-tree` never appears in a resolved tree.
  - The migration `20261029T162855_megamenu_navigation_bar` adds `presentation`, `alignment` and `audience` to `megamenu_items` and makes every stored top-level item a start-aligned `mega` tab; nothing else is converted. The Redis prefix moves to `megamenu:v2:`.
  - The storefront header renders the menu's tabs and nothing else: the hard-coded _Wszystkie kategorie_ trigger and Quick Order button are gone, and so is the mobile drawer's Quick Order promo. A deployment that wants them configures them as tabs; the demo menu does.

  Added:

  - `@endora-commerce/contracts`: item kinds `group` (a heading; a column of a `mega` panel) and `category-tree` (`{ rootCategoryId, depth: 1–3 }`); `megamenuPresentationSchema`, `megamenuAlignmentSchema`, `megamenuAudienceSchema`, `MEGAMENU_TAB_KINDS`, `MEGAMENU_LABEL_INHERITING_KINDS`; `CmsPageReadPort.findStorefrontLinks`; `effectiveCustomerGroupId`, moved from `@endora-commerce/mod-price-lists`, which re-exports it.
  - `@endora-commerce/mod-megamenu`: a `category-tree` expands to the catalogue's live categories on every resolution, from one catalogue read; an empty label on a category link, page link or tree inherits the target's name; a page link follows the page's name, slug and parent path per language. Every item has an audience — everyone, guests, signed-in customers, or customers whose effective customer group is one of the chosen ones — and the storefront API answers each visitor only their items, with `Cache-Control: private, no-store` for an identified caller. Every write runs as a Command with one audit entry (`megamenu.*`), and the module joins the Command Bus coverage check. New dependencies on `customer_accounts` and `organizations`, both non-deactivatable. The editor shows a tab's presentation and alignment, offers the kinds a level allows, sets audiences with customer groups, configures category trees, and marks hidden items in the tree.
  - `@endora-commerce/mod-megamenu`: a tab with a link of its own and a panel can follow its link on click (`clickNavigates`, migration `20261029T190956_megamenu_tab_click_navigates`); the storefront renders it as its link plus a separate toggle for the panel. The `catalog` presentation is named _Panel with side list_ in the editor, and its _All in …_ link appears only for a category.
  - `@endora-commerce/mod-cms`: `findStorefrontLinks(ids, { salesChannelId, language, channelDefaultLanguage })` on the page read port — a page's localised name and its URL in the channel's tree for that language.
  - `@endora-commerce/mod-settings`: the cache flush names `megamenu:v2:*`.
  - `@endora-commerce/mod-catalog`: the demo categories carry Polish names.
  - `@endora-commerce/demo-composition`: the demo menu is a _Wszystkie kategorie_ catalogue tab over the demo category tree, and a Quick Order button at the end of the bar.

- bec2e83: Polish error messages are Polish sentences. 137 `errors.*` entries in these modules' `i18n/pl.json`
  bundles were placeholders — the word "Błąd:" followed by the error code lowercased, for example
  "Błąd: product not found." — and a request with `Accept-Language: pl` received them verbatim as
  `error.message`. Each is now a sentence in Polish, for example "Nie znaleziono produktu."

  Error codes, HTTP statuses and the English sentences are unchanged; a client matching on the code
  sees no difference.

- 1a88646: English error messages are English sentences. 137 `errors.*` entries in these modules'
  `i18n/en.json` bundles were the error code in Title Case with a full stop, for example
  "Product Not Found." or "Asset Legacy Locator Cannot Harden.", and a request in English received
  them verbatim as `error.message`. Each is now a sentence in sentence case, for example
  "Product not found." or "This file cannot be made private because it is stored at an address the
  platform did not issue. Upload it again first."

  Two Polish sentences were corrected to match what the code refuses: `CANNOT_MODIFY_SYSTEM_DEFAULT`
  (`mod-sales-channels`) now says the default sales channel can be neither deactivated nor deleted,
  and `MEGAMENU_TARGET_OUT_OF_SCOPE` (`mod-megamenu`) now names a page as well as a category.

  Error codes and HTTP statuses are unchanged; a client matching on the code sees no difference. A
  client that matched on the English message text must match the new sentences.

- 0a816a0: Display mode `none` now withholds every amount on the server (issue #491). Until now it hid prices
  in the storefront only: the API still sent the price, the base, the sale, the list price and every
  tier — a buyer's own included — so a shop configured to show prices only after sign-in
  (`pricing.unauthenticated_display_mode = none`) disclosed them to anyone reading the network tab.

  - **`@endora-commerce/mod-price-lists`.** Where the viewer's display mode resolves to `none`,
    `resolveListingPriceDetails` answers `price: { source: 'none' }`, `basePrice` and `salePrice`
    `null`, no `listPrice` and every `tiers` entry `null`; `resolveListingPrices` answers the `none`
    arm; `resolveEngine` names no book, bracket, sale, source or compare-at. `displayMode: 'none'`
    stays, so the storefront still renders "price on request". The catalogue listing, product page,
    home cards, search hits and suggestions, comparisons, product links and
    `GET /api/v1/storefront/products/:id/resolved-price` therefore send no amount. A line
    (`resolveLinePrices`) keeps its amount beside the mode — it is the charging path, which the cart,
    the admin order preview and order intake refuse as quote-only.
  - **Price sort and range.** A product whose own display-mode step (its override, else its
    category's) is `none` is left out of the price surface: a price-sorted listing shows it after the
    priced products, in both directions, and a price range leaves it out. This replaces spec 086's
    clarification 2, under which such a product kept its position in the order. A product or
    category display-mode override now marks the products it concerns for the surface worker, so the
    order follows it at the worker's turnaround, like a price change. `PriceListService` gains
    `anyProductStepWithholds()`; `BookPricingDeps` gains the optional `anyProductStepWithholds`.
  - **`@endora-commerce/contracts`.** New `displayModeWithholdsAmounts(mode)`, the one statement of
    the rule for a consumer that publishes a line amount. The documentation of
    `productResolvedPriceSchema`, `resolvedPriceEngineSchema`, `ListingPrice`, `ListingPriceDetail`
    and `LinePriceResult` says what each carries under `none`; no shape changes.
  - **`@endora-commerce/mod-catalog`.** The external catalogue API (`/api/v1/external/catalog/*`)
    withholds a bound key's price, tier ladder and bulk price for a product whose display mode is
    `none` for the bound Organization: `price: null` with `priceUnavailable: true`, no `priceTiers`
    rung, and `reason: 'price_unavailable'` in a bulk answer.

  **Behaviour change for API consumers.** A client that read amounts under `displayMode: 'none'` —
  none should have — now reads `null`. Product feeds are unchanged: a feed publishes deliberately.

- bd7968e: Every sidebar screen of these eight modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords. Each action carries the permission code of the screen it opens, so the palette never offers a screen the operator is refused.

  - `@endora-commerce/mod-catalog` declares `open-attribute-sets`, `open-attachment-types` and `open-bulk-operations` (`catalog:read`).
  - `@endora-commerce/mod-crm` declares `open-crm-tags` and `open-crm-workflow` (`crm:configure`).
  - `@endora-commerce/mod-inventory` declares `open-warehouses`, `open-low-stock` and `open-stock-notifications` (`inventory:read`), and `import-stock` (`inventory:write`).
  - `@endora-commerce/mod-newsletter` declares `open-newsletter-tags` and `open-newsletter-blocks` (`newsletter:read`), and `open-newsletter-provider` (`newsletter:write`).
  - `@endora-commerce/mod-orders` declares `new-order` for the order-entry form (`orders:write`).
  - `@endora-commerce/mod-projects` declares `open-project-roles` and `open-project-loss-reasons` (`projects:configure`).
  - `@endora-commerce/mod-promotions` declares `open-promotion-rules` (`promotions:read`).
  - `@endora-commerce/mod-settings` declares `open-setting-groups` (`settings:read`) and `clear-cache` (`settings:write`).

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- c72a83e: A bulk operation's log trail is readable in each administrator's language.

  - `@endora-commerce/contracts`: `bulkOperationLogEntrySchema` gains an optional `messageKey`
    (`{ key, params? }`, a key in `catalog`'s bundle and the values that fill it) beside
    `message`, which stays the finished English sentence.
  - `mod-catalog`: new log entries store `messageKey` and an English `message` where they stored
    a Polish sentence; the bulk-operations detail screen draws the key in the reader's language
    and falls back to `message` — so entries written before this release still show as they
    did. A Polish reader sees the same sentences as before. New bundle keys:
    `bulkOperations.log.*`.

- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [24ef6aa]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [c99b4cd]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [55864a1]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/mod-custom-fields@0.109.0

## 0.108.0

### Minor Changes

- 0bd5a2b: Products carry a minimum order quantity and a **Returnable** flag; packaging units carry a minimum number of units.

  - **Upgrade note (FR-034): every existing product becomes not returnable for new orders.** The new `products.returnable` column defaults to `false`, so lines of orders placed after the upgrade are not returnable until their products are marked. Mark them in bulk: select the products on the product list and use **Bulk edit → Returnable → Yes — returnable**. Orders placed before the upgrade are unaffected — their lines carry no recorded value and stay returnable.
  - **Behaviour change for API clients.** `POST`/`PATCH /api/v1/admin/catalog/products[/:id]` accept `minOrderQuantity` (integer 1–1 000 000, or `null` to clear) and `returnable`; the admin product response carries both. `minOrderQuantity` on a `grouped`, `bundle` or `virtual` product is refused with `422 VALIDATION_FAILED`; a value outside the range with `400`. `POST /api/v1/admin/catalog/products/bulk-update` accepts `returnable` and writes one audit entry per product it changes. Packaging-unit create/update accept `minOrderUnits` (same range), and the response always carries it; the in-process `CatalogPackagingPort` accepts the same optional field.
  - **Storefront reads:** product detail and product list summaries carry `minOrderQuantity` (`null` when none or when the type takes no minimum); the product detail's `packagingUnits[]` carry `minOrderUnits`.
  - **Read port:** `CatalogProductReadPort` records gain `minOrderQuantity`, `returnable` and `minOrderUnits`, and the port gains `listPackagingUnitsByProductIds(productIds)`. **Implementers of typed `CatalogProductReadPort` stubs must add it**, and its callers must pass only product ids they have already vetted for visibility.
  - **Duplicate** does not copy either rule: the copy starts with no minimum and not returnable.
  - The admin product editor gains an **Order rules** card (Inventory tab), the packaging-unit editor a **Minimum (units)** column, and the bulk edit a **Returnable** section. The card is built from the admin kit's `Checkbox`, `Input` and `Button`; a refused unit minimum stays marked invalid (`aria-invalid`, with its message) until its value changes, even across another save on the editor. New error sentences in both bundles for `PRODUCT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` and `PACKAGING_UNIT_MISMATCH`.
  - Migration `20261016T082008_catalog_order_rules.ts` adds `products.min_order_quantity`, `products.returnable` and `product_packaging_units.min_order_units`.

- 14bcf1d: A product has no price of its own any more (feature 160, FR-042, FR-043): prices are rows of price books.

  - **Removed, not converted.** Migration `20261022T111811_catalog_price_fields_removed` drops `product_variants.price_override` and strips the `defaultPrice` and `price` keys from `products.attribute_values`. The `ProductVariant.priceOverride` property and the `priceOverride` field of the variant DTOs, the admin variant read and `CatalogProductVariantRecord` are gone.
  - **Refused.** `POST`/`PATCH /api/v1/admin/catalog/products[/:id]` naming `attributeValues.defaultPrice` or `attributeValues.price` (or either at the top level), and `POST`/`PATCH …/products/:productId/variants[/:variantId]` naming `priceOverride`, answer `400 PRICE_SET_IN_PRICE_BOOKS` and write nothing. Old: `PATCH …/products/:id` with `{ attributeValues: { defaultPrice: 49.99 } }`, or a variant with `{ priceOverride: 49.99 }`. New: `PUT /api/v1/admin/price-books/base-prices/:productId` with the product's tiers and its variants' rows, per currency.
  - **Admin.** The product editor's _Default unit price_ field and the variant table's _Price override_ column and field are removed; the attribute-set swap no longer keeps a `defaultPrice` key.
  - **Listing.** Price sort and the price range read the price surface; the unpriced tail has no `defaultPrice` arm. Listings, product detail, product links and the external catalogue API pass variants to the pricing port and render the source, compare-at and "from" prices.
  - **Demo.** The catalogue demo writes no `defaultPrice`; `price_lists`' demo step prices the demo products (_Screws 0200_ at 100 PLN).

- 301a69f: An admin read of a product's variants (feature 161, Checkpoint 5 review).

  - **`GET /api/v1/admin/catalog/products/:productId/variants`** (`catalog:read`): every variant of the product by SKU, serialized as the variant writes answer them (`id`, `parentProductId`, `sku`, `variantAttributeValues`, `stockLevel`, `createdAt`, `updatedAt`), whatever the product's status, sales channels or audience; an unknown or deleted product is `404`. `CatalogAdminService.listVariants(productId)` is new. The storefront's `GET /api/v1/catalog/products/:id`, which answers an inactive product `410` and an out-of-channel one `404`, is unchanged.
  - **Contracts:** `adminProductVariantSchema`, `adminProductVariantsResponseSchema` and their types.
  - **The price-book grid** expands a product line through this read (the action is absent without `catalog:read`).

- af57b55: Feature 161 (G14, G15) on the catalogue.

  - **List price on the cards and the product page (G14).** `GET /api/v1/catalog/products` and `GET /api/v1/catalog/products/:idOrSlug` carry `resolvedPrice.listPrice: { amount, currency }` when the pricing engine answers one (`pricing.show_list_price` on and the channel's everyone price above the buyer's). Absent otherwise; nothing else in the summary changes.
  - **Stored admin name and search keys (G15, `specs/161-price-book-editor/research.md` R14).** Migration `20261022T182523_catalog_admin_name_keys` adds `create extension if not exists pg_trgm`, the IMMUTABLE SQL functions `catalog_admin_fold`, `catalog_admin_display_name` and `catalog_admin_name_key`, the generated stored columns `products.admin_name_key_en|pl` (collation `"C"`) and `admin_search_key_en|pl`, the btree `products_admin_order_en|pl` and the GIN trigram indexes `products_admin_search_en|pl_trgm` and `product_variants_sku_lower_trgm`. Postgres maintains the columns on every write; `Product` maps them read-only (`adminNameKeyEn`, `adminNameKeyPl`, `adminSearchKeyEn`, `adminSearchKeyPl`: generated, lazy, hidden). The migration rewrites `products` (seconds at 50 000 rows).
  - **`CatalogProductReadService.pageProductsByAdminName({ membership, language, search?, offset, limit, withTotal? })` (G15)** — one page of the products a caller's membership subquery names, by the stored key of the admin language (`en`, `pl`; others read `en`), then SKU, then id, with the total; `search` matches the folded shown name, the SKU or a variant's SKU, literally. One statement without a search, two with one. **Replaces `pageProductIdsByName`**, which is removed. Old: `pageProductIdsByName({ ids, search, language, offset, limit })` → `{ ids, total }`. New: `pageProductsByAdminName({ membership: { sql, params }, search, language, offset, limit })` → `{ ids, total }` (`total` is `null` with `withTotal: false`). The constructor takes an optional `{ sparseSearchLimit }` (default 2 000).

- d2d3d9a: Catalogue reads are priced once and on the customer's own group (D-287 P0).

  - **`ProductSummary.resolvedPrice`** (`basePrice`, `salePrice`, `displayMode`) is emitted on every listing card and on the product detail, from the same resolution as `price` — `CatalogQueryService` now prices through `ListingPriceDetailPort.resolveListingPriceDetails` (its fifth constructor argument is typed `ListingPriceDetailPort`). The product page no longer needs `GET /storefront/products/:id/resolved-price`. `null` where the channel withholds prices.
  - **Customer group.** Listing, product detail and product-link prices pass the signed-in customer's `customerAccountId`, so a customer whose own group overrides their organization's is priced on it — a behaviour change for such customers.
  - **External catalogue API.** `CatalogOrgPriceDecorator` prices summaries, bulk lines and the tier ladder with one `resolveLinePrices` call each, instead of one `resolveLinePrice` per summary, line and rung; its `pricingService` dependency (and `CatalogModuleOptions['pricingService']`) is now `OrgLinePricePort & LinePricesPort & …`.

### Patch Changes

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

- e358ccb: Documentation only (feature 160): the module pages follow the targeted refresh of the price surface and the pinned-feed rules of 2026-10-23.

  - `price_lists` — _Pricing for developers_ describes the two kinds of mark (a (profile, product) mark in `price_profile_stale_products`, a whole-profile mark), what each write marks, the worker's pass, `namedListPublishability` and the reference a pinned book's percentages are taken off, and the unpriced shape of `resolved-price`; _Price books_ says how soon a price change shows in a price-sorted listing — within a minute for a targeted change, within five minutes at about 200 profiles for a catalogue-wide one (SC-005, owner ruling 2026-10-24) — and that a list a feed was pinned to is retired, not deleted, by the upgrade. The demo is loaded with `demo seed`, not `demo reset`.
  - `product_feeds` — a pinned price book publishes only while it is active or scheduled within its dates, on the feed's channel and for everyone; the feed page warns otherwise, and a run ends `withdrawn` and withdraws the published file (not a failure: no notification, no delivery; the old file stays downloadable from its run). A feed is pinned through the admin API (issue #414).
  - `catalog` — product, category and attribute events mark on the price surface the products they concern. No code changes.

- 6865b14: Pricing strings (feature 160): the product editor's _Pricing_ tab label is translated (`productEditor.tab.pricing`, _Ceny_ in Polish); `price_lists`' Polish hint names the attribute flag _Reguły cennika_, as the catalogue's attribute screen does; a comment on the cart read's pricing chain no longer describes a product price of its own.
- a2cfed7: A price-sorted listing with no price surface built yet pages to its end.

  While no price order exists for the viewer (right after the 0.108.0 upgrade, on a new channel, before the surface worker has run), `sort=price` is served in the default order. That fallback dropped the cursor too, so every page was page 1 with `hasMore: true` and an infinite scroll never ended. The fallback now returns the default listing's cursor wrapped in the price cursor, and a later page honours it: the walk meets every product once and ends, also when the surface is built in the middle of it.

- 0194c0c: A price-sorted listing walk whose price order goes missing midway (its price surface retired or being rebuilt) no longer starts again at the default listing's first page, which showed the buyer products already served. It carries on from the last price it served: the products still to come — those whose live price sorts after it in the walk's direction, then the unpriced ones — in the default order, to the end, so nothing already served is served again from the start. A product whose price changes during the walk may still be met twice or not at all, as on any walk over a live price; every other product is met exactly once. A page that loses the order between two chunks ends with the products it collected. The listing's response shape does not change.
- 528aec6: A price-sorted listing page on a cursor of a walk begun in the default order (no price order existed) is handed to the default listing before anything else is read: it no longer resolves the viewer's pricing context, the category tree or the search's attribute keys only to discard them, and issues exactly the statements the default listing's page does.
- 5001ba1: A malformed cursor on a price-sorted product listing — a price that is not a four-place decimal, an id that is not a uuid, a date that does not parse — is discarded and the listing answers its first page, as the default listing does with a cursor it cannot read, instead of failing with a 500. A default-listing cursor naming an id that is not a uuid is discarded the same way.
- 84f4165: A price range (`minPrice`, `maxPrice`) on the product listing selects the same products under every sort. The bounds are read once, exactly — a minimum rounded up and a maximum rounded down to the four places a price has — and compared as decimals on every path; the price-sorted path rounded them with `toFixed(4)` and the other sorts compared binary numbers, so `minPrice=9.04504` kept a product at 9.0450 when sorted by price and dropped it otherwise. It is now dropped on both.
- 2b9689b: A price-sorted or price-filtered listing page builds the viewer's pricing context (including the organization lookup) and reads the category tree once per page, instead of once per chunk it scans — up to eight times on a page that skips many products.
- 0ef7316: The catalogue and pricing documentation now state what a price-sorted walk guarantees: every product whose price does not change during the walk is met exactly once, including when the price order goes missing midway; a product repriced meanwhile may be met twice or not at all, as with any cursor over a live price. They no longer claim that nothing is ever repeated or lost, and they say that a page may be short or empty and still have more after it.
- ceeab70: A price-sorted or price-filtered product listing page that runs out of its scan budget (it reads at most eight times the page size of rows) no longer ends the walk and loses the products after it: it answers `hasMore: true` with a cursor that continues from where its scan stopped. Such a page can be short, or empty where every row it read was hidden from the viewer or already served; the walk still reaches the end, since every page moves the scan forward.
- 456b948: The remainder of a price-sorted walk whose price order went missing no longer drops every product on a sales channel that publishes no prices: the walk decides on the viewer's own price whether or not the channel shows it, unpriced products are served as before, and the cards still show no price on such a channel.
- eda7da8: Storefront product reads show a product's per-sales-channel value overrides.

  - **Behaviour change for API clients — channel overrides are now visible on the storefront.** `GET /api/v1/catalog/products/:idOrSlug` (name, description, `seo`, `structuredDataJsonLd`, `attributeValues`, `visibleAttributes`, grouped children and bundle options) and every `GET /api/v1/catalog/products` card name now return the override written in the product scope editor for the request's sales channel and language. The resolver's override slots are walked over the storefront's own baseline language order — the `Accept-Language` language, the channel's default language, `en-US`, `en`, the first stored language — taking the (channel, language) override at each language until the baseline has text for one, so an override never replaces baseline text of an earlier language in that order; the channel-only slot is asked last. Product-link tiles (in the product page's `links` and `GET /api/v1/catalog/products/:idOrSlug/links`) show overrides too, walked over their own pick, which has no channel-default leg. Channel-scoped user attributes return their channel override. A product without an override for that channel answers exactly as before.
  - Override rows are read for the request's sales channel only, once per read section, never per card.
  - **Search result cards show the same name.** Every card of the Meilisearch-served listing (`GET /api/v1/catalog/products?q=…` and `GET /api/v1/search/suggest`) now shows the name the catalogue's listing card shows for the request's sales channel and language, rather than the baseline text. The indexed name is still what the index ranks and sorts by. The request channel's override rows are read once per results page.
  - `@endora-commerce/contracts` exports the slot choice both modules share (`overrideLanguages`, `channelOverrideFor`, `effectiveSystemText`, `StorefrontOverrideContext`) and the resolver's `isNonEmpty` presence test the walk reuses, and `CatalogProductReadPort.listValueOverridesByProductIds` takes an optional `{ channelId }` that narrows the read to one sales channel's rows. Existing callers and implementations are unaffected.

- 359ee2b: `CatalogProductReadPort` answers products the way pricing resolves them, without building a record of each (issue #416).

  - **New, required on every implementation of the port:** `listPricingRefs()` and `findPricingRefsByIds(ids)`, answering `CatalogProductPricingRef` (`{ id, attributeValues }`, exported from `@endora-commerce/contracts`). `listPricingRefs()` answers the products `listAll()` answers, ordered by id; `findPricingRefsByIds(ids)` answers the ones `findByIds(ids)` answers. Soft-deleted and inactive products are included in both. An implementation outside this repository has to add both methods. It can map `listAll()` and `findByIds()` to `{ id, attributeValues }`.
  - `@endora-commerce/mod-catalog` answers each with one statement and no entity hydration. The price surface's worker reads the catalogue at the start of every whole build. On a 50 000-product catalogue, `listAll()` took 3.8 s for that, most of it hydrating `Product` entities whose fields the build does not use.

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [1846a38]
- Updated dependencies [b124db8]
- Updated dependencies [ee26beb]
- Updated dependencies [44c1615]
- Updated dependencies [3d1e47c]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [b0e1abd]
- Updated dependencies [0d0a1c6]
- Updated dependencies [55d957b]
- Updated dependencies [9a2d1f8]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/mod-custom-fields@0.108.0

## 0.107.0

### Minor Changes

- 76f9757: `catalogProductReadPort` implements `listProductIdsByAttributeValue({ key, value, match })`: the ids
  of products whose own attribute value equals `value` (`scalar`), contains it (`array`) or is the
  boolean it names (`boolean`), structurally — soft-deleted and inactive products included, like
  `listProductIdsInCategory`. The _Attributes_ documentation now describes what the _Price list
  rules_ flag does: it lets an attribute select products in a price list's price matrix.
- bf9881f: The admin category tree accepts `/catalog/categories?focus=<id>`: once the list has loaded, the
  category's row is marked `aria-current="true"`, highlighted, scrolled into view and focused, once. It
  is where a global-search Category result lands. An id the tree does not hold changes nothing.
- bf9881f: Each module contributes its record type to admin global search (`@endora-commerce/mod-admin-search`).

  | Package              | Record type                           | Fields offered (default in bold)                                                 | Permission                             |
  | -------------------- | ------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
  | `mod-orders`         | `orders.order`                        | **number**, **organizationName**, **customer**, billingCompanyName, billingTaxId | `orders:read`                          |
  | `mod-quote-requests` | `quote_requests.quote_request`        | **number**, **organizationName**, **customer**, customerNote                     | `rfqs:handle`                          |
  | `mod-crm`            | `crm.opportunity`                     | **number**, **title**, **organizationName**, description                         | `crm:read`                             |
  | `mod-organizations`  | `organizations.organization`          | **name**, **taxId**, legalName                                                   | `customers:read` or `customers:manage` |
  | `mod-customers`      | `customers.customer`                  | **email**, **name**                                                              | `customers:read`                       |
  | `mod-catalog`        | `catalog.product`, `catalog.category` | **sku**, **name**, slug, quickSearchAttributes; **name**, **slug**               | `catalog:read`                         |

  Every provider applies its own admin list's visibility: sales representatives see only their
  organizations' orders, quote requests, opportunities and customers; organizations follow the
  Organizations list, with a representative's assigned organizations ranked first. Each module declares
  a `contributes-to` edge on `adminSearchProviderRegistry`, so none of them depends on global search and
  none loses its switch. `mod-quote-requests`, `mod-organizations`, `mod-customers` and `mod-catalog`
  now declare `_i18n` in `dependencies` (status labels in the admin's language), and each module's
  bundle gains `adminSearch.*` keys in English and Polish.

- 8397b0f: Page Builder translation. A **Translate** action in the Page Builder toolbar translates the canvas of the language tab being edited — or only the selected component or text — with the LLM configured in Settings → Page Builder (`cms.page_builder.translation.enabled`, `…llm_credentials`, `…max_source_characters`; off by default), behind the new permission `cms.translate`, through `GET /api/v1/admin/cms/page-builder/translation` and `POST /api/v1/admin/cms/page-builder/translate`. The result is an unsaved change with _Restore previous content_; every request that sent text is audited as `cms.page_builder.translate`.

  For block authors: `BlockDefinition` gains an optional `translatable: [{ path, format? }]` (`format` `plain` | `tiptap` | `html`, paths like `items[].title`) naming the props that are prose; it is served on the Page Builder descriptor. A block without it is never sent to a model. Every CMS-context block of `cms` and `catalog` declares it. `PageBuilderHeaderActions` gains an optional `extraActions` slot, and the blog post and category editors pass the editor what the action needs.

- e9a92b9: Saved views on the admin product list (#289).

  - The Product list's toolbar carries the admin kit's saved-views control: a selector of the admin's own views and every shared view, _Save view_ and _Delete view_. A view is named, private or shared, and stores the list's status tab, type chip and search text — only the ones not at their default. The Stock, Category and Channel chips are not saved. Loading a view replaces status, type and search, returns Stock to _All_, goes back to the first page and clears the row selection; a status or type the list no longer offers loads as _All_, and keys the list does not know are ignored. Any admin who can open the Product list (`catalog:read`) can use it.
  - Four new routes, gated by `catalog:read`: `GET` and `POST /api/v1/admin/catalog/products/list-views`, `PATCH` and `DELETE /api/v1/admin/catalog/products/list-views/{id}`. A view stores the list's filters only (`sort` and `visibleColumns` in a request body are ignored). `GET` returns the caller's own views and every shared view, ordered by name; every item carries `ownedByCaller` and `canModify`. Another admin's private view answers `404`; a shared view is modified or deleted only by its owner or a platform admin (any role except `sales_representative`), `403` otherwise. All four routes answer `401 UNAUTHORIZED` when no admin session resolves.
  - A `PATCH` that changes nothing — an empty body, or every value as already stored — writes nothing and logs nothing; it answers `200` with the current view. It is still refused (`403`/`404`) to a caller who may not modify the view.
  - `PATCH` and `DELETE` answer an `id` that is not a UUID with the same `404 NOT_FOUND` as a view that does not exist.
  - Names are trimmed, 1–160 characters, without control or format characters. One admin cannot hold two views on the product list whose names differ only by letter case or surrounding spaces: `POST`, and a `PATCH` that changes the name, answer `409 PRODUCT_SAVED_VIEW_NAME_TAKEN` with a translated message (English and Polish). The rule binds the view's owner.
  - New table `product_list_saved_views`, created by the migration `Migration20261014T170531CatalogProductListSavedViews`, with a unique index on the owner and the lower-cased name.
  - When a platform admin changes or deletes another admin's view, the `catalog` module logs one `info` record (`event: 'saved_view.updated' | 'saved_view.deleted'`, `list`, `viewId`, `ownerAdminUserId`, `actorAdminUserId`).

  `@endora-commerce/contracts` gains the `ERROR_CODES.PRODUCT_SAVED_VIEW_NAME_TAKEN` member.

- d76291d: Storefront catalogue reads can be priced in the currency the shopper selected. `GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:idOrSlug` and `GET /api/v1/catalog/products/:idOrSlug/links` accept `?currency=` (an ISO 4217 code, any case). The listing price, the price ordering, the price-range filter, the link tiles and the Meilisearch-served listing are all resolved in that currency when the request's sales channel lists it in its `currencies`, and in the channel's `defaultCurrency` otherwise. A malformed code answers `400 VALIDATION_FAILED`. Without the parameter, every read asks the pricing engine exactly what it asked before.

  `@endora-commerce/contracts` exports the pieces both modules use: `listingCurrencyQuerySchema` (the parameter), `resolveListingCurrency(requested, channel)` (requested if the channel offers it, else its default) and `listingPriceChannelContext(channel, currency)` (the `salesChannel` and `currencyCode` half of a `ListingPriceViewerContext`, with the default currency left implicit). `SearchQueryContext` gains an optional `currency`.

  `@endora-commerce/mod-price-lists`: a listing priced in a currency other than the channel's default no longer falls back to the Product's own `defaultPrice` / `price` attribute. That attribute has no currency of its own and was entered in the default one, so the fallback would have quoted, for example, 100 PLN as 100 EUR; such a product now has no listing price in that currency (`source: 'none'`). In the default currency nothing changes.

### Patch Changes

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0
  - @endora-commerce/mod-custom-fields@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0
  - @endora-commerce/mod-custom-fields@0.106.0

## 0.105.0

### Minor Changes

- 602e5ba: Six more events are delivered to webhooks: three product events, two quote-request events and the
  credit-limit adjustment.

  They were emitted on the in-process event bus and delivered to nobody. Each is now offered on the
  Webhooks screen, accepted by the API and delivered, while the module that owns it is present:

  | Event                      | Owner            | Payload, beside `eventId` and `occurredAt`                      |
  | -------------------------- | ---------------- | --------------------------------------------------------------- |
  | `product.created.v1`       | `catalog`        | `productId`, `sku`                                              |
  | `product.updated.v1`       | `catalog`        | `productId`, `changedFields` (field names only)                 |
  | `product.archived.v1`      | `catalog`        | `productId`                                                     |
  | `rfq.created.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `rfq.expired.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `credit_limit.adjusted.v1` | `credit_limits`  | `organizationId`, `amount` (the granted limit after the change) |

  **The owning module offers its own events.** `catalog`, `quote_requests` and `credit_limits` push
  their event names into `webhooks`' `webhookEventRegistry` from a boot hook and declare the edge as
  `contributes-to` — the mechanism `crm` already uses. `webhooks` names none of them, and its two
  built-in types are unchanged. With `quote_requests` or `credit_limits` switched off, their types are
  not offered and a new subscription to them is refused; stored subscriptions are kept and receive
  nothing until the module is back.

  **Who receives them.** Product events carry no `organizationId`, so they reach platform-wide
  subscriptions only. Quote-request and credit-limit events reach platform-wide subscriptions and the
  subscriptions bound to that Organization, never one bound to another.

  **The payloads are published contracts.** `@endora-commerce/contracts` exports a strict schema for
  each — `CATALOG_WEBHOOK_EVENT_SCHEMAS`, `QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`,
  `CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` — with the matching `*_WEBHOOK_EVENT_TYPES` and
  `*_WEBHOOK_EVENTS` constants and one `…EventV1Schema` and type per event.

  Three changes of behaviour in the owning modules:

  - **`catalog` now emits `product.archived.v1` when a product's status moves to `inactive`.** The
    event was emitted only by a deprecated method nothing called, so no path an administrator, an
    import or a PIM synchronisation takes ever announced it. It is emitted once per transition, after
    the `product.updated.v1` of the same write, on every update path. A subscriber on the in-process
    bus — the search indexer removes the product from the index on it — now receives it. The
    archiving write waits for the subscribers of both events before it returns, so a reactivation
    that follows at once cannot be undone by a removal still on its way; on the unaudited update
    path (the API-key upsert, a bulk edit) that makes an archiving write as slow as its subscribers,
    where it used to return without waiting.
  - **`rfq.expired.v1` carries `organizationId`.** Without it the event could reach no subscription
    bound to an Organization. An additive field.
  - **`CreditLimitService` constructed without a Command Bus emits `credit_limit.adjusted.v1` after
    its transaction has committed**, not from inside it, so an adjustment whose commit fails is not
    announced. The composed module always has a Command Bus and was not affected.

  **A contributed event type is delivered only while its owner is present.** `webhooks` asked for
  its own presence before delivering and not for the contributing module's, so an event carrying the
  name of a switched-off module was still delivered to the subscriptions stored for it. The bridge
  now asks per event, for every contributed type — the `crm` ones included. The two built-in order
  events are unaffected.

  Not delivered, and documented as such: a product being deleted (`product.deleted.v1` stays
  in-process), and a product being reactivated (there is no un-archive event; it shows as `status` in
  `changedFields`). `rfq.expired.v1` is sent only by the quote-request expiry sweep, so it occurs
  only on an instance where that sweep runs.

  **Volume.** Nothing is batched: a bulk edit, an import or a PIM synchronisation writes products one
  by one, so a subscription to `product.updated.v1` receives one delivery per product written. An
  event type no subscription names enqueues nothing.

### Patch Changes

- 202f0d9: The storefront product list cuts its page from the products that match. On the default listing
  path of `GET /api/v1/catalog/products` — no price ordering, no price range, not served by the
  search engine — sales-channel membership, the caller's audience (`visibility` and the organisation
  allow-list), `filter[category]` and every `filter[attr.<key>]` were applied to a page **after**
  `limit + 1` rows had been fetched and `hasMore` and the cursor read off that cut. A page whose rows
  were all filtered away was answered `data: []` with `hasMore: true`, and one where some were was
  simply short: with two sales channels and the newest hundred products on one of them, the other's
  first page of a hundred was empty.

  All four are now conditions of the statement the page is cut from, so a page holds `limit` matching
  products whenever that many exist, `hasMore` is `true` only when another matching product exists,
  and walking the cursors yields each matching product exactly once. The response shape, the
  ordering and the cursor format are unchanged, and a cursor issued before the upgrade still resumes
  at the same row.

  Two visible differences beyond the page size:

  - `filter[category]` naming a category that does not exist, is inactive or is deleted answers one
    empty page with `hasMore: false`. It used to answer a run of empty pages with `hasMore: true`,
    one per `limit` rows of the catalogue.
  - A consumer that worked around the defect by requesting further pages after an empty one keeps
    working; it simply never meets an empty page before the last.

  `filter[attr.<key>]` matches what it matched before: the stored value is compared as the string
  JavaScript prints for it, numbers included (`1e+21`, `1e-7`, `1.5` for a stored `1.50`), and an
  array as its comma-joined elements. Two stored shapes no attribute type produces compare
  differently from the previous release: an array nested inside an array (it used to be flattened into
  the join), and a number in `[1e15, 1e21)` or `[1e-6, 1e-4)` that was written with more than 17
  significant digits by something other than JavaScript.

  The two price-ordered paths (`sort=price`, `sort=-price`, `minPrice` / `maxPrice`) are not changed
  by this release: they already collect matching rows before cutting a page, bounded by their scan
  budget.

  `@endora-commerce/platform`: `SalesChannelMembershipPort` gains
  `entityIdsInChannelSubquery(channelId, entityType)`, which returns the membership set as a
  `{ sql, params }` subquery (`select <entity id> from <bridge> where sales_channel_id = ?`) for a
  module to place inside its own statement as `<id column> in (…)`. It executes nothing. Use it where
  a listing has to be channel-scoped before its page is cut; `filterEntityIdsInChannel` remains the
  accessor for narrowing ids already held.

  **Breaking, hence `minor`: a hand-written implementation of `SalesChannelMembershipPort` no longer
  type-checks until it adds `entityIdsInChannelSubquery`.** That is a test double or an overlay's own
  stand-in typed as the port; code that only _calls_ the port is unaffected, and the platform's own
  `SalesChannelMembershipService` already implements it. A minimal addition for a double that is
  never asked for it:

  ```ts
  entityIdsInChannelSubquery: () => {
    throw new Error('entityIdsInChannelSubquery is not stubbed');
  },
  ```

  No setting, permission or migration changes.

- 0184be5: An e-mail that was only written to the server log is no longer reported as sent. On an instance
  with no `SMTP_URL` the console mailer logs the message and used to answer `{ status: 'sent' }`,
  and the transactional e-mail service answered a constant `sent` of its own, so every module that
  records or reports a delivery recorded one that did not happen.

  **Breaking for a consumer of the two port types — three unions gain a member:**

  - `EmailMailerSendOutcome` gains `{ status: 'logged' }`. The console mailer answers it instead of
    `sent`; the SMTP mailer and `InMemoryMailer` still answer `sent`.
  - `TransactionalSendOutcome` gains `{ status: 'logged' }`, and `TransactionalEmailSender.send`
    passes the transport's `logged` on. A transport's `suppressed` (an already accepted message id)
    is still answered as `sent`, as before.
  - `emailDeliveryStatusSchema` / `EmailDeliveryStatus` gain `'logged'`, and
    `invoiceEmailNotSentReasonSchema` / `InvoiceEmailNotSentReason` gain `'logged'`.

  What to do: code with an exhaustive `switch` over one of these unions, or that passes
  `outcome.status` into a closed union of its own, stops compiling until it handles `logged`; code
  that reads `outcome.reason` after `outcome.status !== 'sent'` must narrow to
  `outcome.status === 'suppressed'` first, because `logged` carries no reason. Code that compares
  with `=== 'sent'` keeps compiling and now treats a logged message as not sent. `logged` is not a
  failure and there is nothing to retry: the same call would log the message again. An own
  implementation of `EmailMailerPort` or `TransactionalEmailSender` needs no change.

  What changes on an instance without a mail server:

  - `email_deliveries` rows are written with `status = 'logged'` instead of `'sent'`. The column is
    a plain `varchar(16)`, so there is no migration; rows written earlier keep `sent`.
  - The order, return, payment-status, shipment and invoice e-mail results answer
    `{ sent: false, reason: 'logged' }`, each with its usual "was not sent" log line. Issuing an
    invoice or re-sending its e-mail from the Admin UI says the e-mail was not sent because no mail
    server is configured, in English and Polish (`invoices.emailNotSent.logged`).
  - A CRM Event reminder is recorded as delivered to the bell alone — or as undeliverable when the
    bell is unavailable too — instead of "bell and e-mail".
  - `POST /api/v1/organizations/register` answers `emailVerificationSent: false` when the
    verification e-mail went through the in-code builder and was only logged.

  No setting, permission or migration changes.

- 31a2c0b: A custom field declares who reads its values, and customer-facing order and quote-request replies
  stop naming administrators. **Three breaking changes**, all described below.

  **Every custom-field definition has an `audience`: `customer` or `internal`.** Until now a
  definition had none, and whatever an administrator stored on an order or a quote request was
  answered to the customer (`GET /api/v1/orders`, `GET /api/v1/orders/:id`, the replies to placing
  and cancelling an order, `GET /api/v1/quote-requests/:id`) and to integrations
  (`/api/v1/external/orders`) as `customFieldValues`. An operator who modelled an internal note, a
  credit assessment or a risk flag as an order custom field was showing it to the buyer.

  - `internal` values are answered on admin routes only. `customer` values are also answered on
    the non-admin replies above. A stored value whose definition no longer exists is treated as
    internal. Admin replies are unchanged and carry every stored value.
  - **Existing definitions keep today's behaviour.** The migration
    `Migration20261010T090000CustomFieldsDefinitionAudience` adds
    `custom_field_definitions.audience` and sets every existing row to `customer`, so upgrading
    hides nothing. Review your definitions after upgrading and move to `internal` whatever was
    never meant to be shown.
  - **Breaking: a new definition is `internal` unless it says otherwise.**
    `POST /api/v1/admin/custom-fields/definitions` without `audience` used to create a field whose
    values the customer could read; it now creates one they cannot. Send `"audience": "customer"`
    to keep the old behaviour. `PATCH …/definitions/:id` accepts `audience` and leaves it alone
    when the key is absent. The same patch no longer resets a definition's `config` to `{}` when
    the body does not name it (`updateCustomFieldDefinitionSchema` carried the create default).
  - The definition screen (Custom Fields) shows the choice with an explanation, defaulting to
    internal, and lets the audience of an existing field be changed. Six keys join the module's
    `en` and `pl` bundles under `customFields.audience.*`.

  In `@endora-commerce/contracts`: new `customFieldAudienceSchema` / `CustomFieldAudience`;
  `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` gain a required `audience`;
  `createCustomFieldDefinitionSchema` defaults it to `internal`, so the inferred
  `CreateCustomFieldDefinitionRequest` — the input of `CustomFieldDefinitionApplyApi.applyCreate` —
  now requires it; and `CustomFieldValuePort` gains
  `projectForCustomer(entityType, bag)`, which returns only the keys a non-administrator may read.
  An implementation of that port must add the method. A host module that answers custom-field
  values to a non-administrator calls it in its serialiser; `mod-orders` and `mod-quote-requests`
  do. `mod-catalog` creates product attributes with `audience: 'customer'`; the audience is not
  consulted for product attributes, whose storefront visibility stays with the catalog's own flags.

  **Breaking: buyer-facing and external order replies no longer carry
  `placedOnBehalfByAdminUserId`.** It was the UUID of the administrator who placed the order for
  the customer, answered to the customer and to API-key callers. Those replies now carry
  `placedOnBehalf: boolean` instead. Admin order replies carry both. In `orderSchema`,
  `placedOnBehalf` is a new required key and `placedOnBehalfByAdminUserId` becomes optional
  (present on admin replies only). Replace `order.placedOnBehalfByAdminUserId !== null` with
  `order.placedOnBehalf` in a storefront or an integration; the reference storefront did not read
  the field.

  **Breaking: customer-facing replies carry no administrator identifier at all.** The same rule,
  applied to the other places it was broken:

  - Quote-request replies to a customer (`GET /api/v1/quote-requests/:id` and the replies to
    creating, patching, resubmitting a quote and to accepting or rejecting a revision) no longer
    carry `createdByAdminUserId` and `assignedAdminUserId`, and their `events[]` no longer carry
    `actorAdminUserId` (it was already always `null` there; the key is now absent).
    `actorRoleLabel` still says who acted.
  - Order-comment replies to a customer (`GET` and `POST /api/v1/orders/:id/comments`) no longer
    carry `authorAdminUserId`. A comment whose `authorCustomerAccountId` is `null` was written by
    staff.

  Admin replies are unchanged. In `quoteRequestSchema`, `quoteRequestEventSchema` and
  `orderCommentSchema` those four keys become optional (present on admin replies only). No boolean
  replaces them: the reference storefront declared the fields and read none of them.

  **Re-creating a deleted field.** Deleting a definition keeps its stored values. A
  `POST …/definitions` with `audience: "customer"` for a key that still has stored values is now
  refused with `409 CUSTOM_FIELD_DEFINITION_INVALID`, because it would answer those old values to
  customers at once. Create the field as `internal`, then change its audience. Product attributes
  (created through the catalog) are not affected.

  The definitions cache no longer stores a list that was read before an invalidation and arrived
  after it. A change of audience still takes up to 5 seconds to reach an API process that missed
  the invalidation message; the docs page says so.

  In `mod-orders`, `serializeOrder` is replaced by `serializeOrderForAdmin` and
  `serializeOrderForCustomer` (internal to the module).

- bdb823b: `demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
  financial records unless it is told to.

  **What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
  (`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
  The refusal came after the demo payment methods, the delivery methods and the buyer were already
  gone, so checkout was left broken. A reset that did go through left the demo organisation's
  orders, carts and quote requests naming an organisation that no longer existed.

  **A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
  the composition over it and hands it to every module's demo body as that body's own
  `EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
  foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

  - **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
    the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
    `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
    on a second connection, cannot see what the reset has already deleted, and waits on rows the
    reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
    `@endora-commerce/demo-composition` were moved accordingly.
  - **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
    `createDemoComposition` returns. A reset over a composition that does not is refused before it
    starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
    the two are released in lockstep and the composition's peer range is the exact platform version.
  - The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
    snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
    and while it runs, anything in its async context that asks the pool for a second connection is
    refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
    database client of its own is ended by the idle bound instead of hanging.
  - Every refusal — the composition's, a module's, the database's (an integrity constraint, a
    snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
    has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
  - `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
    to clear half-written rows away.

  **What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
  orders with their shipments, stock allocations (the stock they held is released) and credit
  reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
  keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
  events, price-list assignments, promotion uses (the usage counters they spent are given back),
  promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
  that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
  are matched — it is found by the tax id the demo gives it — so another organisation on the same
  instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
  audit trail, the e-mail delivery log and administrators' notification history are kept.

  A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
  tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
  it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

  **Breaking: the reset refuses when the demo organisation holds financial records.** It exits 1
  before deleting anything and prints how many of each it found. What counts:

  - a payment whose status is `paid`, `refunded` or `partially_refunded`;
  - an invoice of kind `invoice` or `correction`, or of any kind that carries a KSeF reference
    number or an external document reference, or that has an accounting-system row;
  - any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
    `invoice_ledger_client_maps`;
  - a refund, and a refund settled against the credit limit (`credit_limit_return_topups`).

  A payment still `awaiting_payment`, `deferred` or `failed`, and a pro-forma invoice or delivery
  note with no external reference, do not count: they are what an order placement opens and are
  withdrawn with the order, so a demo on which orders were placed and nothing was paid resets
  without the flag. To delete the financial records with the rest:

  ```
  pnpm run cli demo reset --force-delete-financial-records
  ```

  The flag is read from that command line only — no environment variable, no setting — and forces
  nothing else: the production guard and every foreign key apply as before. An automated job that
  resets a used demo needs the flag on its command line.

  The reset also stops before touching anything when another organisation has been filed under the
  demo one — detach or delete the sub-organisation and run it again.

  New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
  to decline a reset; printed as its message, without a stack) and
  `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
  `deleteFinancialRecords`.

  `organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
  and the sales representatives assigned to it before removing the organisation, and reports both
  counts beside `Organization`.

  Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
  and nothing records that, so it is subtracted like the others; a real promotion's counter can end
  up lower than the real uses made since, never below zero.

  `@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
  the flag beside `demo reset`.

  The getting-started, upgrade and CRM documentation pages say what the reset now does.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0
  - @endora-commerce/mod-custom-fields@0.105.0

## 0.104.0

### Minor Changes

- 2d39d97: A product attribute carries a new flag, **`isPriceRule`** — whether the attribute may be used as a
  price-building rule in a Price List. It is the pricing sibling of `isPromoRule` and travels the
  same way: `false` by default, set on create, hot-toggled through
  `PATCH /api/v1/admin/catalog/attributes/:key`, and shown as a column and a checkbox on the admin
  Attributes screen.

  - **`@endora-commerce/contracts`** — `createAttributeRequestSchema` and
    `updateAttributeRequestSchema` accept an optional `isPriceRule`;
    `adminAttributeResponseSchema` and `CatalogAttributeView` always carry it; `CatalogAttributeFlag`
    and `CatalogAdminAttributeFlag` gain `'isPriceRule'`, so
    `catalogAttributeReadPort.listByFlag('isPriceRule')` answers the attributes a price rule may name.
    **If you build a `CatalogAttributeView` yourself** — a test double of `CatalogAttributeReadPort`
    is the usual case — add `isPriceRule: false`; the field is required, which is why this is a
    minor in a `0.x` series.
  - **`@endora-commerce/mod-catalog`** — a migration adds `product_attributes.is_price_rule`
    (`boolean not null default false`), and `GET /api/v1/admin/catalog/attributes/by-flag` accepts
    `flag=isPriceRule`.
  - **`@endora-commerce/demo-composition`** — `createAttributeFixture` accepts `isPriceRule`.

  Nothing prices from the flag yet: a Price List's application rule still matches on sales channel,
  customer group, organization, category and currency only. This release records the flag and
  publishes it for the price-rule work to consume.

- fcf6daa: A category can carry content for its storefront page, authored in the Page Builder.

  - **`@endora-commerce/mod-catalog`** — new nullable `categories.content` column (migration
    `Migration20261008T092714CatalogCategoryContent`; run your instance's migrations) holding one
    Page Builder document per language. New routes: `GET` / `PUT
/api/v1/admin/catalog/categories/:id/content` (`catalog:read` / `catalog:write`) and the
    storefront read `GET /api/v1/catalog/categories/:id/content`. New admin screen
    `/catalog/categories/:id/content`, reached from a **Content** action on the category tree. A save
    runs the `category.content.update` command and emits `category.content.updated.v1`, which flushes
    the storefront's `catalog:categories` cache tag and — unlike `category.updated.v1` — does not
    re-index the category's products. The category list, the category tree and
    `CatalogCategoryRecord` are unchanged and do not carry the content.
  - **`@endora-commerce/contracts`** — new `categoryContentEnvelopeSchema`,
    `putCategoryContentRequestSchema`, `adminCategoryContentSchema`, `categoryPageContentSchema`,
    their inferred types and `CATEGORY_CONTENT_MAX_BYTES` (1 MiB). New admin zone
    `category.content.editor` with `CategoryContentEditorZoneProps`
    (`{ categoryId, language, data, onChange }`): the catalog owns the document and mounts the zone,
    and a module that owns a Page Builder contributes the editor. `assetReferenceKindSchema` gains
    `'category_content'`: a library asset embedded in a category's content cannot be deleted while
    the content references it.
  - **`@endora-commerce/mod-cms`** — contributes its Page Builder to `category.content.editor`
    (gated on `cms.read`). With the CMS module off the catalog's **Content** action is not offered;
    stored content is kept.

  A storefront has to render it to show it: read `getCategoryPageContent(node.id, ctx)` beside the
  listing and render the result through the Page Builder render boundary, as the reference
  storefront's `/c/[slug]` page and `components/CategoryContent.tsx` do.

### Patch Changes

- fd640a0: **A misspelled search phrase now finds products on the search results page**, as it already did in
  the typeahead popup.

  `GET /api/v1/catalog/products` — the listing the storefront's `/search` page reads — answered every
  request from the database unless `CATALOG_SEARCH_BACKEND=meilisearch` was set, and a default
  instance does not set it. The database matches a substring, so `helmest` found nothing where
  `helmets` found the product, while the popup beside it, which always reads the search index,
  offered the product for both.

  A request that carries a search phrase (`q`) is now answered by the `search` module whenever that
  module is switched on, with nothing to configure. A listing without a phrase — browsing a category —
  stays on the database, exactly as before.

  `CATALOG_SEARCH_BACKEND` keeps its meaning and gains a value:

  - unset — a search phrase goes to the search module, everything else to the database (**new
    default**; it used to be the database for everything);
  - `meilisearch` — every listing goes to the search module (unchanged);
  - `postgres` — every listing goes to the database. Set this to keep the previous behaviour.

  What an instance should expect from the change: a text search is ranked by relevance and forgives
  one typo in a word of five letters or more and two in a word of nine or more; it matches whole
  words and the beginning of the last word typed, so a fragment taken from the middle of a SKU
  (`ELMETS-01`) no longer matches where the substring match found it. A search combined with a price
  ordering or a price range is still answered by the database, because the index carries no price,
  and so still tolerates no typo. The fallback to the database when the index is unreachable or
  `search` is switched off is unchanged.

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [32775d5]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/mod-custom-fields@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/mod-custom-fields@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- a609ce3: `CatalogAdminService.createProduct` now persists `categoryIds`. The field is required by
  `createProductRequestSchema` and was accepted and discarded: `POST /api/v1/admin/catalog/products`,
  the creating call of `PUT /api/v1/catalog/products/by-sku/:sku` and
  `CatalogProductWritePort.createProduct` all returned a product in no category, and only a later
  update assigned the ones the caller had named. The `product_categories` rows are now written
  inside the `product.create` Command, so they commit or roll back with the product, appear as
  `categoryIds` in that Command's audit entry, and are in place before `product.created.v1` is
  emitted. A category id that does not exist now fails the create instead of being ignored, and a
  repeated id in `categoryIds` is treated as one membership on both create and update.
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0
  - @endora-commerce/mod-custom-fields@0.103.0

## 0.102.0

### Patch Changes

- 489a0b6: Documentation: migrations are now named by the file that actually ships. The pages cited
  migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
  and others), which matches no file in any package. Each reference now gives the real
  timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
  says which module owns it where that is a different module. The organizations page also no
  longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
  an explanatory `blocked_reason` on each remapped row.
- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/mod-custom-fields@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/mod-custom-fields@0.101.1
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- 5749604: Endora Commerce can be served from **one host with paths** — the storefront at `/`, the admin under `/admin`, the API under `/api` — as well as from one address per component.

  `@endora-commerce/cli`
  - **`endora install --public-url <origin>`** selects that layout. It stands for `--api-url <origin>`, `--storefront-url <origin>` and `--admin-url <origin>/admin`, each applied where the run has a use for it (so it works with `--only` on each machine in turn), and is refused beside any of the three. The API's address in this layout is the host itself — its routes already begin with `/api/v1` — so `--api-url` and `--storefront-url` still refuse a path, and now say why.
  - **`--admin-url` accepts a base path** after its origin (`https://example.com/admin`, or any other plain path; no trailing slash, query or fragment) and is accepted by a run that stands the admin up without the API, where it used to be refused. The path is written as `ADMIN_BASE_PATH=<path>/` into `admin/.env`.
  - **The scaffolded `admin/vite.config.ts` reads `ADMIN_BASE_PATH` as Vite's `base`** (default `/`). An instance scaffolded before this release gets the same by adding `base: env['ADMIN_BASE_PATH'] || '/'` to its own configuration.
  - With the API in the run, `ADMIN_BASE_URL` is the admin's whole address, path included, and `CORS_ALLOWED_ORIGINS` holds origins, each once. A port in an origin two components share is the proxy's, and is no longer written as either component's `PORT`.
  - The wizard, for a run that stands up only some components, asks how the three are reached before it asks any address: _one address each_, or _one address, with paths_ — which is then one question.
  - The closing block of such a run lists the routing the host owes: `/api/` and `/assets/file/` to the API unchanged, `/api/revalidate` exactly to the storefront, `/admin/` to the admin with its `index.html` as the fallback, everything else to the storefront.
  - **`deploy/nginx.paths.example.conf`** (single-host topology) is that routing for nginx, and `deploy/README.md` gains a section on it. `Dockerfile.admin` says how the image is built for a base path: a committed `admin/.env.production` holding `ADMIN_BASE_PATH=/admin/`.
  - **Both nginx examples forward `$http_host`** — the host with its port — as `Host` and `X-Forwarded-Host`, where they forwarded `$host`. Behind a proxy on any port but 80 or 443 the storefront refused every form submission (`x-forwarded-host … does not match origin`), because Next compares the two.
  - The storefront this CLI carries: its service worker leaves requests under `/admin` to the network, as it leaves `/api/`.

  `@endora-commerce/admin-shell`
  - **`AdminRoot` mounts its router under the bundle's base path.** New optional prop `basename`; by default it is derived from Vite's `import.meta.env.BASE_URL`, so a project built with `base: '/admin/'` gets a router under `/admin` with nothing else to set. With the default base nothing changes. New export `routerBasename(base)`.

  `@endora-commerce/mod-blog`, `@endora-commerce/mod-catalog`
  - Two admin screens linked with a raw absolute `href` (the _new category_ button of the blog category tree; the product links in the bulk-edit result list). Under a base path a raw `href` leaves the admin, and at the root it reloaded the application; both are the router's `Link` now.

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/mod-custom-fields@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
- Updated dependencies [54c7417]
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-custom-fields@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/mod-custom-fields@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.11.3

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0
  - @endora-commerce/mod-custom-fields@0.9.8

## 0.11.2

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/mod-custom-fields@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.11.1

### Patch Changes

- cbe6b7f: Two `EntityManager`-taking seams for renaming an attribute key after create, both additive and both run on the caller's transaction so a definition key and the values stored under it move together.
  - `@endora-commerce/mod-custom-fields/ports`: `CustomFieldDefinitionApplyApi.applyRenameKey(em, id, expectedKey, newKey)`, served by the existing `customFieldDefinitionService` registration. It is not an edit — `UpdateCustomFieldDefinitionRequest` still omits `key` — and it refuses a definition whose key is no longer `expectedKey` (`key_changed`), a key another definition of the same entity type holds (`duplicate_key`) and a key outside the grammar (`invalid_key`). It flushes before it returns, dispatches no command and publishes no invalidation: call `publishInvalidate` after your transaction commits. A test double implementing `CustomFieldDefinitionApplyApi` needs the new method.
  - `@endora-commerce/mod-catalog/ports` (new, type-only subpath): `CatalogAttributeValueKeyApi.renameValueKey(em, fromKey, toKey, { occupied })`, registered as `catalogAttributeValueKeyPort`. It moves the key in `products.attribute_values` and `product_value_overrides.attribute_key` and answers how many rows of each moved. `occupied` is required and decides what happens to data already stored under `toKey`, which it reads and locks first: `'refuse'` throws `target_occupied` with both counts before anything is written; `'displace'` removes those values and override rows — on every product holding them — and returns them in `displaced.values` / `displaced.overrides` before the key moves, so nothing is merged over and no unique index is hit. `name`, `description` and keys outside the attribute grammar are refused before any statement runs.

- Updated dependencies [cbe6b7f]
- Updated dependencies [8a88460]
  - @endora-commerce/mod-custom-fields@0.9.6
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.11.0

### Minor Changes

- e915c1e: `catalog` now creates the nine stock-management columns its entities map, in `Migration20260925T125527CatalogInventoryColumns`: `products.{manage_stock, backorder_enabled, low_stock_threshold, low_stock_threshold_mode, fulfilment_strategy, fulfilment_strategy_warehouse_order}` and `categories.inventory_threshold_{high,medium,low}`, together with `products_fulfilment_strategy_check` and `products_low_stock_threshold_mode_check`.

  Until now only `@endora-commerce/mod-inventory`'s migrations created them. `inventory` is switchable and `catalog` does not depend on it, so an instance assembled without `inventory` — the default free set — could not read or insert a product or a category, and a hard uninstall of `inventory` dropped the columns. The new migration uses `add column if not exists` with the original types and defaults, and adds each constraint behind a `pg_constraint` check: on every database that already has them it is a no-op that keeps every value, and on a fresh one it creates them. Its `down()` is deliberately empty, because `products` and `categories` are the platform's tables and their rows outlive `catalog`.

  Regenerate the migration registry (`pnpm --filter backend run composer:generate` in this repository, `endora generate` in an instance) so the migration runs.

### Patch Changes

- b9c6686: These modules derive an attribute's API type from `@endora-commerce/contracts`' `apiAttributeTypeOf` instead of each carrying its own copy of the rule. `catalog`'s `dbToApiAttributeType` keeps its `numericKind`; `pim_ergonode` checks a binding candidate against the shared function (`pim_unopim` made the same move and has since left this repository; its version with the change is cut from the paid-modules repository). The internal `endoraApiAttributeTypeOf` helper is removed from `pim_unopim`, `pim_ergonode` and `pim_pimcore`; no published subpath exported it.

  Behaviour is unchanged. The modules require a `@endora-commerce/contracts` release that exports `apiAttributeTypeOf`.

  `@endora-commerce/mod-pim-pimcore` carries this change as well; it has left for the paid-modules repository, and its next version is cut there.

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/mod-custom-fields@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4
  - @endora-commerce/mod-custom-fields@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/mod-custom-fields@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/mod-custom-fields@0.9.2

## 0.10.1

### Patch Changes

- 4915024: Comarch ERP XL integration (feature 119): shared ERP connector layer and Comarch XL adapter.

  **`@endora-commerce/contracts`** adds `erp-connector.ts` and `comarch-xl.ts` (admin and wire
  schemas), `erpConnector` on `ModuleManifestSchema`, and `COMARCH_XL_*` / `ERP_CONNECTOR_*`
  error codes.

  **`@endora-commerce/mod-erp-connector`** is a new non-deactivatable infra package: mutual
  exclusion registry (`erpConnectorRegistryPort`), activation lock entity, and shared job/run
  vocabulary. Subpaths: `.`, `./backend`, `./migrations`.

  **`@endora-commerce/mod-comarch-xl`** is a new switchable connector package: OpenAPI v0.1.0
  REST client, identity mapping, BullMQ detect/sync pipeline, domain apply services, admin UI,
  and documented overlay ports. Subpaths: `.`, `./backend`, `./migrations`, `./admin`. Ships
  `i18n/` and operator documentation under `docs/`.

  **`@endora-commerce/mod-invoices`** extends the module with `erpSaleDocumentWritePort`,
  ERP-imported sale document entities, B2B customer routes, and attachment handling for XL
  sale documents.

  **`@endora-commerce/mod-inventory`** extends `inventoryStockImportPort` for Comarch XL stock
  apply wiring (warehouse snapshot import).

  **`@endora-commerce/mod-catalog`** honours `createProduct` request `status` instead of
  always defaulting new products to `draft`.

  Activation is gated by `comarch_xl.enabled` (default off). Only one `erpConnector: true`
  module may be operator-active at a time.

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/mod-custom-fields@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/mod-custom-fields@0.9.0

## 0.9.1

### Patch Changes

- 7698fae: The attribute page's "See also" refers to `promotions` by name instead of
  linking `../promotions.md`. `promotions` is not in the module set
  `endora new instance` writes, so the relative link named a page that is not in
  an instance's documentation tree and `onBrokenLinks: 'throw'` refused the whole
  site. The sentence now says the same thing whether or not the reader installed
  the sibling.
- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/mod-custom-fields@0.8.2
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 02838b7: Nine modules now declare the environment inputs they own, in `manifest.env`, so a
  client who installs them can be told what to put in their `.env`. Each declaration
  carries an English and a Polish sentence, a requirement, and — for an `optional`
  one — what is lost without it.

  `health_checks` was the tenth until D-229 dissolved it into the platform; its two
  declarations went with it, and `search`'s `MEILISEARCH_URL` went with them,
  because the platform now declares that name and a module may not describe a
  platform input a second time.

  Nothing changes at runtime: no module reads a new variable and none changes how it
  reads an existing one. What changes is that the requirement is now on the wire, in
  the manifest the platform already carries, and reaches a consumer through the
  package's own `exports` map.

  Every module here declares only what it **owns**. The seven platform-owned names
  these modules read — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`,
  `PUBLIC_API_BASE_URL`, `BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET` and
  `SETTINGS_SECRET_ENCRYPTION_KEY` — are declared by `@endora-commerce/platform` and
  are deliberately not repeated here.

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- 8e86e55: Eleven container names a module read and nothing defaulted are now defaulted by
  the module that reads them, so a composition that contributes nothing can
  resolve every one of them.

  `@endora-commerce/platform` — `composeApp` registers two more names:
  `customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
  expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
  the resolved `NEWSLETTER_TOKEN_SECRET`.

  `@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
  option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
  consumer composing the module through `registerModule` is unaffected; a consumer
  calling `newsletterModule` directly passes `async () => null` where it passed
  `null`. The `NewsletterBridge` interface is removed — the module reads its nine
  members itself.

  `mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
  each registers the names it reads. No published shape changes; a composition
  that contributes one of them still overrides the default, which is what the
  contribution window is for.

  `mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
  ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
  `customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
  one of those owners declares `activation.nonDeactivatable`, so no operator loses
  an activation control.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

### Patch Changes

- f20bc38: Documentation: these packages' pages no longer link Endora's own documentation
  site by relative path.

  A page each package ships under `docs/` linked `../architecture/…` or
  `../integrations/…` — a page above the modules category, which is site content
  and travels with no package. Installed anywhere but the Endora repository, the
  link named a page that is not there, and a documentation build over the
  installed set therefore failed under Docusaurus's `onBrokenLinks: 'throw'` —
  whatever else was installed alongside. The guides are now named in prose.

  No exported symbol, schema, route or translation key changes.

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/mod-custom-fields@0.8.1
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- 83ffe79: The product create form is a declared admin route on `catalog:write`, and the two
  _New product_ affordances on the product list are gated on the same code (D-221).

  `contributions.routes` gains `/catalog/products/new` before the existing
  `/catalog/products/:id`, which keeps `catalog:read`. Both entries resolve the same
  `ProductEditor` component — the id `new` is what its own `params.id === 'new'` reads — so
  this splits one screen's two entry points rather than adding a screen.

  **What changes for an operator.** A role holding `catalog:read` and not `catalog:write`
  can no longer open the product create form, and no longer sees a button offering it. That
  role could not create a product before either: the save refused. What it had was a form it
  could fill in and not submit, and since feature 091 the admin router enforces a route's
  declared code, so once this route exists an ungated button would send that role to the
  admin's not-found page — which says nothing about permissions. The affordance therefore
  moves with the route.

  **The manifest declares `{ code: 'catalog:write', requires: ['catalog:read'] }`.**
  `ProductEditor`'s loader fetches `/api/v1/admin/catalog/categories` and
  `/api/v1/admin/catalog/attribute-sets` unconditionally — before any `isNew` branch, with
  the create path using the second to select the new product's default attribute set — and
  both are `requireAdmin('catalog:read')`. So the write code alone opens the route and
  cannot render the form. `requires` is advisory (D-175): nothing is refused at the gate, and
  the role editor renders the shortfall with a one-click add. The requirement is attached to
  the code rather than to the screen, so every holder of `catalog:write` is advised to add
  `catalog:read`, including holders of gates other modules enforce with it.

  **If you consume this package's `./admin` contributions**, the `routes` array is one entry
  longer and its order changed; nothing was removed and no `requiredPermission` on an
  existing entry moved. `i18n/{en,pl}.json` gain `productsList.empty.readOnly`, the
  empty-state sentence a role without the write code sees in place of the one that carried
  the create link.

- 034f190: The module declares its demo data: `manifest.demo` creates the demo's three-level category tree,
  200 generated products, three composites and the composites' own structure, and withdraws them
  again.

  `endora demo seed` now reports `catalog` by name with what it created, and `endora demo reset`
  removes it. Both bodies are reached by a relative `await import()` from the manifest, so nothing
  is loaded by the processes that merely compose the platform, and the module gained no `exports`
  subpath, no `files` entry and no manifest `dependencies` entry.

  **The catalogue is generated, not shipped.** The products, their descriptions and their images
  are built in process, so this package ships no non-`.ts` demo asset at all: 200 products cost
  the same bytes as 10 000.

  **Three things the block used to hold are not this module's demo data.** A product attribute is a
  `custom_fields` definition paired to one of this module's extension rows; a placeholder image and
  a sample attachment each mint an `assets_library` asset and hand its id to one of this module's
  tables. Each writes two modules' rows in one statement, so each belongs to whoever owns the
  instance. A consumer that seeds through this body alone gets a catalogue with no attributes, no
  images and no attachments — a coherent shop, and a plainer one.

  **The withdrawal changed, and it is the largest repair in the series.** The host's demo reset
  cleared `products`, `categories`, the composites' three structure tables and eleven more with a
  `truncate … cascade`. It now deletes only the slugs and the slug prefix `seed` assigns, deepest
  first, so a catalogue an operator has been building survives a demo reset — as do their uploaded
  assets and their own product-host attributes, which the same cascade had been taking.

  Seeding twice creates nothing the second time and reports the same counts.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

- 0ab2044: Publish the object store, the availability port and the batched category and
  asset reads `product_feeds` reached through a composition root.

  `@endora-commerce/contracts` gains four exports and one method, all additive:
  - `ObjectStoragePort` (container name `objectStoragePort`, owner
    `assets_library`) with `ObjectStore`, `ObjectStoragePutInput`,
    `ObjectStorageBackendCode` and `AssetByteStream`. A byte store for a module
    that keeps its own objects under its own locator prefix and creates no `Asset`
    row. `getForBackend` is **total** — `legacy` is a URL resolver for pre-013
    rows, not a store, so it is not in the code union and a consumer has no arm to
    probe for.
  - `InventoryAvailabilityPort`, the shape `inventoryAvailabilityPort` has always
    answered. The registration carried no type argument, so there was no name to
    import.
  - `CatalogCategoryReadPort.expandCategoryProductIds(categoryIds)` — the batched,
    live-narrowed, cycle-tolerant subtree walk. It is **not** a batched
    `listProductIdsInSubtree`: that one is structural by contract and is a
    recursive CTE with no cycle guard.
  - `AssetReadPort.resolvePublicUrls(assetIds)` — the stable public URL of each
    live, public asset, and nothing for the rest. Absence is the answer rather
    than an exception, because only the owner can tell a stable URL from an
    expiring signed one.

  Breaking, `@endora-commerce/mod-product-feeds`:
  - `ProductFeedsBridge` is **removed**. The module resolves the four ports above
    itself; a composition contributes nothing to it beyond deployment values.
  - `ProductFeedsModuleOptions.storageAdapters: ArtefactStorageAdapterProvider`
    becomes `objectStorage: ObjectStoragePort`. Pass the container's
    `objectStoragePort` instead of an adapter registry.
  - `ArtefactStorageAdapter` and `ArtefactStorageAdapterProvider` are removed from
    `services/artefact-store.js`; `ArtefactStorageBackend` is now
    `ObjectStorageBackendCode` and `ArtefactStorePort.open` returns a
    `node:stream` `Readable` rather than a `NodeJS.ReadableStream`.

  Breaking, `@endora-commerce/mod-catalog`:
  - `CatalogQueryService.expandCategoryProductIds` is **removed**. The same walk,
    unchanged, is `CatalogCategoryReadService.expandCategoryProductIds`, published
    on `catalogCategoryReadPort`. It is a category read and it now has one home.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [034f190]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/mod-custom-fields@0.8.0

## 0.7.0

### Minor Changes

- 543151a: `catalog` and `orders` ship their admin screens, and one icon name joins the allowlist.

  **`@endora-commerce/mod-catalog` gains an `./admin` subpath and `@endora-commerce/mod-orders`
  gains routes and nav on the one it had.** `catalog`'s new entry point exports `contributions`
  with eight `routes` and six `nav` declarations — the product roster and editor, the category
  tree, the attribute and attribute-set registries, the attachment types and the two
  bulk-operation screens. `orders`' entry point exported `contributions` with a `zones` array and
  nothing else since P4d; it now declares four routes and three nav entries beside it. A consumer
  that composes either package's `./admin` gets those screens without editing an application file.

  **`@endora-commerce/mod-catalog` declares three new manifest actions**: `open-products`,
  `open-categories` and `open-attributes`, each with the destination, permission code and keywords
  the admin's hand-written palette row carried, and with the labels and descriptions those rows
  rendered. `@endora-commerce/mod-orders`' manifest is unchanged — its palette row duplicated the
  `open-orders` action it had declared all along.

  **`@endora-commerce/contracts` adds `'ClipboardCheck'` to `KnownIconNameSchema`** and
  `@endora-commerce/admin-kit` adds the matching entry to `resolveIcon`'s map. A module
  declaration names its icon rather than importing it, and `orders`' three sidebar rows render
  that glyph.

  **Breaking for a consumer that imports these two modules' screens from the admin application.**
  Twenty-seven files moved out of `admin/src/modules/{catalog,orders}/` and four re-export shims
  were deleted with them:
  - `admin/src/modules/catalog/components/ProductPicker` — import `ProductPicker` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/Section` — import `Section` from `@endora-commerce/admin-kit/ui`.
  - `admin/src/modules/orders/StatusTransitionGraph` — import `StatusTransitionGraph` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/orderStatusColor` — `ORDER_STATUS_COLOR_PRESETS` and
    `ORDER_STATUS_DEFAULT_COLOR` are `@endora-commerce/contracts`'; `readableTextColor` and
    `statusBadgeStyle` (which that file also re-exported as `orderStatusBadgeStyle`) are
    `@endora-commerce/admin-kit/lib`'s.

  **`@endora-commerce/mod-i18n` drops fifteen keys** — nine `appShell.nav.*`, four
  `appShell.palette.sub.*`, `appShell.nav.quickOrder` and `appShell.crumb.detail` — from the
  shared bundle in both shipped languages, nothing rendering them any more. Their replacements are
  module-relative keys in `@endora-commerce/mod-catalog`'s and `@endora-commerce/mod-orders`' own
  bundles.

  **One route tightens.** `/orders/new` was declared by the admin application and therefore
  ungated, while the sidebar row that advertised it carried `orders:write`; the route is
  `@endora-commerce/mod-orders`' own now and takes that code. A read-only operator who could
  previously open an order-entry form whose save would refuse now meets the admin's not-found
  treatment instead.

- 3583e78: `catalog` is a package: `@endora-commerce/mod-catalog`, with three subpaths (`.` for the
  manifest, `./backend` for composition, `./migrations` for the twenty-one migration classes) and
  an `i18n/` bundle directory beside `dist`. It is the largest module in the tree — 18 entities,
  35 services and four route surfaces — and nothing about its behaviour, schema or HTTP surface
  changes with the move.

  **`./backend` exports an `entities` array and no entity class by name** (D-168). Eighteen
  classes are reachable only through that array, which is the value the host's ORM registers, so
  there is exactly one of each in a process. That number is why the array's shape matters more
  here than anywhere else: a consumer that picks a class out of it with a `find` gets the union of
  eighteen constructors, which TypeScript collapses to one member that is almost certainly not the
  one asked for. Take the class by **name**, never by index. If you want a row's _shape_, the
  contract is in `@endora-commerce/contracts`.

  **Three names leave `./backend` on purpose**, all of them for host programs that construct
  catalogue state rather than serve it:

  ```ts
  import {
    CatalogProductReadService, // the read surface price-list migration is driven from
    legacyToCfType, // legacy attribute value type -> unified custom-field triple
    type CatalogQueryService, // the cradle slot a composition root declares
  } from '@endora-commerce/mod-catalog/backend';
  ```

  `CatalogProductReadService` and `legacyToCfType` are a service and a pure function, so D-168 —
  which bars _entity_ classes from this door — does not reach them; `CatalogQueryService` is a
  type and evaluates nothing. A host program cannot name this package's source instead: a
  compiled build sets `rootDir`, and a `.ts` outside it is a compile error even under
  `import type`.

  **Two `fastify` request properties this module reads are not its own.** `request.actor` and
  `request.apiKeyBinding` are `declare module 'fastify'` augmentations owned by `auth` and
  `api_keys`. Inside one program they are ambient; a package is its own program, so the two reads
  narrow locally rather than importing an interface neither owner publishes. An overlay wrapping
  `routes.external.ts` should expect the same.

  The twenty-one migration classes keep their names, so a database that has applied them sees
  nothing pending.

- 7af67c0: Declared as `peerDependencies` the packages these seven already publish types from (D-181).

  Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
  `devDependency`, which a consumer's install does not resolve. The consequence is silent:
  the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
  is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
  `@endora-commerce/mod-custom-fields` not installed: the exported
  `CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
  installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

  Eleven peers, in two shapes:
  - **A published port interface of another module package** — `mod-catalog` →
    `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
    `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
    `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
    in the emitted declarations, so a consumer type-checking the package resolves them.
  - **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
    for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
    it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

  **If you install one of these packages**, its peers are now install-time requirements
  rather than something your own tree happened to provide. `@types/nodemailer` and
  `@types/web-push` are deliberately _not_ among them: their libraries are imported inside
  function bodies and reach no published signature. Neither is `@types/react` or any other
  types package that contributes global declarations — those exist once in a program by
  construction, and forcing our copy is a conflict you could not fix.

  `minor` rather than `major`: nothing here changes an exported symbol or a call, and the
  requirement is one a consumer that type-checks these packages already had to satisfy for
  the types to mean anything. It is more than a patch because a resolver that was silently
  succeeding will now report an unmet peer.

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

- e969343: `catalog` declares the forty-seven error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied from the frozen
  capture, and is asserted equal to it in both directions.

- 5d9bb88: Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
  placeholder sentences leave the platform bundle.

  `manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
  (`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
  `CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
  `PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
  `@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
  `IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
  `TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
  (`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
  `@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
  D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  `@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
  `error.code` is unchanged for all twenty.

  **Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
  `"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
  bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
  of the eight are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
  - `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
    `@endora-commerce/mod-customer-accounts`
  - `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

  The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
  `PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
  describe and the placeholder is deleted without a replacement. A consumer that reads those keys
  out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
  platform produced the codes they belonged to.

- eeb6a47: Four zone members for the category editor, the product editor and the sales-channel editor.

  `@endora-commerce/contracts` adds four members to `AdminZoneNameSchema`, each with its
  entry in `AdminZonePropsMap`:

  | Member                         | Props                                       | Rendered by                                           |
  | ------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
  | `category.editor.after`        | `CategoryEditorZoneProps { categoryId }`    | the category editor's form, after its save/cancel row |
  | `product.editor.pricing.after` | `ProductEditorZoneProps` (reused)           | the end of the product editor's Pricing tab           |
  | `product.editor.channels`      | `ProductEditorZoneProps` (reused)           | the body of the product editor's Channels tab         |
  | `sales_channel.editor.after`   | `SalesChannelEditorZoneProps { channelId }` | below the sales-channel editor's identity form        |

  `CategoryEditorZoneProps` and `SalesChannelEditorZoneProps` are new exported interfaces.
  `ProductEditorZoneProps` is reused for the two product members rather than aliased: a props
  type is the shape the mount carries, and two places in one editor that both carry a product
  id carry the same shape.

  ```tsx
  import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

  // A tab whose body is a zone shows its button by counting the zone, never by
  // naming the module that fills it.
  const contributions = useAdminZone('product.editor.channels', { productId });
  // …
  <AdminZone name="product.editor.channels" props={{ productId }} />;
  ```

  `@endora-commerce/mod-price-lists` gains an `./admin` subpath declaring two zone
  contributions — `category.editor.after` and `product.editor.pricing.after`, both at
  `price_lists:read` — and takes `DisplayModeOverrideRow` and `LinkedPriceListsPanel` with it.

  **`DisplayModeOverrideRow` loses its `label` and `inheritHint` props**, and that is a copy
  change an operator will see. A host cannot hand its own wording to a contributor it does not
  know, so the control renders `priceLists.displayMode.rowLabel` in every place it appears.
  Two screens read different words than before: the category editor, which passed `catalog`'s
  `categories.priceDisplayMode.label` / `.help` (both keys are removed from `catalog`'s
  bundle — hence its `patch`), and the product editor's Pricing tab, which passed this
  module's own `priceLists.linked.displayModeLabel` / `.displayModeHint`. Those two `core`
  keys are now read by nothing; they are left in place because the same props are still passed
  by `organizations`' detail screen, whose conversion is a separate merge request.

  `@endora-commerce/mod-sales-channels` gains an `./admin` subpath declaring one contribution,
  `product.editor.channels` at `sales_channels:read`, and takes `EntityChannelMembership` with
  it. Its four calls are rebuilt from the published `apiClient` rather than moving
  `sales-channels-client`, so the package reaches nothing in the admin application.

  `@endora-commerce/mod-inventory` gains an `./admin` subpath declaring one contribution,
  `sales_channel.editor.after` at `inventory:read`, and takes the panel formerly at
  `admin/src/modules/warehouses/ChannelMembershipPanel.tsx`. Its own
  `isVisible({ module: 'inventory', requiredPermission: 'inventory:read' })` gate is gone —
  the zone renderer applies presence and that code before the chunk is fetched — while the
  `inventory:write` half stays, because a contribution declares one code and the panel offers
  a read view and write actions behind two.

  No contribution declares a `match`: each names a member exactly one host mounts, and `match`
  narrows the mounts of one place.

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [27ca81d]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [3786732]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [73da94f]
- Updated dependencies [e637f56]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/mod-custom-fields@0.7.0
  - @endora-commerce/platform@0.7.0
