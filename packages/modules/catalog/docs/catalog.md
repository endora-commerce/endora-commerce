---
title: catalog
sidebar_label: Catalog
description: Products, variants, categories, attributes, sales channels
---

# `catalog`

The product catalog: Products, ProductVariants, Categories,
ProductAttributes, and SalesChannels. Owns all read paths the storefront
depends on and the admin-side authoring surface.

## Public surface

Admin routes are gated by `catalog:read` (list / get) /
`catalog:write` (mutations).

The storefront reads that carry a price — the product list, the product detail and
`/products/:idOrSlug/links` — accept `?currency=` (an ISO 4217 code). The response is priced in
that currency when the Sales Channel offers it, and in the channel's default currency
otherwise; every price names its currency either way. A malformed code is refused with
`400 VALIDATION_FAILED`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/products` | storefront / API key | List/search/filter products in the active Sales Channel |
| `GET /api/v1/catalog/products/:idOrSlug` | storefront | Product detail (no amount where the viewer's price display mode is *None*) |
| `GET /api/v1/catalog/categories` | storefront | Nested category tree |
| `GET /api/v1/catalog/categories/:id/content` | storefront | One category's page content, resolved to the caller's language |
| `GET /api/v1/catalog/filters` | storefront | Filterable attributes for the active Sales Channel |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | SEO sitemap |
| `GET /api/v1/admin/catalog/products?status&archived` | admin | Admin product list. `status` is `active` or `inactive` (any other value: `400 VALIDATION_FAILED`); `archived` is `exclude` (default), `include` or `only` — the legacy `includeArchived=1` means `include`. `counts` is `{ all, active, inactive, archived }` — see *Product status and archiving* |
| `GET /api/v1/admin/catalog/products/:id` | admin | Product detail |
| `POST /api/v1/admin/catalog/products` | admin | Create product (`type` immutable post-create; `sku` is editable) |
| `PATCH /api/v1/admin/catalog/products/:id` | admin | Update (incl. `sku`); writes an audit row with stateBefore / stateAfter; refuses with `409 sku_in_use` if the new SKU already belongs to another product |
| `DELETE /api/v1/admin/catalog/products/:id` | admin | Delete (soft) — not the Archive action |
| `POST /api/v1/admin/catalog/products/:id/archive` | admin (`catalog:write`) | Archive one product — see *Product status and archiving* |
| `POST /api/v1/admin/catalog/products/:id/restore` | admin (`catalog:write`) | Restore one archived product |
| `GET`, `POST /api/v1/admin/catalog/products/list-views`; `PATCH`, `DELETE …/list-views/:id` | admin | Saved views on the product list — see *Saved views* below |
| `GET /api/v1/admin/catalog/attributes` | admin | List attributes |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | admin | Picker payload — every attribute carrying the requested flag |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | admin | Single attribute read |
| `POST /api/v1/admin/catalog/attributes` | admin | Create attribute (accepts the new flags + inline `options[]` for select-style types) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isPriceRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition` (re-emits `attribute.updated.v1`) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | admin | Delete; refused with `409 attribute_in_use_by_set` while any Attribute Set still references it |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | List option-list rows for select/enum/multiselect attributes |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Append an option |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | admin | Patch label / labelDefault / isDefault / sortOrder (option `value` is immutable) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | admin | Remove; refused with `409 option_in_use` while any product still carries the value |
| `POST /api/v1/admin/catalog/attribute-set-preview` | admin | Preview which Set's attributes will be edited / hidden when an operator switches a product's Attribute Set |
| `GET /api/v1/admin/catalog/categories` | admin | Flat list, the UI folds into a tree |
| `POST /api/v1/admin/catalog/categories` | admin | Create (parent must exist) |
| `PATCH /api/v1/admin/catalog/categories/:id` | admin | Update; reparenting walks the new parent's chain to refuse cycles (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | admin | Soft-delete; rejects with 409 if any active child still references the row |
| `GET /api/v1/admin/catalog/categories/:id/content` | admin | The category's page content — one Page Builder document per language ([Category page content](./catalog/category-content.md)) |
| `PUT /api/v1/admin/catalog/categories/:id/content` | admin | Replace the category's page content; `null` clears it |
| `PUT /api/v1/catalog/products/by-sku/:sku` | API key | Idempotent upsert (PIM sync); an update is audited as `product.update` naming the key (`apiKeyId`) and is never checked for completeness |

## Product status and archiving

A product's **status** is `active` or `inactive`, globally and as an override per
Sales Channel and per channel × language. `inactive` at any scope is plain **off**
there: the product is not listed, not searchable, not orderable and its page answers as
a product that does not exist. Switching a product off never archives it. New and
duplicated products start `inactive`. Any other status value is refused with
`400 VALIDATION_FAILED` — on the admin API, the API-key upsert
`PUT /api/v1/catalog/products/by-sku/:sku` and an import; archiving is not a status.

**Archiving** is a separate, product-wide action, offered as **Archive** and
**Restore** (`POST …/products/:id/archive`, `…/restore`) and gated by `catalog:write`.
Archive sets the product's archived time and takes it out of every channel; Restore
clears it. Neither changes the status at any scope, and each writes one audit entry
with the archived time before and after. Archiving an archived product, or restoring
one that is not archived, answers `200` and changes nothing — no audit entry, no event.

- **Bulk.** `POST /api/v1/admin/catalog/products/bulk-update` with
  `fields: { archived: true }` archives every selected product, `false` restores them,
  each through the same action and audit entry. `archived` must be the only field of
  its request. Large selections run as a background bulk operation, and the
  operation's undo puts every product back as it was. A background operation audits
  each product with the admin who requested it, as a direct one does. Archive and
  Restore lock the product, so two concurrent Archives of one product archive it once.
- **Setting `active` never restores.** An archived product stays archived whatever its
  status; only Restore brings it back. Restoring an `inactive` product leaves it off.
- **Products archived before this change.** Until this release a product was archived by
  setting it `inactive`. Every product `inactive` at the upgrade therefore stays
  archived (keeping its archived time, or its last-update time when it had none), and
  **needs an explicit Restore** to come back — setting it `active` alone leaves it
  archived.
- **The product page.** An archived product's page answers `410 PRODUCT_ARCHIVED`
  ("gone"), but only to a buyer who could otherwise see it there: the check takes the
  archive away and reads the global status as `active`, while every channel and channel
  × language status, the membership, the channel's languages, the publication window and
  the audience still apply. Everywhere else, and for any product that is off without
  being archived, the page answers `404` exactly as for a product that does not exist.
- **The admin list.** Archived products are hidden by default, whatever their status;
  `archived=only` lists them and `archived=include` lists them beside the rest. The
  `inactive` count and filter cover products that are off but not archived.
  On the product list the **Archived** tab has its own address,
  `/catalog/products/archived`, so the browser's Back button and a reload return to it, and
  the command palette (⌘K / CTRL+K) opens it as **Archived products** — search for
  "archived" or "archiwum".
  With a selection, its bar offers Restore, Bulk edit and Delete; **Edit price** is shown
  on the other tabs but disabled, because prices are set in price books.
- **From the admin assistant.** The assistant's `catalog.archive_product` and
  `catalog.restore_product` tools (`catalog:write`) archive and restore products after
  you confirm the plan it shows, through the same action and audit entry, with you as
  the actor; larger selections run as the bulk operation above. Its status tool,
  `catalog.set_product_status`, only switches products on or off and never archives or
  restores, and its product search lists archived products and says which they are.

### Status per channel and language, in bulk

`POST /api/v1/admin/catalog/products/bulk-update` with
`fields: { scopedStatus: { channelId, languageCode, value } }` sets the status of every
selected product at one scope — the Sales Channel (`languageCode: null`) or one
channel × language — to `active` or `inactive`, or removes the override there with
`inherit`. Only that scope changes on each product; every other scope and the global
status stay as they were. A product that is not in the channel, or a language the
channel does not offer, is skipped and reported as `scope_invalid` — the product is
never added to the channel. `scopedStatus` cannot be combined with `status` in one
request. Each product's change is one audit entry naming the scope; large selections
run as a background bulk operation whose undo puts every scope back as it was and
reports any product changed since.

### Completeness check when switching a product on

When an operator's **status change** switches a product on for a sales channel and
language — the global status, a channel or channel × language status, single or in
bulk — the product must have, in that language: a **name** (its own name in that
language, or a name overridden for that channel; a name in another language does not
count), a **URL key** (the global key counts) and every **required** language-dependent
attribute of its attribute set. The setting **Completeness check when switching a
product on** (`catalog.scope_completeness_gate`, one value for the whole platform)
decides what happens when something is missing:

- **`warn`** (the default) — the change is saved and the answer lists what is missing
  per channel and language (`warnings`, kind `completeness`).
- **`refuse`** — the change is not saved: `422 SCOPE_INCOMPLETE` names every channel and
  language with what it lacks. A change that would switch the product on in several
  places is refused as a whole if any of them fails. In a bulk edit the products that
  pass are changed and the others are skipped as `completeness_gate`.

Only a status change is checked. A product that goes live because it joins a channel,
a channel gains a language, its publication window opens, its audience changes, or it
is restored is not checked; the **scope overview** of the product editor shows what is
missing at every channel and language instead. Setting an archived product `active` is
checked like any status change, although the product stays archived. Imports, PIM
synchronisation and the API-key upsert are never checked.

## Prices

**A product carries no price of its own.** Every price is a row of a price book of the
`price_lists` module: the product's base price per currency, its variants' prices, and any
catalogue, buyer or sale price. Set a product's base price on the product editor's **Pricing** tab
— the *Base prices* panel there, and the list of the price books that price the product, are
contributed by `price_lists` — or in the base book's grid. Variant prices are set in the same
places, never on the variant itself. The `price_lists` module's page explains how the price a
buyer pays is chosen.

- **Listing cards, the product page and related products** show the viewer's own price — their
  organization's and customer group's prices on the request's sales channel and currency. A product
  whose variants cost different amounts shows its lowest price as a *from* price
  (`ProductSummary.price` carries `variesByVariant` and `maxAmount`); a charged sale carries the
  buyer's regular price as the compare-at price; with `pricing.show_list_price` on, a lower buyer
  price carries the catalogue price as `listPrice`. A product nothing prices has no price and
  follows the quote-request path.
- **Sorting and filtering by price** — `?sort=price`, `?sort=-price`, `minPrice`, `maxPrice` on
  `GET /api/v1/catalog/products` — order and select by the same quantity-1 price the cards show to
  that viewer, the *from* price for a variant product. Priced products always come before unpriced
  ones. A price ordering is always answered from PostgreSQL, never from the search index. Paging
  through a price ordering with the cursor meets every product once, provided its price does not
  change meanwhile; a product repriced during the walk may be met twice or not at all, as with any
  cursor over a live price. A page may be short, or even empty, and still have more after it
  (`hasMore: true`) when most of the rows it read are hidden from the viewer; follow its cursor.
  The cursor of a price ordering or a price range is sealed: it cannot be read or altered, because
  the position it continues from can be a product the viewer may not see. A cursor that does not
  open — altered, issued by a release before the seal, or before the instance's session key was
  changed — starts the listing again at its first page.
- **Reading named products** — `?ids=<id>,<id>,…` on `GET /api/v1/catalog/products` restricts the
  listing to those products: at most 24 distinct ids, each a uuid, or `400 VALIDATION_FAILED`. The
  answer is the subset the viewer may see, priced exactly as any listing card for that viewer, in
  the listing's own order — a caller that cares about its order re-orders by id. It combines with the
  other filters and is always answered from PostgreSQL. A blog post's related products are read this
  way.
- **Where the viewer's price display mode is *None*** — for instance an anonymous visitor on a
  channel that hides prices until sign-in — the listing and the product detail carry no amount, and
  a price ordering or range is refused for that page. Sales channels have no price-visibility flag
  of their own any more: the display mode decides, for each viewer.

For developers: the listing paths price a whole page in one batched call —
`resolveListingPrices`, or `resolveListingPriceDetails` where the page renders the split
(`ProductSummary.resolvedPrice`: `basePrice`, `salePrice`, `listPrice`, `displayMode`) — through the
`pricingService` port slices of `@endora-commerce/contracts`, passing the viewer's organization and
customer account rather than a resolved group. A price ordering reads `ListingPriceOrderPort`
(`orderByUnitPrice`, `pricedProductIds`) over `price_lists`' precomputed price surface and composes
the unpriced tail itself (`catalog-query.service.ts`). The external catalogue API prices through
`resolveLinePrices` and builds a bound organization's tier ladder from `listTierStarts`. Product,
category and attribute writes publish the events `price_lists` subscribes to, which clear the
pricing caches and mark on the price surface the products each event concerns, for the surface
worker to refresh.

### Removed price fields (migration note)

The release that introduced price books removed the product's *Default unit price* (the
`defaultPrice` and `price` keys of `attributeValues`, and the editor field) and the variant price
override (`product_variants.price_override`, and the variant editor's price field), without
converting either. Product and variant create and update, and the products import, refuse those
fields with `400 PRICE_SET_IN_PRICE_BOOKS` (`PRICE_FIELDS_REFUSED_ON_PRODUCTS`,
`PRICE_FIELDS_REFUSED_ON_VARIANTS` in `@endora-commerce/contracts`), saying that prices are set in
price books. The catalogue's migration `20261022T111811_catalog_price_fields_removed.ts` dropped the
column and stripped the keys.

## Entities

`Product`, `ProductVariant`, `Category`, `ProductAttribute`,
`SalesChannel`, plus the M:N bridges
`product_categories`, `sales_channel_products`, `product_assets`, and
`ProductListSavedView` (`product_list_saved_views`, the product list's saved
views).

## Saved views

A saved view is a named set of product-list filters that an admin can apply
again with one selection.

### Using saved views

The product list's toolbar carries a **Saved views** selector, whose first
entry is **— Select a view —**, and two buttons beside it: **Save view** and
**Delete view**.

- **What a view remembers.** The status, the type and the search text — and
  nothing else. The **Stock**, **Category** and **Channel** chips are not saved.
  Choosing a view sets status, type and search to the view's values (a value
  the list no longer offers loads as *All*), resets the Stock chip to *All*,
  discards anything you had changed and not saved, clears the row selection and
  goes back to the first page.
- **Saving.** **Save view** opens one dialog with a **Name** field and a
  **Share with every admin who can open this list** checkbox. The checkbox
  starts unchecked, so a new view is private unless you tick it. The name is
  required, leading and trailing spaces are removed, and it can be at most 160
  characters long. Problems are shown on the field and nothing is sent until
  they are fixed; a refusal from the server is shown inside the dialog, which
  stays open with what you typed.
- **Private or shared.** A private view is listed only for you. A shared view
  is listed for every admin who can open the product list, with **(shared)**
  after its name. The selector does not show who saved a shared view.
- **One name per admin.** You cannot hold two views on this list whose names
  differ only in letter case or in surrounding spaces. The dialog answers
  **You already have a view with this name.** before sending anything, and the
  server refuses the name as well. Accented letters are different letters:
  *Wózki* and *Wozki* are two names. Names other admins use, and names used on
  other lists, do not count.
- **Deleting.** **Delete view** is enabled only when the selected view is one
  you may delete. It asks for confirmation and names the view —
  **Delete the view “…”?** — and for a shared view adds that it will disappear
  for every admin who can open this list. Nothing is deleted until you press
  **Delete**.
- **Who may delete or change a shared view.** Its owner, or **any admin whose
  role is not `sales_representative`** — not only the `platform_admin` role: a
  custom role such as a catalog manager counts as well. **Such a deletion or
  change leaves no audit trail**: saved views are not written to the audit log.
  Decide which roles you grant with that in mind before your team relies on
  shared views. A sales representative can delete only their own views, and
  nobody can see or delete another admin's private view.
- **Only save, load and delete.** The Admin UI does not rename a view, change
  whether it is shared, or overwrite it with the current filters; save a new
  view and delete the old one instead. There is no limit on the number of
  views.

### Saved views API

| Method and path | Answers |
| --- | --- |
| `GET /api/v1/admin/catalog/products/list-views` | `200` — the caller's own views plus every shared view, ordered by name |
| `POST /api/v1/admin/catalog/products/list-views` | `201` — the created view |
| `PATCH /api/v1/admin/catalog/products/list-views/:id` | `200` — the modified view; any of `name`, `shared`, `filters`. The Admin UI does not call it. A body that changes nothing — empty, or every value as stored — writes nothing, logs nothing and answers the current view |
| `DELETE /api/v1/admin/catalog/products/list-views/:id` | `200` — `{ data: { deleted: <id> } }` |

- **Gate.** All four routes are gated by `catalog:read` — the code that gates
  reading the product list; there is no separate permission code. A request
  without an admin actor is refused with `401 UNAUTHORIZED`. The static
  `list-views` segment takes precedence over `products/:id`.
- **Body.** `name` (trimmed, 1–160 characters, no Unicode control or format
  characters), `shared` (boolean) and `filters` (an object, at most 8192 bytes
  as UTF-8 JSON). The product list has no sort or column control, so a view
  stores no `sort` or `visibleColumns`; those keys are dropped. The Admin UI
  writes `filters` as `{ status?, type?, q? }`, only the non-default ones.
  Anything outside those bounds is `400 VALIDATION_FAILED`. The shapes are
  `createProductSavedViewRequestSchema` and
  `updateProductSavedViewRequestSchema` in `@endora-commerce/contracts`.
- **Two caller-relative flags.** Every view in a response carries
  `ownedByCaller` and `canModify` — `true` when the caller owns the view, or
  the view is shared and the caller is a platform admin in the sense below. The
  Admin UI enables **Delete view** from `canModify`, and before saving runs a
  best-effort duplicate-name pre-check against the listed views with
  `ownedByCaller`. The server's `lower(btrim(name))` comparison is
  authoritative: a name the pre-check lets through can still be refused with
  `409`.
- **Platform admin, for saved views,** is an admin whose request tenant context
  has `mode === 'all'` — every role except `sales_representative`. The order,
  product and quote request lists derive it the same way, and it fails closed:
  an admin whose reach cannot be resolved is not a platform admin.
- **Refusals.** An absent view, or another admin's private view, is
  `404 NOT_FOUND` — the two are indistinguishable. A shared view the caller
  neither owns nor may modify as a platform admin is `403 FORBIDDEN`. A name
  whose key the view's owner already uses on this list is
  `409 PRODUCT_SAVED_VIEW_NAME_TAKEN`, *"You already have a saved view with this
  name on the product list. Choose a different name."*, in the request's
  language.
- **The name key** is the name trimmed and lower-cased — no accent folding. The
  rule binds the view's **owner**: a platform admin renaming a colleague's
  shared view is refused when the colleague already uses that key. Creating a
  view and changing a name's key take a transaction-scoped advisory lock keyed
  on the owner, and a unique index on `(owner_admin_user_id, lower(name))`
  backs it, so two concurrent saves under one name leave exactly one view.
- **No audit.** Saved views are personal UI configuration and do not run
  through the Command Bus. When an admin modifies or deletes a view they do not
  own, the service writes one `info` log record:
  `{ event: 'saved_view.updated' | 'saved_view.deleted', list: 'product_list_saved_views', viewId, ownerAdminUserId, actorAdminUserId }`.
  That log line is the only trace.
- **Storage.** `product_list_saved_views` (`ProductListSavedView`) is
  platform-global, not organization-scoped: it holds filter values, never list
  results, and every list read after a view is applied runs under the loader's
  own scope.

## Events emitted

`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
`attribute.updated.v1`. Picked up by the search indexer. The three product
events are also offered to outbound webhooks (next section);
`attribute.updated.v1` is not.

`category.updated.v1` and `category.content.updated.v1` both flush the
storefront's category cache; the first also re-indexes the products of the
changed category's subtree.

## Events offered to outbound webhooks

The module contributes three event types to the `webhooks` module's
`webhookEventRegistry`, so a webhook subscription can name them while both
modules are present. The payload is sent whole; the strict schemas are
`CATALOG_WEBHOOK_EVENT_SCHEMAS` in `@endora-commerce/contracts`.

| Event | Sent when | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- |
| `product.created.v1` | A product is created — in the Admin UI, through the API-key upsert, by an import or a PIM synchronisation, or by duplicating another product. | `productId` (UUID), `sku` — the SKU it was created with; it can change later, `productId` cannot. |
| `product.updated.v1` | A product is written, or one of its variants is created, changed or deleted. | `productId`, `changedFields` — the names of the product fields the write addressed (`name`, `status`, `categoryIds`, …; `variants` for a variant write). Names only, an open list, and it may be empty. |
| `product.archived.v1` | A product is archived by the Archive action — for one product or in bulk. Once per transition: archiving an archived product sends nothing. A status change never sends it: `inactive` is plain off. | `productId` |

- **Order.** Archive sends `product.updated.v1` (with `archivedAt` in
  `changedFields`) and then `product.archived.v1`, for one product and for each
  product of a bulk Archive.
- **Restore has no event of its own.** Restore sends `product.updated.v1` with
  `archivedAt` in `changedFields` and nothing else. Switching a product on or
  off sends `product.updated.v1` with `status`. To tell them apart, read the
  product: its `status` and `archivedAt` are the answer.
- **Undo.** Undoing a bulk edit sends `product.updated.v1` for every product it
  put back, naming the fields it restored, and `product.archived.v1` where it
  archives a product again.
- **Deletion is not delivered.** Deleting a product emits `product.deleted.v1`
  on the in-process event bus only; it is not offered to webhooks, and no
  `product.archived.v1` is sent for it. A receiver that mirrors the catalogue
  learns of a deletion by reading: the product is no longer returned by the
  API. Reconcile against a full listing if deletions matter to you.
- **After the commit.** Each event is sent for a write that was committed. A
  write that is refused or rolled back sends nothing.
- **No content leaves.** No name, description, price, attribute value or
  Organization allow-list is in any payload. A receiver reads the product
  through the API with its own key.
- **Platform-wide subscriptions only.** A product is not one Organization's
  data, so the payloads carry no `organizationId` and a subscription bound to
  an Organization never receives a product event.
- **Volume.** One event per product written. A bulk edit, an import or a PIM
  synchronisation writes products one by one and therefore sends one
  `product.updated.v1` per product; nothing is batched. With no subscription
  naming the type, nothing is enqueued.

## Extension points

- **Per-Sales-Channel listing** — the query service receives a SalesChannel
  context, and every price it renders is resolved for that channel; new gating
  (e.g. customer-segment-specific catalogs) is added by composing into
  `catalog-query.service.ts`.
- **Product editor zones** — the editor mounts admin zones other modules contribute to;
  `product.editor.seo.after`, at the end of the SEO tab (props: `productId`), is where the
  SEO module puts its link to the meta-tag editor, so the catalog never names that module.
- **Slug uniqueness** — the slug is unique across all Sales Channels by
  default; override the slugifier in `catalog-admin.service.ts` if locale
  collisions become a concern.

## Order rules: minimum order quantity and returnable

Two rules on a product decide how it may be ordered and whether it may be sent
back. Both are edited in the **Order rules** card on the product editor's
**Inventory** tab.

> **Upgrading: every existing product starts as not returnable.** A product on
> which nobody has set **Returnable** reads as not returnable, and that includes
> every product that existed before the setting was introduced. Lines of orders
> placed after the upgrade are therefore not returnable until you mark their
> products. To mark many at once, select them on the product list and use
> **Bulk edit → Returnable → Yes — returnable**. Orders placed before the
> upgrade are unaffected: their lines stay returnable under the usual rules.

### Minimum order quantity

- **Minimum order quantity (pcs)** — the fewest pieces of the product a buyer
  may order in one order. Optional; a whole number from **1 to 1 000 000**, or
  empty for no minimum. It applies to `simple` and `configurable` products
  only: on a `grouped`, `bundle` or `virtual` product the card says so, and
  the API refuses the field with `422 VALIDATION_FAILED` naming
  `minOrderQuantity`, on create and on update. A value outside the range is
  refused with `400 VALIDATION_FAILED`.
- **A minimum per packaging unit** — each packaging unit may carry its own
  minimum number of units; see [Packaging Units](./catalog/packaging-units.md).

The minimum is judged on the **product total**: every line of the product in
the basket counts — single-piece and packaging-unit lines, every variant. A
packaging-unit minimum counts the units of that unit ordered for the product,
over every variant. The two checks are independent; a basket must satisfy
every minimum that is set. Variants inherit the product's minimum.

Every way into a basket, a quote request or an order applies it — the cart,
checkout, quick order, one-click buy, shopping lists, quote requests, the
admin's Create order screen and the external order API. Each of those modules'
pages says what its path does with a line below the minimum. A refusal answers
`422 PRODUCT_BELOW_MINIMUM_QUANTITY` (pieces) or
`422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (a packaging unit), with a message
in the buyer's language naming the product and the minimum. Removing a line is
always allowed.

A product a buyer may not see, or that the request's sales channel does not
publish, is reported as an unknown product on every path — its name and its
minimum are never disclosed.

The storefront product detail, the product list, search results and the
comparison carry `minOrderQuantity` (`null` when there is none, or when the
product's type takes no minimum); the product detail's `packagingUnits[]`
carries each unit's `minOrderUnits`. The storefront starts the quantity at the
minimum and does not offer less.

### Returnable

**Returnable** (yes / no, on every product type) says whether buyers may
include the product in a **return**. It does not restrict **complaints**. The
default is no.

The value is **recorded on each order line when the order is placed**
(`order_items.returnable_at_purchase`); changing the flag later changes no
order already placed. A line whose product could not be read at placement is
recorded as not returnable. What the Returns module does with the recorded
value is on its own page.

### Per sales channel

Both rules can be overridden for one sales channel — **Order rules** per channel in the
product's scopes (`PATCH /api/v1/admin/catalog/products/:id/scopes`, `minOrderQuantity` and
`returnable` on a channel entry; `null` uses the global value again). The channel's value
applies wherever a basket, an order or a quote request belongs to that channel: adding to
the basket, the basket view, submitting for approval, the checkout preview, placement, the
admin order preview, quote requests and the buyer's quick-order import. A channel minimum
of 1 means no minimum in that channel, whatever the global value. Placement records the
order channel's returnable flag on each line, so returns follow the channel the order was
placed in. The storefront product detail and listing report the minimum of the request's
channel.

### Audit and copies

Setting or clearing either rule is audited like any product edit, with the old
and the new value. **Bulk edit → Returnable** writes one audit entry per
product it changes, for up to 200 products in one synchronous request and
through the queued bulk edit beyond. Changing a rule never alters an existing
cart, order, quote request or return. **Duplicate** does not copy either rule:
the copy starts with no minimum and as not returnable.

### API

| Field | Where | Values |
| --- | --- | --- |
| `minOrderQuantity` | `POST` / `PATCH /api/v1/admin/catalog/products[/:id]`, the admin product response | integer `1…1000000`, or `null` to clear |
| `returnable` | the same, and `POST /api/v1/admin/catalog/products/bulk-update` | boolean |
| `minOrderUnits` | `POST` / `PATCH …/packaging-units[/:unitId]`, the packaging-unit response | integer `1…1000000`, or `null` to clear |

The catalogue read port (`CatalogProductReadPort`) reports `minOrderQuantity`
and `returnable` on each product record and `minOrderUnits` on each packaging
unit, and gains `listPackagingUnitsByProductIds` for batch reads. Like every
method of the port it applies no visibility policy: a caller passes only
product ids it has already vetted.

Migration `20261016T082008_catalog_order_rules.ts` adds
`products.min_order_quantity` (nullable, `CHECK` 1–1 000 000),
`products.returnable` (not null, default `false`) and
`product_packaging_units.min_order_units` (nullable, `CHECK` 1–1 000 000).

## Product structure and composition surfaces

The catalog grew several capability surfaces, each with its own page:

- [Attribute Sets](./catalog/attribute-sets.md) — reusable attribute
  schemas pinned to Products, with a system Default
- [Product Gallery](./catalog/gallery-and-labels.md) — image / video
  gallery with Base / Small / Thumbnail label invariants enforced at
  the database level
- [Attachments](./catalog/attachments.md) — downloadable files
  (certificates, tech specs, ...) with a typed dictionary
- [Product Links](./catalog/product-links.md) — Related, Up-sell,
  Cross-sell pairings driving cross-merchandising on the PDP and cart
- [Composite Products](./catalog/composite-products.md) — `grouped`
  (fixed children), `bundle` (configurable slots), `virtual` (digital
  delivery)

Five product types are now supported: `simple`, `configurable`,
`grouped`, `bundle`, `virtual`. `simple` and `configurable` are the
original pair; the other three were added later.

## Page Builder blocks

The catalog declares the Page Builder's product and category blocks. Their
data is read on the server, so the products are in the page's HTML.

**Product grid and product slider** (`catalog.ProductGrid`,
`catalog.ProductSlider`) keep every option they had — the product source
(picked products, a category, a search), the limit, columns, gap and view —
and add:

| Option | Meaning |
| --- | --- |
| Header | An optional heading, lead text and button (for example "See all") above the products. |
| Card style | Default, compact, horizontal, or **showcase**: the product image on a neutral backdrop, its name, a short summary and a "more" link — no price or SKU. |
| Text under the product name | The one line under each card's name: the card style's default (the SKU on the default, compact and horizontal cards, the short description on showcase), the **Short description** (the first words of the product's description, at most 160 characters), the SKU, or none. The page editor's preview shows the same line as the storefront. |
| Card title weight | The weight of each card's product name: **Default** (the card style's own) or 300–800. |
| Card image background | The colour of the box behind each card's image: a brand colour or a hex value. Empty keeps the card style's own light grey. |
| Divider under each card | **None** (as before) or **Line**: a 1 px line under each card, in the **Divider color** you pick or the neutral border colour. A bordered card's bottom edge becomes the line; a showcase card gets it 16 px below its text. |
| Card link label | The text of the showcase card's link; "More" when empty. |
| Gap (grid) | A spacing step or **Custom gap (px)**, per breakpoint. A grid saved with a gap in pixels opens on Custom with that number and looks as before. The category grid's gap works the same way. |
| Equal items height (grid) | Per breakpoint, next to the columns and the view, on the **Responsive** tab; a value saved before applies at every width. The category grid's works the same way. |
| Button below the products | An optional button under the grid or slider. |

The slider takes the Page Builder carousel's options: slides per view per
breakpoint, gap, slide or fade effect, arrow and dot placement, bleed to the
viewport edge and optional autoplay. A grid or slider saved before these
options existed renders as it did. To give any of these blocks an anchor, a
colour scheme, a background, spacing or a width, place it inside a **Section**
block (`cms.Section`). The header texts, the card
link label and the footer button label are translatable with the Page
Builder's **Translate** action.

**The product summary.** The storefront product list and product detail
(`GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:idOrSlug`)
return `summary`: the product description in the request language as plain
text, cut at a word boundary to at most 160 characters with `…`, or `null`
when the product has no description. It is derived from the description the
read already loads, so it costs no extra query per product (the module's
`src/backend/services/product-summary-text.ts`).
The showcase card shows it.

## Attribute extensions on the Catalog read paths

The Attributes work added the operational surface the storefront
needs to render rich product information and the search / promotions
modules need to resolve customer queries. The dedicated
[Attributes](./catalog/attributes.md) page covers the attribute
authoring surface in full — this section only summarises what changed
on the Catalog read paths.

### New attribute flags

`ProductAttribute` gains four behavioural flags + a numeric position +
a per-locale label fallback:

- `isPromoRule` (boolean) — picker eligibility for the Promotion Rule
  editor's `attribute` criterion variant
- `isVisibleOnProductPage` (boolean) — surface the attribute on the
  storefront PDP "Parametry produktu" tab when the product carries a
  value
- `isRequired` (boolean) — enforced at product save time when the
  attribute is part of the product's Attribute Set
- `filterPosition` (number) — sort key for the storefront filter sidebar
  (lower comes first; ties broken by label)
- `labelDefault` (string) — fallback used when the active locale has no
  matching key in the per-locale `label` JSONB

### Option lists

Select-style attribute types (`select`, `enum`, `multiselect`) carry an
ordered option list — each row keyed by `(definition, value)` with
per-locale label + fallback + sort order + default flag. The legacy
`enum_values: string[]` JSONB column on `product_attributes` was
decommissioned by migration
`20260505T060113_catalog_attribute_options_and_flags.ts` (into the catalog-owned
`attribute_options` table), and migration
`20260723T230401_catalog_attributes_on_custom_fields.ts` moved the
rows into the generic `custom_field_options` table. Existing readers
project the option list back into the legacy form for backward
compatibility at the API boundary.

### Editable SKU

Product `sku` is mutable. The internal canonical reference for every
cross-module link (assets, links, RFQ items, ...) is the `Product.id`
UUID, which never changes. Updating the SKU writes an audit row and
refuses with `409 sku_in_use` if the new value already belongs to
another product.

### Attribute Set swap

When an operator assigns a different Attribute Set to a Product, the
admin form re-renders to show only the new Set's attributes. Values
for attributes outside the new Set stay in the JSONB column server-side
— switching back surfaces them again. The
`attribute-set-preview` endpoint lets the editor warn the operator
which fields will be hidden vs. retained before they confirm.

### Cross-module read surface

Two methods on `CatalogQueryService` cross module boundaries (the
documented service ports):

- `comparableAttributeKeys(): string[]` — Compare
- `promoRuleAttributeKeys(): string[]` + `getAttributeWithOptions(key)`
  — Promotions
- `buildVisibleAttributesProjection()` — internal, used by the PDP
  detail response to assemble the `visibleAttributes[]` payload

## Attributes as Custom Field extensions

The attribute definition store has converged onto the generic Custom
Fields layer that the `custom_fields` module owns, adapter-shaped rather
than rewritten. Nothing changed on the
HTTP surface — every endpoint above keeps its shape — but the storage
and ownership model is different:

- **A product attribute is a catalog extension of a product-host Custom
  Field definition.** The generic identity (`key`, per-locale `label` +
  `labelDefault`, `valueType`, `required`) lives on a
  `custom_field_definitions` row with `entity_type = 'product'`. The
  `product_attributes` table remains, rebuilt as a thin 1:1 extension
  row (`custom_field_definition_id` UNIQUE FK) carrying only the
  catalog behaviour flags (`isSearchable`, `isFilterable`,
  `isVariantAxis`, `displayAsSlider`, `isComparable`,
  `quickSearchable`, `isPromoRule`, `isPriceRule`, `filterPosition`,
  `isVisibleOnProductPage`, `channelScoped`, `languageScoped`,
  `massEditable`) plus two presentation refinements (`selectDisplay`,
  `numericKind`) that keep the legacy `enum`/`select` and
  `number`/`price` distinctions lossless. **Flags stay catalog-owned**
  — the generic core never interprets them.
- **Options live in `custom_field_options`.** The catalog-owned
  `attribute_options` table is gone; option lists are ordinary Custom
  Field option rows on the product-host definition.
- **Single write surface: `/catalog/attributes`.** Attribute and
  option mutations are catalog Commands that create/update/delete the
  definition and the extension together in one transaction (one audit
  row), using the transactional apply seam exported by
  `custom_fields`. The generic Custom Fields admin surface lists
  product definitions read-only and refuses mutations with
  `409 host_managed`.
- **Migration `20260723T230401_catalog_attributes_on_custom_fields.ts`** performed the
  one-time convergence in a single transaction: backfilled one
  definition per legacy attribute (key, labels, mapped value type,
  required, deterministic sort order), moved `attribute_options` rows
  into `custom_field_options`, re-keyed `attribute_set_attributes` to
  definition ids, added `custom_field_definition_id` /
  `select_display` / `numeric_kind` to `product_attributes`, dropped
  the duplicated columns (`key`, `label`, `label_default`,
  `value_type`, `is_required`), and dropped `attribute_options`. The
  migration is reversible (`down()` restores the legacy shape) and
  aborts loudly on a reserved-key collision.
- **Attribute values did not move** — `products.attribute_values`,
  `product_variants.variant_attribute_values`, and
  `product_value_overrides` keep their shape and catalog ownership
  (the host owns its data).

Internal consumers (search, quick order, comparisons, bulk edit, the
promotions port, the scope editor) read attributes through the
catalog-exported `CatalogAttributeReadService`, which composes the
definition and the extension into the legacy-shaped
`CatalogAttributeView`.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds products and categories. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| Product: SKU | yes |
| Product: Name | yes |
| Product: URL key (slug) | no |
| Product: Quick-search attributes | no |
| Category: Name | yes |
| Category: URL key (slug) | yes |

Names match in every language and are shown in the admin's language. Inactive and archived products are found and show their status; deleted products and categories are not. A category result opens the category tree with that category highlighted. Both appear for a role holding `catalog:read`.
