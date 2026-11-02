# @endora-commerce/mod-quote-requests

## 0.109.0

### Minor Changes

- e64ed74: **BREAKING — a `POST /api/v1/admin/quote-requests` that omits `salesChannelId`, for an Organization not assigned to the channel the admin request resolves to (the system default, or `X-Sales-Channel`), now answers `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` where it answered `201`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. The server is the sole enforcer of the channel (owner decision 2026-10-29 "A"): the channel the request lands on, named or not, must be one of the Organization's active channels. A caller with no request scope — a worker, a CLI script, an in-process call to `RfqAdminService.createOnBehalf` — has no resolved channel and must name `salesChannelId`; without it the call is refused with the same code (`details.code: 'no_channel'`).

  An operator names the sales channel a quote request is created on for a customer. `adminCreateQuoteRequestSchema` gains an optional `salesChannelId`; `POST /api/v1/admin/quote-requests` stores the request on that channel, snapshots its line names in the channel's default language, and reports `PRODUCT_UNAVAILABLE_IN_SCOPE` warnings for that channel, refusing — before anything is written — a channel that is not one of the Organization's active channels (read through the kernel's `SalesChannelMembershipPort.listChannelsForEntity`; `RfqAdminServiceDeps` gains `channelMembership`) with the new `422 RFQ_SALES_CHANNEL_NOT_ALLOWED`. Absent, the request is raised where the admin request resolves (the system default, or `X-Sales-Channel`) — and that channel is checked the same way, as above. The _Create quote request_ screen offers the customer's organization's active channels — preselecting the only one, else requiring a choice —, prefills agreed prices on the chosen channel (`PricePrefillRequest.salesChannelId`), and, when the answer warns, lists the unavailable products before leaving the screen. Until a channel is settled it neither prefills prices nor sends anything: a failed or refused read says so (`rfqCreate.channelsLoadError`) with a retry, inactive while it runs.

- 22604fa: Attachments per sales channel and language, packaging-unit names per language (product data scopes, FR-078, FR-079).

  - **Attachments:** create and update (`POST` / `PATCH /api/v1/admin/catalog/products/:productId/attachments…`) accept `nameTranslations` and `descriptionTranslations` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). A newly hidden channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing is always allowed. The admin DTO carries all three. The product page leaves out an attachment hidden in the request's channel and serves its name and description in the request's language, else the global ones.
  - **Packaging units:** create and update accept `nameTranslations` (the admin schemas stay strict). The admin DTO and `CatalogPackagingUnitRecord` carry it. The product page's `packagingUnits[].name` is the name in the request's language, else the global name.
  - **Basket snapshot:** a basket line ordered by a packaging unit stores the unit's name in the basket's language (`effectivePackagingUnitName`) and keeps it after a rename; the order line copies it. A buyer's quote-request line (create and draft edit) appends the unit's name in the request's language on its channel, else the global name, and keeps it; a line naming its unit by name and base quantity is still matched on the global name.
  - **Auditing:** these writes run the existing Commands `product_attachment.create` / `.update` and `packaging_unit.create` / `.update`, one audit entry per request. The route-level `attachment.create`, `attachment.update` and `product_packaging_unit` rows are no longer written beside them. The projections carry `productId`, the translations and `hiddenInChannels`; re-sending `before` without `productId` restores the row. They emit `product.updated.v1` with `changedFields: ['attachments']` / `['packagingUnits']`; a request that changes nothing writes and emits nothing. EN/PL audit labels added.
  - **Scope overview:** lists `attachments:hidden` per channel and `attachments:name`, `attachments:description`, `packagingUnits:name` per language.
  - **Contracts:** `ATTACHMENT_DESCRIPTION_TRANSLATION_MAX`.
  - **Migration** `catalog` `attachment_packaging_translations`: columns `product_attachments.name_translations`, `.description_translations`, `product_packaging_units.name_translations`, table `product_attachment_channel_hidden`. No backfill.

- 145ab33: Quote requests refuse an archived product (product data scopes). A product archived with catalog's Archive action can no longer be put on a quote request through any path:

  - **Buyer:** create, draft edit and resubmit — and so cart conversion, the quick order build, shopping-list conversion and order clone, which all create through the same path — answer `404 PRODUCT_NOT_FOUND`, exactly as for a product that does not exist. This now also holds outside a request (no sales channel), where only the audience rule used to run.
  - **Behaviour change for API clients — operator:** `POST /api/v1/admin/quote-requests` and `PATCH /api/v1/admin/quote-requests/:id` refuse a line whose product is archived with `409 PRODUCT_ARCHIVED` ("Product is archived.") and write nothing; a product id that does not exist still answers `404 PRODUCT_NOT_FOUND`. Before, the create accepted it and answered a `PRODUCT_UNAVAILABLE_IN_SCOPE` warning; that warning still covers every other reason a line is unavailable.
  - **Convert:** converting an approved quote whose product has been archived since answers the existing `409 PRODUCT_NOT_FOUND` before the basket is touched (the line would have been refused at order placement anyway).

  Price lists are unchanged: an archived product can still be priced.

- d50b874: A discount that is real but rounds to no cent is no longer shown as 0,00 (issue #430).

  - **`DocumentValue`** (contracts): a `money` value may carry `belowMinorUnit: true`. `formatDocumentValue` prints it as `DOCUMENT_BELOW_MINOR_UNIT_TEXT` ("—"), and `sumDocumentValues` keeps the mark while the sum is zero.
  - **Quote document** (quote_requests): `lineDiscount` and `discountTotal` carry the mark when a line has a unit discount but its rounded line discount is 0.00, so the PDF prints "—"; the amount stays 0, so list value − discount = net.
  - **Admin quote screen** (quote_requests): the _Difference_ column keeps a difference of unit prices at four places (`referenceDifference(...).amount`) and shows its significant places (`RfqNumberFormat.signedUnitAmount`), instead of rounding it to 0.00.

### Patch Changes

- bdd04a7: The acquisition seams ask `catalogProductAvailabilityPort` (product data scopes per sales channel and language) instead of testing membership, audience or status themselves.

  - **Behaviour change for API clients — basket:** adding a product to the basket (single add and the batch add behind quick order, shopping-list and quote conversions) is refused with `404 PRODUCT_NOT_FOUND` — the answer an absent product gets — when the product is not effectively available at the basket's channel and the request's language (switched off there, outside its publication window, or outside the channel's audience rule). The add path used to test no status at all, so a `draft` member product could be put in a basket. A line whose product goes off after it was added stays in the basket and reads `unavailable` (`unavailableReason: 'not_purchasable'`); submitting the basket for approval and placing the order refuse it with `404 PRODUCT_NOT_FOUND` and its `cartItemIds`, and the checkout preview lists it as `product_unavailable`. The cart's up-sell strip shows only available products.
  - **Orders:** the admin order preview reports a member product that is not available in the chosen channel (at its default language) as `PRODUCT_NOT_IN_SALES_CHANNEL`. Reorder and quote conversion are unchanged (their lines are refused at placement as above).
  - **Quote requests:** a buyer's request (create, draft edit, resubmit) naming a product not available at the request's channel and language is refused with `404 PRODUCT_NOT_FOUND`. `POST /api/v1/admin/quote-requests` still accepts such a line and answers `warnings: [{ productId, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]` beside `data` (only when there is one).
  - **Comparisons and shopping lists:** a product not available at the request's channel and language cannot be added or saved (`404 PRODUCT_NOT_FOUND`); a comparison column reads `available` from the same answer; a saved line whose product went off is skipped on conversion as `product_not_found`.
  - **Quick order:** a pasted SKU of a product not available in the request's channel is rejected as `product_not_found`; the operator's import arm is unchanged.
  - **Effective names (FR-017):** basket line names and batch below-minimum outcomes, quote-request line snapshots (buyer: request language; operator: channel default) and comparison names and compared values follow the channel's overrides at the request language.

- 07f3764: Minimum order quantity and "returnable" per sales channel (product data scopes, FR-100).

  - **Behaviour change:** a product's channel override of its minimum order quantity or its returnable flag (`product_channel_scopes`, written through `PATCH /api/v1/admin/catalog/products/:id/scopes`) now applies in that channel. Adding to the basket (single, batch and quick-order build), the basket view, submitting a basket for approval, the checkout preview, placement, the admin order preview, quote requests (create, draft edit, resubmit, the operator's per-line warning) and the buyer's quick-order import judge the minimum of the basket's, order's or request's channel; a channel minimum of 1 means no minimum there. Placement stamps `order_items.returnable_at_purchase` from the order channel's flag, so returns follow it. Without an override nothing changes.
  - **Storefront read model:** `minOrderQuantity` on the product detail and listing summaries is the request channel's value.
  - **Contracts:** new `withChannelOrderRules(records, rules)` puts the rules of `catalogProductAvailabilityPort.effectiveOrderRules` into a set of product records for one seam; `CatalogProductRecord.minOrderQuantity` / `returnable` keep meaning the global values.

- d9a4759: An operator's quote create or edit refused with `409 PRODUCT_ARCHIVED` names the archived products in `details.productIds`; the message stays catalog's `Product is archived.`.
- df0a90e: A buyer's quote line is judged at the request's scope language, as a basket line is. `CreateForCustomerOptions` gains `languageTag` — the request's first `Accept-Language` tag, resolved against the channel's own languages — and `RfqService.createForCustomer`, `patchDraft` and `resubmit` ask `catalogProductAvailabilityPort` and snapshot line and unit names at it; absent, at the channel's default language. `language` is now a message language only: it used to decide the scope too, so a buyer asking in a language the message bundles do not carry (`de-DE` answered in Polish) was quoted a product switched off in that language. The customer quote routes, the basket's conversion to a quote request (`CartConversionService.convertToQuoteRequest`'s options gain `languageTag`) and the buyer's quick-order build to a quote request (`QuickOrderBuildOptions.languageTag`) pass the tag.
- dde1f3e: Creating a quote request in the admin no longer offers archived products: the product browser has no Archived tab and leaves archived products out of All, and the quick search lists them disabled with the reason — as on the order create screen.
- f148418: The storefront probes that take a bare product id follow product data scopes per sales channel and language.

  - **Behaviour change for API clients — price and stock probes:** `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId`, `GET /api/v1/storefront/inventory/stock/:id` and both notify-when-available routes (`POST /api/v1/storefront/inventory/notify-when-available`, `POST /api/v1/catalog/products/:id/notify-when-available`) answer only about a product available at the request's channel and language to the caller now. A product that is switched off there, outside its publication window, sold on another channel or outside the channel's audience rule gets each route's existing `404`, the same body an id nobody sells gets; a notify-when-available request for such a product can no longer reach `409 PRODUCT_UNMANAGED_STOCK` or `422 PRODUCT_IN_STOCK`.
  - **Composition:** `price_lists`' plugin options and `inventory`'s plugin options take `catalogAvailability` (`catalogProductAvailabilityPort`), required; `AvailabilityNotificationService` takes it in place of the sales-channel membership port, and `SubscribeInput` gains `languageTag`.
  - **Caching:** `markPersonalisedPricing` now marks every response for an authenticated caller `private, no-store`, not only one naming an organisation; `GET /api/v1/catalog/filters` and `GET /api/v1/catalog/categories` call it, since their counts and tree follow the caller's audience. Anonymous responses stay unstamped.
  - **Product page:** an archived product answers `410` only where it would be available with the archive taken away; otherwise (switched off in that channel or language, outside its window) it answers the absent product's `404`.
  - **Buyer seams name their channel:** `CreateForCustomerOptions.salesChannelId` (and the draft-edit and resubmit options) carry the channel the buyer's route resolved; quick order's pasted-SKU lookup takes it too; the basket asks availability at its own channel. The audience-only answer remains only for callers outside a request.
  - **Helpers:** `@endora-commerce/contracts` exports `toScopeChannel`, `scopeLanguageOf` and `firstLanguageTag`. `BundleService.validateConfiguration` requires its availability filter.

- eba4fd8: A quote's validity date now binds order placement, not only the conversion into a basket (issue #167). A basket line filled by `convert-to-order` names its quote (`CartItemRecord.quoteRequestId`, column `cart_items.quote_request_id`, backfilled from the basket's `source_quote_request_id`), and placement refuses every line still priced at its agreement with `410 QUOTE_VALIDITY_ENDED` once that quote's `expiresAt` has passed (`details.code: 'lapsed'`), once it no longer applies — re-opened, cancelled, expired or gone (`'withdrawn'`) — or while `quote_requests` is off and nothing can confirm the prices (`'unavailable'`, fail-closed; this used to place the basket at the agreed prices). The order-total preview answers the same verdict as `quoteCommitmentRefusal` (`quoteCommitmentRefusalSchema` in `@endora-commerce/contracts`), `null` when nothing is refused. `QUOTE_VALIDITY_ENDED` declares the three reasons as refusal tokens, with sentences in English and Polish.
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

- b80812d: `QuoteRequestPdfDialog` (_Export PDF_ / _Send PDF to customer_) picks the language in the same update that loads the template choices or changes the template, instead of in a following effect. A click on _Download PDF_ or _Send_ the moment the dialog finished loading could otherwise go out with no `language` while the select already showed one, leaving the server to fall back to the channel's language even where the preselected template does not offer it.
- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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
- Updated dependencies [0e33ca9]
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
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [eeed924]
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
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/page-builder-core@0.109.0
  - @endora-commerce/email-components@0.109.0

## 0.108.0

### Minor Changes

- 0bd5a2b: Quote requests validate packaging units by id and apply minimum order quantities — refused for buyers, flagged for sales reps.

  - **Behaviour change for API clients — packaging validation.** A customer line (create, draft edit, cart → quote request) may carry `packagingUnitId`; it must be a current unit of the line's product, and the server stores that unit's catalogue name and base quantity. A line sending a packaging name and base quantity without an id is accepted only when both match one of the product's units. Anything else is refused whole with `422 PACKAGING_UNIT_MISMATCH`, `details.lines[]` with `index` and `reason`; every failure of an id has the single reason `unknown_unit` (a name gives `name_unknown` or `base_quantity_mismatch`). **A buyer request with a non-matching packaging label is now refused, including a draft edit of an existing request whose stored label no longer matches a catalogue unit.** `packagingUnitId` is returned on the admin and customer reads.
  - **Behaviour change for API clients — buyer writes refused below a minimum.** Customer create (`POST /api/v1/quote-requests`, also from the cart, quick order, a shopping list or an order clone), draft edit (`PATCH /api/v1/quote-requests/:id`) and resubmit answer `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]`. Order: hidden or unpublished products as unknown first, then packaging, then minimums. A draft edit does not refuse a line left unchanged; a line is matched to its stored row by the packaging unit's id first, so a unit renamed in the catalogue since does not make the line "changed" (it keeps its exemption and its stored reference price). Resubmit is judged as a new request; **a resubmit of a request whose product no longer exists now answers `404 PRODUCT_NOT_FOUND`**.
  - **Product names in the response language.** The minimum and packaging refusals of a buyer's create (also from the cart, quick order and a shopping list), draft edit and resubmit name products in the language their sentence is written in (q-sorted `Accept-Language`, else the channel default); `createForCustomer` takes `options.language`.
  - **Sales-rep writes warn.** Create on behalf, Modify, the admin's order clone and the admin quick-order build write below-minimum lines; `GET /api/v1/admin/quote-requests/:id` gives each such line `minimumWarning` (`{ kind, minimum, packagingUnitName? }`), shown as a _Below minimum_ badge on the quote request screen. It never reaches the customer read.
  - `RfqCustomerPort.createForCustomer` accepts `options.minimums` (`'enforce' | 'warn'`).
  - `mod-i18n`'s `core` bundle gains `rfq.detail.minimum.pieces`, `rfq.detail.minimum.packagingUnit` and `rfq.detail.minimum.packagingUnitUnnamed` in English and Polish.
  - Migration `20261018T122118_quote_requests_item_packaging_unit_id.ts` adds `quote_request_items.packaging_unit_id`.

- 73699ad: Custom-field filters on the admin Orders and Quote Requests lists. The fields marked as list filters appear among each list's filters, labelled in the operator's language, and are applied on the server. They are deep-linkable (`cf.<key>.<operator>` in the address), shown as removable chips and kept in saved views. A saved filter on a field that is no longer offered is dropped when the view is loaded, with a notice naming it. A filter the server refuses, for instance one carried in an old link, is reported by the field's name with a button that removes it. The Orders CSV export follows the same filters, and is not offered while a refused filter stands.
- 252b54b: The admin Quote Request list accepts `customFieldFilters`, a JSON object of filters keyed by Quote Request custom-field key, applied on the server and combined as AND with the organization, status and assignment filters. A key the list does not offer is refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it; a malformed value, more than 10 keys or 100 chosen values, or the parameter given twice is 400 `VALIDATION_FAILED`. An operator that does not apply to a field's type, or an inverted range (a minimum above its maximum, a start date after its end), is refused with 400 `VALIDATION_FAILED` rather than ignored or answered empty.

  `GET /api/v1/admin/quote-requests/custom-field-filters` (`rfqs:handle`) lists the Quote Request custom fields the list offers as filters.

  The module's Quote Request custom-field definitions now follow its activation: while `quote_requests` is switched off they are neither offered, served nor writable on the custom-fields admin, and they return unchanged with it.

- cf7a9c0: The Order and the Quote Request detail screens honour `?returnTo=`: opened with a path of the application, their _Back_ leads there and says only "Back" — the convention their create screens already had. Without it, _Back_ still leads to the list.
- 1df7a5e: The Line items table prints a document's groups.

  - **Contracts.** `DocumentCollectionDeclaration` gains an optional `sections(data)` answering `DocumentItemSection[]` (`{ key, kind: 'group' | 'ungrouped', label, itemIndexes, summary }`, with `documentItemSectionSchema` and `DOCUMENT_UNGROUPED_SECTION_KEY`); `isValidSectionPartition(sections, itemCount)` checks one. `itemsTableGroupingSchema` is now a union of `{ by: 'sections', otherItemsLabel, showItemCount }`, `{ by: 'none' }` and the existing field shape (with `by: 'field'` optional) — `itemsTableSectionsGroupingSchema`, `itemsTableNoGroupingSchema`, `itemsTableFieldGroupingSchema`; `itemsTableGroupingMode(raw)` reads a stored value. `documentCollectionDetailSchema` gains `sampleSections` (default `[]`). `documentSectionTexts(language)` answers the default _Other items_ heading and the plural item count in English and Polish.
  - **Changed meaning of a stored `grouping: null`.** It meant _No grouping_; it now means **the document's groups**, which is also what an absent setting means. A document with no group prints exactly as before (the flat definition is unchanged), so this changes nothing until a document has groups — then every template, including those saved before this release, prints them without being edited. A table that must stay flat whatever the document says stores `{ by: 'none' }` (_No grouping_ in the editor).
  - **Document templates.** In that mode, a document holding a group prints per section a heading row (the group's name, the item count when enabled), its rows and one subtotal row per totals row of the table over the section's totals, then _Other items_ and the document's totals. The renderer reads `sections()` once per collection per render; a host that throws, or answers a partition that does not cover its lines, is logged and the table prints flat. Route 2 serves `sampleSections`; the editor's _Grouping_ field offers _Document's groups_, _By field_ and _No grouping_, the _Other items_ heading and _Show item count_, and the canvas draws the sample's groups.
  - **Quote requests.** The quote's `lines` collection declares its sections (`quoteLineSections`), each with the quote's totals rule over its own lines; the editor's sample quote has two groups and an ungrouped line.

- c8aa175: Quote request lines can be arranged in named, ordered groups.

  - **Admin API.** `PATCH /api/v1/admin/quote-requests/:id` and `POST /api/v1/admin/quote-requests` accept `groups` (`{ key, id?, name }`, in display order) and a per-line `groupKey`. A body with `groups` replaces the grouping (an `id` keeps a group across a rename; a stored group not named is deleted; its lines become ungrouped); a body with `items` and no `groups` keeps every paired line in its group; `groups` without `items` answers 400; a group id of another quote answers `422 VALIDATION_FAILED` at `groups.<i>.id`. The grouping is written under the existing row lock and recorded on the `quote_request.modify` / `quote_request.create_on_behalf` audit entry (`stateBefore.groups`, `stateAfter.groups` as `{ name, lineCount }`). A save that only regroups is an ordinary revision.
  - **Replies.** Every quote reply answers `itemGroups` (admin: every group, empty ones included; customer: groups holding a line only) and each item's `groupId` and `position`, with `items` **in display order** — the reply read had no order before. The customer comparison may carry `{ kind: 'grouping' }`; the admin history lists the five new change kinds. Customer bodies accept no grouping (`PATCH` refuses `groups`; a create body's keys are stripped as before); a customer draft edit keeps every paired line's group; resubmission copies none.
  - **One product on several lines.** A quote may hold one product and variant on several lines, in different groups or in one. Lines without an id pair with stored lines by group and quantity first (draft edits, API clients, revision comparisons); the customer comparison pairs revision lines one to one instead of by product, and an entry about a product on several lines names its group (`groupName`), as the admin history's line reference does. A `PATCH` line may carry `splitFromId`: a new line split off a stored line keeps its variant, packaging unit, proposal, note, currency and reference. The _Modify_ tab offers _Split line_; the create screen lets a product be added again and keys its price prefill by line.
  - **Read port.** `quoteRequestReadPort.listItems` answers lines in display order with `position` and `group`.
  - **PDF data.** The document data carries `groups` and each line's `groupId` / `position`, lines in display order; the quote PDF prints them as sections (see the document-sections changeset).
  - **Admin screens.** The detail _Modify_ tab and the create screen group lines with the line groups editor, with a summary per group; _Overview_ shows the groups read-only.
  - **Migration** `20261020T171341_quote_requests_quote_request_item_groups.ts` creates `quote_request_item_groups` and adds `quote_request_items.group_id` (on delete set null) and `position` (default 0, no backfill).
  - `mod-i18n`'s `core` bundle gains `rfq.detail.history.change.{group_added,group_removed,group_renamed,line_group,line_order}`, `rfq.detail.history.ungrouped` and `rfq.detail.history.lineInGroup` in English and Polish.

- 14bcf1d: Every consumer prices on price books (feature 160, D-287 P1), through the one batched resolution chain.

  - **carts** — `cart_items.price_source` (migration `…_carts_cart_items_price_source`) records which tier priced a line (`agreed | base | catalogue | buyer | sale`). `CartLinePricing.orderablePrices` drops the product's own price step, passes the variant, and stores the source.
  - **orders** — `order_items.price_source` (migration `…_orders_order_items_price_source`) is copied from the cart line at placement. The admin order preview and the external order intake price through `resolveLinePrices` instead of one `resolveLinePrice` per line; a line no price book prices is refused, with no `defaultPrice` fallback.
  - **organizations** — the effective price lists of an organization are its effective **price books**: `PriceListReadPort.listForOrganization({ organizationChain, customerGroupId })` answers the books whose audience holds the organization, an ancestor or its group, each with `reason` and `depth`. Old: `listActive()` plus `evaluateApplicationRule` per list. New: one `listForOrganization` call.
  - **product_feeds** — a feed pinned to a price book publishes that book's rows over the channel's catalogue price (`namedListPrices` takes the feed's `salesChannelId`); a product the book does not price is absent.
  - **search** — hits and suggestions price through the batched listing resolution; suggestions pass the request currency.
  - **quote_requests** — reference prices are resolved in the request's currency; the RFQ create prefill and the reference probe call `POST /api/v1/admin/price-books/resolve` instead of `GET /api/v1/admin/products/:id/resolved-price`.

- b0e1abd: A custom-field value that was not carried is recorded with the field's label, so its history line can name the field.

  - **`customFieldCarryPort`** names every skipped key with the **source** definition's label as
    it reads at that moment — `label: { labelDefault, labels }` — a `target_missing` skip
    included.
  - **Records keep the label.** The Order system note (`systemNote.skipped`), the Quote Request
    `custom-field-carry-skipped` event and its `custom_field_carry_skipped` history entry, and the
    Sales Opportunity audit member `customFieldCarry.skipped` store each skip's label next to its
    key and reason. It is a snapshot: renaming the field later does not change history. Skips
    recorded earlier have no label and read as before.
  - An administrator who cannot read custom-field definitions can now be shown which field was
    not carried and why. The values themselves stay visible only to readers with
    `custom_fields:read`.

- 9e0d759: A Quote Request created from a Sales Opportunity receives the Opportunity's carried custom-field values.

  - **`quoteRequestCustomFieldCarryPort`** (`CustomFieldCarryReceiverPort` from
    `@endora-commerce/contracts`) carries a Sales Opportunity's values into a Quote Request's
    **empty** fields in one `quote_request.custom_fields.carry` Command, attributed to the system.
    A value the request already holds is kept. A missing request and one of another Organization
    both answer `not-found`, and nothing is written; when nothing is carried and nothing skipped,
    no audit entry is written.
  - **History.** A value that cannot be carried is named in one `custom-field-carry-skipped` event
    (new value of the `qre_event_type_check` constraint, migration
    `Migration20261021T164808QuoteRequestsQuoteRequestEventCarrySkipped`), shown in
    `GET /api/v1/admin/quote-requests/:id/history` as a `custom_field_carry_skipped` entry with
    `customFieldCarry` (the source Opportunity and every skipped key with its reason). It is
    admin-only: buyer replies leave the event out.

- 56b075d: The _Place order_ action on an approved Quote Request in the Admin UI works. It posted to the storefront's `POST /api/v1/quote-requests/:id/convert-to-order`, which is customer-only: an administrator's session answered `401`, which the Admin UI reads as an expired session, so the operator was signed out — and an accepted call would have seeded the administrator's own basket.

  `@endora-commerce/mod-quote-requests` adds `POST /api/v1/admin/quote-requests/:id/prepare-customer-basket`, behind the module's `rfqs:handle` permission and the sales-representative scope of the other admin actions. It puts the approved request's lines into the basket of the customer who owns the request, at the agreed unit prices — replacing what that basket held, exactly as the customer's own conversion does and under the same rules — and records `quote_request.prepare_customer_basket` in the audit log. The customer completes the order at checkout. `@endora-commerce/contracts` exports its response schema, `adminPrepareCustomerBasketResponseSchema` (`cartId`, `customerAccountId`, `itemCount`).

  The Admin UI button calls it after a confirmation that names the replaced basket, and is labelled _Prepare the customer's basket_ (`@endora-commerce/mod-i18n`, English and Polish).

- e6f3a78: A quote line's unit prices keep four decimal places (owner ruling of 2026-10-25). `quote_request_items.desired_unit_price`, `agreed_unit_price` and `reference_unit_price` are `numeric(14,4)` (`Migration20261025T031736QuoteRequestsUnitPriceFourPlaces`, lossless). A typed desired or agreed price is stored as typed, up to four places (`unitPriceText` now writes four places; a fifth is refused with `400 UNIT_PRICE_PRECISION_EXCEEDED`), a reference price is the resolver's four-place amount, and a cart line's four-place price handed over on conversion is a valid reference. The quote document marks its unit prices (`listUnitPrice`, `proposedUnitPrice`, `unitPrice`, `unitGrossPrice`, `unitDiscount`) as unit prices, carried at four places and printed with their significant places; a line's discount is its list value less its net. The admin screens show unit prices by the same rule, take a typed price at four places, and value a line as its unit price × quantity rounded once.

### Patch Changes

- ee26beb: Documentation for custom-field list filters, in English and Polish.

  - `@endora-commerce/mod-custom-fields` ships its first documentation page: the records that take
    custom fields, creating and editing a field and the limits of editing, the _Use as list
    filter_ option, how each type filters, and the list APIs.
  - The `orders`, `quote_requests` and `crm` pages describe the custom-field filters on their admin
    lists. The `quote_requests` page also says that its fields follow the module's activation. The
    `crm` page explains how the Opportunities list's filters differ from the board's card-field
    filters.

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

- 87ac085: A price is rounded to two places the same way everywhere: half-up on its decimal digits.

  - **`@endora-commerce/contracts`.** New `roundAmountHalfUp(value: string | number): string` — an amount at two places, half-up on its decimal digits (half away from zero when negative). A number is read as the shortest decimal that round-trips it.
  - **`@endora-commerce/mod-carts`.** The basket line stores the resolver's four-place amount through `roundAmountHalfUp`, and the placement drift check (`storedPriceDiffers`) compares with it. `Number(amount).toFixed(2)` rounded the binary double, so a 9.0450 price was stored and charged as 9.04 while the card showed 9.05, and 1.0050 as 1.00 against 1.01.
  - **`@endora-commerce/mod-orders`.** The admin order preview rounds its line prices the same way.
  - **`@endora-commerce/mod-quote-requests`.** A quote line's stored reference price is rounded the same way.
  - **`@endora-commerce/mod-product-feeds`.** Feed prices (`123.45 PLN`) are rounded the same way.

- f367838: A resolver amount stays the decimal string `price_lists` answers with until it is rounded, and it is rounded only by the decimal helpers (`roundAmountHalfUp`, `grossAmountHalfUp`).

  - **`@endora-commerce/mod-product-feeds`.** The feed's price ports carry decimal strings: `NamedListPriceResolver` and `SelectionPricePort` answer `Map<string, string>` (was `Map<string, number>`), `AnonymousPriceResolver` answers `{ amount: string; isSale }`, `NamedListPriceResolvers.one` answers `string | null`, and `FeedItemPrice.net` / `.gross` are strings (`gross` already rounded to two places). A custom item-field resolver or a decoration of these ports reads strings now; the file's figures do not change.
  - **`@endora-commerce/mod-quote-requests`.** A quote line's reference price is rounded from the resolver's decimal string, not from a JS number; anything but a non-negative decimal stores no reference.
  - **`@endora-commerce/mod-comparisons`.** The comparison PDF, its document table block and the admin comparison screen write a price at two places, half-up: a price of 9.0450 was shown as `9.045 PLN`, and 1900 as `1900 PLN`.

- 93f873e: The admin quote request's Modify tab pre-fills an empty agreed unit price with the customer's current price rounded half-up on its decimal digits (`roundAmountHalfUp`), as a stored reference price is. It wrote `toFixed(2)` of the binary double, so a price of 9.0450 was offered as 9.04 and, once accepted, charged as 9.04 against the 9.05 the storefront shows. The current reference price the screen asks for is held at those two places too, and a price already defined on the request is written by the same rule.
- 6f1e0ec: Custom-field carry review fixes.

  - **`@endora-commerce/contracts`** — every string of `customFieldCarrySkipLabelSchema` is at most 200 characters (`CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX`, new export); a longer `labelDefault` or per-locale label is refused.
  - **`@endora-commerce/mod-custom-fields`** — the carry port cuts a skip's label snapshot to that limit, since a definition's per-locale labels are not capped, so every skip it plans parses.
  - **`@endora-commerce/mod-quote-requests`** — the Opportunity → Quote Request carry takes the request's row `for update` and plans over the bag it re-reads under the lock, so an administrator's concurrent edit is never overwritten. A carry that fills a field still raises the request's `version`.

- cec838d: The quote request's _History_ tab renders the `custom_field_carry_skipped` entry: under its title, the sales opportunity the values came from and one line per key not carried, with the reason, in English and Polish. A reason the screen has no sentence for reads "the value could not be carried", never its code.
- f376a45: The admin quote request list's `totalAtAgreedPrice` and `totalAtCustomerPrice` are exact sums, through the customer list's helper `listTotal` (issue #417).
- d34d96c: Quote amounts are computed in exact decimal arithmetic (issue #417). The rules are unchanged.

  - **The quote document** (PDF lines and summary): a line's net, VAT and gross, the unit gross, the list value, the discounts and their percentage, and the summary's net, VAT (on the net total, at the quote's one rate) and gross are computed on decimals and rounded half-up once — 29.50 at 23 % printed a unit gross of 36.28, now 36.29.
  - **Typed unit prices** — an operator's `agreedUnitPrice` and a buyer's `desiredUnitPrice` — are stored half-up on their decimal digits (new `unitPriceText`); `toFixed(2)` stored 1.005 as 1.00.
  - **The admin screens**: the quote's net, VAT and gross (new `quoteTotals`, `quoteNet` in `admin/quote-totals.ts`), the section summaries and the reference difference are exact; 0.70 at 5 % showed a VAT of 0.03, now 0.04.

- 2b8bd26: The quote request list's `totalAtCustomerPrice` and `totalAtAgreedPrice` are exact sums (issue #417, review of PR #423): 3 × 9.05 was published as `27.150000000000002`, now `27.15`. A typed `desiredUnitPrice` (`createQuoteRequestLineSchema`) and `agreedUnitPrice` (`adminCreateQuoteRequestLineSchema`, `adminPatchQuoteRequestLineSchema`) with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED` (`@endora-commerce/contracts`).
- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
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
- Updated dependencies [0d0a1c6]
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
  - @endora-commerce/page-builder-core@0.108.0
  - @endora-commerce/email-components@0.108.0

## 0.107.0

### Minor Changes

- 70bb5e5: Customer draft edits and seller revisions keep line data they used to drop.

  - **Behaviour change — at most 200 lines.** Customer create (`POST /api/v1/quote-requests`) and draft-edit (`PATCH /api/v1/quote-requests/:id`) bodies accept at most 200 lines; a longer list, accepted before, is now refused with `400` and nothing is written. A client that sends more must split the request.
  - **Customer draft edits** (`PATCH /api/v1/quote-requests/:id`) are refused only once an administrator has modified the request (`409 RFQ_NOT_DRAFT`); a customer — or an organization administrator editing a colleague's draft — may now edit a pending draft repeatedly. An edit stores each line's packaging unit as sent. The route is rate-limited to 30 edits per minute per quote request (`429` beyond).
  - **Seller revisions** (`PATCH /api/v1/admin/quote-requests/:id`) keep each surviving line's customer proposal, variant, line note, packaging unit and stored reference price unless the request changes them; `lineNote: null` clears a note. A line the seller adds has no packaging unit.
  - **New peer dependency: `@fastify/rate-limit` (`^10`)**, needed for the route's rate-limit configuration. The platform host already registers it.

- 70bb5e5: New `GET /api/v1/admin/quote-requests/:id/history` (gated by `rfqs:handle` and the sales-representative scope) and a rebuilt History tab on the admin quote-request screen. The stored events are turned into readable, translated entries: records of one decision are merged, every entry names the person who acted (an administrator by name and role, a customer user by name and e-mail, _System_ for expiry and completion), and a modification lists what changed against the previous revision — lines added and removed, quantity, agreed and proposed price, line note, header note and validity date. The reply reads the most recent 100 events and says `truncated: true` when older ones exist. Names are on the admin surface only.

  An admin modification that changes the offer's validity date now records it in the `modified` event's payload as `validity`, and the customer's event payloads may carry that one key.

- 70bb5e5: A per-customer **price negotiation lock**. An administrator decides whether customers may propose prices on quote requests — on the organization (allowed by default) and, as an override, on a customer account (_as organization_, _allowed_, _not allowed_). The effective value is the account's override, else the organization's value, else allowed.

  - **Admin API**: `GET` / `PUT /api/v1/admin/organizations/:id/quote-price-negotiation` and `GET` / `PUT /api/v1/admin/customers/:id/quote-price-negotiation`. Reading follows `customers:read`, writing needs `customers:manage`; a sales representative reaches only organizations they may see (`404` otherwise). Every change is an audited Command with the old and new value.
  - **Admin UI**: panels on the organization and customer screens, shown to roles with `customers:read`; the control is disabled without `customers:manage`. A role with `customers:manage` but not `customers:read` sees no panel.
  - **Storefront API**: `GET /api/v1/quote-requests/price-negotiation` answers the signed-in customer's own effective value (`{ priceProposalsAllowed }`) and nothing else.
  - **Enforcement**: a customer create or draft edit whose lines carry a proposed price — `0` included — while the request owner's value is _not allowed_ is refused with `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED` (translated) and writes nothing. The lock binds the request's **owner**, not the acting user: an organization administrator editing a colleague's draft is judged by the colleague's value. Cart conversion and resubmission carry no proposal and keep working. The seller's side and proposals already stored are not affected.
  - While the module is switched off, the panels, the routes and the enforcement are absent; stored values are kept and apply again when it is switched back on.

- 70bb5e5: Every quote line now stores a **reference price** — the net unit price, per base unit, that the request's customer would pay on a normal order on the request's sales channel — captured server-side on every customer write (storefront form, cart conversion, draft edit, resubmit, quick order, shopping list, order copy) and kept for the life of the request. The admin detail shows it per line beside the customer's proposal, their difference (amount and percentage) and the agreed price; a line with no stored reference shows the customer's current price on the request's channel, labelled as such. The Modify tab shows the same with a live difference, and prefills an empty agreed price with the customer's own price rather than the administrator's storefront price.

  - **The module now depends on `price_lists`** (manifest `dependencies`): the reference is resolved through its `buyerLinePricePort`. `price_lists` cannot be switched off, so no activation control is affected.
  - **For ERP and connector readers of `quoteRequestReadPort.listItems`: a line converted from a cart now has `desiredUnitPrice = null`.** The cart's unit price is its reference — read it from the new `referenceUnitPrice` / `referenceCurrency`.
  - **Customer list totals**: `totalAtCustomerPrice` is `null` unless every line carries a proposal, the rule the admin list already applied. A cart-converted request therefore shows no customer-price total until it is priced.
  - **Admin list totals**: the customer-price total no longer turns `null` at the seller's first revision — a revision now keeps each line's proposal.
  - **CRM opportunity value**: a cart-converted request with no agreed price is valued `0` (it used to be valued at the cart prices recorded as proposals); a revised line the customer left unpriced is valued at the proposal carried from the customer's last draft edit until sales sets an agreed price.
  - A client cannot supply a reference price: an unknown key in the customer body is stripped. A failure to resolve a price stores no reference and never blocks the request.

- 70bb5e5: **A sales representative outside a quote request's organization now gets `404`, not `403`, on every admin quote-request route** — the detail, the new history and every action — the same answer as for an id that does not exist, so the response no longer reveals that the request exists. A client that branched on `403` for "not yours" should treat `404` as that case.
- 05d0650: `quoteRequestReadPort` records now carry `salesChannelId`: the channel the quote request was
  raised on, or `null` for one created outside a channel-resolved request.
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

- d571d8c: Quote request PDF: export and send to the customer (`specs/153-quote-request-pdf-template/`).

  - The module registers the _Quote request_ document type (`quote_requests.quote_request`,
    per-document selection) with four blocks (`QuoteHeader`, `QuoteParties`, `QuoteNotes`,
    `QuoteDetails`), every general-purpose block, the line collection `lines` (list price, discounts,
    net, VAT, gross, product attributes …) and a built-in layout in English and Polish.
  - The quote request screen offers **Export PDF** and **Send PDF to customer** in every state while
    document templates are switched on. The template chosen for a quote is remembered on it and
    audited (`quote_request.set_document_template`); the language is chosen in the dialog.
  - **Send PDF to customer** e-mails the PDF to up to five addresses (the requester preselected)
    through the new transactional e-mail `quote_request_pdf`, editable and switchable like every
    other, with an optional personal message; each send is audited
    (`quote_request.send_document`) and shown on the quote's History.
  - New admin routes under `/api/v1/admin/quote-requests/:id/`: `document-templates`,
    `document-template`, `pdf`, `pdf/send`; new error codes `QUOTE_REQUEST_PDF_TOO_LARGE`,
    `QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE`, `QUOTE_REQUEST_PDF_SEND_FAILED`.
  - Schema: `quote_requests.document_template_id` (nullable, no foreign key) and the `pdf-sent`
    event type. The module now depends on `transactional_emails`.

- b96321c: Saved views on the admin Quote Request list (#290).

  - The Quote Request list's toolbar carries the admin kit's saved-views control beside the column picker: a selector of the admin's own views and every shared view, _Save view_ and _Delete view_. A view is named, private or shared, and stores the list's visibility scope, organization, status selection, search text, sort and visible columns. Loading a view replaces all six and goes back to the first page; a status or column the list no longer offers is dropped, an empty column selection loads the default columns, an unknown sort loads _Newest_, and a view without a scope loads the viewer's default (_All_ for a platform admin, _My organizations_ otherwise). Any admin who can open the Quote Request list (`rfqs:handle`) can use it.
  - Loading a view never widens what the loader sees: the list request that follows is the loader's own, narrowed to the organizations they reach, and a saved `scope: 'mine'` means the loader's assignments. A view stores an organization by id only, and the list never shows the name of an organization the loader cannot see — a captured organization outside their scope shows as an id prefix and an empty list.
  - Four new routes, gated by `rfqs:handle` and by the module's presence: `GET` and `POST /api/v1/admin/quote-requests/list-views`, `PATCH` and `DELETE /api/v1/admin/quote-requests/list-views/{id}`. A view stores the list's filters, and optionally its sort (`{ field, dir }`) and visible columns; `null` for either means the list's default. `GET` returns the caller's own views and every shared view, ordered by name; every item carries `ownedByCaller` and `canModify`. Another admin's private view answers `404`; a shared view is modified or deleted only by its owner or a platform admin (any role except `sales_representative`), `403` otherwise. All four routes answer `401 UNAUTHORIZED` when no admin session resolves.
  - A `PATCH` that changes nothing — an empty body, or every value as already stored — writes nothing and logs nothing; it answers `200` with the current view. It is still refused (`403`/`404`) to a caller who may not modify the view.
  - `PATCH` and `DELETE` answer an `id` that is not a UUID with the same `404 NOT_FOUND` as a view that does not exist.
  - While `quote_requests` is switched off, all four routes answer `503 MODULE_DISABLED` exactly as the Quote Request list does; saved views are kept and are served again once the module is back.
  - Names are trimmed, 1–160 characters, without control or format characters. One admin cannot hold two views on the quote request list whose names differ only by letter case or surrounding spaces: `POST`, and a `PATCH` that changes the name, answer `409 RFQ_SAVED_VIEW_NAME_TAKEN` with a translated message (English and Polish). The rule binds the view's owner.
  - New table `quote_request_list_saved_views`, created by the migration `Migration20261014T173236QuoteRequestsQuoteRequestListSavedViews`, with a unique index on the owner and the lower-cased name.
  - When a platform admin changes or deletes another admin's view, the `quote_requests` module logs one `info` record (`event: 'saved_view.updated' | 'saved_view.deleted'`, `list`, `viewId`, `ownerAdminUserId`, `actorAdminUserId`).

  `@endora-commerce/contracts` gains the `ERROR_CODES.RFQ_SAVED_VIEW_NAME_TAKEN` member.

### Patch Changes

- b4fbb1c: **Create quote request** adds lines through **Browse products** — the admin kit's shared product
  browser, many products at once — and a quick search by name or SKU beside it; the per-row product
  search and **Add line** are gone. Draft and inactive products can be added; grouped and bundle
  parents are shown with a reason and cannot; a product already on the request is marked as already
  added. Each line shows name and SKU, an editable whole-number quantity (default 1), an editable
  agreed unit price and remove.

  The agreed unit price is prefilled from the customer's price lists through a queue with at most
  four requests in flight, and a response is applied only while it still answers the line's current
  product, quantity and customer. **A hand-typed agreed price is no longer overwritten** — before,
  changing the quantity or the customer replaced it. A prefilled price answers one quantity, so
  once the quantity is no longer a valid one that price is cleared and the line is marked. On a
  customer change every price not typed by hand is cleared and resolved again for the new
  customer, so it may become empty; lines added before a customer is chosen are prefilled once one
  with an organization is.

  **Incomplete lines block submit instead of being dropped**: a line with no agreed price or an
  invalid quantity is marked and the request cannot be sent until it is fixed or removed; every line
  on screen is sent. The running total counts the lines with both a valid quantity and a price.

  The `core` bundle gains `rfqCreate.items.browse`, `rfqCreate.items.quickSearch`,
  `rfqCreate.items.empty`, `rfqCreate.line.priceMissing` and `rfqCreate.line.quantityInvalid` in
  English and Polish, and loses `rfqCreate.addItem`, which nothing reads any more.

- 64aabf5: The customer draft-edit rate limit (`PATCH /api/v1/quote-requests/:id`, 30 edits per minute per quote request) is now counted after the customer guard and keyed on the customer as well as the request. An unauthenticated caller naming a request's id is answered `401` without consuming the owner's budget, and one customer's edits no longer spend another's. Only a well-formed request id enters the key; any other `:id` counts against one bucket per customer, so varying the path no longer mints a fresh budget.
- 34f97ae: Callers of the cart ports name the basket's sales channel (`specs/154-sales-channel-access/`):
  quick-order builds and one-click buy fill the basket of the request's channel (one-click now
  always places on that channel), converting an approved quote request seeds the basket of the
  request's channel (`RfqService.convertToOrder` takes the channel), and converting a shopping list
  fills the basket of the request's channel (`ShoppingListService.convertToCart` takes the channel
  as its fourth argument).
- 53b3482: The Quote Request expiry sweep holds each request to `quote_requests.expiry_days` resolved for its own sales channel. It read the default channel's value and applied it to requests of every channel, so a channel set to `0` was not exempt and a channel with its own number of days was held to the default's. A request with no channel is held to the default channel's value, as before, and the `expired` history entry records the value that applied.

  **On upgrading:** a channel that already has its own value starts following it on the sweep's first runs. A channel with a lower value than the default expires its backlog of requests that have been quiet that long, and a channel set to `0` stops expiring. Read the per-channel values of _Auto-expire pending after (days)_ before upgrading if that matters.

  `@endora-commerce/mod-settings`: the setting's help text says so in English and Polish.

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
- Updated dependencies [ad55813]
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
  - @endora-commerce/page-builder-core@0.107.0
  - @endora-commerce/email-components@0.107.0

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

## 0.105.0

### Minor Changes

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

- fe96d30: The Quote Request expiry sweep runs. Until now nothing called it.

  `RfqExpiryWorker.sweep()` was built, exposed on the module's handle and documented as running every
  30 minutes, and no scheduler, timer or command ever reached it. With `quote_requests.expiry_days`
  set, a Pending or Created from admin Quote Request never became `Expired`, nobody was told, and
  `rfq.expired.v1` was never emitted.

  **This changes what a running instance does.** The module now installs a BullMQ Job Scheduler on the
  queue `quote_requests.expiry.sweep` and a consumer for it, in every process that consumes queues.
  It fires every 30 minutes and stops with the module.

  **Which requests it expires.** `quote_requests.expiry_days = 0`, the default, disables the sweep.
  Otherwise a request is expired when all three hold:

  - it is still `Pending` or `Created from admin`;
  - nothing has been added to its history for `expiry_days` — the clock is the request's latest
    history entry, so a submission, an edit, a revision or a note restarts it, and the customer merely
    opening the request, or an assignment, does not;
  - **it carries no offer that is still valid**: when the seller dated an offer (`expiresAt`), that
    date wins, and the request is never expired by inactivity while the date is ahead. The sweep does
    not expire a request because its validity date passed; that date is enforced on accept and
    convert, as before.

  **Turning the setting on expires the backlog — read this before upgrading or changing it.** The rule
  applies to everything that is open, not from the day it is set. Moving `expiry_days` from `0` to
  `N`, or lowering it, expires over the next ticks every open request that has been inactive for more
  than `N` days. Releases up to 0.104.0 never ran the sweep, so an instance that already has the
  setting set meets the same backlog on the first ticks after this upgrade:

  - they all become `Expired`, get their `expired` history entry, and `rfq.expired.v1` is emitted for
    each;
  - **no notification record is written for a request that became due more than 24 hours before the
    tick that reached it.** A property of every run, not of the first one;
  - at most 500 requests are expired per tick, oldest first.

  Set `quote_requests.expiry_days` to `0` before upgrading to review the open requests first. The
  sweep reads the value of the default sales channel and applies it to requests of every channel; a
  channel set to `0` is not exempt.

  **The sweep and an answer are mutually exclusive.** A buyer's accept or decline, a customer's edit,
  and a seller's approve, revise, cancel or assign now take the request's row and check its `version`
  before writing; the sweep skips a request that is held. A transition that loses to the sweep — or
  to any other concurrent transition — is refused with `409 VERSION_CONFLICT`, where it used to
  succeed and overwrite. Before this, an accept racing the sweep answered `200` and left a request
  `Approved` with `expiredAt` set and an `rfq.expired.v1` announced for it.

  Also fixed in the sweep itself:

  - **A request that fails is retried later, not first.** The worker process leaves a request whose
    expiry failed alone for two hours, so requests that keep failing cannot be the head of every
    batch.
  - **A failure no longer loses events.** The pass flushed every due request to `Expired` and then
    walked them; a throw on the second of three left three requests `Expired`, one announced, and
    nothing for the next pass to find. Each request is now one transaction — status, history row and
    notification rows together — and its event is emitted after that transaction commits. A request
    that fails stays due for the next tick and does not stop the others.
  - **`rfq.expired.v1` carries `organizationId`**, the Organization the request belongs to. An
    additive field.
  - **An idle tick writes no audit row.** The tick asks whether anything is due before it enters its
    system scope.

  `RfqExpiryWorker.sweep()` now resolves to `{ expiredCount, failedCount,
notificationsSuppressedCount, reachedBatchLimit }`; `expiredCount` is unchanged in meaning.
  `RfqEventService.append` and `RfqNotificationService.enqueue` accept an optional transactional
  EntityManager.

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

## 0.104.0

### Minor Changes

- 32775d5: Two additive seams for other modules; an instance in which nobody uses them behaves as before.

  - **A new in-process event, `rfq.created_by_admin.v1`** (`rfqId`, `organizationId`,
    `adminUserId`, `origin | null`), emitted once per quote request created through
    `POST /api/v1/admin/quote-requests`, which accepts an optional opaque `origin: { type, id }`
    and hands it on unread. `rfq.created.v1` is still emitted for a customer's own submission
    only, so nothing that listens to it starts seeing requests an administrator prepared.
  - **The create screen (`/quote-requests/new`) can be opened by another screen**: it reads
    `originType`, `originId`, `organizationId`, `customerAccountId` and `returnTo` from its query
    string. Opened without them it behaves as before.
  - **A new admin zone, `quote_request.detail.after`**, mounted once at the end of a quote
    request's screen with `{ quoteRequestId }`. The module names no contributor; with nothing
    contributed the screen is unchanged.

- 85793d6: A quote request that a customer orders is now completed by that order.

  `POST /api/v1/quote-requests/:id/convert-to-order` has always seeded the basket at the agreed
  prices; it now also marks the basket with the quote request, so the order placed from it
  records `sourceQuoteRequestId` (see `@endora-commerce/mod-orders`). The module's existing
  `order.created.v1` subscriber — which sets `Completed`, `converted_order_id` and sends the
  `completed` notification — had nothing to react to until now, so **on upgrade, accepted quote
  requests start being completed when they are ordered, and a completed one can no longer be
  converted a second time** (`409 RFQ_NOT_QUOTED`). Quote requests ordered before the upgrade
  stay `Approved`; nothing is backfilled.

  Two changes to that subscriber:

  - It waits for the order's commit. The event is announced from inside the placing
    transaction, so the order is sometimes not readable yet; the subscriber now looks again —
    off the event bus, for a little over two seconds — instead of giving up at the first read.
    An order that is still not readable after the last look is **logged at `warn`**, naming the
    order: almost always a placement that rolled back, and otherwise an order whose quote request
    was left `Approved`.
  - It never completes a quote request for an order of another organization.

  **Breaking for anyone composing `quoteRequestsModule(...)` by hand**: `QuoteRequestsModuleOptions`
  gains two required members, `deferAfterCommit(work)` and `isStillPresent()`. The packaged
  composition (`registerModule`) supplies both.

  The response of `convert-to-order` is unchanged, and so is every other route.

### Patch Changes

- 8820b6f: **A quote request is accepted, approved and ordered only once the seller has priced it.**

  A quote line is sold at the unit price the seller agreed, and a line the seller has not priced has
  no price at all. Three operations now hold that rule, and each answers `409` when it is not met:

  - `POST /api/v1/quote-requests/:id/accept-revision` answers `RFQ_NOT_QUOTED` when the seller has
    made no offer to accept — the request is neither `Created from admin` nor awaiting the customer's
    acceptance of a seller revision — and `QUOTE_INCOMPLETE` when the seller's offer leaves a line
    without an agreed unit price.
  - `POST /api/v1/admin/quote-requests/:id/approve` answers `QUOTE_INCOMPLETE` while any line has no
    agreed unit price. An operator who wants to approve a request as the customer raised it prices
    every line first (`PATCH /api/v1/admin/quote-requests/:id`), then approves.
  - `POST /api/v1/quote-requests/:id/convert-to-order` answers `QUOTE_INCOMPLETE` while any line has
    no agreed unit price, whichever way the request came to be approved.

  `QUOTE_INCOMPLETE` was already one of the module's declared error codes and nothing raised it; it
  and `RFQ_NOT_QUOTED` now carry a real sentence in English and Polish in place of the generated
  placeholder.

  What an instance should expect:

  - The rules are about a **missing** price. An agreed unit price of exactly `0` that an operator
    entered is an agreed price like any other, and such a request is accepted, approved and ordered
    as before.
  - `reject-revision` is unchanged: a customer can still withdraw a request the seller has not
    answered.
  - **A request that is already `Approved` with an unpriced line can no longer be converted into an
    order — that is intended.** Its lines cannot be edited in that status, so the way forward is
    `resubmit`, which raises a new request for the seller to price. To find them:

    ```sql
    select distinct qr.id, qr.business_id
      from quote_requests qr
      join quote_request_items it on it.quote_request_id = qr.id
     where qr.status = 'Approved' and it.agreed_unit_price is null;
    ```

  - Orders already placed are not touched. An order placed from such a request before this release
    carries the unit price it was placed at; the same query with `qr.status = 'Completed'` lists the
    requests to review.

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
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

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

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.11.7

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.11.6

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
  - @endora-commerce/platform@0.13.3

## 0.11.5

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.11.4

### Patch Changes

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
  - @endora-commerce/platform@0.13.1

## 0.11.3

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

## 0.11.2

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.11.1

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.11.0

### Minor Changes

- 6b2ed26: `QuoteRequestReadPort` gains `findByBusinessId(businessId)`, answering the quote carrying a
  human-facing business id or `null`.

  It exists because `comarch_xl` needs it: an ERP offer names the quote it answers by the
  reference a person read off the document, never by the uuid. The connector had been reading
  `quote_requests` with a raw `select`, which crosses the module boundary without any
  specifier naming it and keeps returning rows after an operator has switched
  `quote_requests` off. Consumers resolve it through the container name
  `quoteRequestReadPort`, as they do the other three methods.

### Patch Changes

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

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

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

### Patch Changes

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
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

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

## 0.7.0

### Minor Changes

- a28c796: `invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
  host is a module package.

  **New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
  `@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
  nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
  the hand-written host registrations carried:
  - `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
    `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
    every `GET` behind those four screens enforces; each screen keeps gating its own writes on
    `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
    two template screens deliberately have no row: they are reached through
    `InvoiceSectionTabs`, which this package already owned.
  - `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
    `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
    `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
    `open-ksef` palette action has always named.
  - `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
    `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
    its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains one zone member and its props.**
  `AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
  new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
  changes. A host mounts it with

  ```tsx
  <AdminZone name="invoice.detail.after" props={{ invoiceId, kind, ksefReferenceNumber }} />
  ```

  and a contributor declares
  `zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
  whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

  **`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
  `InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
  proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
  the panel. Neither package names the other in any specifier. It is a zone and not a published
  component because the panel's signature is three values in and nothing out; and it carries no
  `match`, because the place has a single host and a single mount, and `match` has no negation to
  write "not a proforma" with.

  **`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
  `appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
  `appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
  (`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
  own `i18n/` bundle in both shipped languages.

- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- d5f7022: The validity deadline an operator sets on a Quote Request is enforced again.

  `expiresAt` — written from `expiresInDays` by `RfqAdminService.modify` and
  `createOnBehalf`, serialised into `QuoteRequest`/`QuoteRequestSummary`, and shown to both
  parties as `expires <date>` — was read by no rule. The feature-008 workflow rewrite
  (`4f24dc948`) dropped the live check `accept()` carried and nothing replaced it, so a
  customer could accept a revision and convert an approved quote to a cart at its agreed
  unit prices for ever. `RFQ_EXPIRED` and `QUOTE_VALIDITY_ENDED` stayed enumerated in
  `ERROR_CODES` with sentences in both shipped languages, raised by nothing.

  **Two customer transitions now refuse**, both with `410`, both only when the operator
  actually set a deadline (`expiresAt` absent still means no deadline):
  - `POST /api/v1/quote-requests/:id/accept-revision` → `RFQ_EXPIRED`
  - `POST /api/v1/quote-requests/:id/convert-to-order` → `QUOTE_VALIDITY_ENDED`

  The two codes are the split
  `specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md` already made —
  the offer that lapsed undecided, and the accepted quote that ran out — restored rather
  than invented. Neither is redundant: they carry different remedies, and a client
  discriminating on `error.code` can say which happened.

  **Nothing else changes.** `reject-revision` and `resubmit` stay open — declining a lapsed
  offer consumes no committed price, and resubmit is the buyer's way forward; it raises a
  new request carrying no deadline. Every admin path is untouched, so the operator can
  re-quote a lapsed request with a fresh `expiresInDays` and the customer can then accept.
  The expiry worker is a different concept and is not touched: it sweeps `updatedAt` against
  a settings-wide `expiryDays` and never reaches `Approved`.

  **If you consume the customer routes**, handle `410` on those two paths. The envelope
  carries the code and the module's own translated sentence; the placeholder strings under
  `errors.RFQ_EXPIRED` and `errors.QUOTE_VALIDITY_ENDED` are replaced with real prose in
  `en` and `pl`.

  There is no data migration. A request whose `expiresAt` is already in the past refuses on
  both paths from the moment this lands — that is the rule, not an accident of deployment.

- f1ff167: New package: the Quote Requests (RFQ) module, the second to leave `backend/src/modules/`
  (feature 080, T040b).

  Three subpaths, no root wildcard, every one of them compiled output (D-164):
  - `@endora-commerce/mod-quote-requests` — the manifest. Isomorphic,
    `@endora-commerce/contracts` its only import, and where the generated manifest index reads
    the module's identity, settings, palette action and activation control from.
  - `@endora-commerce/mod-quote-requests/backend` — `registerModule(ctx)`, the two ports it
    publishes (`quoteRequestReadPort`, `rfqService`), and the `entities` array the host's ORM
    registry spreads. **No entity class is exported by name** (D-168): the five
    `QuoteRequest*` classes are imported by the barrel to build that array and nothing else,
    so `import type { QuoteRequest } from '@endora-commerce/mod-quote-requests/backend'` does
    not compile in a consumer's tree, whoever the consumer is.
  - `@endora-commerce/mod-quote-requests/migrations` — the `migrations` array the platform's
    package loader reads, plus the six migration classes by name for the host's migration
    registry. The names are contract in a way an entity class name is not: they are what
    `mikro_orm_migrations` persists, so every already-migrated database holds them as strings.

  `@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are `@mikro-orm/*`,
  `fastify` and `zod`. Unlike `mod-blog` this package declares no `ioredis` peer, because it
  imports none: it keeps no cache of its own, and `RfqExpiryWorker` is a plain `sweep()` a
  caller drives — the name is historical, there is no BullMQ consumer behind it.

  The manifest id stays `quote_requests` — identity of record for the lifecycle registry, the
  settings store, the `rfqs:handle` permission code, the i18n bundle paths and the ownership of
  all six migrations (D-142). The npm name is only how npm keeps names unique.

  **What this package proves that `mod-blog` could not.** It ships six migrations rather than
  one, so the per-module ordering chain has more than one link, and its `ctx.subscribe`
  subscriber **writes** — `order.created.v1` completes the originating quote request — so a
  test can tell a registered subscriber from an unregistered one, which is the obligation the
  first module package left uncovered.

### Patch Changes

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

- 67eeced: `quote_requests` declares the nine error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the
  `RFQ_`/`QUOTE_` prefix rule in `@endora-commerce/mod-i18n`, which continues to
  answer identically for every one of them: the list is the chain's own answer,
  copied from the frozen capture, and is asserted equal to it in both directions.

  No `tokens` are declared: none of the nine carries a refusal discriminator —
  all ten raise sites of the three codes anything raises pass no `details.code`,
  and the other six are raised by nothing at all.

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
  - @endora-commerce/platform@0.7.0
