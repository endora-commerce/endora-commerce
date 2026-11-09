# Feature Specification: Admin global search — find Organizations, Customers, Orders, Quote Requests, Sales Opportunities, Products and Categories from one search, with configurable searchable fields

**Feature Branch**: `feat/150-admin-global-search` (spec directory `specs/150-admin-global-search/`)
**Created**: 2026-10-16
**Status**: Clarified — the owner answered Q1–Q3 and the module-id question on 2026-10-16 (see
*Clarifications*); Q2 was answered differently from the architect's default.
**Input**: Product-owner request, translated from Polish: *"In the Admin UI add a search that
lets you search by Organization, Customer, Order, Quote Request (RFQ), Sales Opportunity (CRM),
Product, Category. Ideally there would be a place where you can configure which fields each of
these entities is searchable by."*

## Background

Today an admin who knows *something* about a record — an order number read out over the phone, a
customer's e-mail, a company's tax ID, a SKU — must first decide which list screen holds it, open
that list, find its filter box and type there. Each list searches different fields in different
ways, and two of the seven (Quote Requests and Categories) cannot be searched by text at all.

The admin already has one place to "search": the **command palette**, opened with ⌘K / Ctrl+K or
by clicking the search field at the top of the sidebar. It finds *screens* and *actions*
("Orders", "New product"), never *records*. This feature makes it find records too, and adds a
configuration screen for which fields each record type is searched by.

## Vocabulary

- **Global search** — the capability this feature adds: one search text, matched against several
  record types at once, from anywhere in the admin.
- **Record type** — one of the seven searchable kinds of record: Organization, Customer, Order,
  Quote Request, Sales Opportunity, Product, Category.
- **Searchable field** — one property of a record type the search text can match (an order's
  number, a customer's e-mail). Every record type has a **closed list of offered fields**, decided
  by the part of the platform that owns that record type, not by the admin.
- **Search configuration** — for each record type: whether it takes part in global search, and
  which of its offered fields are searched.
- **Command palette** — the existing ⌘K / Ctrl+K dialog. Its existing groups are *Assistant*,
  *Navigate* and *Actions*; this feature adds one group per record type.
- **Organization scope** — the set of organizations an admin may see. A platform administrator
  sees all; a sales representative sees the organizations assigned to them (plus the unassigned
  ones, as everywhere else in the admin).
- **Assigned organizations** — for an admin whose organization scope is restricted (a sales
  representative), the organizations in that scope. Used by global search only to *rank*
  Organization results (Q2); it never widens or narrows what Organization results contain.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Find any record from the command palette (Priority: P1)

An admin presses ⌘K (or clicks the sidebar search field) anywhere in the admin, types a fragment
— `ZAM/2026/0042`, `kowalski@`, `5260250995`, `CHAIR-RED` — and sees matching records grouped by
type (Orders, Quote Requests, Sales Opportunities, Organizations, Customers, Products,
Categories) below the screens and actions the palette already lists. Arrow keys and Enter open the
chosen record's screen.

**Why this priority**: it is the request. Every other story refines or configures it, and it is
useful on its own with sensible default fields.

**Independent Test**: with default configuration and seeded data containing one record of each
type sharing the token `ACME`, open the palette, type `acme`, and confirm seven groups appear, each
result opens the right screen, and keyboard-only operation works. Repeat as a sales representative
assigned to one organization and as a role without `orders` read access, and confirm only
permitted records appear.

**Acceptance Scenarios**:

1. **Given** an admin anywhere in the admin, **When** they open the palette and type fewer
   characters than the minimum search length, **Then** the palette behaves exactly as it does
   today (screens and actions only) and no record search is performed.
2. **Given** an admin types at least the minimum length, **When** typing pauses, **Then** within
   a second the palette shows, below the existing groups, one group per record type that has
   matches, in the fixed order Orders, Quote Requests, Sales Opportunities, Organizations,
   Customers, Products, Categories, each group titled in the admin's language.
3. **Given** results are shown, **When** the admin moves through the list with the arrow keys and
   presses Enter on a result (or clicks it), **Then** the palette closes and the record's own
   admin screen opens.
4. **Given** a record type has more matches than the per-type limit, **When** its group is shown,
   **Then** it shows the limit and says that more exist, and a "See all results" entry is offered
   (User Story 3).
5. **Given** the admin keeps typing, **When** an earlier, slower search returns after a later one,
   **Then** the earlier results never replace the later ones.
6. **Given** the search text exactly equals an order's number, **When** results appear, **Then**
   that order is the first result in the Orders group.
7. **Given** a sales representative assigned to organization A, **When** they search for a text
   matching orders of organizations A and B, **Then** only A's orders appear, and nothing on screen
   reveals that B's orders exist.
8. **Given** a role without permission to read orders, **When** that admin searches, **Then** no
   Orders group appears at all, while groups for types they may read do.
9. **Given** the Sales Opportunities module is switched off on `/platform/modules`, **When** any
   admin searches, **Then** no Sales Opportunities group appears; **When** it is switched back on,
   **Then** opportunities are found again with the configuration they had.
10. **Given** one record type cannot be searched in time (e.g. an overloaded database table),
    **When** results appear, **Then** the other types' results are shown and that type's group
    says it could not be searched, instead of the whole search failing.
11. **Given** an admin types `lodz`, **When** an organization named `Łódź Meble` exists, **Then** it
    is found (organization names ignore Polish diacritics).
12. **Given** an admin pastes a record's internal identifier (as shown in a URL), **When** results
    appear, **Then** that record is found whatever fields are configured.
13. **Given** a sales representative assigned to organization A, **When** they search for a text
    matching organizations A and B (both visible on today's Organizations list), **Then** both are
    shown in the Organizations group, A first — assigned organizations rank before the others, and
    within each of the two groups the usual ranking applies in a stable order (Q2).

---

### User Story 2 — Configure which fields each record type is searched by (Priority: P2)

An admin with the configuration permission opens **Global search** settings, sees each record
type with the fields it can be searched by, ticks and unticks fields (e.g. adds *Billing tax ID*
to Orders, removes *Slug* from Categories), can exclude a record type from global search entirely,
and saves. From the next search on, every admin's results follow the new configuration.

**Why this priority**: the product owner asked for it ("ideally"), and it lets each business tune
noise vs. recall — but defaults make Story 1 valuable without it.

**Independent Test**: on the configuration screen, untick *Organization name* for Orders and save;
search for an organization name and confirm its orders no longer appear while the organization
does; restore defaults and confirm they appear again. Try to save a field the record type does not
offer (through the API) and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** an admin holding the configuration permission, **When** they open the Global search
   configuration (from the sidebar's System section or the palette), **Then** they see every record
   type whose module is present, each with its offered fields (labelled in their language), the
   currently selected ones ticked, and a switch for whether the type takes part.
2. **Given** a record type with one selected field, **When** the admin tries to untick it while the
   type takes part, **Then** saving is refused with an explanation (switch the type off instead).
3. **Given** the admin changes fields and saves, **When** any admin searches afterwards, **Then**
   the new configuration applies, with no restart and no re-indexing wait.
4. **Given** the admin clicks "Restore defaults" for a type and saves, **Then** that type's fields
   return to its shipped defaults.
5. **Given** a request to store a field a record type does not offer, **When** it is submitted,
   **Then** it is refused and nothing is stored.
6. **Given** two admins edit the configuration at the same time, **When** the second saves after
   the first, **Then** the second is told the configuration changed and asked to reload, rather than
   silently overwriting it.
7. **Given** an admin without the configuration permission, **When** they look for the screen,
   **Then** it is not in their sidebar or palette, and opening its address shows the usual
   access-denied screen.
8. **Given** a configuration change is saved, **When** the audit log is consulted, **Then** it shows
   who changed it, when, and the value before and after.
9. **Given** a record type's module is switched off, **When** the configuration screen is opened,
   **Then** that type is not listed; its stored configuration is kept and applies again when the
   module returns.

---

### User Story 3 — See all results for a search (Priority: P3)

From the palette, an admin chooses "See all results for “…”" and lands on a full-page results
screen listing more matches per record type (up to 20), with the option to narrow to one record
type. The page's address carries the search text, so it can be bookmarked or shared with a
colleague (who sees only what *they* may see).

**Why this priority**: the palette's five-per-type limit covers lookups; broader "which records
mention X" questions need a page. Useful, not essential to the first release.

**Independent Test**: search a text with more than five orders matching, choose "See all results",
confirm up to 20 orders are listed, narrow to Orders only, copy the URL into another admin's
session and confirm that admin's own visibility rules apply.

**Acceptance Scenarios**:

1. **Given** palette results, **When** the admin activates "See all results", **Then** the results
   page opens with the same text and up to 20 results per record type.
2. **Given** the results page, **When** the admin narrows to one record type, **Then** only that
   type is searched and shown, and the address reflects the narrowing.
3. **Given** a results-page address opened by another admin, **When** it loads, **Then** results
   follow the second admin's permissions and organization scope.
4. **Given** the admin edits the text on the page, **When** typing pauses, **Then** results refresh
   without a page reload.

### Edge Cases

- Text with SQL/LIKE wildcard characters (`%`, `_`, `\`) is matched literally.
- Text longer than 100 characters is refused as invalid input; leading/trailing whitespace is
  ignored; whitespace-only text counts as empty.
- A record type with no matches shows no group (no empty headings); if no type matches, the
  palette shows its existing "no matches" message only when screens and actions match nothing too.
- The admin's role changes or a module is switched off while the palette is open: the next search
  reflects the change; a result opened after the change follows the destination screen's own
  access rule.
- A record matched by several fields appears once.
- Product and category names exist per language; any language's name matches, and the result is
  shown in the admin's language (falling back to the default language).
- Inactive, draft and archived products, blocked customers and organizations, and cancelled orders
  are found (admins need them) and are marked with their status; soft-deleted records, anonymized
  customers and personal (B2C) organizations are not found (personal customers are found as
  Customers).
- The configuration stores a field the record type later stops offering (a module upgrade): the
  field is ignored when searching and disappears from the screen; if that leaves a type with no
  field, the type's defaults apply.
- Global search itself is switched off: the palette keeps screens and actions and simply never
  shows record groups; the configuration screen and results page are absent; nothing is deleted.

## Requirements *(mandatory)*

### Functional Requirements

**Searching**

- **FR-001**: The command palette (opened by ⌘K / Ctrl+K or the sidebar search field) MUST search
  records of the seven record types in addition to the screens and actions it lists today.
- **FR-002**: Record search MUST start only once the trimmed text reaches the minimum search length
  (default 3, configurable 2–10). Below it, the palette MUST behave as it does today.
- **FR-003**: Results MUST be grouped by record type, one group per type with matches, in the fixed
  order Orders, Quote Requests, Sales Opportunities, Organizations, Customers, Products,
  Categories, shown after the palette's existing groups and titled in the admin's language.
- **FR-004**: Each group MUST show at most the per-type limit (default 5, configurable 1–10) and
  MUST indicate when more matches exist.
- **FR-005**: Each result MUST show a primary line identifying the record (number, name or SKU), a
  secondary line that tells same-named records apart (e.g. organization and date for an order,
  tax ID for an organization, category path for a category) and, where the record type has one,
  its status. Activating a result MUST open that record's admin screen.
- **FR-006**: Record results MUST be operable with the palette's existing keyboard interaction
  (arrow keys, Enter, Escape) and by pointer, as one continuous list with the existing groups.
- **FR-007**: Results MUST refresh as the admin types, without submitting; a response for older
  text MUST never replace results for newer text.
- **FR-008**: While a search is running the palette MUST indicate it; a record type whose search
  fails or exceeds its time budget MUST be reported as unavailable in place of its results while
  the other types are still shown.
- **FR-009**: Matching MUST be case-insensitive substring matching against each selected field. A
  record matched through several fields MUST appear once. Within a group, records whose identifier
  field equals the text MUST come first, then those whose identifier starts with it, then the rest
  by most recent change.
- **FR-010**: Text equal to a record's internal identifier MUST find that record, independent of
  the field configuration.
- **FR-011**: Organization names MUST match without regard to Polish diacritics (`lodz` finds
  `Łódź`). Other fields are matched as stored (see Assumptions).
- **FR-012**: Wildcard characters in the text MUST be matched literally; text longer than 100
  characters MUST be refused as invalid.

**Visibility**

- **FR-013**: A record type MUST take part only while the module that owns it is present (installed
  and switched on). An absent module's type MUST contribute no group, no result and no entry on the
  configuration screen.
- **FR-014**: A record type MUST take part for an admin only if the admin's role holds the
  permission that type's own admin list requires.
- **FR-015**: Global search MUST NOT return any record the admin could not find through that record
  type's own admin list, and MUST NOT return records outside the admin's organization scope. No
  count, hint or label may reveal that hidden records exist. Organization results follow exactly
  the visibility of the Organizations admin list: the organizations the list shows the searching
  admin, which for a sales representative is the reach rule of `organizations` (amended 2026-11-07
  by the owner's ruling on issue #305, which superseded the Q2 exception "every non-personal,
  non-deleted organization, for anyone who may read that list").
- **FR-015a**: For an admin whose organization scope is restricted, Organization results MUST rank
  the organizations in that scope (their assigned organizations) before all others; within each of
  the two groups the FR-009 ranking applies, and the order MUST be stable (ties broken by the
  record's identifier) so that repeating a search yields the same order. For an admin with an
  unrestricted scope there is one group.
- **FR-016**: Soft-deleted records, anonymized customers and personal (B2C) organizations MUST NOT
  be returned. Records in every other status MUST be returned with their status shown.
- **FR-017**: Search text MUST NOT be stored, recorded for analytics, or written to logs beyond the
  platform's standard request logging.

**Configuration**

- **FR-018**: A configuration screen MUST list every present record type, with its offered fields
  (labelled in the admin's language, defaults identified), which of them are selected, and whether
  the type takes part.
- **FR-019**: An authorized admin MUST be able to select and unselect offered fields, switch a type
  out of (or back into) global search, restore a type's defaults, and save.
- **FR-020**: A type that takes part MUST keep at least one selected field; saving otherwise MUST be
  refused with an explanation.
- **FR-021**: Only fields offered by a record type's owner MAY be stored for that type; any other
  field MUST be refused and nothing stored.
- **FR-022**: Each record type MUST ship the offered fields and defaults below. The owner of a record
  type MAY offer more fields in a later release without changing global search itself.

  | Record type | Offered fields (✓ = selected by default) |
  | --- | --- |
  | Order | Order number ✓ · Organization name ✓ · Customer name or e-mail ✓ · Billing company name · Billing tax ID |
  | Quote Request | Quote Request number ✓ · Organization name ✓ · Customer name or e-mail ✓ · Customer's note |
  | Sales Opportunity | Opportunity number ✓ · Title ✓ · Organization name ✓ · Description |
  | Organization | Name ✓ · Tax ID ✓ · Legal name |
  | Customer | E-mail ✓ · Name ✓ |
  | Product | SKU ✓ · Name ✓ · URL key (slug) · Quick-search attributes |
  | Category | Name ✓ · URL key (slug) ✓ |

- **FR-023**: The configuration MUST be one platform-wide configuration, effective for every admin
  from their next search after saving, with no restart and no waiting for re-indexing.
- **FR-024**: Viewing and changing the configuration MUST require a dedicated permission; admins
  without it MUST NOT see the screen in the sidebar or palette.
- **FR-025**: Every configuration change MUST be recorded in the audit log with actor, time and
  before/after values.
- **FR-026**: Saving a configuration that changed since it was loaded MUST be refused with a prompt
  to reload.
- **FR-027**: The stored configuration of a record type MUST survive its module being switched off
  and MUST apply again when the module is switched back on.
- **FR-028**: The minimum search length and the per-type limit MUST be editable on the admin's
  Settings screen, within the ranges in FR-002 and FR-004.

**Full results page**

- **FR-029**: The palette MUST offer "See all results for “<text>”" whenever record search ran; it
  MUST open a results page showing up to 20 results per record type for the same text.
- **FR-030**: The results page MUST allow narrowing to one record type, and its address MUST carry
  the text and the narrowing so that it can be bookmarked or shared; each viewer sees results under
  their own permissions and scope.

**Switching global search on and off**

- **FR-031**: Global search MUST be switchable on the platform's module screen. While off: the
  palette MUST show no record groups and no "See all results" entry, the results page and the
  configuration screen MUST be absent, its settings MUST NOT be editable, and its API MUST refuse
  as absent. Switching off MUST delete nothing; switching back on MUST restore the previous
  configuration and behaviour.

**Language and accessibility**

- **FR-032**: Every text this feature adds MUST be available in English and Polish.
- **FR-033**: The palette with record results, the results page and the configuration screen MUST be
  operable by keyboard alone and meet WCAG 2.2 AA; result updates MUST be announced to assistive
  technology without moving focus.

### Key Entities

- **Record type** — a kind of record global search can find: its display name, the permission
  required to read it, its owner module, its offered fields with defaults, and how a result is
  presented and opened.
- **Searchable field** — one offered field of a record type: a stable code, a display name, whether
  it is selected by default, and whether it is an identifier (ranked first on exact/prefix match).
- **Search configuration** — per record type: takes part (yes/no) and the selected field codes; plus
  the minimum search length and per-type limit. One per platform; versioned for concurrent edits.
- **Search result** — one found record: record type, identifier, primary and secondary line,
  optional status, and the admin screen it opens.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin opens a known order, customer or product from any admin screen in at most
  three interactions (shortcut, type, Enter) and under 5 seconds.
- **SC-002**: At the reference volume (100 000 orders, 20 000 quote requests, 20 000 opportunities,
  10 000 organizations, 50 000 customers, 50 000 products, 2 000 categories) the server answers a
  palette search across all seven types in under 800 ms at the 95th percentile with default
  configuration.
- **SC-003**: In a permission matrix of platform administrator, sales representative (one assigned
  organization) and a role lacking each read permission in turn, 0 results appear outside the
  admin's permissions or organization scope — Organizations excepted by FR-015, whose results equal
  the Organizations list's for that admin, assigned organizations first (FR-015a).
- **SC-004**: A saved configuration change is reflected in the very next search of a different
  admin, with no restart.
- **SC-005**: With each switchable owner (Customers, Quote Requests, Sales Opportunities) and with
  global search itself switched off in turn, 0 results of the affected type(s) and 0 configuration
  entries appear; switching back on restores 100% of the prior configuration.
- **SC-006**: Automated accessibility checks report 0 violations on the palette with results, the
  results page and the configuration screen, and every flow in Stories 1–3 completes with the
  keyboard alone.

## Clarifications

### Session 2026-10-16 (owner)

- **Module id** → `admin_search`, added to the naming check's `allowed_singular` list beside
  `search` (research R-16, resolved).
- **Q1** — Is the configuration platform-wide, or per admin / per role? → **Platform-wide, one
  setting** (the default was kept; FR-023, FR-024).
- **Q2** — Should a sales representative's Organization results be limited to their scope, or match
  the Organizations list? → **Changed from the architect's default.** Organization results are
  **not** limited to the admin's scope: they show every organization the admin could see on today's
  Organizations admin list (same visibility rule as that list), but the organizations assigned to
  the admin (in their scope) are ranked **first**, then the rest (FR-015 exception, FR-015a). Every
  other record type stays scope-limited. *Superseded 2026-11-07 by the owner's ruling on issue
  #305:* there is one reach rule on every surface, and the Organizations list itself narrows to it,
  so Organization results are the reach — never an organization assigned to another
  representative. FR-015a's ranking is unchanged.
- **Q3** — Ignore Polish diacritics on every name field? → **Only organization names** in this
  release (the default was kept; FR-011).

## Assumptions

- The command palette is the admin's search entry point; the sidebar search field already opens it,
  so no second search box is added to the page header.
- "Customer" means a customer account (a person who signs in), as on the Customers screen; their
  organization is shown on the result.
- "Quick-search attributes" are the product attributes the catalogue already flags for quick
  search on the storefront; no new attribute flag is introduced.
- Admins search across all sales channels: admin screens are not limited to one channel, so global
  search is not either.
- The minimum search length defaults to 3 because the identifiers admins paste (order and quote
  numbers, tax IDs, SKUs) are longer than that, and shorter texts match too much to be useful.
- Global search is switched on by default after installation and needs no setup: defaults apply
  until someone edits the configuration.
- No search history, "recent searches" or saved searches are in scope.
- Records are searched live, so a change is findable as soon as it is saved; there is no index to
  rebuild.

## Out of scope

- Searching other record types (invoices, returns, shipments, carts, CMS pages, …) — the design lets
  their owners add them later without changing global search.
- Per-admin or per-role configurations; ranking customisation; synonyms and typo tolerance.
- Changing what the existing list screens search.
- Storefront search (the separate `search` module) is not affected.
