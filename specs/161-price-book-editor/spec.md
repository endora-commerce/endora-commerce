# Feature Specification: Price-book editor (P2 of D-287)

**Feature Branch**: `feat/161-price-book-editor` (spec directory `specs/161-price-book-editor/`),
branched from the release branch `feat/160-pricing-model-v2`
**Created**: 2026-10-21
**Status**: Draft — three open questions for the owner (*Clarifications → Open*), each with a
recommended default; nine gaps in P1's admin API to feed back to feature 160 (*Dependencies*).
**Input**: Issue #378, *"Price lists: replace 'Products & brackets' with a rebuilt multi-currency
Price matrix"*, re-scoped by D-287 §8.2 to **P2 — the price-book editor**: the admin screens on top of
the price-book model and the versioned admin API of feature 160 (`specs/160-pricing-model-v2/`). P1
and P2 are released together (spec 160, Clarifications, Q-A): this feature is the gate of that
release.

## Background

Feature 160 replaces the Application rule, the per-product brackets and the matrix tab with **price
books** and removes the old admin screens; it leaves the complete admin API
(`specs/160-pricing-model-v2/contracts/admin-price-books-api.md`), the shared schemas, the error
messages and the palette actions ready for this feature (`specs/160-pricing-model-v2/plan.md`, *What
P1 leaves ready for P2*). The pricing semantics this editor exposes are D-287
(`specs/pricing/decision-record.md`) and are not restated; the vectors of
`specs/pricing/worked-examples.md` §10 are the scenarios an administrator must be able to configure.

Issue #378 asked for "products as rows, currencies as columns". Under D-287 a price book has **one
currency** (requirement 3, Q5), so the columns become **quantity tiers**; the issue's other asks — one
place to define prices, fast keyboard entry, bulk add through the product picker of
`specs/145-admin-product-picker/` — stand.

## Vocabulary

As spec 160 (*price book*, *base book*, *row*, *selection*, *catalogue price*, *buyer price*,
*cell*, *price source*), plus:

- **Grid** — the editor of one price book's rows: one line per selection, one column per quantity
  tier start ("from 1", "from 10", "from 100"), a price in each cell.
- **Price kind** — how a cell states a price: a fixed amount, a signed amount adjustment (±) or a
  signed percentage (±) of the reference price (base for catalogue books, catalogue price otherwise).
- **Unsaved changes** — cell edits held in the browser until the administrator saves them as one
  batch.

## Clarifications

### Settled by earlier rulings (not re-asked)

D-287 and the owner's rulings Q1–Q11 and N1–N13 (`specs/pricing/decision-record.md`, *Owner
rulings*), in particular: the header carries the channel set (each channel offering the currency),
one currency and an audience set of one kind (Q1, Q5); signed percentages and amounts, surcharges
allowed up to +1000 % (Q6, N2, N9); sales representatives edit only books whose every organization is
theirs, other books read-only, a book with an out-of-scope organization hidden (Q9, N3); the "list
price / your price" display is a setting on `/price-lists/display-modes`, **default "your price"
only** (Q8a, N4: the list price only when above "your price"); the promotions exclusion is owned by
`promotions` and is P4, not this feature (Q8b, N5); the precedence is configurable but only through
P3 — this feature **displays** it (Q11, FR-023 of 160); P1 and P2 ship together (Q-A).

### Open (questions for the owner)

- **Q-1 Grid columns.** [NEEDS CLARIFICATION: How are quantity tiers laid out in the grid?
  **(A)** one column per tier start used anywhere in the book ("from 1", "from 10", "from 100"); a
  line that has no price at a start shows an empty cell, a line with a tier window not on the shared
  starts opens in a cell detail; **(B)** one column only (the quantity-1 price), every other tier in a
  per-cell expansion, as Medusa's bulk editor does; **(C)** a column per tier start, but limited to the
  book's first five starts, the rest in the expansion. *Recommended: (A)* — tiers are what B2B price
  books are about, and a table that shows them side by side is the issue's "easier entry"; the
  expansion still covers windows that do not fit.]
- **Q-2 Import and export.** [NEEDS CLARIFICATION: Is moving a price book in and out of a
  spreadsheet part of this release? **(A)** paste from a spreadsheet into the grid and copy out of it
  (keyboard), plus a CSV **export** of a book; CSV **import** later; **(B)** paste and copy only;
  **(C)** paste, copy, CSV export and CSV import (upload with a preview of every change before
  saving). *Recommended: (A)* — export answers "send Acme its prices" now; a file import needs its own
  preview and error report and is better as a follow-up.]
- **Q-4 Price books on the product editor.** [NEEDS CLARIFICATION: Besides the base-price panel,
  should the product editor list the price books that price this product directly (book, audience,
  price, link to the grid), as the removed *Linked price lists* panel did? **(A)** yes, read-only, with
  a "Why this price?" link to the explanation screen; **(B)** no, the explanation screen answers it.
  *Recommended: (A)* — it replaces a panel administrators had, and it needs one small additive filter
  in P1's API (gap G1).]

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Find, create and configure a price book (Priority: P1) 🎯 MVP

A pricing administrator opens *Price books* from the navigation or ⌘K, finds a book by name, type,
status, currency, channel, audience or member, and creates a new one in a short sequence: type
(regular or sale) → currency → channels (only channels offering that currency are offered) → audience
(everyone, customer groups or organizations, with their pickers) → schedule and priority. The book
starts as a draft; activation explains what is missing when it cannot apply anywhere or to anyone.

**Why this priority**: Nothing can be priced without a book; this is also the screen every other
story starts from.

**Independent Test**: With the API of 160 and an empty database plus demo channels, groups and
organizations, create one book of each audience kind, activate them, and see them filtered in the
list.

**Acceptance Scenarios**:

1. **Given** the list, **When** the administrator filters by currency PLN and audience *organizations*
   containing *Acme B2B (demo)*, **Then** only the matching books are shown, with type, status, currency,
   channels, audience summary, priority, row count and a flag when the book applies to no one or nowhere.
2. **Given** the create flow, **When** the administrator picks currency EUR, **Then** the channel step
   offers only channels that offer EUR and says why others are missing.
3. **Given** a draft with no audience member, **When** activation is attempted, **Then** activation is
   refused with the reason and a link to the audience step (no generic error).
4. **Given** an active book, **When** the administrator edits its header, **Then** currency is shown but
   not editable, the audience kind is not editable, and a channel that no longer offers the currency is
   shown as *inactive — the channel no longer offers PLN*.
5. **Given** a book, **When** it is deleted, **Then** a confirmation names the book and its row count;
   the base books show no delete action.
6. **Given** the list, **When** the system base books are shown, **Then** each is marked *Base prices —
   PLN* (one per currency), opens in the same grid restricted to product and variant lines, and cannot be
   renamed, scheduled or deleted.

---

### User Story 2 — Enter prices fast in the grid (Priority: P1)

A pricing administrator opens a book and enters prices in a grid: one line per product, variant,
category, attribute value, category ∩ attribute value or "all products", one column per quantity
tier, a price per cell. They add many products at once through the product picker, add a category or
attribute-value line through their pickers, type or paste prices, move with the keyboard, fill down,
undo, and save everything as one batch.

**Why this priority**: The grid is issue #378's core ask and the only way to enter buyer, catalogue
and sale prices after P1 removes the old screens.

**Independent Test**: Configure the books of `worked-examples.md` E1, E2 and E3 entirely in the grid,
save, and confirm through the explanation screen (US5) that each vector's buyer pays the expected
price.

**Acceptance Scenarios**:

1. **Given** an empty book, **When** the administrator adds 40 products through the product picker,
   **Then** 40 lines appear at once, with name, SKU and an empty "from 1" cell each, nothing saved yet,
   and the unsaved-changes indicator counts 40.
2. **Given** a line, **When** the administrator types `95`, `-5%`, `+20%`, `-3` or `+3` in a cell,
   **Then** the cell shows a fixed price, a −5 % or +20 % adjustment, or a −3 / +3 amount adjustment, with
   the price kind visible as text and an icon, not colour alone; on catalogue books percentages read
   "of base", on others "of catalogue price".
3. **Given** a selection of cells, **When** the administrator pastes a block copied from a spreadsheet
   (tab- or semicolon-separated, decimal comma or point, spaces, currency symbols), **Then** the values
   fill the cells from the focused one, normalised, and any value that cannot be read is marked in its
   cell with the reason.
4. **Given** focus in the grid, **When** the administrator uses arrow keys, Tab/Shift+Tab, Enter
   (edit/commit), Escape (cancel), Ctrl/⌘+C/V, Ctrl/⌘+Z and Ctrl/⌘+Shift+Z, fill down (Ctrl/⌘+D), and
   Delete (clear), **Then** each behaves as named, without a mouse.
5. **Given** unsaved changes, **When** the administrator saves, **Then** one batch is sent, the save
   button shows progress and stays disabled, the result is announced, and on success the indicator clears.
6. **Given** a save that overlaps an existing window or breaks a row rule, **When** the server refuses it,
   **Then** every failing cell is marked with its reason (not only the first), nothing is lost, and the
   rest of the edits stay unsaved for correction.
7. **Given** a product line of a variant product, **When** the administrator expands it, **Then** its
   variants appear as sub-lines whose cells may be left empty (the product's line applies to them) or
   filled (a variant price).
8. **Given** a cell, **When** the administrator opens its detail, **Then** they can set a tier window that
   does not fit the shared columns (e.g. 25–49), see what the cell inherits when empty, and remove it.
9. **Given** a line of an attribute that lost its *Price list rules* flag, or a deleted product, **Then**
   the line shows *Inactive* with the reason and still opens.
10. **Given** two administrators edit the same book, **When** the second saves after the first,
    **Then** the second is told the book changed since it was opened, and may reload while keeping a
    copy of their unsaved cells to re-apply (no silent overwrite).
11. **Given** a selection of lines, **When** the administrator applies a bulk action — *set percentage*,
    *set amount adjustment*, *multiply fixed prices by*, *clear* — **Then** every selected cell changes
    as unsaved edits, undoable as one step.
12. **Given** a book with more lines than one page, **When** the administrator searches by name, SKU,
    category or attribute value or filters by selection kind, **Then** the matching lines are shown,
    and unsaved edits on other pages are kept.

---

### User Story 3 — Base prices on the product (Priority: P1)

A catalogue administrator editing a product sets its base price per currency, with optional quantity
tiers, and for each variant either leaves it inheriting the product's price or sets a separate price,
a percentage or an amount above or below it.

**Why this priority**: P1 removes the product editor's *Default unit price*; every product needs a
base price (D-287 requirement 1), and the product editor is where catalogue staff expect it.

**Independent Test**: For the fixture of `worked-examples.md` §10.14, set P5's base and P5r's +10 %
in the panel and confirm V1 and V2 through the explanation screen.

**Acceptance Scenarios**:

1. **Given** a product with no base price, **When** the panel opens, **Then** it shows one empty line
   per currency offered by any channel, and says the product is not orderable until a base price is set.
2. **Given** the panel, **When** the administrator sets 100.00 PLN from 1 and 90.00 PLN from 10 and saves
   with the product, **Then** both tiers are stored in the PLN base book.
3. **Given** a variant product, **When** the administrator sets variant P5r to "+10 %", **Then** the panel
   shows the resulting 88.00 beside it, and P5b shows "inherits 80.00".
4. **Given** the product editor is saved, **When** the base-price panel has an invalid value, **Then**
   the error is shown on the field and the product save does not report success for the prices.
5. (Q-4 = A) **Given** the product is priced by other books, **Then** a read-only list shows each book,
   its audience and the price it sets, linking to the grid and to "Why this price?".

---

### User Story 4 — Duplicate a price book (Priority: P2)

A sales manager builds Beta's terms from Acme's by duplicating Acme's book: new name, the same or
other channels, another currency with an exchange multiplier for fixed amounts, and Beta instead of
Acme as the audience.

**Why this priority**: Requirement 6 of D-287; it saves re-entering hundreds of rows, but books can be
built without it.

**Independent Test**: Duplicate the E3 Acme book to Beta in EUR with multiplier 0.23, open the copy,
and check fixed prices are converted and percentages kept.

**Acceptance Scenarios**:

1. **Given** a book, **When** *Duplicate* is chosen, **Then** a dialog pre-fills name "… (copy)", the
   same channels, currency and audience, and multiplier 1.
2. **Given** another currency is picked, **When** the dialog validates, **Then** channels not offering
   it are flagged before submit, and the multiplier field explains that percentages are copied unchanged.
3. **Given** the copy is created, **Then** it opens as a draft and the source is untouched.

---

### User Story 5 — Explain a price (Priority: P2)

An administrator or sales representative asks "what does this buyer pay for this product, and why?":
they pick a channel, currency, buyer (organization or customer, or a guest), products or variants and
quantities, and see for each line the price, its source (base, catalogue, buyer, sale), the book and
row that set it, the reference a percentage was taken from, the precedence version, and the ranked
runner-ups that lost.

**Why this priority**: Explainability is the reason the model was rebuilt; support staff need it, but
prices can be entered without it.

**Independent Test**: For E3, explain Acme × Screws 0200 and see 95.00, *buyer*, *organization ×
product*, the Acme book, and the runner-ups (Acme × Screws category 85.00, VIP × product 90.00).

**Acceptance Scenarios**:

1. **Given** the explanation screen, **When** a buyer and a product are chosen, **Then** the answer shows
   the price, source, cell in words ("organization × product"), book (linked), row (linked to its cell),
   reference and precedence version.
2. **Given** a sale was charged, **Then** the explanation shows the sale and the regular price it beat.
3. **Given** the line is unpriced, **Then** the explanation says which tiers had nothing and suggests
   setting a base price.
4. **Given** the screen is reached from a product, an organization or a book, **Then** the
   corresponding field is pre-filled.
5. **Given** a sales representative, **When** they pick a buyer, **Then** only organizations in their
   scope are offered.

---

### User Story 6 — See the precedence in force (Priority: P2)

An administrator sees which precedence preset is active and the order of the twelve buyer cells in
plain words, read-only, with a note that changing it arrives in a later release.

**Why this priority**: Required to understand an explanation; changing it is P3.

**Independent Test**: Open *Pricing settings* and read "Contract first, blanket last (HY)" with its
twelve cells in order.

**Acceptance Scenarios**:

1. **Given** the pricing settings page, **Then** the precedence section names the active preset, lists
   the cells in order with examples ("Organization × product — Acme's price for Screws 0200"), shows the
   category/attribute order, and offers no control that changes them.

---

### User Story 7 — Show "list price / your price" to buyers (Priority: P3)

A shop administrator turns on the display of the catalogue price beside the buyer's price; buyers
whose price is lower than the catalogue price see both, everyone else sees one price.

**Why this priority**: Ruled by the owner (Q8a) with default off; it does not affect prices.

**Independent Test**: With the setting on, Acme sees "List price 100.00 · Your price 95.00" for Screws
0200 (E3); a guest sees 100.00; with a surcharge, Acme sees only their price (vectors D1–D4).

**Acceptance Scenarios**:

1. **Given** `/price-lists/display-modes` (shown as *Pricing settings*), **When** the administrator turns
   on *Show list price beside the buyer's price*, **Then** the change is saved and audited, and the
   product page and listing cards show the pair from the next request; the basket and checkout show
   only the price charged.
2. Vectors **D1–D4** of `worked-examples.md` §10.15.

---

### User Story 8 — Sales representatives edit only their organizations' books (Priority: P2)

A sales representative sees and edits only books whose every audience organization is theirs; sees
everyone and customer-group books read-only; never sees a book that names an organization outside
their scope.

**Why this priority**: Ruled (Q9, N3); a security property of every screen above.

**Independent Test**: As a representative scoped to Acme, the A3 vectors of `worked-examples.md`
§10.11 hold on every screen.

**Acceptance Scenarios**:

1. Vectors **A3.1–A3.3**: an organization book of Acme is editable; a book of Acme and Beta is absent
   from the list, its address shows the same page as an unknown book; a VIP group book opens read-only
   with every edit control absent (not disabled-and-unexplained).
2. **Given** a representative creating a book, **Then** the audience step offers only *organizations*
   and only their own organizations.

### Edge Cases

- A book at the 5 000-row limit: adding lines is refused before saving, with the limit stated.
- A pasted block larger than the visible lines: extra rows are ignored with a notice; extra columns
  beyond the tier columns create no columns.
- A value with three or more decimals for a fixed price, a percentage outside −100…+1000, a percentage
  on an *all products* fixed cell, or text: marked in the cell with the reason; never sent.
- Leaving the page with unsaved changes: a confirmation; the browser's back button included.
- The session expires during editing: the save fails with a sign-in prompt, and the unsaved cells
  survive the sign-in in the same tab.
- A product picker selection that includes products already in the book: they are not duplicated;
  the picker shows them as already present.
- A channel deleted while a book is open: the header shows it gone after reload; nothing breaks.
- An empty book list, a book with no lines, a product with no currency offered anywhere: each has an
  explanatory empty state with one action.
- The module switched off: navigation, palette, product-editor panel and settings section disappear;
  a stale address answers as for a module that is not installed.
- Slow network: every save, load and pick shows progress within 400 ms and cannot be double-submitted.

## Requirements *(mandatory)*

### Functional Requirements

**Book list and header** (US1)

- **FR-001**: The admin MUST list price books with filters by type, status, currency, channel,
  audience kind, audience member and name, paging, and the columns of US1 scenario 1; base books MUST
  appear once per currency, marked as base prices.
- **FR-002**: Creating a book MUST follow the order type → currency → channels → audience → schedule
  and priority, offering only channels that offer the chosen currency and pickers matching the audience
  kind (customer groups, organizations), and MUST create a draft.
- **FR-003**: The header editor MUST show currency and (once activated) audience kind as read-only;
  MUST show each dormant channel binding with its reason; MUST let the administrator edit name,
  channels, members, schedule and priority.
- **FR-004**: Activation and deactivation MUST be available from the header; a refused activation MUST
  name what is missing and link to the step that fixes it.
- **FR-005**: Deleting a book MUST require a confirmation naming the book and its row count; base books
  MUST offer no delete, rename or schedule action.

**Grid** (US2)

- **FR-006**: The grid MUST show one line per row selection of the book (variant, product, category ∩
  attribute value, category, attribute value, all products), labelled by name and identifier, and one
  column per quantity tier start of the book (per Q-1), with each cell's price and kind.
- **FR-007**: Cells MUST accept a fixed amount, a signed percentage or a signed amount adjustment
  typed as in US2 scenario 2, normalised liberally (decimal comma or point, spaces, currency symbol,
  `%` with or without a space) and shown with the kind as text and icon; percentages MUST state their
  reference (base or catalogue price).
- **FR-008**: Adding lines MUST be possible in bulk through the product picker of feature 145 and
  through category, attribute-value and category ∩ attribute-value pickers that offer only eligible
  *Price list rules* attributes; products already present MUST not be added twice.
- **FR-009**: A variant product's line MUST expand to its variants; an empty variant cell MUST state
  what it inherits.
- **FR-010**: A cell detail MUST let the administrator set a tier window outside the shared columns,
  see the inherited value, and clear the cell.
- **FR-011**: The grid MUST support keyboard navigation and editing (arrows, Tab, Enter, Escape),
  copy and paste of rectangular blocks (to and from spreadsheets), fill down, clear, and undo/redo of
  unsaved edits, without a pointing device.
- **FR-012**: Bulk actions on selected cells or lines MUST include set percentage, set amount
  adjustment, multiply fixed prices and clear, each undoable as one step.
- **FR-013**: Edits MUST stay unsaved until the administrator saves; a save MUST send one batch; the
  unsaved count MUST be visible; leaving with unsaved changes MUST ask for confirmation.
- **FR-014**: A refused save MUST mark every failing cell with its reason and keep every edit; a save
  against a book changed by someone else since it was opened MUST be refused and offer reload with the
  unsaved cells kept for re-application.
- **FR-015**: The grid MUST page lines, search them by name, identifier, category or attribute value,
  filter by selection kind, and keep unsaved edits across pages.
- **FR-016**: Lines that are inactive (an ineligible attribute, a deleted target) MUST show the reason.
- **FR-017**: Rules the API enforces (overlapping windows, fixed price on *all products*, percentage
  bounds, base books holding only product and variant lines) MUST be checked in the browser before
  saving where the rule needs no server data, and always reported per cell when the server refuses.
- **FR-018**: (Q-2) A book MUST be exportable as CSV (lines, tiers, kinds, values), and pasting from a
  spreadsheet MUST be the bulk-entry path; [CSV import per Q-2].

**Base prices on the product** (US3)

- **FR-019**: The product editor MUST contain a base-price panel contributed by the price-list module
  through the product editor's zone: per currency offered by any channel, the product's tiers, and per
  variant *inherits* / fixed / ± % / ± amount with the resulting price shown.
- **FR-020**: The panel MUST save with the product editor's save action, report its own errors on its
  fields, and state when the product has no base price and is therefore not orderable.
- **FR-021**: (Q-4) The product editor MUST list read-only the books that price the product directly,
  with audience and price, linking to the grid and the explanation screen.

**Duplicate** (US4)

- **FR-022**: Duplicating MUST open a dialog pre-filled from the source (name with "(copy)", channels,
  currency, audience, multiplier 1), validate channels against a changed currency before submit,
  explain that percentages are copied unchanged, and open the draft copy on success.

**Explanation** (US5)

- **FR-023**: An explanation screen MUST answer, for a channel, currency, buyer (organization,
  customer or guest) and lines (product or variant, quantity), each line's price, source, cell in words,
  book and row (linked), reference price, precedence version and ranked runner-ups.
- **FR-024**: The explanation screen MUST be reachable from the navigation, ⌘K, a book, a grid cell, a
  product and an organization, pre-filled from where it was opened.

**Precedence and settings** (US6, US7)

- **FR-025**: The pricing settings page (`/price-lists/display-modes`, titled *Pricing settings*) MUST
  show the active precedence read-only: preset name, the twelve cells in order with an example each,
  the category/attribute order, and that changes arrive later.
- **FR-026**: The pricing settings page MUST offer *Show list price beside the buyer's price*, default
  off, saved through an audited write; when on, the storefront MUST show the catalogue price beside the
  buyer price on the product page and listing cards — never in the basket or checkout — only when the
  catalogue price is above the buyer price, and the
  buyer price alone otherwise (D1–D4).

**Scope, access and presence** (US8, cross-cutting)

- **FR-027**: A sales representative MUST see and edit only organization books whose every
  organization is in scope, see everyone and customer-group books read-only with edit controls absent,
  and receive for any other book the same page as for an unknown book; the audience step MUST offer
  them only organizations in scope.
- **FR-028**: Screens MUST require the price-list read permission to view and the write permission to
  change; controls the user may not use MUST be absent rather than failing on click.
- **FR-029**: *Price books*, *New price book* and *Price explainer* MUST be reachable from ⌘K / CTRL+K
  and the navigation; the base-price panel, list and settings MUST disappear when the price-list module
  is off, and a stale address MUST answer as for an absent module.
- **FR-030**: Every write the screens perform MUST go through the API of feature 160 (and the gaps of
  *Dependencies*); the screens MUST NOT compute a price themselves — previews in the grid and panel
  that show a resulting amount MUST say "preview" and match the server's rounding.

**Quality** (all stories)

- **FR-031**: Every screen MUST meet WCAG 2.2 AA (`.claude/skills/ux-laws/SKILL.md` §4): the grid as an
  ARIA grid with row and column headers and one tab stop, visible focus, errors linked to cells and
  announced, status (loading, saving, saved, error counts) in a polite live region mounted before it
  has text, kind and state never by colour alone, and reduced motion respected.
- **FR-032**: Every list, grid, panel and screen MUST have loading (skeleton or progress within 400 ms),
  empty (icon, one line, one action), error (specific, constructive, with retry) and saving states; no
  submit may be double-sent.
- **FR-033**: Each view MUST have one primary action; destructive actions MUST be separated from it and
  confirmed (`ux-laws` Von Restorff, Fitts).
- **FR-034**: Screens MUST reuse admin-kit and admin-shell primitives and pickers (product picker,
  organization, customer-group, customer, category and sales-channel pickers, modal dialog, responsive
  table, pagination, sticky form actions, saved views where lists have filters); a new shared primitive
  (the editable grid) MUST live in admin-kit with its own tests if no existing one fits.
- **FR-035**: All text MUST exist in English and Polish.
- **FR-036**: The grid MUST remain responsive (scroll, focus move and typing under 100 ms) on a page of
  200 lines × 6 tier columns, and a save of 5 000 rows MUST show progress and finish without the page
  becoming unresponsive.

### Key Entities *(include if feature involves data)*

No new stored entity. The screens edit the entities of feature 160 (`data-model.md`): price book
header, channel set, audience members, rows, base books, and read the precedence version. One new
setting: *show list price* (`pricing.show_list_price`, boolean, default false), owned by the price-list
module. Browser-only state: unsaved edits, undo history, the book version the edits started from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator configures the books of E1, E2 and E3 from an empty database in under
  10 minutes using only the admin, and the explanation screen confirms every vector of §10.2–§10.4.
- **SC-002**: Entering 50 products × 3 tiers by pasting from a spreadsheet and saving takes under 2
  minutes, with zero values lost or mis-assigned.
- **SC-003**: The whole flow of US1–US3 is completed with the keyboard only, and an automated
  accessibility scan of each screen reports no violation; screen-reader announcements exist for load,
  save, error counts and the unsaved count.
- **SC-004**: Grid interactions stay under 100 ms at 200 lines × 6 columns, and every save or load
  shows feedback within 400 ms.
- **SC-005**: With two administrators on one book, a second save over a newer version is refused 100 %
  of the time, and no unsaved cell is lost.
- **SC-006**: A sales representative cannot learn, through any screen, link or message, that a book
  naming an organization outside their scope exists (A3.2).
- **SC-007**: With the setting on, vectors D1–D4 hold on the product page and listing cards; with it off, buyers see
  one price everywhere.
- **SC-008**: Every new string exists in English and Polish (0 missing keys).

## Assumptions

- Feature 160's API, schemas and error messages are the contract; this feature changes it only through
  the gaps listed under *Dependencies*, each additive.
- Quantity-tier columns are the book's tier starts; a tier window ends where the next start begins
  unless a cell detail sets an explicit end.
- Paging, not virtualised scrolling: pages of 50/100/200 lines (no new dependency). Search and filters
  find lines across pages.
- When the list-price display is on, the pair shows on the product page and listing cards only; the
  basket and checkout show the charged price alone, so a buyer never sees two prices beside one charge.
- Undo/redo covers unsaved edits of the current session only; saved changes are reverted by editing.
- The audit history of a book is the platform audit log filtered to the book, linked from the header.
- The documentation of the price-book editor is part of feature 160's Phase 13 (FR-048 of 160), which
  runs after this feature; this feature delivers in-product help text only.

## Dependencies

**Feature 160 — gaps in its admin API that this editor needs** (feed back to the 160 implementation;
each is additive and justified by the requirement named):

| # | Gap | Needed by |
| --- | --- | --- |
| G1 | `GET /api/v1/admin/price-books?productId=` — books with a row selecting the product (or its variants) directly, with that row's price | FR-021 (Q-4) |
| G2 | Row read model carries display labels: product name and SKU, variant label, category name, attribute label and value label, and a deleted marker — so the grid needs no per-row lookups | FR-006, FR-016 |
| G3 | `?search=` on `GET …/rows` over those labels | FR-015 |
| G4 | The book read model carries its distinct tier starts (`tierStarts`), so columns are known before all lines are loaded | FR-006 (Q-1) |
| G5 | Optimistic concurrency: a book `version` returned on read and required by `PUT …/rows` and `PATCH …/:id`; `409 PRICE_BOOK_STALE` when it moved | FR-014, SC-005 |
| G6 | Batch refusals list **every** failing row (input index or id, field, reason), not the first | FR-014 |
| G7 | `PUT …/rows` accepts base books, restricted to product and variant rows (FR-009 of 160), so the base grid of US1 scenario 6 saves through the same path | FR-005, FR-017 |
| G8 | The `pricing.show_list_price` setting (manifest, default false) with an audited write route; the existing display-mode settings write bypasses the Command Bus and must not be copied | FR-026 |
| G9 | `ListingPriceDetail` and the storefront resolved price carry the catalogue price when it is above the buyer price **and** the setting is on, so the storefront renders the pair without computing a price | FR-026, SC-007 |

**Other**: the product picker of feature 145; the product editor's zone mechanism (feature 091); the
release gate of feature 160 (one pull request to `master` after this feature and 160's Phase 13).

## Out of Scope

- Changing the precedence (P3); promotions excluding sale or contract lines (P4).
- CSV import (subject to Q-2), scheduled bulk changes, approval workflows for price changes.
- Price history per row beyond the audit log.
- The storefront variant-selection experience (#377), which consumes 160's variant prices.
