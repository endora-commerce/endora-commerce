---
title: The price-book editor
sidebar_label: Price-book editor
sidebar_position: 1
description: The admin screens of price books — the list, creating a book, the price grid, CSV import and export, duplication, base prices on the product, the price explainer and Pricing settings.
---

# The price-book editor

This page walks through the admin screens of the `price_lists` module. What a price book is, and how
the platform chooses the price a buyer pays, is on the [module's main page](../price_lists.md);
read its first sections before configuring prices.

| Screen | Where | Needs |
| --- | --- | --- |
| **Price books** — the list | sidebar *Price books*, `/price-lists`, ⌘K / CTRL+K *Price books* | `price_lists:read` |
| **New price book** | the list's *New price book* button, `/price-lists/new`, ⌘K *New price book* | `price_lists:write` |
| **A price book** — *Settings* and *Prices* tabs | `/price-lists/<id>`, `?tab=prices` for the grid | `price_lists:read`; changes need `price_lists:write` |
| **Price explainer** | `/price-lists/explain`, ⌘K *Price explainer*, and links from a book, a grid cell, a product and an organization | `price_lists:read` |
| **Pricing settings** | the list's *Pricing settings* link, `/price-lists/display-modes`, ⌘K *Pricing settings* | `price_lists:read`; changes need `price_lists:write` |
| **Base prices** on a product | *Catalog → Products → (a product) → Pricing* | `price_lists:read`; changes need `price_lists:write` |
| **Explain a price for this organization** | the organization's detail page | `price_lists:read` |

A control you may not use is absent rather than disabled: an administrator with read access sees
every screen without its edit, save, import and delete actions.

## The price-book list

The list shows every book you may see — base, catalogue, buyer and sale books — with its name, type,
status, currency, number of sales channels, audience, priority and number of price rows. A book
that cannot apply is flagged *Applies to no one* (a customer-group or organization book without
members) or *Applies nowhere* (no sales channel that sells in its currency). The base books are
marked *Base prices — PLN* and so on, one per currency.

Filter by name, type, status, currency, sales channel, audience kind and audience member. The
filters are kept in the page's address, so a filtered list can be bookmarked or sent to a colleague;
saved views are not available on this list yet (issue #408).

## Creating a book

*New price book* walks through five steps, in this order, and creates the book as a **draft**:

1. **Name and type** — *Regular prices* or *Sale prices*.
2. **Currency** — one, for good. The step lists the currencies your sales channels sell in, with
   the channels selling in each.
3. **Sales channels** — only channels that sell in the chosen currency are offered; the step names
   the channels left out and why. You can create a book with no channel and add one later, but it
   applies nowhere until you do.
4. **Audience** — *Everyone*, *Customer groups* or *Organizations*, with a picker for the members of
   the chosen kind.
5. **Schedule and priority** — leave the dates empty for a book that applies from activation and
   never ends. The priority only decides between books that price the same kind of line for the
   same buyer.

A sales representative is offered only *Organizations*, and only their own organizations.

## A book's *Settings* tab

The header shows the book's name, its base-book badge if it is one, its status, type and currency,
and three actions: **Duplicate**, **Explain a price** (the explainer pre-filled with this book's
channel, currency and, for a book with a single organization, that organization) and **View
history** (the audit log, filtered to this book).

The *Settings* tab edits the name, sales channels, members, schedule and priority, and saves them
with **Save changes**. The currency is shown but never editable — duplicate the book to price in
another currency. The audience kind is fixed once the book has been active. A channel that no longer
sells in the book's currency is shown as *Inactive — the channel no longer offers PLN*.

**Activate** and **Move to draft** change the book's status. When a book cannot be activated, the
screen says what is missing — a sales channel that sells in the currency, or a member — and offers
the step that fixes it.

**Delete** sits in its own section at the bottom, apart from the save, and asks for confirmation
naming the book and its number of price rows. Deletion cannot be undone.

The base books show none of these actions: they cannot be renamed, scheduled, given a priority,
moved to draft, duplicated or deleted.

If someone else saved the book after you opened it, your save is refused with *This price book
changed since you opened it* and a **Reload** action; nothing is overwritten silently.

## The price grid (*Prices* tab)

The grid is the editor of a book's rows: **one line per selection** — the whole catalogue, an
attribute value, a category, a category and attribute value, a product, a variant — and **one
column per quantity tier** used anywhere in the book ("From 1", "From 10", "From 100"). Lines run
from the most general to the most specific, alphabetically within each kind; a note above the grid
reminds that which line wins for a buyer is decided by the precedence, with a link to it on
*Pricing settings*.

### Adding lines

**Add lines** offers:

- **Products…** — the catalogue's product browser, where you tick many products at once. A product
  already in the book is not added again; the grid names it. The browser needs `catalog:read`.
- **Category…**, **Attribute value…**, **Category and attribute value…** — pickers that offer only
  attributes marked *Price list rules* that can select prices.
- **All products** — a line for the whole catalogue (a percentage or an adjustment only).

**Add quantity tier** adds a column, from a quantity of 2 or more. A product line of a product with
variants opens with **Show variants**: each variant is a sub-line, empty unless the variant has its
own price.

### Typing prices

Type into a cell:

| You type | The cell holds |
| --- | --- |
| `95`, `95,50`, `1 234,50 zł` | a fixed price (decimal comma or point, spaces and a currency symbol are accepted) |
| `-5%`, `+20%` | a 5 % discount, a 20 % surcharge |
| `-3`, `+3` | an amount adjustment of −3 or +3 |

The cell shows the kind in words and with an icon, never by colour alone. A percentage says what it
is taken off: *of base* in a catalogue book, *of catalogue price* in a buyer or sale book, *of the
product's base* on a variant line of a base book. A value that cannot be read, has too many
decimals, or is a percentage outside −100 % … +1000 % is marked in its cell with the reason and is
never sent.

**An empty cell inherits** the line's nearest lower tier, shown de-emphasised — *inherits from 1:
−5 %*. When the line has no lower tier, the cell says *not priced here*: the line does not price
that quantity, and another line, or the base price, does.

**Cell details** (from the cell's menu) set a quantity range that does not follow the columns, such
as 25–49 (it gets its own column), show what an empty cell inherits, clear the cell, and open **Why
this price?** — the explainer for this product.

### Working with the keyboard and a spreadsheet

The grid is fully usable without a mouse: arrow keys, Home/End, PageUp/PageDown, Tab and Shift+Tab
move; Enter or F2 starts editing and Enter commits; Escape cancels; Delete clears; Ctrl/⌘+C and
Ctrl/⌘+V copy and paste rectangular blocks to and from a spreadsheet (tab- or semicolon-separated);
Ctrl/⌘+D fills down; Ctrl/⌘+Z and Ctrl/⌘+Shift+Z undo and redo. A paste fills from the focused cell;
rows beyond the visible lines are ignored with a notice.

**Change selected…** applies one change to every selected cell — *Set a percentage*, *Set an amount
adjustment*, *Multiply fixed prices by*, or *Clear selected cells* — and is undone in one step.

### Saving

Every edit stays **unsaved** until you press **Save prices**; the count of unsaved changes is shown
beside it, and leaving the page asks first. A save sends all your changes as one batch and writes
one audit entry. While it runs the button shows progress and cannot be pressed twice.

- If the server refuses some rows — an overlap with another row of the same line, a fixed price on
  the all-products line, a product or category that no longer exists — **every** refused cell is
  marked with its reason and all your edits stay, ready to correct.
- If someone else saved the book since you opened it, the grid says so, keeps your unsaved changes
  and offers **Re-apply my changes** after reloading, or **Discard my changes**.

### Large books

The grid pages by **line** — 50, 100 or 200 lines a page — and never splits a line's tiers or a
product's variants across pages. **Search lines** finds lines by product name, SKU, category or
attribute value across every page, and the **Line kind** filter narrows to one kind. Unsaved edits
on other pages are kept while you page and search.

Lines that price nothing are shown as *Inactive* with the reason — an attribute that lost *Price
list rules* or was deleted, a product, variant or category that was deleted — and still open.

A book other than a base book holds at most 5 000 price rows; the grid refuses an edit that would
exceed it before saving.

### Base books in the grid

A base book opens in the same grid, restricted to **product and variant lines**. A product's base
price is a fixed price; a variant line is a fixed price, a percentage or an amount adjustment of
its product's base price.

## CSV export and import

**CSV file → Export to CSV** downloads the book (or the lines the current search and filter show)
in the fixed price-book format — one row per tier, UTF-8 with a byte-order mark, semicolon-separated,
with a decimal comma when the admin is in Polish and a decimal point otherwise, as the file name
says (`<book>-<date>-pl.csv` or `-en.csv`). It opens correctly in a spreadsheet with Polish
settings. More than 5 000 rows are written as numbered files of at most 5 000 rows each, each
importable on its own.

| Column (English) | Column (Polish) | Value |
| --- | --- | --- |
| `kind` | `rodzaj` | `all`, `attribute`, `category`, `category_attribute`, `product`, `variant` |
| `product_sku` | `sku_produktu` | for `product` and `variant` |
| `variant_sku` | `sku_wariantu` | for `variant` |
| `category_path` | `sciezka_kategorii` | the category's slugs from the root, joined by `/` |
| `attribute_key` | `kod_atrybutu` | for `attribute` and `category_attribute` |
| `attribute_value` | `wartosc_atrybutu` | the option code |
| `min_quantity` | `od_ilosci` | a whole number, 1 or more |
| `max_quantity` | `do_ilosci` | a whole number, or empty for no end |
| `price_kind` | `typ_ceny` | `fixed`, `percent`, `amount` |
| `value` | `wartosc` | a fixed price; a signed percentage (`+20`, `-5`); a signed amount |

**CSV file → Import from CSV…** reads a file in that format — a comma or a semicolon, a decimal
comma or point, UTF-8 with or without a byte-order mark, or Windows-1250 (when the file is not
UTF-8 the screen shows its first lines and asks you to confirm the encoding). A file over 5 MB or
with more than 5 000 rows, an unknown, missing or duplicated column, or an empty file is refused
before anything else.

Choose how to import:

- **Merge** (the default) — rows of the file are added or changed; the book's other rows stay.
- **Replace** — the book's rows become exactly the file's; the preview states how many rows would
  be removed.

The **preview** comes from the server checking the very batch it would write, and writes nothing:
counts and lists of added, changed (before → after) and — in replace mode — removed rows, and every
row that cannot be imported with its file line and reason (an unknown SKU, variant, category path or
attribute value, an attribute that cannot select prices, an unreadable number, an overlap, a row a
base book cannot hold). A preview with any refused row cannot be confirmed: fix the file and upload
it again, or **Download refused rows** — the same format plus a `reason` column, which the importer
ignores, so the corrected file imports as it is.

**Import N changes** writes the batch as one audited change, against the version of the book the
preview was made from. If someone saved the book in between, the import is refused and a fresh
preview is offered. An import is not possible while the grid holds unsaved edits of the same book —
save or discard them first. An exported book re-imported unchanged previews as *No changes*.

## Duplicating a book

**Duplicate** opens a dialog pre-filled from the book: the name with *(copy)*, the same sales
channels, currency and audience, and **Multiply fixed prices by** 1. Change any of them — another
currency with an exchange multiplier, another organization as the audience. Fixed prices and amount
adjustments are multiplied (rounded half-up to four decimals); **percentages are copied unchanged**.
Channels that do not sell in a newly chosen currency are flagged before you submit. The copy is a
draft and opens when created; the original is untouched. The copy keeps the original's type,
priority and schedule.

## Base prices on the product

The product editor's **Pricing** tab ends with the **Base prices** panel, contributed by this
module. It is available once the product has been created.

- One block per currency that any sales channel sells in: the product's price *from 1*, and **Add
  tier** for further tiers, each starting above the one before.
- For a product with variants, each variant: *Inherits the product's price*, *Own price*,
  *Percentage* or *Amount adjustment*, with the resulting price shown as a labelled **preview**,
  rounded as the server rounds it. A variant whose own price has quantity tiers is edited in the base
  book's grid.
- The panel says when the product has no base price in a currency — buyers paying in it cannot
  order it — or none at all.
- **Save prices** saves the panel; it is the panel's own button, separate from the product's save,
  and leaving the tab or the page with unsaved prices asks first (one save for the whole page is
  issue #407). An invalid value is reported on its field.
- **Open the base prices** opens the base book's grid; **Why this price?** opens the explainer for
  this product.

Below it, read-only, **Price books pricing this product** lists every book with a row naming the
product or one of its variants directly — the book, its audience and the price each row sets —
linking to the book's grid.

A sales representative sees the base prices and cannot change them.

## The price explainer

The explainer answers *"what does this buyer pay for this product, and why?"*. Choose:

- the **sales channel** (the default channel when none is chosen) and the **currency** (the
  channel's currency when none is chosen);
- the **buyer** — a guest, an organization, or a customer (picking a customer needs
  `customers:read`); a sales representative is offered only their own organizations;
- one or more **lines** — a product, optionally a variant, and a quantity.

**Explain** shows, for each line, the price; its **source** — *Base price*, *Catalogue price*,
*Buyer price* or *Sale price*; the cell that decided it, in words (*Organization book, product
line*); the book (linked) and the row (**Open the row** opens the grid at that line); the
**reference price** a percentage or an adjustment was taken off; the precedence version; and the
**runner-ups** — the other candidates of the step that decided the price (up to ten), in rank
order. For a charged sale it also shows the
regular price the sale beat. For an unpriced line it says that no base, catalogue, buyer or sale
price applies, and offers **Set a base price**.

Opened from a book, a grid cell, a product or an organization, the explainer is pre-filled from
there.

## Pricing settings

*Pricing settings* (`/price-lists/display-modes`) holds three things:

- **Display modes** — the platform-wide modes for signed-in and anonymous visitors
  (`pricing.default_display_mode`, `pricing.unauthenticated_display_mode`) and the overrides per
  organization, category and product.
- **Storefront prices** — *Show list price beside the buyer's price*
  (`pricing.show_list_price`, off by default). Saving it is audited, and buyers see the change from
  their next page. What buyers then see is described on the
  [main page](../price_lists.md#where-prices-appear).
- **Price precedence** (`#precedence`) — the preset in force, its version, the twelve cells in
  order with an example each, whether a category line wins over an attribute value line, and a note
  that changing the precedence arrives in a later release. Nothing on it can be changed.

## Sales representatives

A sales representative works in the same screens with these differences:

- The list shows organization books whose every member is one of their organizations, and the books
  for everyone and for customer groups. A book naming any other organization is missing from the
  list, and its address shows *Price book not found*, exactly as for a book that does not exist.
- Books for everyone, customer-group books and the base books open read-only, with no edit, save,
  import, duplicate or delete action.
- Creating or duplicating a book offers only *Organizations*, and only their own; the member
  pickers and the explainer's buyer picker list only their organizations.
