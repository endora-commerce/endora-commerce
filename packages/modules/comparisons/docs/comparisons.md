---
title: Compare Products
description: 'Compare Products: customer-curated set with display modes, share link, and PDF export'
---

# Compare Products

Customer-facing product-comparison module. Owns a first-class
`Comparison` resource (a customer-curated set of products with a chosen
display mode and a stable shareable link), an admin observability
surface, and the Node-side PDF export. The module deliberately holds no
catalog data; it consumes products and the `is_comparable` attribute
flag through the `CatalogQueryService` port (Constitution Principle I).

This page is written for two audiences:

- **Buyers and platform administrators** who want to see *what* the
  feature does (sections "What a buyer does", "What an administrator
  sees", "What an administrator configures").
- **Developers** who need to extend or operate the module (every
  section after "Public surface").

## What a buyer does

### 1. Pick products to compare

On any catalog list page or product detail page, click **Compare** on
the product card. The button toggles — click it again to remove the
product from the comparison set. A header pill (**Compare (N)**) shows
how many products you have queued.

The first time you mark a product, the storefront opens a session for
your comparison. You don't need to be signed in.

### 2. Open the comparison page

Click the header pill, or navigate to `/compare`. You'll see a
side-by-side table:

- The header row always shows each product's **name**, **price** in
  your sales-channel currency, and **base image**.
- The body shows every comparable attribute the catalog administrator
  has flagged for comparison (weight, material, dimensions, etc. —
  varies per category).

### 3. Switch the view

The toolbar above the table has three buttons:

- **All attributes** — shows everything; rows that are identical
  across products are highlighted with a calmer styling, rows that
  differ stand out.
- **Common attributes only** — shows only the rows where every product
  agrees, so you can confirm the baseline.
- **Differences only** — shows only the rows where at least one
  product disagrees, so the decision-relevant signal stands out.

Switching is instantaneous — no reload.

### 4. Share with a colleague

Click **Copy share link**. The storefront writes a URL of the form
`https://your-store/compare/share/<token>` to your clipboard. Anyone
who opens that link sees the same comparison — without needing an
account, and without being able to change anything. They can switch
modes themselves (locally), but they cannot remove products, delete the
comparison, or use *Add to cart*.

The link works as long as the comparison exists. If you delete the
comparison, the link stops working for everyone.

**What the recipient sees is decided by who the recipient is**, not by
who sent the link. A share link grants access to the comparison, never
to anything in it:

- **Prices** — a signed-in recipient sees the prices agreed with *their*
  organization, and a recipient who is not signed in sees the store's
  standard prices. Your negotiated prices are never disclosed by a link
  you send, and the page says whose prices it is showing.
- **Products** — if your comparison holds a product that is restricted
  to your organization, a recipient outside it does not see that column.
  The page tells them that something is not available to them rather
  than quietly showing a shorter table. A recipient whose own
  organization is allowed to see the product sees it normally.

### 5. Add a chosen product to the cart

Once you've decided, click **Add to cart** on the chosen product's
column. The cart picks up the product subject to the same rules as if
you'd added it from the product page (channel availability, stock).
The comparison itself stays intact.

### 6. Export to PDF

Click **Export to PDF**. The storefront downloads a PDF named
`comparison-<token>.pdf` that mirrors what's on screen — same
products, same display mode, same column order. The PDF is generated
fresh each time; switching the display mode and re-exporting produces
a new file with the new mode.

PDFs of three or more products land in landscape orientation; one or
two products land in portrait.

### 7. Tidy up

When you're done, click **Delete comparison**. The set is cleared and
any shared links you sent stop resolving.

## Limits and edge cases

- **Maximum products per comparison** — defaults to **4**. Your
  platform operator can raise or lower this per sales channel via
  Settings (`compare.max_products`). The eleventh add — or whichever
  one exceeds the configured cap — is refused with a message; the
  existing comparison stays unchanged.
- **Removing a product** — drops a column. The remaining columns
  recompute which rows count as common vs. different.
- **One product in the set** — the page renders, but suggests adding
  at least one more product to draw a meaningful comparison.
- **Empty set** — the page invites you to add products from the
  catalog.
- **Product disappears from the catalog** — if a product is unpublished
  while it is in your comparison, the column stays but is marked
  unavailable; *Add to cart* is disabled for that column.
- **Shared link in a different sales channel** — recipients see prices
  in their own channel currency, and any product that isn't sold in
  their channel still appears but is marked unavailable.
- **Shared link opened by a buyer from another organization** — the
  columns are re-priced for that buyer's own agreements, and any product
  they are not entitled to see is left out with a note saying so.
- **Multi-value attributes** — two products are treated as agreeing on
  a multi-value attribute (e.g. a list of certifications) only when
  their full sets of values match.
- **Missing values** — a product without a value for a row renders an
  `—`, and the row counts as a difference.

## What an administrator sees

Open **Comparisons** in the admin sidebar. The list shows every
comparison every customer has built, with the customer's email (or
*Anonymous* for unsigned-in builders), the sales channel, the active
display mode, the product count, and the creation time. Filter by
channel, owner kind, or time range; sort is newest-first by default.

Click a row to open the detail view. You'll see every product and
attribute row the customer put in the comparison — including products
restricted to organizations other than theirs — projected through that
customer's sales channel. **The prices here are the channel's standard
prices, not the customer's negotiated ones**: the comparison prices for
whoever is looking at it, and an administrator has no buying
organization to price against. The screen says so, so a figure quoted
back to a customer is never mistaken for the figure they were shown.
There are no edit, delete, or share buttons on the admin view by design
(it is read-only audit, not a tool to alter customer state).

If a customer deletes their comparison on the storefront, the row
disappears from the admin list on the next refresh.

## What an administrator configures

| Where | What |
| --- | --- |
| **Catalog → Attributes**, the `Comparable` checkbox | Picks which attributes appear as rows on the comparison page. Independent of `Searchable` / `Filterable`. |
| **Settings → Compare**, the `compare.max_products` setting | The per-channel cap on how many products a single comparison can hold. |

## Why this exists

In B2B procurement, a buyer rarely chooses alone — engineers, finance
folk, and managers all weigh in. Building a comparison once, sharing
the link, and exporting a PDF for archival is what the feature is for.
The admin view exists so the platform team can investigate support
tickets that quote a shared link.

---

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/comparisons/me` | storefront (anonymous or customer) | Read the caller's Comparison; `204 No Content` when none |
| `POST /api/v1/comparisons/me/products` | storefront | Add a product (creates the Comparison + `compare_token` cookie on first call); refuses with `409 COMPARISON_FULL` over the channel-resolved cap |
| `DELETE /api/v1/comparisons/me/products/:productId` | storefront | Remove a product; `404 PRODUCT_NOT_IN_COMPARISON` if absent |
| `PATCH /api/v1/comparisons/me` | storefront | Update the persisted display mode (`all` / `common` / `differences`) |
| `DELETE /api/v1/comparisons/me` | storefront | Hard-delete the Comparison; the share token stops resolving for everyone |
| `GET /api/v1/comparisons/me/pdf` | storefront (owner only) | Owner PDF export; PDF mirrors the active mode and embeds product base images; `409 COMPARISON_EMPTY` for a zero-product comparison |
| `GET /api/v1/comparisons/share/:token` | public, no auth | Recipient view; same shape as the owner read minus `maxProducts`, plus `meta.viewerIsOwner`; priced and filtered for the *recipient* (`data.pricedFor`, `data.hiddenProductCount`); `404 COMPARISON_NOT_FOUND` for a deleted/never-existed token |
| `GET /api/v1/admin/comparisons` | admin (`comparisons:read`) | List every Comparison with filters (channel, owner kind, time range) and cursor pagination |
| `GET /api/v1/admin/comparisons/:id` | admin (`comparisons:read`) | Read-only detail; rendered through the comparison's recorded sales channel so the view matches what the customer reported |

There is **no** comparisons-side cart proxy. The storefront's
*Add to cart* button on the comparison page calls the existing
`POST /api/v1/cart/items` directly (research.md R-9).

## Settings

One knob under the `compare` group, registered by
`packages/modules/comparisons/src/manifest.ts`:

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `compare.max_products` | `number` | `4` | Upper bound on a single Comparison; the store-front refuses to add the (max+1)-th product per channel. Sane range `1..16`. |

The bound is read at request time inside
`ComparisonService.addProduct(...)`. Lowering the cap mid-session does
**not** retroactively trim existing comparisons (research.md R-7); the
next add is the first request that picks up the new value.

## Catalog flag

The module relies on a new `is_comparable` boolean column on
`product_attributes`. Catalog owns the column (migration `028` lives
under `catalog/migrations/`); the comparisons module reads it through
`CatalogQueryService.comparableAttributeKeys()`.

The Catalog admin UI's `<AttributesManager>` exposes a `Comparable`
checkbox alongside `Searchable` and `Filterable`; toggling it has no
side effect (no event emission, no reindex) — the next comparison-page
render picks up the change directly from Postgres.

## Storage

Two tables, both owned by the comparisons module
(`027_comparisons_init.ts`):

- `comparisons` — primary key, 22-char base64url `share_token`
  (`UNIQUE`), exclusive owner column (`customer_account_id` *or*
  `anonymous_token`; DB CHECK enforces XOR), `sales_channel_id` (FK
  with `ON DELETE RESTRICT`), `display_mode`, `created_at`,
  `updated_at`. Partial indexes on each owner column; a separate index
  on `(sales_channel_id, created_at desc)` supports the admin overview
  channel filter.
- `comparison_products` — composite PK on
  `(comparison_id, product_id)`, `position` (smallint), `added_at`.
  Both FKs cascade. Reverse index on `product_id` for the admin list's
  product-count aggregate.

No soft-delete. Per spec FR-014, a deleted comparison must resolve to a
clear "no longer exists" state for shared-link recipients — a missing
row + `404 COMPARISON_NOT_FOUND` already satisfies that without a
soft-delete bit.

## Anonymous → authenticated identity

Anonymous customers carry the `compare_token` cookie (HttpOnly,
SameSite=Lax, Path=/, Max-Age = 1 year). At sign-in the existing
`onLogin` hook in `organizationsModule` extracts the cookie and calls
`ComparisonService.adoptAnonymousComparison(...)` (research.md R-2):

- Customer with no Comparison → the anonymous one is reassigned
  (`customer_account_id` set, `anonymous_token` cleared).
- Customer with an existing Comparison → the anonymous one is hard-
  deleted; the customer's curated set wins.

## PDF export

Generated server-side with `pdfmake` — the module's only new runtime
dependency, justified per Constitution IV in
`specs/007-compare-module/plan.md` Complexity Tracking. Document
definition is built declaratively from `ComparisonOwnerView`; product
base images are pre-fetched by `AssetByteFetcher` (per-request cache,
1×1 transparent PNG fallback) and embedded as data URIs. Page
orientation is landscape when product count ≥ 3, portrait otherwise.

A strict deny-all `setUrlAccessPolicy` pins the contract that pdfmake
never opens its own network sockets — every image reaches the document
through the AssetByteFetcher.

## Module isolation

| Direction | What we depend on | How |
| --- | --- | --- |
| Reads | Catalog products and `is_comparable` flag | `CatalogQueryService.comparableAttributeKeys()` + entity reads via the EM |
| Reads | `compare.max_products` | `SettingsService.get(...)` — same shape Search uses |
| Reads | Sales channel context (currency, public flag) | `getResolvedChannel()` — the channel the resolver middleware put on the request scope |
| Reads | Customer email for the admin list | `CustomerAccount` entity — read-only join |
| Writes | None outside its own two tables | — |

The comparisons module has zero compile-time dependencies on the
`carts` module. Removing the comparisons module leaves catalog,
settings, sales_channels, and carts working — no dangling references.
