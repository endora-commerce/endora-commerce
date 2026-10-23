# Feature Specification: Price-book editor (P2 of D-287)

**Feature Branch**: `feat/161-price-book-editor` (spec directory `specs/161-price-book-editor/`),
branched from the release branch `feat/160-pricing-model-v2`
**Created**: 2026-10-21
**Status**: Draft — the owner answered every open question (*Clarifications*, Session 2026-10-21);
ten additive gaps in P1's admin API to feed back to feature 160 (*Dependencies*).
**Input**: Issue #378, *"Price lists: replace 'Products & brackets' with a rebuilt multi-currency
Price matrix"*, re-scoped by D-287 §8.2 to **P2 — the price-book editor**: the admin screens on top of
the price-book model and the versioned admin API of feature 160 (`specs/160-pricing-model-v2/`). P1
and P2 are released together (spec 160, Clarifications, Q-A): this feature is the gate of that
release.

## Background

Feature 160 replaces the Application rule, the per-product brackets and the matrix tab with **price
books** and removes the old admin screens; it leaves the complete admin API
(`specs/160-pricing-model-v2/contracts/admin-price-books-api.md`), the shared schemas, the error
messages ready for this feature (the palette actions are this feature's own: P1 does not register
them, because their target screens are built here) (`specs/160-pricing-model-v2/plan.md`, *What
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

### Session 2026-10-21

- Q-1: How are quantity tiers laid out in the grid? → A: **(A) one column per tier start used anywhere
  in the book** ("from 1", "from 10", "from 100"). Organization and customer group are the book's
  header audience, not grid dimensions, so each audience is its own book; lines are selections, ordered
  from general to specific (all products, attribute value, category, category ∩ attribute value,
  product, variant) with a filter by kind and a search; an **empty cell inherits the line's nearest
  lower tier**, and the editor shows what it inherits; which line wins for a buyer is decided by the
  precedence, shown read-only (US6) and through "Why this price?" (US5).
- Q-2: Is moving a price book in and out of a spreadsheet part of this release? → A: **(C) paste and
  copy, CSV export and CSV import with a preview**, all in this release.
- Q-4: Should the product editor list the price books that price the product? → A: **Yes**, read-only,
  linking to the grid and to "Why this price?"; it replaces the removed *Linked price lists* panel
  (gap G1 is therefore required).

### Session 2026-10-22

- OQ-1: How does the base-price panel save (FR-020)? → A: **(B) its own *Save prices* button** with
  an unsaved-changes prompt, as every product-editor zone panel saves today. One Save for the whole
  product edit page is the future direction, tracked as issue #407.
- OQ-2: Saved views on the book list (FR-034)? → A: **(B) not now**: the list's filters live in the
  URL (shareable, bookmarkable); saved views on the price-book list are issue #408.
- Review (coordinator, 2026-10-22): the grid pages by **product line**, never splitting a line's tiers
  across pages, and a page call does not read the whole book. The 5 000-row figure is the CSV/batch
  limit, not a book size: base books hold a row per product tier and variant across the catalogue.

### Session 2026-10-23

- Owner ruling (list price beside a sale, FR-026): when a sale is charged and the list price is shown,
  the storefront shows **two prices only** — the list price struck through and the sale price labelled
  *Your price*; the buyer's regular price is not shown as a third number. This holds on every surface
  that shows the pair (price block, listing card, product page and its net/gross switch, typeahead).
  Without a sale, the pair is unchanged; with the setting off, a sale strikes the buyer's own price as
  before. Vectors D5 and D6 of `worked-examples.md` §10.15.
- Coordinator rulings (Checkpoint 11): a refused row carries a per-rule `reason` code
  (`PRICE_BOOK_ROW_ERROR_REASONS`) that the admin translates — never the server's English message;
  the attribute refusal is three reasons (not selectable, unknown value, not yes/no).

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
5. **Given** the product is priced by other books, **Then** a read-only list shows each book,
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
2. Vectors **D1–D6** of `worked-examples.md` §10.15.

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

### User Story 9 — Move a price book in and out of a spreadsheet (Priority: P2)

A pricing administrator exports a book to CSV, edits it in a spreadsheet (or receives one from a
buyer or an ERP), and imports it back: the editor shows exactly what would change and what cannot be
imported, and writes nothing until they confirm.

**Why this priority**: Ruled by the owner (Q-2 = C); large books are maintained in spreadsheets, and
a contract is often sent to the customer as one.

**Independent Test**: Export the E3 Acme book, change one price, add a row for an unknown SKU and one
for a new product, import in merge mode: the preview shows one change, one addition and one refused
row; after fixing the file and confirming, the grid equals the file.

**Acceptance Scenarios**:

1. **Given** a book, **When** it is exported, **Then** the file has the fixed header and one row per
   tier, opens in a spreadsheet with Polish settings without mangling decimals or diacritics, and
   re-imported unchanged produces an empty preview ("no changes").
2. **Given** a file with a changed price, a new line and a line whose SKU does not exist, **When** it is
   uploaded in merge mode, **Then** the preview lists 1 changed cell (old → new), 1 added line and
   1 refused row (line number, "unknown SKU …"), shows that nothing has been written, and cannot be
   confirmed until the refused row is fixed.
3. **Given** a valid file in replace mode, **When** previewed, **Then** the rows of the book missing from
   the file are listed as removed, with their count stated before the confirm button.
4. **Given** a confirmed preview, **When** the import runs, **Then** one audited change is written and
   the grid shows the result; **Given** someone else saved the book after the preview, **Then** the
   confirmation is refused and a fresh preview is offered.
5. **Given** a file in Windows-1250 with semicolons and decimal commas, **When** uploaded, **Then** it is
   read correctly, or the administrator is asked to choose the encoding when detection is uncertain.
6. **Given** a preview with refused rows, **When** the administrator downloads them, **Then** they get a
   CSV of exactly those rows with a reason column.

### Edge Cases

- A non-base book at the 5 000-row limit: adding lines is refused before saving, with the limit
  stated. Base books are not capped by it (they hold the catalogue's base prices).
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
- An import file with an unknown or duplicated header, an empty file, a file over 5 MB or more than
  5 000 rows: refused before the preview, with the reason.
- An import row naming a variant of another product, a category path that matches two categories, an
  attribute value code that does not exist, or an attribute without the *Price list rules* flag:
  refused in the preview with the line number.
- Two import rows for the same line and overlapping quantity windows: both refused in the preview.
- A percentage or amount on a base book line other than a variant: refused (base books hold fixed
  product prices and variant adjustments only).
- An import into a book the representative may only read: the import action is absent.
- An empty cell whose line has no lower tier: shown as "not priced by this line at this quantity",
  never as zero.

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
  *Clarification (owner, 2026-10-23): a base book's priority is not editable — base prices are their own tier and there is one base book per currency, so priority, a same-cell tie-break, never decides for it.*

**Grid** (US2)

- **FR-006**: The grid MUST show one line per selection of the book, labelled by name and identifier,
  **ordered from general to specific** — all products, attribute values, categories, category ∩
  attribute values, products, variants (under their product) — and alphabetically by label within a
  kind; and **one column per quantity tier start used anywhere in the book**, with each cell's price
  and kind.
- **FR-037**: An empty cell MUST show, de-emphasised and labelled as inherited, the value the line's
  nearest lower tier gives at that quantity ("inherits from 1: −5 %"); when no lower tier of the line
  exists, it MUST say the line does not price that quantity and offer "Why this price?". The grid MUST
  state, next to the line ordering, that which line wins for a buyer is decided by the precedence, and
  link to the precedence view.
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
- **FR-015**: The grid MUST page by **line** — a page boundary never splits a line's tiers, and a
  product's variant lines stay on its product's page — with the total line count shown; search lines by
  name, identifier, category or attribute value; filter by selection kind; and keep unsaved edits
  across pages. A page MUST load without the server reading the whole book.
- **FR-016**: Lines that are inactive (an ineligible attribute, a deleted target) MUST show the reason.
- **FR-017**: Rules the API enforces (overlapping windows, fixed price on *all products*, percentage
  bounds, base books holding only product and variant lines) MUST be checked in the browser before
  saving where the rule needs no server data, and always reported per cell when the server refuses.
**Import and export** (US9)

- **FR-018**: A book MUST be exportable as a CSV file in the **fixed price-book format**: a header row,
  then one row per tier — selection kind, product SKU, variant SKU, category path, attribute key,
  attribute value code, minimum quantity, maximum quantity, price kind, value — in UTF-8 with a BOM,
  semicolon-separated, decimal comma for a Polish administrator and point otherwise (stated in the file
  name), so the file opens correctly in a spreadsheet and imports back unchanged. A book (or a filtered
  view of it) with more than 5 000 rows MUST export as numbered files of at most 5 000 rows each, each
  importable on its own in merge mode.
- **FR-038**: A CSV file in that format MUST be importable into a book in one of two modes: **merge**
  (default — cells in the file are added or changed, others stay) or **replace** (the book's rows become
  exactly the file's). Column order is fixed by the header; the header names MUST be recognised in
  English and Polish; unknown columns MUST be refused with their names.
- **FR-039**: Import MUST accept a comma or semicolon separator, a decimal comma or point, UTF-8 with
  or without a BOM, and Windows-1250 (detected, or chosen by the administrator when detection fails),
  and MUST refuse a file over 5 MB or with more than 5 000 rows (one batch) before parsing further.
- **FR-040**: Before anything is written, import MUST show a **preview**: counts and a list of added,
  changed (old → new) and, in replace mode, removed cells, and every row that cannot be imported with
  its line number and reason — an unknown SKU, variant, category or attribute value, an ineligible
  attribute, an unreadable number, an overlap, a rule of the book (e.g. a base book line other than
  product or variant). The preview MUST come from the server's validation of the same batch it would
  write (gap G10).
- **FR-041**: Nothing MUST be written until the administrator confirms the preview; a preview with any
  refused row MUST NOT be confirmable (the administrator fixes the file and uploads again, or downloads
  the refused rows as CSV with their reasons); confirmation MUST write the batch as **one audited
  change** against the book version the preview was made from, and a book changed since MUST be refused
  with a new preview offered.
- **FR-042**: Import MUST NOT run while the grid holds unsaved edits for the same book (the
  administrator saves or discards them first).

**Base prices on the product** (US3)

- **FR-019**: The product editor MUST contain a base-price panel contributed by the price-list module
  through the product editor's zone: per currency offered by any channel, the product's tiers, and per
  variant *inherits* / fixed / ± % / ± amount with the resulting price shown.
- **FR-020**: The panel MUST have its own *Save prices* action, guarded by an unsaved-changes prompt
  when leaving the Pricing tab or the page; it MUST report its own errors on its fields and state when
  the product has no base price and is therefore not orderable (Clarifications, Session 2026-10-22;
  one Save for the whole product page is issue #407).
- **FR-021**: The product editor MUST list read-only the books that price the product directly,
  with audience and price, linking to the grid and the explanation screen, replacing the removed
  *Linked price lists* panel.

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
  buyer price alone otherwise (D1–D4); beside a charged sale, the list price struck through and the
  sale as *Your price*, with no third number (D5, D6; owner ruling 2026-10-23).

**Scope, access and presence** (US8, cross-cutting)

- **FR-027**: A sales representative MUST see and edit only organization books whose every
  organization is in scope, see everyone and customer-group books read-only with edit controls absent,
  and receive for any other book the same page as for an unknown book; the audience step MUST offer
  them only organizations in scope.
- **FR-028**: Screens MUST require the price-list read permission to view and the write permission to
  change; controls the user may not use MUST be absent rather than failing on click.
- **FR-029**: *Price books*, *New price book* and *Price explainer* MUST be reachable from ⌘K / CTRL+K
  and the navigation; this feature registers those palette actions (moved from spec 160 T105, whose
  target screens did not exist yet); the base-price panel, list and settings MUST disappear when the price-list module
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
  table, pagination, sticky form actions); list filters MUST live in the URL (saved views on the
  price-book list are issue #408); a new shared primitive
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
- **SC-007**: With the setting on, vectors D1–D5 hold on the product page and listing cards; with it off, buyers see
  one price everywhere.
- **SC-008**: Every new string exists in English and Polish (0 missing keys).
- **SC-009**: Importing a 1 000-row file shows its preview within 10 seconds, writes nothing before
  confirmation (0 rows changed by an unconfirmed or refused import), and after confirmation the grid
  equals the file in 100 % of cells; an export re-imported unchanged yields an empty preview.

## Assumptions

- Feature 160's API, schemas and error messages are the contract; this feature changes it only through
  the gaps listed under *Dependencies*, each additive.
- An empty cell inherits from the line's nearest lower tier because a tier's window runs until the
  line's next tier starts (or without end); this is the 160 row model, displayed, not a new rule.
- Quantity-tier columns are the book's tier starts; a tier window ends where the next start begins
  unless a cell detail sets an explicit end.
- Paging, not virtualised scrolling: pages of 50/100/200 **lines** (a product line with its variants
  counts as one), with page numbers (no new dependency). Search and filters run on the server and find
  lines across pages.
- When the list-price display is on, the pair shows on the product page and listing cards only; the
  basket and checkout show the charged price alone, so a buyer never sees two prices beside one charge.
- Undo/redo covers unsaved edits of the current session only; saved changes are reverted by editing.
- The audit history of a book is the platform audit log filtered to the book, linked from the header.
- The documentation of the price-book editor is part of feature 160's Phase 13 (FR-048 of 160), which
  runs after this feature; this feature delivers in-product help text only.

## Dependencies

**Feature 160 — gaps in its admin API that this editor needs** (feed back to the 160 implementation;
each is additive and justified by the requirement named):

| # | Gap (endpoint and shape) | Needed by |
| --- | --- | --- |
| G1 | `GET /api/v1/admin/price-books?productId=&variantId=` → page of `PriceBookSummary` plus `matches: [{ rowId, selectionKind, minQuantity, maxQuantity, price }]` for rows selecting the product or its variants directly (required: Q-4 = yes) | FR-021 |
| G2 | `PriceBookRow` gains `labels: { productName?, productSku?, variantLabel?, variantSku?, categoryPath?, attributeLabel?, attributeValueLabel? }` and `targetDeleted: boolean` | FR-006, FR-016, FR-018 |
| G3 | `GET /api/v1/admin/price-books/:id/rows?search=` matching those labels and SKUs | FR-015 |
| G4 | `PriceBook` and `PriceBookSummary` gain `tierStarts: number[]` (distinct `min_quantity` over the book's rows, ascending) | FR-006 |
| G5 | `PriceBook` gains `version: number`; `PUT …/:id/rows` and `PATCH …/:id` require `expectedVersion` (or `If-Match`) and answer `409 PRICE_BOOK_STALE` with the current version when it moved | FR-014, FR-041, SC-005 |
| G6 | A refused `PUT …/:id/rows` answers `400`/`409` with `errors: [{ index?, rowId?, field, code, message }]` listing **every** failing row, not the first | FR-014, FR-040 |
| G7 | `PUT …/:id/rows` accepts a base book's id, restricted to product rows (`fixed`) and variant rows (`fixed`/`percent`/`amount`) per 160 FR-009, refusing other shapes per row | FR-005, FR-017 |
| G8 | Manifest setting `pricing.show_list_price` (boolean, default `false`) with `PUT /api/v1/admin/price-books/settings/show-list-price` `{ value }` through `CommandBus.run` (audited); not the display-mode settings write, which bypasses the bus | FR-026 |
| G9 | `ListingPriceDetail` and `GET /api/v1/storefront/products/:id/resolved-price` gain `listPrice?: { amount, currency }`, present only when the setting is on and the catalogue price is above the buyer price | FR-026, SC-007 |
| G10 | `PUT /api/v1/admin/price-books/:id/rows?dryRun=true` (same body plus `mode: 'merge' \| 'replace'`, rows also addressable by natural keys `{ productSku?, variantSku?, categoryPath?, attribute?: {key, valueCode} }`) → writes nothing and answers `{ version, resolved: rows with ids, diff: { added[], changed[{ before, after }], removed[], unchangedCount }, errors[] }` (G6 shape, with `index` = file line); the confirming call is the same body without `dryRun`, with `expectedVersion` (G5) | FR-038–FR-041, SC-009 |

**Found while planning against the implemented P1** (2026-10-22): eight further additive gaps,
G11–G18, built as backend tasks of this feature — `contracts/backend-gaps.md`.

**Other**: the product picker of feature 145; the product editor's zone mechanism (feature 091); the
release gate of feature 160 (one pull request to `master` after this feature and 160's Phase 13).

## Out of Scope

- Changing the precedence (P3); promotions excluding sale or contract lines (P4).
- Scheduled bulk changes, approval workflows for price changes, column mapping for files that are not
  in the price-book format (the fixed format is the contract).
- Price history per row beyond the audit log.
- The storefront variant-selection experience (#377), which consumes 160's variant prices.
