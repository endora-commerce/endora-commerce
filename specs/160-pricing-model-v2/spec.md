# Feature Specification: Pricing model v2 — price books, three-tier resolution, variant prices

**Feature Branch**: `160-pricing-model-v2` (spec directory `specs/160-pricing-model-v2/`)
**Created**: 2026-10-21
**Status**: Draft — one scope question open (*Clarifications*); every pricing-semantics question is
settled by D-287 and the owner's rulings Q1–Q11, N1–N13.
**Input**: Phase **P1** of the ratified pricing decision **D-287**
(`specs/pricing/decision-record.md` §8.2): replace the Application rule and the per-product
brackets with price books (a header fixing currency, channel set and audience set; rows pricing a
selection), resolve every price through three tiers (base → catalogue → buyer, then sale when
lower) over a configurable precedence seeded with the **HY** preset, price variants in the same
books, precompute buyer prices for price-sorted listings, convert base prices once and drop
everything else of the old model, re-point every consumer, version the admin API, and reseed the
demo with the owner's scenarios E1–E3.

## Background

The standing analysis is `specs/pricing/` and is not restated here: what the code does today is
`current-model.md`, every read path and its cost is `read-paths-and-performance.md`, the target model
and every ruling is `decision-record.md` (ratified as D-287 on 2026-10-21), and the scenarios this
feature must reproduce are the test vectors of `worked-examples.md` §10. Citations below of the form
"§5.2" point into `decision-record.md`; vector ids (E1.1, F5, V4 …) point into `worked-examples.md`.

There is no production deployment (owner, 2026-10-21): the feature replaces the old model in one
step, without a compatibility period (§8).

## Vocabulary

- **Price book** (price list) — a header (name, type *regular* or *sale*, one currency, a set of sales
  channels, an audience set of one kind, schedule, priority) and its **rows**.
- **Audience set** — *everyone*, a set of customer groups, or a set of organizations; never mixed.
- **Row** — prices a **selection** (variant, product, category ∩ attribute value, category, attribute
  value, all products) for a quantity tier, as a fixed amount, a signed percentage or a signed amount
  adjustment of a reference price.
- **Base book** — the system price book of one currency, channel-independent, holding the base
  price of products and variants.
- **Catalogue price** — the base price, unless a regular book for *everyone* on the channel prices
  the line; the reference of every buyer-tier and sale percentage (§5.3).
- **Buyer price** — the best-ranked row of the buyer's organization-set and customer-group-set books,
  else the catalogue price.
- **Cell** — audience kind × selection kind (e.g. *organization × category*); the precedence orders
  the twelve buyer cells (§5.6).
- **Price source** — which tier priced a line: base, catalogue, buyer or sale.

## Clarifications

### Settled before this specification (2026-10-21)

All of D-287's rulings apply as recorded in `decision-record.md` *Owner rulings* (Q1–Q11, N1–N13):
audience and channel sets; `isPriceRule` kept; percentages off the catalogue price; surcharges
allowed; category before attribute; sales representatives edit only their organizations' books;
sort by the quantity-1 price; configurable precedence with HY as the default and AF-N as the only
depth-first preset; fixed product prices apply to every variant; amount adjustments everywhere;
"from" price for variant products; surcharge bound +1000 %; one category ∩ one attribute value at
most; development price books dropped and reseeded; demo books reproduce E1–E3.

### Session 2026-10-21

- Q: Between this feature and P2, must administrators be able to edit prices in the admin at all?
  Removing the old model removes what today's admin screens edit — the price-list editor's
  *Products & brackets*, *Application rule* and *Price matrix* tabs, and the Product editor's
  *Default unit price* field. → A: **(C) this feature and P2 (the price-book editor, issue #378
  re-scoped) are released together**, so no release ever lacks a working price editor. There is no
  production deployment, and a throwaway interim editor would be built only to be replaced. Neither
  feature's changes reach `master` ahead of the other in a way that leaves the admin without price
  editing; the plan decides the branch and merge mechanics.
- Q: E1–E3 conflict on the one demo organization and product (E2 and E3 give *Acme B2B (demo)*
  different terms for *Screws 0200*; E1 raises its catalogue price, which moves every percentage of
  E2 and E3). How must the demo show them? → A: **(A) one scenario active at a time.** The examples
  were illustrations of possible variants, never meant to be active together. The demo seeds all
  three scenarios' books; E3's are active and E1's and E2's are drafts, and a presenter activates one
  scenario at a time, each then showing its literal numbers.
- Q: The migration order runs every catalogue migration before every price-list migration, so the
  catalogue fields cannot be dropped in the same release after a price-list conversion has read
  them. Remove them a release later, or do not convert them? → A: **one release, no conversion of
  the catalogue fields.** The conversion reads only the price-list module's own data (Default-list
  brackets become base-book rows of their currencies); `products.attribute_values.defaultPrice` and
  `product_variants.price_override` are not converted, and the catalogue module's own migration in
  this release drops `price_override` and strips the `defaultPrice`/`price` keys. A variant price
  override was never charged, so converting it would turn a never-paid number into a charged price;
  the product *default price* mattered only for products without a Default bracket; there is no
  production deployment, the demo seeds base prices directly (FR-044) and development price lists are
  dropped and reseeded (N13). **Accepted cost**: in a development database a hand-made product
  without a Default bracket has no price until a demo reset or a manually entered base price; "a
  price" in SC-006 therefore means a price the old price lists held. **Caveat**: if a production
  deployment appears before this release, this ruling is to be revisited.

### Session 2026-10-22

- Q: Removing the old model removes `priceListAdminPort`, through which the PIM connectors' price
  import wrote a product's prices. Is a replacement part of this release? → A: **yes — a narrow
  in-process write port on price books ships in P1, before the release** (owner ruling 2026-10-22,
  FR-049), so no release leaves the PIM price import without a target.
- Q: The demo seeds its base prices in PLN only; the old Default list copied each amount into every
  currency a channel offered, EUR included. Must the demo price EUR too? → A: **no, PLN only**
  (owner ruling 2026-10-22). A base price is per currency and is never converted (K1.3), and an EUR
  base book created by the demo would be a system book that a demo reset cannot tell from the
  operator's own.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Every product and variant has a base price in each currency (Priority: P1)

A merchandiser sets one base price per product and currency, optionally with quantity tiers, and a
variant either inherits its product's base price or states its own (a separate price, a percentage
or an amount above or below the product's). A buyer to whom no price book applies pays that base
price everywhere. The base prices that existed before the change are carried over; nothing else of
the old model is.

**Why this priority**: The base price is the floor of every other price and the reference of every
percentage (requirement 1 of D-287). Nothing else in this feature can be tested without it.

**Independent Test**: On a database holding old-model prices, run the conversion; then, with no
price book defined, price every product for a guest and compare with the old Default-list brackets.

**Acceptance Scenarios**:

1. **Given** a product with an old Default-list bracket per currency, **When** the conversion runs,
   **Then** the product has the same base price and tiers in each currency's base book.
2. **Given** a product with only the old product-level *default price* and no Default bracket, or a
   variant with an old variant price override, **When** the conversion runs, **Then** neither value
   becomes a price, and both fields are gone from the catalogue (Clarifications, Session 2026-10-21).
3. **Given** the conversion has run, **When** the old price lists, brackets, rules and matrix entries
   are looked for, **Then** none exist, and every non-system price list of the old model is gone.
4. Vectors **V1, V2, V7** (variant inherits; variant percentage; variant amount adjustment), **E1.2,
   E1.3** with no books (base only), **K1.3** and **Q4** of §10.8 (no base in the currency →
   unpriced).

---

### User Story 2 — Organization and customer-group prices resolve by the configured precedence (Priority: P1)

A sales manager gives an organization, a set of organizations or a set of customer groups their own
price book — fixed prices, percentage discounts or surcharges, amount adjustments — on products,
variants, categories, attribute values, category ∩ attribute values or the whole catalogue, with
quantity tiers. Every buyer is charged exactly what the owner's scenarios state.

**Why this priority**: Buyer-specific prices are the B2B core of the model, and E2–E3 are the
owner's acceptance scenarios.

**Independent Test**: With base prices only plus the books of `worked-examples.md` §10.3–§10.4,
price each listed buyer/product pair through the cart and compare with the vectors.

**Acceptance Scenarios**:

1. Vectors **E2.1–E2.5** (organization category and product percentages; percentage off the
   catalogue price).
2. Vectors **E3.1–E3.6** (organization product beats group product; organization category beats
   group product; inheritance from a parent organization).
3. The **N11 evidence table** of §10.10 under the default **HY** preset, and **F1–F5** under HY.
4. Vectors **A1.1–A1.4, A2.1–A2.3** (organization-set and customer-group-set books; one effective
   group per buyer, the customer's own group first).
5. Vectors **H1, H2** under HY (chain depth inside a cell).
6. Vectors **T1–T3** (priority only between books defining the same cell) and **Q1–Q3** of §10.8
   (quantity tiers, fall-through to the next row).
7. Vectors **U2.1, U4** (surcharge; a 100 % discount is a valid free line).
8. Vector **C1** under category-before-attribute.

---

### User Story 3 — Channel catalogue prices for everyone (Priority: P1)

A merchandiser prices a channel for everyone — a different price for some products, a category, an
attribute value or a category ∩ attribute value — in one currency, on a set of channels that all offer
that currency. Guests and every buyer see that catalogue price, and buyer percentages are taken off
it.

**Why this priority**: E1 is one of the owner's three scenarios, and the catalogue price is the
reference every buyer percentage uses.

**Independent Test**: With base prices and the books of §10.2 and §10.12, price the listed guests and
buyers on each channel.

**Acceptance Scenarios**:

1. Vectors **E1.1–E1.4** and **C∩0** (category ∩ attribute value prices red screws only).
2. Vectors **F2, F4** (an organization percentage is off the channel's catalogue price).
3. Vectors **C2** under category-before-attribute; **U1.1–U1.3** (surcharge for everyone on an
   attribute value); **U3.1, U3.2** (amount adjustment; a negative result skips the row).
4. Vectors **K1.1, K1.2** (a book on a channel set); **K2** (a channel not offering the currency is
   refused); **K3.1–K3.3** (a channel that stops offering the currency stops using the book, and
   resumes when it offers it again, without any change to the book).

---

### User Story 4 — Sales are charged only when they are lower (Priority: P2)

A marketer runs a sale for everyone or for an audience; a buyer is charged the sale price only when
it is lower than their own price, and sees their own price as the struck-through price.

**Why this priority**: Today a sale replaces a lower contract price; the fix protects contract
customers, but the model is usable without sales.

**Independent Test**: Add the sale book of §10.6 to the E3 setup and price the listed buyers on a
listing card and in the cart.

**Acceptance Scenarios**:

1. Vectors **S1.1–S1.3** (sale charged when lower, with the buyer's price as compare-at; equal is not
   a sale).
2. Vector **S2** (a sale higher than the contract price is not charged).
3. Vector **U2.2** (a sale under a surcharged buyer price).

---

### User Story 5 — Variant prices on the product page, in the cart and on listings (Priority: P2)

A buyer choosing a variant sees and pays that variant's price; a product whose variants cost
different amounts is listed "from" its lowest price.

**Why this priority**: Variant prices must be defined somewhere (#377); defining them in the books
now avoids a second model change. The storefront variant experience itself is #377.

**Independent Test**: With the variant fixture of §10.14, price each variant for a guest and for
Acme on the product page, in the cart and on a listing card.

**Acceptance Scenarios**:

1. Vectors **V3–V6** (a variant axis value matches an attribute row; percentages keep variant
   differences; a variant row beats a product row; a fixed product price applies to every variant).
2. Vector **V8** (listing card "from" the lowest variant price; sorted and filtered by it).
3. Vector **V9** (a cart line is charged its variant's price, and the product page shows the price
   that will be charged).

---

### User Story 6 — One price everywhere, including price-sorted and price-filtered listings (Priority: P2)

Whatever surface a buyer uses — listing, search results, product page, comparison, cart, checkout,
quote request, order intake, external catalogue, product feed — the same buyer, product, variant,
quantity, channel and currency get the same price, and sorting or filtering a listing by price
follows the prices the cards show, for every buyer.

**Why this priority**: A price that differs between the card, the sort and the cart is the defect
class that keeps bringing pricing back (`current-model.md` §1.4); the old price sort stops working
when the old tables go, so it has to be replaced here.

**Independent Test**: For every buyer of the §10 fixtures, compare each surface's price for each
product, and compare a price-sorted listing's order with the card prices.

**Acceptance Scenarios**:

1. **Given** any buyer and product of the §10 fixtures, **When** the product is priced by every
   surface listed above, **Then** every surface returns the same amount, currency and price source.
2. **Given** a buyer whose organization has its own book, **When** the catalogue is sorted by price
   ascending or descending, or filtered by a price range, **Then** the order and membership follow the
   quantity-1 prices the cards show, including variant products by their "from" price.
3. **Given** a price book is changed, **When** any surface next prices an affected product, **Then**
   it shows the new price, and the sorted listing agrees with it once the precomputed prices are
   refreshed (within the window stated in SC-005).
4. **Given** a cart line, **When** it is priced, **Then** the line records its price source, and the
   order line placed from it keeps it.

---

### User Story 7 — Administrators manage price books safely through the versioned API (Priority: P2)

An administrator creates, edits, activates, schedules, duplicates and deletes price books and their
rows; every change is audited; a sales representative only touches books of their own organizations.

**Why this priority**: Prices must be manageable and accountable; the editor UX is P2, but the rules
it will rely on are this feature's.

**Independent Test**: Exercise the versioned admin API as a platform administrator and as a sales
representative over the books of §10.11, and read the audit log.

**Acceptance Scenarios**:

1. Vectors **A3.1–A3.3** (representative: edit when every member is in scope, hidden when any is not,
   read-only on everyone and group books) and **A4** (mixed audience kinds refused).
2. **Given** a book, **When** it is duplicated with a new name, channel set, currency, audience set
   and an amount multiplier, **Then** the copy is a draft whose fixed amounts and amount adjustments
   are multiplied and rounded half-up, whose percentages are unchanged, and whose channel set is
   validated against the new currency.
3. **Given** any write to a book, its rows, its channel set or its audience set, **When** it
   completes, **Then** one audit entry names the actor, the book and the state before and after.
4. **Given** the resolved-price check for a buyer and product, **When** it answers, **Then** it names
   the tier, the cell, the book, the row, the reference price used and the precedence version.

---

### User Story 8 — The demo shows the owner's scenarios (Priority: P3)

A prospect or developer opening the demo instance finds price books that reproduce E1–E3 for the
demo organization *Acme B2B (demo)*, the customer group *VIP*, the category *Screws* and the
attribute value *color = red*. The three scenarios are alternatives, not one combined setup: E3's
books are active after a reset, E1's and E2's are drafts, and activating one scenario's books (and
deactivating the others') shows that scenario's literal numbers.

**Why this priority**: The owner ruled it (N12); it is the most direct demonstration of the model
but adds no capability.

**Independent Test**: Reset the demo and price the E1–E3 vectors' buyers and products on the demo
storefront.

**Acceptance Scenarios**:

1. **Given** a freshly reset demo, **When** the E3 vectors are priced against the demo's data,
   **Then** each returns the vector's expected amount.
2. **Given** a freshly reset demo, **When** only E1's books are made active, and separately only
   E2's, **Then** that scenario's vectors return their expected amounts.
3. **Given** a development database with old-model price lists, **When** the feature is installed,
   **Then** those lists are gone and the demo seed's books are present after a demo reset (N13).

### Edge Cases

- A product has a base price in one currency only and is viewed in another → unpriced in the other
  currency, never converted (K1.3).
- A percentage or amount row whose reference is missing → the row is skipped and the next candidate
  is tried (Q4 of §10.8).
- An amount adjustment produces a negative price → the row is skipped and shown as not applicable;
  a result of exactly 0 is a valid price (U3.2, U4).
- Two rows of one book have the same selection and overlapping quantity windows → refused.
- An attribute row names an attribute that loses its *Price list rules* flag, becomes per-language or
  per-channel, or has a non-choice value type → the row stops pricing, never errors, and resumes when
  eligible again.
- A variant, product, category or audience member a row or membership names is deleted permanently →
  the row or membership goes with it; a recoverable deletion keeps it, marked.
- An organization-set book whose last member is removed, or a book whose channels have all stopped
  offering its currency → shown as applying to no one / nowhere, and cannot be activated.
- A buyer belongs to an organization chain where several members have books → resolved by cell, then
  nearest organization within the cell (H1, H2).
- A sale book and a regular book price the same line at the same amount → the regular price is
  charged and nothing is struck through (S1.2).
- A product import carrying the old *default price* attribute → refused with a message that prices
  are set in price books.
- A request asks for a currency the channel does not offer → unpriced, never priced from a book of
  that currency (K3.2).
- A precedence change is requested → refused in this feature with a message that changes are not yet
  available (the change flow is P3, §8.2).

## Requirements *(mandatory)*

### Functional Requirements

**Price books and rows** (§5.1)

- **FR-001**: A price book MUST have a name, a type (regular or sale), exactly one currency, a
  lifecycle status with optional start and end, a priority, an audience set and — unless it is a base
  book — a non-empty set of sales channels.
- **FR-002**: The audience set MUST be either *everyone*, one or more customer groups, or one or more
  organizations; members of two kinds in one book MUST be refused (A4).
- **FR-003**: Every channel in a book's channel set MUST offer the book's currency at create, edit and
  activation; otherwise the write MUST be refused naming the channels (K2).
- **FR-004**: A book's currency MUST NOT change after creation; its audience kind MUST NOT change
  after activation.
- **FR-005**: A row MUST price exactly one selection — a variant, a product, one category with one
  attribute value, a category, an attribute value, or all products — for a quantity window, as a
  fixed amount, a signed percentage between −100 % and +1000 %, or a signed amount adjustment.
- **FR-006**: A fixed amount for *all products* MUST be refused; rows of one book with the same
  selection MUST NOT have overlapping quantity windows.
- **FR-007**: An attribute selection MUST be allowed only for attributes with the *Price list rules*
  flag whose values are a single choice, multiple choices or yes/no and that are neither per-language
  nor per-channel (§5.9); a row on an attribute that stops qualifying MUST stop pricing without error
  and resume when it qualifies again.
- **FR-008**: A row whose computed price is below zero MUST be treated as not pricing the line; zero
  MUST be a valid price.
- **FR-009**: Each currency MUST have exactly one base book, applying on every channel to everyone;
  it MUST hold only product and variant rows; a variant row in a base book MUST be a fixed amount, a
  percentage or an amount adjustment of its product's base price at the same quantity.

**Resolution** (§5.2–§5.4)

- **FR-010**: A price MUST be resolved for a product, an optional variant, a quantity, a channel, a
  currency and a buyer (organization chain and one effective customer group: the customer's own
  group, else the organization's) — the same inputs on every surface.
- **FR-011**: A book MUST apply only while active within its dates (evaluated at the time of the
  request), for its currency, on a channel of its set that currently offers that currency.
- **FR-012**: The base price MUST be the variant's base row if any, else the product's base row, at
  the tier covering the quantity.
- **FR-013**: The catalogue price MUST be the best matching row of the regular *everyone* books,
  ranked by selection (variant, product, category ∩ attribute, then category and attribute in the
  configured order, then all products), percentages and adjustments off the base price; else the base
  price.
- **FR-014**: The buyer price MUST be the best matching row of the regular organization-set and
  customer-group-set books applying to the buyer, ranked by the active precedence's cell order, then
  by organization nearness within a cell (nearness first under AF-N), then by book priority, then by
  higher starting quantity, then by lower amount, then by a fixed identifier order; percentages and
  adjustments MUST be taken off the catalogue price; else the catalogue price.
- **FR-015**: The sale price MUST be the best matching row of the sale books applying to the buyer
  (buyer cells in precedence order, then *everyone* rows by selection), percentages and adjustments
  off the catalogue price; it MUST be charged only when strictly lower than the buyer price, with the
  buyer price as the compare-at price (S1.1–S2).
- **FR-016**: Attribute rows MUST match a product's own values overlaid by the chosen variant's axis
  values; category rows MUST match the product's own category assignments.
- **FR-017**: A fixed product row MUST price every variant of the product unless a variant row of an
  equal or better cell applies (V6, N1).
- **FR-018**: A line no tier prices MUST be unpriced and follow today's quote-only path; there MUST be
  no other fallback price (the old product *default price* and variant price override are not prices).
- **FR-019**: Percentages MUST be rounded half-up to four decimals; the cart's two-decimal rounding is
  unchanged.
- **FR-020**: Every resolution MUST return its explanation: price source, cell, book, row, reference
  price and precedence version.

**Precedence configuration** (§5.6)

- **FR-021**: The platform MUST hold a versioned precedence configuration of the twelve buyer cells,
  the category-before-attribute toggle and the depth mode, with exactly one active version; this
  feature MUST install version 1 = the **HY** preset with category before attribute and depth within
  the cell.
- **FR-022**: Resolution MUST read the cell order from the active version only; under each of the
  presets AF, SF, HY and AF-N the resolver MUST reproduce the §10.10 tables (N11 evidence, F1–F5,
  C1–C2, H1–H2).
- **FR-023**: A request to change the precedence MUST be refused in this feature (the staged change
  flow with impact preview is P3).

**Variants and listings** (§5.8, §6, §7)

- **FR-024**: A listing card for a product whose variants resolve to different prices for the viewer
  MUST show the lowest as a "from" price and expose that the price varies; otherwise the single price.
- **FR-025**: A listing card MUST carry the compare-at price when a sale is charged.
- **FR-026**: Price sort (ascending and descending) and price-range filters MUST order and select
  products by the quantity-1 price the card shows to that viewer, the "from" price for variant
  products, and MUST NOT place a priced product among unpriced ones.
- **FR-027**: Price sort and filter MUST be served from prices precomputed per group of buyers that
  share the same applicable books, refreshed in the background after any change to books, rows,
  memberships, channel sets, base prices, product categories, eligible attribute values, variants or
  the attribute flag; the cart, checkout, product page, quote requests and order intake MUST always
  resolve live.

**Consumers** (§5.7, §7, §8.2)

- **FR-028**: Catalogue listings, search results, search suggestions, the product page, comparisons,
  product links, cart (add, merge, quantity change, read, placement check), quote-request reference
  prices, admin order preview, external order intake, the external catalogue API and product feeds
  MUST price through the one resolution of FR-010–FR-020; no consumer may keep a fallback of its own.
- **FR-029**: Product feeds pinned to a named book MUST read that book's rows for its channel and
  currency over the catalogue price; products the book does not price MUST be absent from the feed,
  as today.
- **FR-030**: Cart lines and order lines MUST record the price source of their unit price.
- **FR-031**: The product page MUST show, and the cart MUST charge, the price of the selected variant;
  no surface may show the old variant price override.
- **FR-032**: The organization screen's effective price lists MUST list the books that apply to the
  organization through its own or an ancestor's membership or its customer group.

**Administration and audit** (§5.5, §5.7)

- **FR-033**: Price books, their rows, channel sets and audience sets MUST be readable with the price
  list read permission and writable with the price list write permission; no new permission is needed
  in this feature.
- **FR-034**: A sales representative MUST be able to write only organization-set books whose every
  member is in their scope; MUST see everyone and customer-group books read-only; and MUST receive,
  for an organization-set book with any member outside their scope, exactly the answer for a missing
  book (A3.1–A3.3).
- **FR-035**: Every create, change, activation, deactivation, duplication and deletion of a book, a
  row, a channel-set entry or an audience member MUST be audited through the platform's uniform write
  auditing with actor and before/after state.
- **FR-036**: Duplicating a book MUST let the administrator set name, channel set, currency, audience
  set and an amount multiplier; the copy MUST be a draft; fixed amounts and amount adjustments MUST be
  multiplied and rounded half-up; percentages MUST be copied unchanged.
- **FR-037**: The admin price-book API MUST be published as a new versioned resource replacing the
  old price-list engine endpoints, which MUST be removed in the same release; the published contract
  and price-list packages MUST carry a breaking-change release note giving the old call and the new
  one (§8.1, Principle II).
- **FR-038**: The resolved-price check MUST answer with the explanation of FR-020 for a buyer,
  product, optional variant, quantity, channel and currency, within the representative's scope rules.
- **FR-039**: Deleting a currency MUST remain refused while a book, including a base book, uses it.
- **FR-040**: All new user-facing text MUST exist in English and Polish.

**Conversion and removal** (§8.1)

- **FR-041**: Installing the feature MUST convert, once, the price-list module's own data only:
  Default-list brackets into base-book rows of their currencies. The product *default price* and the
  variant price override MUST NOT be converted (Clarifications, Session 2026-10-21).
- **FR-042**: Installing the feature MUST remove every non-system price list of the old model with its
  roster, brackets, rule and matrix entries (N13), and the old model's storage: the Application rule,
  the per-product roster and bracket tables, the legacy feature-014 tables, the matrix entries'
  organization and currency coordinates; and the catalogue module MUST remove, in the same release,
  the product *default price* (the `defaultPrice`/`price` keys and the editor field) and the variant
  price override.
- **FR-043**: Product and variant create, update and import MUST refuse the old *default price* key and
  the variant price override with a message that prices are set in price books.
- **FR-044**: The demo seed MUST create base prices directly in the base books and price books that
  reproduce vectors E1–E3 against the demo's own organization, customer group, category, attribute
  and products (N12); a demo reset MUST restore them. The scenarios are alternatives: E3's books MUST
  be active after a reset and E1's and E2's MUST be drafts, so that activating one scenario's books
  alone reproduces that scenario's vectors (Clarifications, Session 2026-10-21).

**Behaviour that D-287 replaces** (`current-model.md` §1.4)

- **FR-045**: Renaming a book or editing its rows MUST NOT change which book wins a tie; only priority
  and the fixed order of FR-014 decide (T1–T3).
- **FR-046**: A sale MUST NOT be charged when it is higher than or equal to the buyer price (S2).
- **FR-047**: Activation and expiry by date MUST take effect at the scheduled instant for every
  request, not at the next sweep.

**Documentation** (product owner, 2026-10-21)

- **FR-048**: When P1 and P2 are complete, the Docusaurus documentation MUST be rebuilt to describe the
  new price determination, in English and Polish (`docs/docs/contributing/documentation-i18n.md`).
  For **platform users** (administrators, sales representatives, buyers): what a base price, a
  catalogue, buyer and sale price book are; how the winning price is chosen (the tiers, the configured
  precedence and its default HY preset, priority, quantity tiers, percentages taken off the catalogue
  price, a sale charged only when lower); channels, currency and audience on the book header;
  duplication; the resolved-price check; and worked examples E1–E3. For **Endora Commerce
  developers**: the data model, the resolution algorithm and its rank table, the batched pricing
  service as the only sanctioned read path, caching and cross-replica invalidation, the versioned
  admin API, how a consumer module reads a price and how the conversion from the old model ran. Pages
  describing the removed Application rule, per-product roster and brackets, the product *default
  price* and the variant price override MUST be rewritten or removed, not left beside the new text.
  At minimum this covers the module-owned page `packages/modules/price_lists/docs/price_lists.md`,
  the generated module reference, and every docs page that describes how a price is obtained
  (catalog, carts, orders, quote requests, search, product feeds, organizations).

**Cross-module price writes** (owner ruling 2026-10-22, Clarifications Session 2026-10-22)

- **FR-049**: The price-list module MUST publish an in-process port through which another module
  (the PIM connectors' price import) reads a product's base prices per currency, replaces a
  product's base tiers in the currencies it names — product tiers alone, leaving the variants' base
  rows as they are, or product and variant rows together exactly as the admin base-price write does —
  and lists the price books that price the product directly, for its field-protection compare. Every
  write MUST go through the same write path as the admin API (one audited command, the book's
  version moved, the pricing caches invalidated after the commit, the price surface marked stale)
  and MUST be refused for the same reasons with the same codes. With the price-list module absent
  the port MUST fail closed. It replaces `priceListAdminPort`, which this release removes.

### Key Entities *(include if feature involves data)*

- **Price book** — header of FR-001; owned by the price-list module; has channel-set entries,
  audience members and rows.
- **Channel-set entry** — (book, sales channel); dormant while the channel does not offer the book's
  currency.
- **Audience member** — (book, customer group or organization), all of one kind per book.
- **Row** — (book, selection, quantity window, price kind, value); the selection names at most one of
  variant, product, category, attribute value (category ∩ attribute value is the one allowed pair).
- **Base book** — the system price book of one currency.
- **Precedence configuration** — versioned order of the twelve buyer cells, toggle, depth mode; one
  active version.
- **Precomputed buyer price** — per group of buyers sharing the same applicable books, per product, at
  quantity 1: lowest and highest variant price, compare-at, price source.
- **Line price source** — on cart and order lines: base, catalogue, buyer or sale.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every vector of `worked-examples.md` §10 that belongs to this feature — E1–E3, F1–F5
  under HY, S, T, the quantity vectors of §10.8, C∩0, C1–C2, H1–H2, A1–A4, K1–K3, U1–U4, V1–V9, and
  the four-preset tables of §10.10 — returns its expected price: 0 mismatches.
- **SC-002**: For every buyer and product of those fixtures, every pricing surface of FR-028 returns
  the same amount, currency and price source: 0 disagreements.
- **SC-003**: For every buyer of those fixtures, a price-sorted listing lists products in exactly the
  order of their card prices, and a price-range filter returns exactly the products whose card price is
  in range: 0 disagreements.
- **SC-004**: Catalogue pages and product pages are priced no slower than before the change for
  guests and for buyers with their own books — measured against the baselines recorded in
  `read-paths-and-performance.md` §7 — and a 50-product listing page costs a bounded number of
  database round trips independent of the number of price books.
- **SC-005**: A price-sorted first page returns within the existing price-sort budget (150 ms p95) on
  a 50 000-product catalogue with 1 000 organizations of which half have their own books, and a price
  change is reflected in sorted listings within 60 seconds.
- **SC-006**: After installation, nothing of the old model listed in FR-042 remains, and no product or
  variant that had a price before has none afterwards in the currency it had it in.
- **SC-007**: A freshly reset demo reproduces E3, and with only E1's or only E2's books active
  reproduces that scenario: 0 mismatches across the three.
- **SC-008**: A sales representative cannot learn, from any status code or message, that an
  organization-set book with an out-of-scope member exists.
- **SC-009**: Every new user-facing string exists in English and Polish (0 missing keys).
- **SC-010**: After P1 and P2, `check:docs-translations` passes and no docs page, in either locale,
  still describes the Application rule, the product *default price* or the variant price override as
  current behaviour (a search for them returns only migration or history notes).

## Assumptions

- The base book of the platform's default currency (the default currency of the system-default sales
  channel) exists after installation even when no Default-list bracket was in that currency.
- Product feeds keep their current contract: a feed pinned to a book lists only what that book prices.
- Quote requests keep their stored price at request and accepted agreements keep their agreed price;
  open carts are re-priced on read and placement refuses a changed line as today.
- The `isPriceRule` flag, the attribute value types and the category assignments are read through the
  catalogue module as today; this feature adds no catalogue attribute.
- The buyer's organization chain is the one the organizations module already resolves.
- The storefront variant-selection experience and per-variant galleries are issue #377; this feature
  provides the variant prices it consumes.
- Display of a list price beside the buyer price (setting, default off), the precedence change flow,
  the new price-book editor and the promotions exclusion are later phases (P2, P3, P4).

## Dependencies

- **P0 — pricing read-path hardening** (in progress on branch `fix/pricing-read-path-hardening`):
  this feature relies on its cross-replica pricing-change signal sent after commit, its scheduled
  activation invalidation and its batched consumer paths, and should be planned on top of P0 once P0
  is merged rather than re-implementing any of them. Where P0 fixes a consumer this feature re-points
  (FR-028), this feature keeps P0's batching.
- `specs/pricing/` (merged in PR #393, 2026-10-21): this specification cites it as normative.
- Organizations (chain), customer accounts (groups), catalogue (products, variants, categories,
  attributes), sales channels (currencies) and currencies (references) as existing read sources;
  carts and orders own their new line field; product feeds, search, comparisons, quote requests and
  the storefront as consumers.

## Out of Scope

- The price-book editor UX, the product editor's base-price panel UX and the "list price / your price"
  display setting (P2, issue #378), released together with this feature (Clarifications, Session 2026-10-21).
- Changing the precedence through the admin, with impact preview and versioned rebuild (P3).
- A search-engine field for everyone's price (P3, optional).
- Promotions excluding sale- or contract-priced lines (P4); this feature only records the price
  source.
- Intersections beyond one category and one attribute value (N10).
