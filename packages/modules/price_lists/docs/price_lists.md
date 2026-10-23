---
title: price_lists
sidebar_label: Price books
description: Price books — base prices per currency, catalogue, buyer and sale prices on sales channels, and the rules that decide what each buyer pays.
---

# Price books (`price_lists`)

Every price a buyer sees or pays — on a product list, a product page, in search, in the basket, on
an order, in a quote request's reference price, in the external catalogue API and in a product
feed — comes from **price books**. This page explains what a price book is and how the platform
chooses the price a buyer pays. Two further pages go deeper:

- [The price-book editor](./price_lists/price-book-editor.md) — the admin screens, step by step:
  the book list, creating a book, the price grid, CSV import and export, duplicating a book, base
  prices on the product, the price explainer and *Pricing settings*.
- [Pricing for developers](./price_lists/developer-guide.md) — the data model, the resolution
  algorithm, the one sanctioned read path, caching, the price surface behind price sorting, the
  admin API, the ports other modules use, and how the release converted the old model.

The module cannot be switched off on the modules screen: B2B selling is contract pricing, and
without this module every buyer would silently pay the base price.

## The idea in one paragraph

Each product has a **base price** in each currency. A **catalogue** price book can change that
price for everyone on some sales channels. A **buyer** price book gives an organization, a set of
organizations or a set of customer groups their own prices. A **sale** price book offers a
temporary price, which is charged only when it is lower than the price the buyer would pay
otherwise. When several books price the same product for the same buyer, a fixed, published order —
the **price precedence** — decides which one wins, and the **price explainer** shows, for any buyer
and product, which book won and which lost.

## What a price book is

A price book has a **header** and **rows**.

The header fixes:

| Field | What it means |
| --- | --- |
| **Name** | What you recognise the book by. Renaming a book never changes which price wins. |
| **Type** | *Regular prices* — the prices buyers pay — or *Sale prices*, charged only when lower than the buyer's regular price. |
| **Currency** | Exactly one. It never changes after the book is created; to price in another currency, duplicate the book. |
| **Sales channels** | The channels the book applies on. Each must sell in the book's currency. A channel that later stops offering the currency stays on the book as *Inactive* and the book stops applying there; when the channel offers the currency again, the book applies again with no change to the book. |
| **Who the prices are for** (audience) | *Everyone*, a set of *customer groups*, or a set of *organizations* — one kind per book, never a mix. The kind is fixed once the book has been active. |
| **Schedule** | Optional start and end. A book applies from the exact start instant until the exact end instant. |
| **Priority** | A whole number. It only decides between books that price the same kind of line for the same buyer — the higher number wins — and never lets a general line beat a more specific one. |
| **Status** | *Draft*, *Scheduled*, *Active* or *Expired*. A draft never applies. Activating a book makes it *Active*, or *Scheduled* when its start is in the future. *Move to draft* takes it out of use again. |

A book can be activated only when it would apply somewhere and to someone: it needs at least one
sales channel that sells in its currency, and a customer-group or organization book needs at least
one member.

Each **row** prices one **line** of the book for a quantity tier. A line is one of:

| Line | Prices |
| --- | --- |
| **All products** | every product (a percentage or an adjustment only — never one fixed price for everything) |
| **Attribute value** | every product with that value of an attribute, for example *color = red* |
| **Category** | every product assigned to that category (its own assignment; sub-categories are not included) |
| **Category and attribute value** | the products of that category that have that value — for example red products in *Screws* |
| **Product** | one product, and all its variants |
| **Variant** | one variant of a product |

Only attributes marked **Price list rules** under *Catalog → Attributes* can form attribute lines,
and only those whose values are a single choice, multiple choices or yes/no and that are neither
per-language nor per-sales-channel. If an attribute loses the flag (or stops qualifying), its lines
stop pricing — the grid shows them as *Inactive* with the reason — and they price again as soon as
it qualifies again. Pricing never fails because of such a line.

A row states its price in one of three ways:

| Kind | Typed as | Meaning |
| --- | --- | --- |
| **Fixed price** | `95` or `95,50` | the price, up to four decimal places |
| **Percentage** | `-5%`, `+20%` | a discount or a surcharge, from −100 % (a free line) to +1000 %, up to two decimal places |
| **Amount adjustment** | `-3`, `+3` | an amount taken off or added |

A percentage or an adjustment is taken off a **reference price**: the base price for a catalogue
book, the catalogue price for buyer and sale books (see below). If a row's result would be below
zero, that row does not price the line and the next candidate is tried; a result of exactly zero is
a valid price.

**Quantity tiers.** Each row starts at a quantity ("from 1", "from 10", "from 100") and, unless it
has an explicit end, runs until the line's next tier starts. Two rows of the same line may not
overlap. A row that does not cover the quantity being ordered does not price it, and resolution
moves on to the next candidate — another tier of the same line, or another line.

A book holds at most 5 000 rows. The base books are not limited by that number, because they hold
the base price of every product in the catalogue.

## Base prices

Each currency has exactly one **base price book** — shown in the list as *Base prices — PLN*,
*Base prices — EUR*, and so on. It applies to every buyer, on every sales channel that sells in its
currency, and it is always active: it cannot be renamed, scheduled, given a priority or deleted.

- A **product's base price** is a fixed price, optionally with quantity tiers, in each currency you
  sell it in. You set it on the product itself (*Catalog → Products*, the *Pricing* tab) or in the
  base book's grid.
- A **variant** either **inherits** its product's base price, or has **its own price**, or is a
  **percentage** or an **amount** above or below the product's base price at the same quantity.

A base price is never converted between currencies: a product with a base price in PLN only has no
price at all in EUR. **A product with no base price in a currency, and no other book pricing it, is
unpriced in that currency**: buyers cannot add it to the basket and see the quote-request path
instead. There is no other fallback — a product carries no price of its own.

The base book of the platform's default currency always exists; the base book of another currency
is created the first time a base price is saved in it.

## How the price a buyer pays is chosen

A price is always worked out for a product (and, when one is chosen, a variant), a quantity, a sales
channel, a currency and a buyer. The buyer is a guest, or an organization — with its parent
organizations — and **one customer group**: the signed-in customer's own group if they have one,
otherwise their organization's group.

Only books that are active now, in the request's currency, on the request's channel (with that
channel selling in the currency) and for this buyer take part. The price is then built in four
steps:

1. **Base price** — the variant's base row if it has one, otherwise the product's, at the tier that
   covers the quantity.
2. **Catalogue price** — the best row of the regular books for *everyone* on this channel, if any
   prices the line: a variant line before a product line, before a category and attribute value line,
   before a category line, before an attribute value line, before an all-products line.
   Percentages are taken off the base price. If no such row prices the line, the catalogue price is
   the base price.
3. **Buyer price** — the best row of the regular books for the buyer's organizations and customer
   group, by the price precedence below. Percentages are taken off the **catalogue price**. If no
   such row prices the line, the buyer price is the catalogue price.
4. **Sale** — the best row of the sale books that apply to the buyer (their own organization and
   group sale books first, then sale books for everyone). Percentages are taken off the catalogue
   price. The sale is **charged only when it is strictly lower than the buyer price**; the buyer
   then sees their own price struck through. A sale equal to or above the buyer's price is not
   charged and nothing is struck through — a contract customer never pays more because of a sale.

Because buyer percentages are taken off the catalogue price, a contract discount follows a channel
price: if the channel sells a product at 120 instead of 100, a 20 % contract discount gives 96.

Percentages are rounded half-up to four decimal places; the basket rounds line amounts to two, as it
always has.

### The price precedence

A buyer can be priced by several lines at once — their organization's price for one product, their
organization's discount on a whole category, their customer group's price for the same product. Each
candidate falls into one of twelve **cells**: who the book is for (*organization* or *customer
group*) × what the line selects. The precedence is the order of those twelve cells; the first cell
that has a candidate wins.

The platform ships with the preset **Contract first, blanket last (HY)**:

| # | Cell | Example |
| --- | --- | --- |
| 1 | Organization × variant | Acme's price for one variant of Screws 0200 |
| 2 | Organization × product | Acme's price for Screws 0200 |
| 3 | Organization × category and attribute value | Acme's price for red items in Screws |
| 4 | Organization × category | Acme's price for everything in Screws |
| 5 | Organization × attribute value | Acme's price for everything red |
| 6 | Customer group × variant | VIP customers' price for one variant of Screws 0200 |
| 7 | Customer group × product | VIP customers' price for Screws 0200 |
| 8 | Customer group × category and attribute value | VIP customers' price for red items in Screws |
| 9 | Customer group × category | VIP customers' price for everything in Screws |
| 10 | Customer group × attribute value | VIP customers' price for everything red |
| 11 | Organization × all products | Acme's discount on everything |
| 12 | Customer group × all products | VIP customers' discount on everything |

So an organization's negotiated prices win over its group's, except that an organization's blanket
discount on everything does not override a specific price its customer group has — otherwise a
small blanket discount would leave that organization paying more than every other member of the
group. A category line wins over an attribute value line, in every step.

Inside one cell the remaining ties are decided in this order:

1. **The nearer organization** — a line of the buyer's own organization before one of its parent,
   before one of the parent's parent. A branch with no line of its own in a cell gets its head
   office's.
2. **Priority** — the higher number wins.
3. **The higher starting quantity** — a "from 100" row before a "from 10" row that also covers the
   quantity.
4. **The lower price.**
5. A fixed internal order, so the answer never depends on timing, on a rename or on which book was
   edited last.

The precedence in force is shown read-only on *Pricing settings*. Three other presets exist in the
code — *Audience first (AF)*, *Specificity first (SF)* and *Audience first, nearest organization
first (AF-N)* — but changing the precedence is not available yet: it arrives in a later release with
a preview of what the change would do.

### Variants

A variant is priced in the same books as its product. A variant line wins over its product's line in
the same audience; a **fixed** product price applies to every variant unless a variant line of the
same or a better cell prices it; a **percentage** on the product keeps the differences between its
variants. An attribute line matches a variant on its own axis values (a red variant of a product
matches *color = red*), overlaid on the product's values.

On a product list, a product whose variants cost different amounts shows its lowest price as a
**"from"** price; sorting and filtering by price use that lowest price. On the product page the
price shown is the price of the selected variant, and the basket charges the price of the variant
in the line.

## Where prices appear

The same buyer, product, variant, quantity, channel and currency get **the same price on every
surface**: product lists, search results and suggestions, the product page, comparisons, related
products, the basket and checkout, order placement, the admin order form, quote requests, the
external catalogue API and product feeds. The basket re-prices a line whenever it is added, merged
or has its quantity changed, and order placement refuses a basket whose stored price is no longer
current (`409 CART_PRICE_CHANGED`), so the buyer reviews the new price before ordering.

**Sorting and filtering by price** follow the prices the product cards show, for every buyer — a
buyer with their own contract prices sees the list in the order of their own prices. The order is
served from prices the platform precomputes in the background: after a price change the cards show
the new price at once, and the sorted order catches up once the background refresh has run. The
refresh recomputes only the products a change can move, for the buyers it can reach, so a price
book line, a base price or a product edit shows in the order within about half a second in the
platform's measurements, even during a large product import. A change that reaches the whole
catalogue — a line for all products or for an attribute value alone, a change to more than 10 000
products at once, or a change to a sales channel — recomputes the order whole for every group of
buyers it reaches, which can take minutes on a large catalogue with many contract price books.

**List price beside the buyer's price.** With *Show list price beside the buyer's price* switched on
(*Pricing settings*, off by default), a buyer whose price is below the catalogue price sees both on
the product page, on product lists, in search results and in search suggestions — *List price
100.00 · Your price 95.00*. A buyer whose price equals or exceeds the catalogue price sees one
price. When a sale is charged, the buyer sees two prices only: the list price struck through and
the sale price as *Your price*; their regular contract price is not shown as a third number. With
the switch off, a charged sale strikes through the buyer's own price. The basket and checkout always
show only the price charged.

**Display modes** decide how prices are shown — gross only, net only, both, or not at all. *None*
hides every price and replaces *Add to cart* with *Add to quote request*; the basket also refuses
such a product (`400 CART_PRODUCT_QUOTE_ONLY`). The mode is set platform-wide (separately for
signed-in and anonymous visitors) and can be overridden per organization, per category and per
product; the most specific setting wins. Display modes are set on *Pricing settings* and in the
organization and category editors.

## Worked examples — the demo shop

The demo shop (`pnpm run cli demo seed`) carries the three scenarios the model was designed
against, with literal numbers. Its fixture:

- *Screws 0200* — red, in category *Screws*, base price 100.00 PLN;
- *Screws 0032* — blue, in *Screws*, base price 50.00 PLN;
- *Bolts 0025* — red, in category *Bolts*, base price 30.00 PLN;
- the organization *Acme B2B (demo)*, a member of the customer group *VIP*.

The three scenarios are **alternatives**: once the demo is seeded the E3 books are active and the E1
and E2 books are drafts. To see E1 or E2, activate that scenario's books and move the others to draft.

**E1 — a price for everyone on a category and attribute value.** Book *E1 — red screws for everyone
(demo)*: regular, everyone, one line *Screws* ∩ *color = red*, fixed 120.

| Buyer | Product | Pays | Why |
| --- | --- | --- | --- |
| guest | Screws 0200 | 120.00 | the catalogue line prices red screws |
| guest | Screws 0032 | 50.00 | blue: the line does not match, so the base price |
| guest | Bolts 0025 | 30.00 | red, but not a screw: the base price |
| Acme | Screws 0200 | 120.00 | Acme has no book of its own in this scenario |

**E2 — an organization's contract.** Book *E2 — Acme B2B contract (demo)*: regular, for the
organization Acme, *Screws* −10 %, *Screws 0200* −20 %.

| Buyer | Product | Pays | Why |
| --- | --- | --- | --- |
| Acme | Screws 0200 | 80.00 | the product line (−20 %) wins over the category line (−10 %) |
| Acme | Screws 0032 | 45.00 | the category line |
| Acme | Bolts 0025 | 30.00 | nothing matches: the base price |
| another organization | Screws 0200 | 100.00 | not a member: the base price |

With E1 active as well, Acme pays 96.00 for Screws 0200: −20 % is taken off the catalogue price of
120, not off the base price.

**E3 — an organization within a customer group.** Books *E3 — VIP customers (demo)* (for the
customer group VIP, *Screws 0200* −10 %) and *E3 — Acme B2B terms (demo)* (for the organization
Acme, *Screws 0200* −5 %, *Screws* −15 %).

| Buyer | Product | Pays | Why |
| --- | --- | --- | --- |
| Acme | Screws 0200 | 95.00 | *Organization × product* (−5 %) is the best cell; the category line (85.00) and the VIP line (90.00) lose |
| another VIP organization | Screws 0200 | 90.00 | the VIP line |
| Acme | Screws 0032 | 42.50 | Acme's category line (−15 %) |
| a branch of Acme | Screws 0200 | 95.00 | inherited from its head office |
| a guest, or an organization outside VIP | Screws 0200 | 100.00 | the base price |

The price explainer answers each row of these tables with the winning book, the cell, the reference
price and the runner-ups.

## Who can do what

| Permission | Grants |
| --- | --- |
| `price_lists:read` | the book list, every book's settings and prices, base prices, the price explainer, *Pricing settings* |
| `price_lists:write` | creating, changing, activating, scheduling, duplicating, importing into and deleting books; base prices; display modes; the list-price switch. Adding product lines also uses the catalogue's product browser, so a role that edits books also needs `catalog:read` (the role editor on `/admin-roles` says so). |

**Sales representatives** — administrators whose role limits them to their own organizations — see
and edit only organization books whose **every** member is one of their organizations. Books for
everyone, customer-group books and the base prices are read-only for them. A book naming any
organization outside their scope does not exist for them: it is missing from the list, and its
address shows the same page as a book that was never created. When they create a book, they can
choose only *Organizations*, and only their own.

Every change to a book — its settings, channels, members, rows, activation, a duplicate, a deletion
— and every change to base prices and to the list-price switch is written to the audit log with the
administrator and the state before and after; *View history* on a book opens its entries.

## Known limitations

- **The precedence cannot be changed yet.** The HY preset is the only one in force; the change flow,
  with an impact preview, is a later release.
- **Promotions apply on top of sale and contract prices.** A cart promotion does not yet know
  whether a line is priced by a sale or a contract; excluding such lines is a later release.
- **The base-price panel on the product has its own *Save prices* button**, separate from the
  product editor's save, and asks before you leave it with unsaved changes. One save for the whole
  product page is issue #407.
- **The book list has no saved views**; its filters live in the address, so a filtered list can be
  bookmarked and shared (issue #408).
- **Right after a large import**, the grid of a very large book (tens of thousands of lines) can take
  slightly longer to page and search until the database has refreshed its statistics, which it does
  on its own shortly afterwards (issue #409).
- **The product editor's *Variants* tab shows no variants for an inactive product or one outside the
  default sales channel**, because it reads them through the storefront read (issue #410). The
  base-price panel is not affected: it reads every variant.
- **Screen readers announce the storefront's sale badge as "Request a quote"**; the visible text is
  correct (issue #411).
- **The sorted order lags a price change** by the background refresh — usually under a second, and
  minutes for a change that reaches the whole catalogue (see *Where prices appear*); the prices on
  the cards never lag. Price sorting needs the platform's background workers running.
- **The external catalogue API** prices the API key's organization with that organization's
  customer group, not the bound customer account's own group, and its bulk pricing request names
  product SKUs only.
- **Product feeds price products, not variants**, at quantity 1.

## Upgrading from the old price lists (migration note)

The release that introduced price books replaced the previous pricing model in one step. On an
instance that used it:

- **Base prices are kept.** Every price of the old *Default* price list became a base price of its
  currency.
- **Every other price list is gone** — with its Application rule, its products and quantity brackets
  and its price matrix. Recreate the prices it held as price books.
- **The product's *Default unit price* and the variant price override are gone**, and were not
  converted: the product editor no longer has those fields, and product writes and the products
  import refuse them (`400 PRICE_SET_IN_PRICE_BOOKS`). A product that had only a *Default unit price*
  and no *Default*-list price has no price until you enter a base price on its *Pricing* tab.

What the migrations did, and which API calls replaced the removed ones, is in
[Pricing for developers](./price_lists/developer-guide.md#upgrading-from-the-old-model-migration-note).
