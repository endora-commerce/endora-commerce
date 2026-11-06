# Feature Specification: Admin product picker (orders, quote requests, price lists)

**Feature Branch**: `feat/145-admin-product-picker` (spec directory `specs/145-admin-product-picker/`)
**Created**: 2026-10-13
**Status**: Implemented — accepted by the product owner 2026-10-14 against code and tests, pending the manual browser walk of `quickstart.md` §1–§3 (T060; §4's API checks were already smoke-tested against a running stack). History: clarify session 2026-10-13 (sixteen answers — the last two product-owner rulings on findings of the analyze pass); `plan.md` and `tasks.md` written 2026-10-13; analyze re-run 2026-10-13 after those rulings; all nine phases built, QA, code review and security review passed 2026-10-14
**Issues**: #280, #281, #282, #291
**Input**: Product owner's request, summarised in English. Three admin screens that put products
onto a document — **Create order** (`/orders/new`), **Create quote request**
(`/quote-requests/new`) and a price list's **Products & brackets** tab (`/price-lists/:id`) — make
the operator find products one at a time through a single-product search. The operator wants the
same filterable, paginated product table the **Products** list (`/catalog/products`) offers, with
multi-select, so that many products can be added in one action; after adding, the operator sets
quantity (orders, quote requests) and agreed unit price (quote requests), and sees unit price and
line total (orders). On **Create order**, the **Items** and **Order summary** sections should not
be shown until the inputs that pricing needs are set in **Customer & methods**.

## What the product does today (measured on `origin/master` at `8c2be9fba`, release 0.106.0)

Section labels are the `en` strings of the `core` bundle
(`packages/modules/_i18n/i18n/en.json`); the key is cited where it matters. No changeset is pending
in `.changeset/`; the 0.105.0 and 0.106.0 changelog entries of `mod-catalog`, `mod-orders`,
`mod-quote-requests`, `mod-price-lists`, `mod-i18n` and `admin-kit` were read, and the one that
touches these screens (per-channel delivery and payment methods, 0.105.0) is reflected below.

### Products list (`/catalog/products`) — the screen to mirror

- `packages/modules/catalog/src/admin/pages/ProductsList.tsx`. A hand-built `b2b-*` table with
  `PaginationFooter` from `@endora-commerce/admin-kit/components`; page size remembered per screen
  through `usePageSizePreference('catalog-products')`.
- Columns: checkbox, product (colour swatch placeholder + `en-US` name, the `pl-PL` name as a second
  line when it differs), SKU, status, type, visibility, updated, and an empty row-action button.
- **Filters that filter** (sent to `GET /api/v1/admin/catalog/products`): status tabs with counts
  (All / Active / Draft / Inactive → `status`), a Type chip cycling simple / configurable / grouped /
  bundle / virtual (`type`), and a 250 ms debounced text search (`q`). The search matches **SKU,
  slug and name** (`catalog-admin.service.ts`, `listProducts`). The list always sends
  `includeArchived=1`, `page` (0-based) and `pageSize`.
- **Filters that do not filter**: the Stock chip is a client-side kill switch (any value other than
  "all" shows zero rows); the Category and Channel chips have empty click handlers. The endpoint
  accepts `categorySlug`; the list never sends it.
- Endpoint: `packages/modules/catalog/src/backend/routes.admin.ts` (`GET
  /api/v1/admin/catalog/products`), gated `catalog:read`; default page size 20, maximum 500, newest
  first (`catalog-admin.service.ts`, `listProducts`). A row (`serializeAdminProduct`) carries id,
  SKU, slug, type, status, localized name, visibility, `allowedOrganizationIds`, stock flags and the
  raw `attributeValues` — no resolved price, no stock quantity, no variant count.
- `POST /api/v1/admin/catalog/products/batch-by-id` (same file, gated `catalog:read`; contract
  `batchByIdProductsRequestSchema` in `packages/contracts/src/catalog.ts`, at most 500 ids,
  paginated, archived rows included) reads products by id. None of the three host screens uses it.
- Bulk selection: a per-page id set; when the whole page is selected a banner offers "select all N
  matching", which freezes the filter and resolves ids through `POST
  /api/v1/admin/catalog/products/resolve-ids` (`admin/lib/resolve-product-selection.ts`, hard
  maximum 10 000). **Any filter change clears the selection** (feature 033 FR-006); the header
  checkbox replaces the selection with the current page.
- The status pill, the visibility label and the relative "updated" time are hard-coded English.

### Existing single-product picker

- `packages/admin-kit/src/components/product-picker/ProductPicker.tsx` — a combobox (`mode:
  "select" | "multiselect"`) over the same list endpoint: page 0 only, 20 results, search only, no
  filters, no table, no pagination. It omits `includeArchived` by default, so inactive products are
  not offered; drafts are, with a `· draft` suffix. It accepts `excludeIds`. Its strings are
  `productPicker.*` in `core`. Used by both create screens below, and also by `seo`
  (`SeoPage.tsx`), the quote-request detail screen (`RfqDetail.tsx`) and the catalog product editor
  (`ProductEditor.tsx`).

### Create quote request (`/quote-requests/new`)

- `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx`; route gated `rfqs:handle`
  (`packages/modules/quote_requests/src/admin/index.ts`).
- Sections: **Customer** (`rfqCreate.section.customer`; customer combobox, organization derived from
  the customer; a warning when the customer has no organization), **Line items**
  (`rfqCreate.section.items`; one row per line: single-product combobox + quantity + agreed unit
  price + remove; **Add line**; running total), **Options** (header note, expiry days).
- The page can be opened with `organizationId`, `customerAccountId`, `originType`/`originId` and
  `returnTo` in the query string (feature 143); the customer then arrives chosen.
- The agreed unit price is prefilled per line from `GET /api/v1/admin/products/:id/resolved-price`
  (`packages/modules/price_lists/src/backend/routes.ts`, gated `price_lists:read`) with organization,
  customer and quantity. The route always prices on the **system default sales channel** and its
  default currency. A failure leaves the field empty. Changing the customer **or the quantity**
  re-resolves and overwrites the price, including one typed by hand.
- Lines with no product, quantity ≤ 0 or an empty price are silently dropped from the submit; submit
  needs an organization and at least one valid line. Payload: `POST /api/v1/admin/quote-requests`,
  items `{productId, variantId?, quantity, agreedUnitPrice, lineNote?}`
  (`adminCreateQuoteRequestLineSchema`, `packages/contracts/src/quote-requests.ts`;
  `agreedUnitPrice` is required and may be 0). The page never sends `variantId` and has no input for
  `lineNote`.
- The server (`RfqAdminService.createOnBehalf`) refuses an unknown product id and checks neither
  product status nor type; it is exempt from the visibility and channel-assortment filters by
  ruling (see `isProductVisibleTo` in `packages/contracts/src/catalog.ts`).

### Create order (`/orders/new`)

- `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx`; route gated `orders:write`
  (`packages/modules/orders/src/admin/index.ts`). Above the form, the `order.entry.tabs` zone shows
  the **Standard** / **Quick order** tab strip; the Quick order tab is `quick_order`'s separate
  screen (`/orders/quick-order`) and is not part of this feature.
- Sections, in order: **Customer & methods** (`orderCreate.section.parties`; customer, sales
  channel, payment method, delivery method, delivery and billing address), **Items**
  (`orderCreate.section.items`; single-product combobox + quantity rows, unit price and line total
  shown once priced, **No price** — `orderCreate.line.unavailable`, PL "Brak ceny" — when the
  preview marks the line unavailable; **Add item**), **Order summary** (`orderCreate.summary.title`;
  subtotal, tax, delivery, payment surcharge, discount, total), then the note and submit.
- **Items is always visible**, including before a customer is chosen. Order summary renders only
  once a price preview exists.
- Since 0.105.0 the payment and delivery selects offer only the methods of the chosen sales channel
  (`methodsOfferedInChannel`), and a method the new channel does not offer is cleared.
- The page can be opened with `organizationId`, `customerAccountId`, `salesChannelId`,
  `originType`/`originId` and `returnTo` in the query string (feature 143); customer and channel
  then arrive chosen. An unsaved-changes prompt (`useUnsavedChangesPrompt`) fires when the form is
  dirty, and lines count towards dirtiness.
- Pricing: a debounced `POST /api/v1/admin/orders/preview` (`packages/modules/orders/src/backend/routes.ts`;
  `adminOrderPreviewRequestSchema` in `packages/contracts/src/orders.ts`) fires once **customer +
  sales channel + at least one line** are set; delivery and payment methods are optional inputs that
  add delivery cost and surcharge. Response lines carry `unitPrice`, `currency`, `lineTotal`,
  `unavailable`; the response adds a summary and per-product `messages` (`PRODUCT_NOT_FOUND`,
  `QUOTE_ONLY`). Any message blocks submit. A product without an applicable price list is priced
  from its catalogue `defaultPrice`/`price` attribute, possibly 0.00. A customer without an
  organization makes the preview fail (422), which the page shows as **Could not calculate prices**
  (`orderCreate.preview.error`) without blocking submit.
- The preview resolves its channel as the body's `salesChannelId` **or, when that id names no
  channel, any active channel** (`findOne(SalesChannel, { status: 'active' })` in the preview
  handler) — so a channel deleted after it was chosen is silently replaced by another one for
  pricing. Only when no active channel exists at all does it answer `404 NOT_FOUND` "Sales channel
  not found.".
- `PRODUCT_NOT_FOUND` on the preview means an id with **no catalogue row**. Catalogue deletion is a
  soft delete (`deletedAt`), and both the preview and order creation read products with the port's
  default (wider) lookup, which returns soft-deleted rows: a soft-deleted product is priced like a
  live one on the preview and accepted on create (`CatalogProductReadPort.findById`,
  `catalog-product-read.service.ts`; `CartService.addItem`). *Amended 2026-11-06, issue #820,
  feature 163 FR-001:* no longer the current state — order creation refuses a soft-deleted product
  with `404 PRODUCT_NOT_FOUND`, and the preview reads with `liveOnly` and reports it as
  `PRODUCT_NOT_FOUND`.
- Submit needs customer, channel, delivery method, payment method, both addresses, at least one line
  and no preview message; lines with quantity ≤ 0 are silently dropped. Items `{productId,
  variantId?, quantity}` (`adminCreateOrderRequestSchema`); the page never sends `variantId`.
- The order is created by filling the customer's cart line by line
  (`order-creation-admin-service.ts` → `CartService.addItem`), which refuses a product the customer
  may not see (`isProductVisibleTo` with the customer's organization and `authenticated: true`, so
  `allowedOrganizationIds` not naming that organization and `organization_restricted` refuse, while
  `logged_in_only` passes) or one outside the **request's** sales channel (`outOfRequestChannel`)
  with `404 PRODUCT_NOT_FOUND` — one answer for all three causes, by the enumeration-oracle ruling in
  `isProductVisibleTo`'s documentation (`packages/contracts/src/catalog.ts`) and at the call site
  (`packages/modules/carts/src/backend/services/cart-service.ts`). The preview runs neither check.
  Nothing on the server refuses a product for its status or type.

### Price list — Products & brackets (`/price-lists/:id`)

- `packages/modules/price_lists/src/admin/pages/PriceListDetailPage.tsx` (`ProductsAndBracketsPanel`,
  `ProductPickerDialog`); route gated `price_lists:read`, writes gated `price_lists:write` on the
  server.
- Left: the roster of products on the list; right: the per-product, per-currency bracket editor
  (`packages/modules/price_lists/src/admin/components/BracketGrid.tsx`). **Add**
  (`priceLists.detail.products.add`) is disabled only for the system list — there is no client-side
  write-permission gate. It opens a side drawer: a search box filtering client-side over name and
  SKU, and a plain list (capped at 100 rows) that hides products already on the list; clicking one
  product adds it at once (`POST /api/v1/admin/price-lists-engine/:id/products {productId}`) and
  closes the drawer.
- **Defect**: the drawer and the roster's name lookup both call `GET
  /api/v1/admin/catalog/products` with no parameters, so they see only the first page — the 20
  newest non-inactive products. Products beyond that cannot be added from the drawer. A roster row
  for a product beyond that shows an id prefix instead of a name and SKU, **and selecting it never
  opens the bracket editor** — the panel stays on *Loading product…*
  (`priceLists.detail.products.loadingProduct`), because the editor renders only when the product is
  in that 20-row map.
- Server: `POST …/products` is an idempotent single append (`price-list-service.ts`, `addProduct`),
  one `price_list.product_add` audit entry per new assignment, no product-existence check of its own
  (`price_list_products.product_id` has a foreign key to `products`). `PUT …/products
  {productIds}` is a **delta replace** that removes every roster entry absent from the body, with
  their brackets. There is no bulk-append endpoint.
- Roster and brackets are per **product**; there is no variant level.

### Line unit: products, not variants

- The order and quote-request contracts accept an optional `variantId`, but no admin screen sends
  it; the price-list roster has no variant concept. The purchasable unit on all three screens is the
  product.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bulk-add products to a new order with live prices (Priority: P1)

A sales rep creating an order for a customer opens a product table inside **Items**, filters it the
same way as the Products list, ticks many products (across pages and filter changes), and adds them
in one go. The added products appear as order lines where the rep sets quantities and sees each
line's unit price and line total.

**Why this priority**: Order entry is the highest-value sales flow; today it takes one combobox
search per line and offers no browsing by status or type.

**Independent Test**: With a customer and sales channel chosen, add 20 products from two pages of a
filtered table in one action, set quantities, and see unit price and line total per line plus the
order summary.

**Acceptance Scenarios**:

1. **Given** customer and sales channel are chosen, **When** the rep opens the product picker in
   **Items**, **Then** a paginated table appears with the same working filters as the Products list
   (status tabs with counts, type, text search) and a checkbox per row.
2. **Given** the rep ticked 5 products on page 1, **When** they go to page 2 or change a filter and
   tick 3 more, **Then** the picker shows "8 selected" and all 8 remain ticked when revisited.
3. **Given** 8 products are selected, **When** the rep confirms "Add 8", **Then** the picker closes
   and 8 new lines appear, each with quantity 1, unit price and line total (quantity × unit price)
   in the order's currency, and the order summary updates.
4. **Given** lines exist, **When** the rep changes a line's quantity, **Then** that line's unit price
   (which may change with quantity brackets), line total and the summary update.
5. **Given** a product is already a line, **When** the picker is opened again, **Then** that
   product's row is shown as already added and cannot be selected again.
6. **Given** a selected product the pricing preview reports as unavailable (product not found,
   quote-only for this customer and channel, not visible to the chosen customer, or outside the
   order's chosen sales channel's assortment — FR-024, FR-027), **When** it is added, **Then** its
   line is marked unavailable with that cause's own translated reason and the order cannot be
   submitted until that line is removed. (A product with no applicable price list is priced from its catalogue default price,
   possibly 0.00, as today; it is not "No price".)
7. **Given** the picker opens on the order screen, **When** it loads, **Then** the Active tab is
   selected, and grouped/bundle parents and draft/inactive products are shown with a reason and
   cannot be ticked.
8. **Given** the rep knows a SKU, **When** they type it in the quick search beside **Browse
   products** and pick the result, **Then** one new line is appended without opening the picker.
9. **Given** the rep has ticked 200 products, **When** they try to tick another, **Then** the
   checkbox is unavailable and the picker says the per-Add limit of 200 is reached.
10. **Given** the rep cancels the picker, **When** it closes, **Then** no lines are added and the
    existing lines are unchanged.
11. **Given** a product whose `allowedOrganizationIds` does not name the chosen customer's
    organization, **When** the rep adds it (through the picker or the quick search — neither greys
    it out), **Then** the preview reports that line as unavailable with the visibility message
    code, the line shows the translated visibility reason ("the customer cannot see this product")
    instead of a price — not the assortment reason — and submit is disabled until the line is
    removed; the order's other lines keep their prices.
12. **Given** a product the chosen customer may see but that is not in the order's chosen sales
    channel's assortment, **When** the rep adds it, **Then** the line shows the translated
    assortment reason ("not in this sales channel's assortment") — not the visibility reason —
    instead of a price, and submit is disabled; **and when** the rep switches the order to a sales
    channel whose assortment includes it, the re-priced preview no longer marks the line, it shows
    unit price and line total, and it no longer blocks submit.
13. **Given** a product the chosen customer cannot see **and** that is not in the order's chosen
    sales channel's assortment, **When** the rep adds it, **Then** the preview returns exactly one
    message for that line, carrying the visibility code, and the line shows only the visibility
    reason; **when** the rep switches to a channel whose assortment includes it, the line still
    shows the visibility reason; **and when** the rep instead changes the customer to one who can
    see it (the channel still lacking it), the re-priced preview reports the assortment reason in
    its place (FR-024, FR-027).
14. **Given** lines exist and the order's chosen sales channel is deleted by someone else (the form
    still holds its id), **When** the preview runs, **Then** it is refused with the route's
    existing not-found error, the screen shows **Could not calculate prices** as for any preview
    failure, no line is marked unavailable, and no other channel is used for pricing or for the
    assortment check (FR-027).

---

### User Story 2 - Order items and summary hidden until the order can be priced (Priority: P1)

On **Create order**, **Items** and **Order summary** stay hidden until the customer and the sales
channel are set in **Customer & methods** — the two inputs pricing needs. Until then the rep sees a
short hint naming what is missing.

**Why this priority**: Prevents building a basket that cannot show prices; small and separately
testable.

**Independent Test**: Open `/orders/new` fresh; verify neither section is shown; set the customer,
then the sales channel; verify the sections appear only after both are set, without needing
payment, delivery or addresses.

**Acceptance Scenarios**:

1. **Given** a fresh order form, **When** it loads, **Then** **Items** and **Order summary** are
   not shown and a hint lists the fields still required (customer, sales channel).
2. **Given** only the customer is set, **When** the rep sets the sales channel, **Then** **Items**
   appears; the summary appears as soon as at least one line is priced.
3. **Given** lines exist, **When** the rep changes the customer or sales channel to another value,
   **Then** the lines are kept and re-priced against the new value.
4. **Given** lines exist, **When** the rep clears a required field, **Then** both sections are hidden
   again; the lines are kept and reappear when the field is set again.
5. **Given** the page is opened with `customerAccountId` and `salesChannelId` in the query string
   (the feature 143 hand-over another screen uses), **When** it loads, **Then** **Items** is shown
   immediately.

---

### User Story 3 - Bulk-add products to a new quote request (Priority: P2)

A sales rep creating a quote request opens the same product picker in **Line items**, adds many
products in one go, and then sets quantity and agreed unit price on each added line. The agreed
price is prefilled from the customer's price lists where possible.

**Why this priority**: Same pain as orders, lower volume.

**Independent Test**: With a customer (with an organization) chosen, add 10 products via the
picker, see lines with quantity 1 and a prefilled agreed price where one resolves, edit prices and
quantities, submit.

**Acceptance Scenarios**:

1. **Given** the quote-request form, **When** the rep opens the picker in **Line items**, **Then**
   the same table, filters and multi-select behaviour as in User Story 1 are available.
2. **Given** 10 products are selected, **When** the rep confirms "Add 10", **Then** 10 lines appear
   with quantity 1 and the agreed unit price prefilled from the price resolved for the chosen
   customer, or left empty for manual entry when no price resolves.
3. **Given** lines exist, **When** the rep edits a quantity, **Then** the agreed price is
   re-prefilled only if the rep has not edited that line's price by hand (FR-033).
4. **Given** lines exist, **When** the rep edits an agreed unit price, **Then** the running total
   updates.
5. **Given** a line has an empty agreed price, **When** the rep tries to submit, **Then** submit is
   blocked and the line is visibly marked as missing a price (it is not silently dropped).
6. **Given** a product is already a line, **When** the picker is reopened, **Then** it is shown as
   already added and cannot be selected again.
7. **Given** the picker on the quote-request screen, **When** the rep switches to the Draft or
   Inactive tab, **Then** those products can be ticked; grouped/bundle parents still cannot.

---

### User Story 4 - Bulk-add products to a price list (Priority: P2)

A pricing admin on a price list's **Products & brackets** tab clicks **Add** and gets the same
filterable, paginated product table; they tick many products and add them to the price list in one
action. Products already on the list are marked and cannot be ticked. Brackets for added products
are then edited as today.

**Why this priority**: Price-list setup is periodic rather than daily, but today the drawer cannot
reach any product beyond the newest 20, and roster products beyond them cannot have their brackets
edited at all.

**Independent Test**: On a non-system price list, add 30 products (from more than one page) in one
action; the roster shows all 30 by name, each opens the bracket editor, and none of the previously
present products changed their brackets.

**Acceptance Scenarios**:

1. **Given** a non-system price list, **When** the admin clicks **Add**, **Then** the product picker
   opens with the Products list's working filters and pagination over the whole catalog.
2. **Given** products already on the list, **When** the picker shows them, **Then** they are marked
   "already on this price list" and cannot be selected.
3. **Given** 30 products are selected, **When** the admin confirms "Add 30", **Then** all 30 join
   the roster without prices, the picker closes and the first added product is selected in the
   roster with its bracket editor open.
4. **Given** 30 products are selected and 2 of them are deleted from the catalog before the admin
   confirms, **When** the admin confirms "Add 30", **Then** one bulk-add request is sent, its
   response reports 28 `added` and 2 `failed` with a reason, the 28 are on the roster, and a message
   names the 2 failed products and the reason (FR-043, FR-045).
5. **Given** products already on the list have brackets, **When** new products are added, **Then**
   those existing brackets are unchanged.
6. **Given** the system (Default) price list, **When** the tab is shown, **Then** **Add** stays
   disabled as today.
7. **Given** a price list whose roster holds products older than the catalog's newest 20, **When**
   the tab loads, **Then** every roster row shows its name and SKU and selecting it opens the
   bracket editor.
8. **Given** another admin added one of the selected products to the same price list after the
   picker was opened, **When** the admin confirms the Add, **Then** that product is reported
   `unchanged` (not a failure, no error shown for it), its brackets are untouched, and the others
   are `added`.
9. **Given** a bulk add of N products of which at least one is new to the list, **When** it
   completes, **Then** exactly one audit entry records the write, through the Command Bus (FR-045).
10. **Given** the system (Default) price list, **When** a client sends a bulk-add request for it
    (bypassing the disabled **Add**), **Then** the server refuses the request with an error, no
    product is added to the Default roster and no audit entry is written (FR-044, FR-045).
11. **Given** a bulk-add request naming a price list that does not exist or has been deleted,
    **When** it is sent, **Then** it is refused with an error, nothing is written and no audit entry
    is produced (FR-043, FR-045).
12. **Given** a bulk-add request carrying 201 product ids (or a malformed body), **When** it is
    sent, **Then** it is refused with an error, no product is added, the existing roster and its
    brackets are unchanged and no audit entry is produced (FR-043, FR-045).
13. **Given** 30 products are selected and the price list is deleted by someone else (or the network
    fails, or the server answers with any other error) before the admin confirms, **When** the admin
    confirms "Add 30", **Then** the picker stays open with all 30 still selected, an error message
    with a **Retry** action is shown inside the picker, the roster and its brackets are unchanged
    and no audit entry is produced; **Retry** re-sends the same selection (FR-010, FR-043).

---

### Edge Cases

- **Already-added products**: shown in the picker, marked, not selectable (orders, quote requests,
  price lists). Removing a line and reopening the picker makes the product selectable again.
- **Selection across pages and filters**: the selection persists while the picker is open, across
  page changes, page-size changes and filter changes, until Add or Cancel. A visible selected count
  with **Clear selection** and a "show selected only" view let the user review it. This deliberately
  differs from the Products list, which clears the selection on a filter change.
- **Header checkbox**: selects or deselects the selectable rows on the current page only, adding to
  (not replacing) the existing selection.
- **Product removed or deactivated between selection and Add**: order / quote request — the line is
  added and then priced by the existing pricing. On the order, an id with **no catalogue row** shows
  as unavailable (`PRODUCT_NOT_FOUND`, **No price**); a product **soft-deleted** from the catalogue
  is priced like a live product, as today, and order creation accepts it likewise — the preview
  stays consistent with create (FR-024). A deactivated one is priced as today and the create
  endpoint's existing rules apply. On the quote request its price may stay empty. Price list — a
  product the bulk-add endpoint cannot add, including a soft-deleted one, is reported in the
  response's `failed` entries with reason `product_not_found`, and the others are still added
  (FR-043, FR-045).
- **Product added to the price list by someone else meanwhile**: reported `unchanged`, not failed;
  its brackets are untouched.
- **Bulk-add request invalid as a whole** (unknown or deleted price list, more than 200 ids,
  malformed body, the system Default list): the server answers with an error in the existing
  price-list endpoints' error shape and writes nothing — no roster entry, no audit entry; no
  `added` / `unchanged` / `failed` report is returned (FR-043, FR-045). On the screen, a confirm
  that fails as a whole — this error, a network failure, or no response — keeps the picker open
  with the selection intact and shows an error with **Retry** inside the picker; nothing was
  written (FR-010). This differs from a request **accepted with `failed` entries**, which follows
  the normal path: the picker closes, the accepted products join the roster and the screen names
  the failed products (FR-041, FR-043).
- **Non-purchasable products (grouped/bundle parents, draft, inactive)**: shown with a reason and not
  selectable where FR-012 says so; the quick search applies the same rules. These are rules of the
  admin screens; the server does not refuse these products today and this feature does not add such
  a refusal.
- **Product the customer may not see, or outside the channel's assortment (orders)**: the picker and
  the quick search still offer it (no greying out); once added, the preview reports the line as
  unavailable with the cause's own reason (one message code for "the customer cannot see this
  product", another for "not in the chosen sales channel's assortment"; exactly one message per
  line — a product failing both checks is reported with the visibility reason only, the assortment
  reason being reported only for a product the customer can see), evaluated against the chosen
  customer's organization and the
  **order's chosen** sales channel, and submit is blocked until the line is removed or the customer
  or channel changes so that the line is available (FR-024, FR-027). Known residue until the
  separate create-path fix lands (see *Out of Scope*): when the order's chosen channel differs from
  the admin request's channel, a line the preview accepts can still be refused at create with
  "Product not found.", and the reverse.
- **Quote requests**: no visibility or assortment check is added; `RfqAdminService.createOnBehalf`
  is exempt by ruling (see *What the product does today*).
- **No price for the customer**: the order line shows **No price** and blocks submit only when the
  preview marks it unavailable (FR-024); otherwise the catalogue default price applies, as today,
  including 0.00. The quote-request line keeps an empty agreed price for manual entry.
- **Pricing preview fails as a whole** (e.g. a customer with no organization, a method the
  organization may not use, or — new, FR-027 — a chosen sales channel that no longer exists): the
  existing **Could not calculate prices** message is shown; lines stay, show no price and are not
  marked unavailable. Behaviour otherwise unchanged by this feature.
- **Customer or channel changed after lines exist**: lines kept and re-priced (order) / re-prefilled
  except hand-edited prices (quote request). On the order screen, changing the channel can also
  clear a delivery or payment method the new channel does not offer (existing, 0.105.0).
- **Unsaved-changes prompt**: hiding **Items** (FR-025) does not remove the lines from the draft, so
  leaving the page with hidden lines still prompts.
- **Large selections**: a single Add is capped (FR-008); the picker tells the user when the cap is
  reached and does not allow ticking more.
- **Empty result for the current filter while items are selected**: empty-state message, the
  selected count still visible and Add still enabled.
- **Load error**: an error message inside the picker with a retry; existing lines untouched.
- **Quantity**: integer ≥ 1; 0, negative or non-numeric is rejected on the line, not silently
  dropped.
- **Long names / SKUs**: truncated with the full text on hover; the PL name shown as a second line
  as on the Products list.
- **Narrow viewport**: the picker remains usable at tablet width (horizontal scroll inside the table
  only).
- **Permissions**: a user who can open the host screen but lacks product read permission sees the
  picker trigger disabled with a reason, not an error after opening.
- **Price list status**: adding is allowed on a non-system list regardless of its status (as today).

## Requirements *(mandatory)*

### Functional Requirements

**Product picker (shared by all three screens)**

- **FR-001**: The system MUST provide one product picker, opened from a host screen, that lists
  catalog products in a paginated table and is identical in look, columns, filters and selection
  behaviour on all three host screens (only host-specific labels, row states and the confirm action
  differ).
- **FR-002**: The picker MUST offer the filters that work on the Products list today: status tabs
  (All, Active, Draft, Inactive) with per-status counts, product type, and free-text search (SKU,
  slug, name — what the list endpoint matches) with typing debounce. Filter labels and values MUST
  match the Products list, except that status and type values are shown translated (FR-014).
- **FR-003**: The picker MUST show at least these columns: selection checkbox, product name (PL name
  as a secondary line when different), SKU, status, type. Visibility and "updated" columns MAY be
  omitted.
- **FR-004**: The picker MUST paginate with a page-size control consistent with the Products list
  and MUST reach every product matching the filters (no hidden first-page limit).
- **FR-005**: Users MUST be able to select and deselect individual rows and all selectable rows on
  the current page; the selection MUST persist across page, page-size and filter changes until the
  picker is confirmed or cancelled.
- **FR-006**: The picker MUST show the running count of selected products, a way to clear the
  selection, and a way to review only the selected products.
- **FR-007**: The confirm action MUST be labelled with the count ("Add N" / "Dodaj N") and be
  disabled when nothing is selected; Cancel (and closing the picker) MUST discard the selection
  without changing the host.
- **FR-008**: A single confirm MUST accept at most 200 products; once the limit is reached further
  rows cannot be ticked and the picker says why. There is no "select all N matching the filter"
  action in the picker.
- **FR-009**: Products already present in the host (order lines, quote-request lines, price-list
  roster) MUST be shown as already added and MUST NOT be selectable.
- **FR-010**: The picker MUST show distinct loading, empty-result and load-error states; a load error
  MUST offer retry and MUST NOT alter the host's existing lines. Where the confirm itself performs a
  server write — the price-list screen only (FR-045) — the picker MUST also have a confirm-failure
  state: when the write fails as a whole (an error response such as an unknown or deleted price
  list, a network failure, no response), the picker MUST stay open, keep the selection unchanged,
  and show an error message inside the picker with a **Retry** action that re-sends the same
  selection; the host is unchanged because nothing was written. On the order and quote-request
  screens the confirm only appends lines locally and has no confirm-failure state.
- **FR-011**: The picker MUST be usable by keyboard (focus moves into the picker on open, Esc
  cancels, rows and checkboxes are reachable and labelled for screen readers) and MUST return focus
  to the trigger on close.
- **FR-012**: Selectability by host screen:
  - On the order and quote-request screens the picker MUST open on the Active status tab; the other
    tabs stay reachable.
  - On the order and quote-request screens, `grouped` and `bundle` parent products MUST be shown but
    not selectable, with a visible reason (e.g. "Product group — pick its individual products").
  - On the order screen, draft and inactive products MUST be shown but not selectable, with a visible
    reason.
  - On the quote-request screen, draft and inactive products MUST be selectable.
  - On the price-list screen every product type and status MUST be selectable, and the picker opens
    on the All tab.
- **FR-013**: The picker trigger MUST be disabled with an explanatory hint when the signed-in user
  lacks `catalog:read`; the host screen's own permissions are unchanged.
- **FR-014**: Every new user-visible string (picker, hints, row states, messages, confirm labels)
  MUST exist in Polish and English and follow the admin's language setting; the picker's status,
  type and visibility labels MUST be translated (unlike the current hard-coded English on the
  Products list).

**Create order**

- **FR-020**: **Items** MUST offer a **Browse products** action that opens the product picker, and
  beside it a quick single-product search (by name or SKU) that appends the chosen product as a new
  line in one step. The per-row product search on each line is removed; lines are created only
  through these two entry points. The quick search MUST apply the same selectability rules as the
  picker (FR-009, FR-012).
- **FR-021**: **Items** and **Order summary** MUST NOT be shown until both the customer and the sales
  channel are set in **Customer & methods**; payment method, delivery method and addresses do not
  gate them. Until then a hint in their place MUST name the missing fields (customer, sales channel,
  or both).
- **FR-022**: Each added line MUST show product name and SKU, an editable integer quantity (≥ 1,
  default 1), the unit price and the line total (quantity × unit price) in the order currency, and a
  remove action.
- **FR-023**: Line prices and the summary MUST be recalculated whenever lines, quantities, customer,
  sales channel, delivery or payment method change, using the same pricing the order will be created
  with.
- **FR-024**: A line the pricing preview reports as unavailable MUST be marked and MUST block submit
  (existing rule, kept and extended). The causes are: product not found and quote-only (today,
  marked **No price**), and — new, FR-027 — not visible to the chosen customer and outside the
  order's chosen sales channel's assortment, each marked with its own translated reason instead of
  **No price**. A line shows exactly one reason; a product failing both new checks shows the
  visibility reason (FR-027). "Product not found" means an id with no catalogue row; a product
  soft-deleted from the catalogue is not "not found" — it is priced like a live product, as today
  and as order creation accepts it. *(Amended 2026-11-06, issue #820, feature 163 FR-001: a
  soft-deleted product is `PRODUCT_NOT_FOUND` on the preview, on every channel, as order creation
  refuses it with `404 PRODUCT_NOT_FOUND`.)* A
  product without an applicable price list keeps today's catalogue-default pricing, possibly 0.00,
  and is not unavailable.
- **FR-025**: Hiding the sections because a gating field is cleared MUST NOT discard the lines
  already added.
- **FR-026**: The created order MUST contain exactly the visible lines and quantities; the submitted
  payload shape is unchanged.
- **FR-027**: The order pricing preview (`POST /api/v1/admin/orders/preview`) MUST, per line, check
  (a) whether the product is visible to the chosen customer — the same `isProductVisibleTo` answer
  order creation applies, i.e. the customer's organization with `authenticated: true` — and (b)
  whether the product is in the assortment of the **order's chosen sales channel** (the request
  body's `salesChannelId`, not the channel the admin request was resolved on). A line failing either
  check MUST be returned with `unavailable: true` and a `messages` entry carrying one of **two new
  message codes**, one per cause — (a) the customer cannot see the product (organization visibility
  or restriction), (b) the product is not in the chosen sales channel's assortment — distinct from
  each other and from `PRODUCT_NOT_FOUND` and `QUOTE_ONLY`. The preview MUST return **exactly one**
  such message per line: the visibility check takes precedence, and the assortment code is returned
  only for a product the customer can see, so a product failing both checks carries the visibility
  code alone. The order screen MUST show each code's
  own translated reason on the line (FR-014). The change is additive to `adminOrderPreviewResponseSchema`
  (`packages/contracts/src/orders.ts`): no field removed or retyped, the request schema unchanged.
  The preview MUST price on, and check assortment against, exactly the channel the body's
  `salesChannelId` names; the current fallback to another active channel is removed. A
  `salesChannelId` naming no channel MUST be refused with the route's existing not-found error
  (`404 NOT_FOUND`, the existing error shape) before any line is evaluated — the preview neither
  falls back to another channel nor marks lines. The create path does not refuse such a channel
  today (`POST /api/v1/admin/orders` answers 201); that gap is a separate fix (*Out of Scope*),
  and the preview's refusal does not wait on it. The screen shows its existing **Could not calculate prices** (US1 scenario 14).
  The plan MUST justify the distinct codes against the single-answer (enumeration-oracle) rule
  documented on `isProductVisibleTo`, on the ground that the preview is an admin-only surface gated
  `orders:write`, and MUST record that justification where the rule is documented. The picker and
  the quick search MUST NOT pre-filter or grey out such products (the answer chose preview marking,
  not picker marking).

**Create quote request**

- **FR-030**: **Line items** MUST offer the same two entry points as the order screen (FR-020:
  **Browse products** and the quick single-product search, with the quote-request selectability
  rules) plus the list of added lines; each line shows product name and SKU, an editable integer
  quantity (≥ 1, default 1), an editable agreed unit price, and remove.
- **FR-031**: On add, each line's agreed unit price MUST be prefilled with the price resolved for the
  chosen customer (and its organization) at the line's quantity, or left empty when none resolves.
- **FR-032**: If no customer is chosen when products are added, lines MUST be added with empty prices
  and be prefilled as soon as a customer with an organization is chosen.
- **FR-033**: Changing quantity or customer MUST re-prefill a line's agreed price only while that
  price has not been edited by hand; a hand-edited price MUST NOT be overwritten.
- **FR-034**: A line with an empty agreed price or an invalid quantity MUST be visibly marked and
  MUST block submit; lines MUST NOT be silently dropped.
- **FR-035**: The running total (Σ quantity × agreed unit price) MUST update on every edit.
- **FR-036**: The existing customer-without-organization warning and the submit rules for customer
  and organization remain.

**Price list — Products & brackets**

- **FR-040**: **Add** MUST open the product picker over the whole catalog (FR-004) instead of the
  current single-product drawer.
- **FR-041**: Confirming MUST add every selected product to the price list without prices, in one
  request to the bulk-add endpoint (FR-045) — a request failing as a whole leaves the picker open
  with the selection kept (FR-010); after an accepted request the roster MUST show every product on the list
  (newly added and pre-existing, regardless of catalog size) by name and SKU, MUST open the bracket
  editor for any roster product selected, and MUST select the first added one.
- **FR-042**: Adding products MUST NOT change, remove or reset any product or bracket already on the
  price list.
- **FR-043**: Partial failure is a server contract for **per-product** problems in a request that is
  valid as a whole: a product that cannot be added (e.g. deleted from the catalog meanwhile) MUST NOT
  prevent the others in the same request from being added. The bulk-add response MUST report every
  requested product in exactly one of `added`, `unchanged` (already on the list) or `failed` (with a
  reason code); the screen MUST name each failed product with its translated reason (FR-014), and
  MUST NOT treat `unchanged` as a failure. A request **invalid as a whole** — an unknown or deleted
  price list, more than 200 product ids, a malformed body, or the system Default list (FR-045) — MUST
  be refused with an error status and MUST add nothing; such a response carries no `added` /
  `unchanged` / `failed` report; the screen handles it with the picker's confirm-failure state
  (FR-010).
- **FR-044**: **Add** MUST stay disabled on the system price list (as today) and MUST be disabled for
  users without `price_lists:write` (a new client-side gate; the server already refuses the write).
  The bulk-add endpoint enforces the system-list rule on the server as well (FR-045).
- **FR-045**: `price_lists` MUST gain an additive bulk-add endpoint that appends a set of products
  to a price list's roster without prices: at most 200 product ids per request (the FR-008 cap),
  gated `price_lists:write`, its request and response shapes defined as Zod schemas in
  `packages/contracts/` before implementation (Constitution II). The write MUST run as one audited
  command through the Command Bus (Constitution XIII), producing one audit entry for the request
  rather than one per product — and none when nothing was added, as the single add skips its audit
  entry today on a no-op (`price-list-service.ts`, `addProduct`). The endpoint MUST refuse the system
  Default price list — the fallback whose roster is seeded from each product's `defaultPrice` and is
  read-only in the admin by design — with an error and nothing added. It MUST likewise refuse, with
  nothing written and no audit entry, a request naming an unknown or deleted price list, carrying
  more than 200 ids, or with a malformed body (FR-043). Its errors MUST follow the error shape the
  existing price-list endpoints use (`HttpError` with an `ERROR_CODES` code, as the Default-list
  guards in `price-list-service.ts` do); the exact status and code per cause are the plan's. The
  existing single `POST …/products` and the delta-replace `PUT …/products` keep their current
  behaviour.

### Key Entities

- **Product (catalog)**: the selectable unit — id, SKU, localized name, status, type. The line unit
  on all three screens; variants are not selected.
- **Picker selection**: the transient set of product ids chosen in one picker session; never stored.
- **Order line / quote-request line / price-list roster entry**: the existing host records the
  selection is turned into; shapes unchanged.
- **Bulk-add result**: the per-product outcome of one accepted price-list bulk add — `added`,
  `unchanged` or `failed` with a reason code; returned to the client, not stored beyond the audit
  entry. A request refused as a whole (FR-043) returns an error instead and has no bulk-add result.
- **Preview unavailability reason**: the message code the order preview attaches to an unavailable
  line; the existing `PRODUCT_NOT_FOUND` and `QUOTE_ONLY` plus the two new codes of FR-027 (not
  visible to the customer; outside the chosen sales channel's assortment). Exactly one per line;
  visibility takes precedence over assortment (FR-027).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add 20 products found through two different filters to an order, a quote
  request or a price list in a single picker session (one open, one confirm).
- **SC-002**: The three host screens expose the identical filter set and column set in the picker
  (verified by one checklist applied to all three).
- **SC-003**: On a catalog of more than 500 products, any product matching the filters can be found
  and added on the price-list screen, and every roster product opens its bracket editor (today only
  the newest 20 are reachable).
- **SC-004**: On a fresh order form, 0 product lines can be entered before the gating fields are
  set; after they are set, every added line shows unit price and line total without a manual
  refresh.
- **SC-005**: 100% of new strings exist in both PL and EN; switching the admin language changes all
  picker text.
- **SC-006**: Orders and quote requests created through the new flow are accepted by the existing
  create endpoints with no payload changes; price-list brackets of pre-existing roster products are
  byte-for-byte unchanged after a bulk add.
- **SC-007**: A price-list Add of 200 products issues exactly one write request and produces exactly
  one audit entry (none when every product was already on the list or the request was refused as a
  whole).
- **SC-008**: For a given customer and sales channel, every order line that order creation would
  refuse as not visible to the customer is marked unavailable by the preview before submit; the same
  holds for assortment once the separate create-path fix (see *Out of Scope*) aligns the create
  check with the order's sales channel.

## Assumptions

- The picker mirrors only the Products-list filters that work today (status, type, search). The
  Stock, Category and Channel chips on the Products list are non-functional and are not copied;
  adding a category filter is out of scope.
- The line unit is the product. Variant selection is not offered.
- `simple`, `virtual` and `configurable` products are selectable on orders and quote requests
  (subject to the status rules in FR-012); a `configurable` product is added without a variant, as
  today.
- FR-012 and FR-009 are rules of the admin screens. The order-create and quote-request endpoints keep
  accepting what they accept today, and no endpoint's request payload changes. The feature makes
  two additive server changes — the price-list bulk-add endpoint (FR-045) and the preview's new
  unavailability checks and their two message codes (FR-027) — and one behaviour change on the
  preview: a `salesChannelId` naming no channel is refused (404) instead of being replaced by
  another active channel (FR-027). No response field is removed or retyped.
- The picker sorts like the Products list (newest first); no column sorting is added.
- The picker opens as an overlay (dialog or side panel) above the host screen; the exact pattern is a
  design decision constrained by FR-001…FR-011 and the admin design system.
- Added lines appear in the order the products were selected; new lines are appended after existing
  ones.
- The picker's default page size follows the user's Products-list page-size preference.
- Quote-request prices resolve against the system default sales channel and its default currency, as
  today; the quote-request screen gets no channel or currency selector.
- The order currency is the one the pricing preview returns (the delivery method's currency when one
  is chosen, otherwise the channel's default); the picker shows no prices.
- Permissions are the existing ones: `orders:write` (create order), `rfqs:handle` (create quote
  request), `price_lists:read` / `price_lists:write` (price lists), `catalog:read` (product listing),
  `price_lists:read` (quote-request price prefill). No new permission codes.
- **Line items** on the quote-request screen stays visible before a customer is chosen (no gating
  was asked for there); prices are filled once a customer with an organization is chosen (FR-032).
- The existing read endpoints are expected to suffice for the picker and the roster (the list
  endpoint for browsing, `batch-by-id` for names of products already on a host). The one new write
  endpoint is the price-list bulk add (FR-045), gated by the existing `price_lists:write`.
- The **Quick order** tab (`quick_order`, `/orders/quick-order`) is unchanged.
- Ordering of all four preview unavailability codes on one line: the product owner ruled only
  visibility over assortment (FR-027). The default, for the plan to confirm against the preview
  code, is `PRODUCT_NOT_FOUND` > visibility > assortment > `QUOTE_ONLY`, still exactly one message
  per line — a product that does not exist cannot be checked further, and a product the customer
  cannot see or cannot buy in the channel is not reported as quote-only.
- A price-list bulk add accepted with `failed` entries closes the picker like a fully successful one
  (US4 scenario 4); only a request failing as a whole keeps it open (FR-010).
- When an accepted bulk add has no `added` product (every product `unchanged` or `failed`), the
  picker closes, the roster reloads, and the roster selection is left as it was — FR-041's "select
  the first added one" has no referent.
- **Retry** after a confirm whose write did land but whose response was lost is safe: the bulk add
  is idempotent, so the retry reports those products `unchanged` and writes no audit entry
  (FR-045).
- The confirm and **Retry** actions are disabled while the bulk-add request is in flight, so one
  click sends one request.
- Price-list bulk add: "deleted from the catalog" (US4 scenario 4, FR-043) means soft-deleted
  (`deletedAt` set) → `failed: product_not_found`. An archived (inactive) or draft product is a live
  product and is **added** — every status is selectable on price lists (FR-012). Default accepted at
  analyze, 2026-10-13.
- Create quote request: on a customer change, every agreed price **not** typed by hand is cleared
  and then re-resolved for the new customer, so a line may go from a price to empty when nothing
  resolves for the new customer; a previous customer's price never survives as the new customer's.
  Hand-typed prices are kept (FR-031, FR-033). Default accepted at analyze, 2026-10-13.

## Out of Scope

- Variant-level selection (the contracts allow `variantId`, but no host uses it).
- "Select all N matching the filter" (collection mode) inside the picker.
- New filters beyond the Products list's working ones (category, sales channel, stock, price).
- Showing prices or stock inside the picker table.
- Changing the Products list screen itself (`/catalog/products`), including its broken chips and
  English labels.
- Line notes, packaging units, or discounts on quote-request lines.
- Any change to the request payloads of the order and quote-request create endpoints (SC-006). The
  preview response changes only additively (FR-027); its one new refusal, an unknown
  `salesChannelId`, uses the route's existing not-found error.
- **Separate fix, after this feature**: admin order creation checks channel assortment against the
  sales channel the admin request was resolved on (`outOfRequestChannel` in `CartService.addItem`)
  instead of the order's `salesChannelId`. This feature does not change the create path; the preview
  check of FR-027 already uses the order's chosen channel.
- **Separate fix, after this feature**: admin order creation (`POST /api/v1/admin/orders`) accepts a
  `salesChannelId` naming no channel and answers 201, where the preview (FR-027) refuses it with
  404. This feature does not change the create path.
- Greying out or filtering, in the picker or the quick search, products the chosen customer may not
  see or that are outside the channel's assortment (FR-027 marks them on the line instead).
- Server-side refusal of products for their status or type (FR-012 stays a rule of the admin
  screens).
- A server-side system-list guard on the existing single `POST …/products` and the delta-replace
  `PUT …/products`; only the new bulk-add endpoint refuses the Default list (FR-045).
- Visibility or assortment checks on quote-request creation (`createOnBehalf` stays exempt by
  ruling).
- Treating a product **soft-deleted** from the catalogue as unavailable on the order. Today both
  the preview and order creation accept it; a future change would cover the preview and the create
  path together, never the preview alone. (The price-list bulk add already refuses it per product,
  `failed: product_not_found`.) *Amended 2026-11-06, issue #820, feature 163 FR-001: delivered by
  feature 163 for both paths — create refuses it with `404 PRODUCT_NOT_FOUND`, and the preview
  reports it as `PRODUCT_NOT_FOUND`.*

## Clarifications

### Session 2026-10-13

Answers given by the product owner.

- Q: Which **Customer & methods** fields must be set before **Items** and **Order summary** appear on
  Create order? → A: Customer and sales channel only (FR-021, User Story 2).
- Q: How are grouped parents and draft/inactive products treated in the picker? → A: The picker opens
  on the Active tab; grouped/bundle parents are shown but not selectable, with a reason (orders and
  quote requests); draft/inactive are not selectable on orders and are selectable on quote requests;
  on price lists everything is selectable and the picker opens on All (FR-012).
- Q: What happens to a product that is already a line or already on the roster? → A: Shown as
  already added, not selectable (FR-009).
- Q: Maximum products per single Add? → A: 200 per Add; no "select all N matching" (FR-008).
- Q: Keep a quick single-product search next to the picker on orders and quote requests? → A: Yes,
  beside **Browse products**; the per-row product search is removed (FR-020, FR-030).
- Q: Should a line priced at 0.00 (no applicable price list, catalogue default 0) be blocked or
  flagged? → A: No; it keeps today's behaviour and no new block is added (FR-024).
- Q: Is the price-list defect — **Add** and the roster seeing only the newest 20 products — in scope?
  → A: Yes; fix it (FR-040, FR-041, SC-003).
- Q: How is a bulk add of up to 200 products to a price list written — one existing single-product
  `POST …/products` call per product, or a new bulk-add endpoint? → A: A new bulk-add endpoint in
  `price_lists`: one request, one audited write through the Command Bus, the response reporting
  `added` / `unchanged` / `failed` per product; FR-043's partial failure becomes a server contract
  (FR-041, FR-043, FR-045, US4 scenarios 4, 8, 9, SC-007). The earlier "no backend change" premise
  is withdrawn.
- Q: Order lines that order creation would refuse — the customer may not see the product, or it is
  outside the order's channel assortment — are priced by the preview and refused only at submit.
  Leave as today, mark them in the picker, or have the preview report them? → A: The preview reports
  such lines as unavailable with a reason (an additive message code (refined below: two codes)), so the line is marked and
  submit is blocked before sending — the same path as **No price**. The check uses the order's chosen
  sales channel. The plan must justify the distinct code against `isProductVisibleTo`'s single-answer
  rule (the preview is admin-only) (FR-024, FR-027, US1 scenarios 6, 11, 12, SC-008). The create
  path's request-channel assortment check is a separate fix, not this feature (*Out of Scope*).
- Q: Does the preview use one message code for both new unavailability causes, or one per cause? →
  A: Two distinct codes, one for "the customer cannot see this product" (organization visibility or
  restriction) and one for "the product is not in the chosen sales channel's assortment"; each shows
  its own translated reason on the line (FR-024, FR-027, US1 scenarios 6, 11, 12).
- Q: What does the bulk-add endpoint do with a request that is invalid as a whole (unknown or deleted
  price list, more than 200 ids, malformed body)? → A: Error status, nothing added; `added` /
  `unchanged` / `failed` reports only per-product problems (e.g. a product deleted meanwhile). Errors
  follow the existing price-list endpoints' error shape (FR-043, FR-045, US4 scenarios 11, 12).
- Q: May the bulk-add endpoint write to the system Default price list? → A: No; it refuses it on the
  server (error, nothing added). Default is the system fallback whose roster is seeded from the
  product's `defaultPrice` and is read-only in the admin by design. The existing single
  `POST …/products` is unchanged (FR-044, FR-045, US4 scenario 10, *Out of Scope*).
- Q: A preview line failing both new checks — the customer cannot see the product **and** it is
  outside the chosen sales channel's assortment — carries which message? → A: One message per line;
  the visibility reason takes precedence, and the assortment reason is reported only for a product
  the customer can see. One message per line keeps the contract and the tests deterministic
  (FR-024, FR-027, US1 scenario 13).
- Q: What does the picker do when a price-list bulk-add confirm fails as a whole (list deleted
  meanwhile, network error, 4xx/5xx)? → A: The picker stays open, the selection is kept, and an
  error message is shown in the picker with a **Retry** action; nothing was written (FR-010,
  FR-041, FR-043, US4 scenario 13).
- Q: On **Create order**, the chosen sales channel no longer exists (the preview body carries an
  unknown `salesChannelId`). Fall back to another channel, mark the lines, or refuse? → A: Refuse.
  The preview answers the route's existing not-found error (404, existing error shape) and the
  screen shows its existing **Could not calculate prices**; it does not fall back to another
  channel and does not mark lines (FR-027, US1 scenario 14, Edge Cases). The create path accepts
  an unknown `salesChannelId` today (201); closing that is a separate create-path fix (*Out of
  Scope*). Re-confirmed by the product owner on 2026-10-13 after that gap was found.
- Q: On **Create order**, a product soft-deleted from the catalogue — should the preview mark it
  unavailable? → A: No; today's behaviour stays: the preview prices it as a live product,
  consistent with order creation, which accepts it. Only an id with no catalogue row is
  `PRODUCT_NOT_FOUND`. A future change for soft-deleted products would cover the preview and create
  together (*Out of Scope*). The price-list bulk add keeps `failed: product_not_found` for
  soft-deleted products (FR-024, FR-043, Edge Cases). *Amended 2026-11-06, issue #820, feature 163
  FR-001:* the answer becomes **Yes, `PRODUCT_NOT_FOUND`, together with create**, which refuses it
  with `404 PRODUCT_NOT_FOUND`.
