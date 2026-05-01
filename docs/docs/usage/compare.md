---
title: Comparing products
---

# Comparing products

The Compare feature lets a B2B buyer set up to four products
side-by-side, switch among three views (everything / similarities only /
differences only), share the comparison with a colleague, export it to
PDF, and add a chosen product to the cart without leaving the page.

This page is written for the buyer and for the platform administrator
who wants to see what the buyer is doing.

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

Click a row to open the detail view. You'll see the same products and
attribute rows the customer is currently looking at — projected
through that customer's sales channel so prices match what they
reported. There are no edit, delete, or share buttons on the admin
view by design (it is read-only audit, not a tool to alter customer
state).

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
