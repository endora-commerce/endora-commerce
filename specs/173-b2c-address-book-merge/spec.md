# Feature Specification: One address book — merge for B2C customers, retire the personal book

**Feature Branch**: `spec/762-address-book-merge`
**Created**: 2026-11-05
**Status**: Draft. OD-1 – OD-7 were ruled 2026-11-05. OD-8 – OD-12 are open (see *Owner decisions*)
**Issue**: #762
**Input**: Owner ruling of 2026-11-05 on issue #762. A B2C customer has a personal Organization
and two address books that do not know about each other. Checkout reads and writes the
Organization's book. "Moje adresy" (`/addresses`) edits the `customers` module's personal book,
which checkout never offers. An address typed at checkout does not land in the person's own book.
The first ruling: **for the B2C customer the two lists are merged into one.** The second ruling,
also 2026-11-05, on this spec (OD-3): **the personal address book is retired in this feature, for
everyone**, company members included.

**Related**: `specs/040-*` (customers, the personal address book: US2, FR-008, FR-009, FR-038).
That directory is pre-migration and is not in this tree. It is cited for provenance; the
behaviour is read from `packages/modules/customers/`. `specs/051-*` (personal Organizations) is
also pre-migration. `specs/170-organization-roles/` (FR-014a, FR-057, FR-070a; owner rulings
OR-8, PR-3, PR-10). PR #758 (issue #757) hid the "Adresy organizacji" navigation entry for
personal Organizations. Issue #769 is being fixed in parallel: `quick_order` eligibility will
accept only Organization-book addresses.

## Background *(non-normative)*

| | Organization book | Personal book (retired by this feature) |
| --- | --- | --- |
| Owner module | `addresses` (entity `Address`, table `addresses`, `@OrgScoped`), routes served by `organizations` | `customers` (entity `CustomerAddress`, table `customer_addresses`, `@CustomerScoped`) |
| Customer API | `/api/v1/organizations/mine/addresses` (`packages/modules/organizations/src/backend/routes.customer.ts`) | `/api/v1/me/customer/addresses` (`packages/modules/customers/src/backend/routes.self.ts`) |
| Write gate | organization permission `addresses.manage` (declared in `packages/modules/addresses/src/manifest.ts`, *Member* default) | the customer session |
| Storefront | checkout, `/organization/addresses`, `/preferences` | `/addresses` ("Moje adresy") |
| Order placement | accepted | **refused for everyone**: `403 ADDRESS_NOT_OWNED` (`packages/modules/orders/src/backend/services/order-service.ts`) |
| Can be switched off | no (`addresses` and `organizations` are `nonDeactivatable`) | yes (`customers.enabled`) |

No order has ever been placed to a personal-book address. That is why retiring the book removes no
working capability. The only thing to protect is the data people typed into it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A B2C customer has one address book (Priority: P1)

Anna shops as an individual (her account belongs to a personal Organization). She opens
"Moje adresy", adds a delivery address and makes it the default. Checkout offers the same address
and pre-selects it. On a later order she types a new delivery address at checkout. After the order
it is listed in "Moje adresy" next to the first one, and she can remove it there.

**Why this priority**: it is the owner's ruling and the defect the issue reports.

**Independent Test**: as a personal-Organization customer, add an address on `/addresses`, open
checkout and see it offered. Type a new one at checkout, place the order, open `/addresses` and see
it listed. Run once in English and once in Polish.

**Acceptance Scenarios**:

1. **Given** a personal-Organization customer on "Moje adresy", **When** she adds a delivery
   address, **Then** checkout offers it among the saved delivery addresses.
2. **Given** that customer at checkout with no saved address chosen, **When** she types a new
   delivery address and places the order, **Then** "Moje adresy" lists that address.
3. **Given** that customer, **When** she makes an address the default on "Moje adresy", **Then**
   checkout pre-selects it.
4. **Given** that customer, **When** she removes an address on "Moje adresy", **Then** checkout no
   longer offers it, and orders already placed keep the address they were placed with.
5. **Given** that customer, **When** "Moje adresy" is shown, **Then** it shows exactly one list
   and no section called "Organization addresses" / "Adresy organizacji".
6. **Given** the storefront in Polish and in English, **When** scenarios 1–5 run, **Then** every
   label on the page and at checkout is in the language of the store.

---

### User Story 2 — Existing personal-book addresses of B2C customers are moved, not lost (Priority: P1)

Piotr is a B2C customer who saved two addresses in "Moje adresy" before the upgrade. After the
upgrade both are in his one list and checkout offers them. Nothing is duplicated: an address that
was already in his Organization's book appears once.

**Acceptance Scenarios**:

1. **Given** a B2C customer with live personal-book addresses, **When** the move has run,
   **Then** each of them is in his personal Organization's book. The personal-book rows are marked
   merged and are no longer listed.
2. **Given** a personal-book address equal to an Organization-book address of the same kind,
   **When** the move runs, **Then** no second Organization-book row is created.
3. **Given** a personal-book default and no Organization-book default of that kind, **When** the
   move runs, **Then** the moved address becomes the default. **Given** both have a default,
   **Then** the Organization-book default stays the default.
4. **Given** the move has run, **When** it runs again, **Then** nothing changes.
5. **Given** a soft-deleted personal-book row, **When** the move runs, **Then** it is not copied.

---

### User Story 3 — A company member's private addresses are handed back, then removed (Priority: P1)

Marek belongs to a company Organization. Before the upgrade he saved his home address in
"Moje adresy". Checkout never offered it. After the upgrade his account navigation has one address
entry, "Adresy organizacji", the company's book. On that page, and visible only to him, a section
lists his former personal addresses as read-only. It says on which date they will be removed. For
each one he can **copy it into the company's addresses** (if his role holds `addresses.manage`) or
**remove it** now. On the date shown, what is left is removed and its contents erased. The company's
other members never see these addresses unless he copies one.

**Why this priority**: retirement ruled for everyone (OD-3). Without this story the retirement would
either delete typed data with no warning, or publish a private address to colleagues.

**Acceptance Scenarios**:

1. **Given** a company member with live personal-book rows, **When** he opens his addresses page,
   **Then** he sees the company book and, below it, his former personal addresses as read-only, with
   the removal date.
2. **Given** that member holds `addresses.manage`, **When** he copies one, **Then** it is in the
   company book (and offered at checkout), and it leaves the former-addresses section.
3. **Given** that member lacks `addresses.manage`, **When** the section is shown, **Then** it offers
   *Remove* only, and one line says that an administrator can add the address to the company.
4. **Given** another member of the same company, **When** she opens the addresses page, **Then** she
   does not see Marek's former personal addresses.
5. **Given** the removal date has passed, **When** the retirement job runs, **Then** every remaining
   former personal address is soft-deleted and its fields are erased.
6. **Given** a company member, **When** anything tries to add or edit a personal-book address,
   **Then** it is refused (FR-012).

---

### User Story 4 — An operator sees the same list as the customer (Priority: P2)

An operator opens a customer's detail screen in the admin. The addresses card shows the
Organization book the customer orders from, read-only. For a company member with former personal
addresses still in their notice period, it also lists those, read-only, with their removal date.
Rows the move refused are listed with the reason.

**Acceptance Scenarios**:

1. **Given** any customer, **When** an operator opens the addresses card, **Then** it lists the
   customer's Organization book and offers no add form (OD-6).
2. **Given** a company member with former personal addresses, **When** the card is shown, **Then**
   they are listed read-only with their removal date.
3. **Given** a B2C customer with a row the move refused, **When** the card is shown, **Then** the row
   is listed with the refusal reason. The customer does not see it (ruled 2026-11-05).

### Edge Cases

- **The move has not run yet** for a B2C customer (the worker has not picked it up, or `customers`
  is switched off): her pre-upgrade addresses are not in the one list until it has. The upgrade note
  documents this window. While `customers` is off the personal book behaves as if never installed
  (Principle XVII); the job runs when the module is next on.
- **A company member who leaves the company** during the notice period keeps nothing: the rows are
  his account's, and he no longer has a company page to see them on. They are removed on the date,
  as for anyone. They cannot be copied anywhere, because the account no longer has a company.
- **An account later detached from a company into a personal Organization** with rows still inside
  the notice period: the next run of the job moves them, as for any B2C customer.
- **An org-less account** (data that predates `specs/051-*` and was not backfilled; registration has
  provisioned a personal Organization since then): its rows follow User Story 3 without the copy
  action, because there is no Organization to copy into. Principle XI makes this an invalid state;
  this feature does not repair it.
- **`customers` is switched off during the notice period**: the former-addresses section and the
  admin card are absent. The removal date does not move. The job runs at the first run with the
  module on, and removes whatever is past its date.
- **Checkout creates a new row for every typed address**, even when an equal one exists. This is
  today's behaviour, unchanged, and is tracked as a follow-up.

## Requirements *(mandatory)*

### Functional Requirements

**One book (B2C)**

- **FR-001**: For a customer whose Organization is personal, "Moje adresy" / "My addresses" MUST
  show exactly one address book: the personal Organization's book. *(OD-1)*
- **FR-002**: For that customer, "Moje adresy" MUST let her add, remove and set the default delivery
  and billing address. Every change MUST be visible at checkout on the next load.
- **FR-003**: An address that customer types at checkout MUST appear in "Moje adresy" after the
  order is placed.
- **FR-004**: For that customer, "Moje adresy" MUST NOT show a second, read-only
  "Organization addresses" / "Adresy organizacji" section.

**Moving B2C rows** *(OD-2)*

- **FR-005**: Every live personal-book address of a customer whose Organization is personal MUST be
  moved into that Organization's book once, automatically, without operator action.
- **FR-006**: The move MUST NOT create an Organization-book row equal to a live one of the same kind.
  Equality is defined in `plan.md` R-4.
- **FR-007**: The move MUST keep an existing Organization-book default. It MUST carry a personal
  default only where the Organization book has no default of that kind.
- **FR-008**: The move MUST be idempotent and resumable after an interruption, without duplicating
  or losing an address.
- **FR-009**: A moved row MUST be kept soft-deleted, with a reference to the Organization-book row it
  became.
- **FR-010**: Every moved, copied, refused and removed address MUST leave an audit entry
  (Principle XIII).
- **FR-011**: A row the Organization book's owner refuses during the move MUST stay, marked with the
  reason. Only the operator sees it (ruled 2026-11-05).

**Retiring the personal book for everyone** *(OD-3)*

- **FR-012**: No surface (storefront, admin, API) MUST create, edit or set a default on a
  personal-book address any more, for any customer. A write MUST be refused with one stable error
  code and a translated message in Polish and English. *(OD-5, OD-8)*
- **FR-013**: A company member's or org-less account's live personal-book rows MUST stay readable by
  their own customer and by operators, read-only, until a removal date shown to both. *(OD-9, OD-10)*
- **FR-014**: During that period the customer MUST be able to remove such a row, and a company member
  holding `addresses.manage` MUST be able to copy one into the company's book.
- **FR-015**: Such a row MUST NOT be shown to any other member of the company.
- **FR-016**: After the removal date, every remaining personal-book row MUST be soft-deleted and have
  its personal fields erased.
- **FR-017**: A company member MUST be offered exactly one address entry in the account navigation,
  the company's book. *(OD-11)*
- **FR-018**: The address fields of `/api/v1/me/customer/defaults` MUST report the customer's
  Organization book defaults.
- **FR-019**: `quick_order` MUST NOT read the personal book. This is delivered by #769, and this
  feature removes the published read port that is left.

**Permissions** *(OD-4)*

- **FR-020**: A personal Organization's member MUST be able to create, update and delete addresses
  through `/api/v1/organizations/mine/addresses`. No new permission is added.

**Admin** *(OD-6)*

- **FR-021**: The admin customer-detail addresses card MUST list the customer's Organization book
  read-only, plus any personal-book rows still in their notice period or refused by the move, with
  the removal date or the reason.

**Anonymisation** *(OD-7)*

- **FR-022**: When the retention sweep anonymises a B2C customer and its personal Organization is
  scrubbed, every address of that Organization MUST be soft-deleted **and** its personal fields
  erased. The customer's personal-book rows MUST be erased too. Order snapshots are untouched.

**Off-state and language**

- **FR-023**: With `customers` switched off, a B2C customer MUST still be able to see and manage her
  one book and use it at checkout. The move and the removal MUST NOT run while `customers` is off,
  and MUST run when it is next on.
- **FR-024**: With `customers` switched off, no storefront page MUST link to or render a surface
  `customers` serves (the former-addresses section).
- **FR-025**: Every new user-facing string MUST ship in Polish and English.

### Key Entities

- **Organization address** (`addresses`, owner `addresses`): the one book of every customer. No
  schema change. It gains one port method for anonymisation (`plan.md` R-7).
- **Customer address** (`customer_addresses`, owner `customers`): retired. It gains the provenance
  and retirement columns `merged_into_address_id`, `merged_at`, `merge_refusal` and `retire_after`.
  Rows are kept only until moved or past `retire_after`. The table, entity and remaining code go in
  a later release (OD-12).

## Owner decisions

The arguments, the alternatives and the consequences are in `plan.md` § Decisions. Each decision
becomes a `D-nnn` ruling, numbered above the floor in `specs/pre-migration-history/README.md`, in
the ruling record.

### Resolved (owner, 2026-11-05)

| # | Question | Ruling |
| --- | --- | --- |
| **OD-1** | Which book is canonical for a personal Organization? | **Resolved 2026-11-05, as recommended**: the personal Organization's book (`addresses`). |
| **OD-2** | Existing personal-book addresses of B2C customers | **Resolved 2026-11-05, as recommended**: an automatic one-time move, with no duplicates. The Organization default is kept. Source rows are soft-deleted with a link to the new row. |
| **OD-3** | Does the personal book keep a role for company members? | **Resolved 2026-11-05, changed from the recommendation**: retire the personal address book **now, in this feature, for everyone**, company members included. |
| **OD-4** | Permissions | **Resolved 2026-11-05, as recommended**: no new permission. A personal Organization's member is Administrator and holds `addresses.manage`. |
| **OD-5** | A personal-book write after the merge | **Resolved 2026-11-05, as recommended**: refuse with `409 CUSTOMER_ADDRESS_BOOK_MERGED`. The owner noted that probably no external client uses the API. Under OD-3, the plan makes the refusal the answer of every retired write for everyone, and asks in OD-8 to confirm the code's name and status. |
| **OD-6** | The admin customer-detail card | **Resolved 2026-11-05, as recommended**: read-only. Admin editing of Organization addresses is a separate follow-up. |
| **OD-7** | Anonymisation of a deleted B2C customer's addresses | **Resolved 2026-11-05, as recommended, sub-question included**: in this feature, the personal Organization's addresses are cleared **and** their fields blanked, not only soft-deleted. |
| — | Rows refused during the move | **Resolved 2026-11-05**: visible to the operator only. |

### Open (raised by OD-3)

| # | Question | Recommendation |
| --- | --- | --- |
| **OD-8** | One refusal for every retired write: which code and status? | `410 Gone` with **`CUSTOMER_ADDRESS_BOOK_RETIRED`**, for everyone. The ruled name says "merged", which is false for a company member's book, and a code name cannot be corrected once clients rely on it. Fallback: the ruled `409 CUSTOMER_ADDRESS_BOOK_MERGED` for everyone. |
| **OD-9** | Existing company-member (and org-less) personal-book rows | Read-only for a notice period, with *Copy to company addresses* and *Remove*. Then erase what is left. Rejected: auto-copy (privacy), immediate deletion, an export file, read-only forever. |
| **OD-10** | Length of the notice period and how it is announced | **90 days from the upgrade**, fixed per row by the migration, not a Setting. Notice on the page and the admin card, plus the operator's upgrade note. **No e-mail.** |
| **OD-11** | What "Moje adresy" is for a company member afterwards | No separate entry. A company member has one address entry, "Adresy organizacji" (`/organization/addresses`), and `/addresses` redirects there. His former personal addresses show on that page, to him only, during the notice period. |
| **OD-12** | When the table and the remaining personal-book code go | In a later release, by a `customers` migration that **refuses to run while any row is still unmoved or inside its notice period**. The upgrade note says to upgrade through this feature's release first. |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every customer, the set of addresses on their one address page equals the set
  offered at checkout. A test asserts this in both languages, for a B2C customer and for a company
  member.
- **SC-002**: After the move, zero live, unmoved, unrefused `customer_addresses` rows belong to an
  account of a personal Organization (`plan.md` § Counting).
- **SC-003**: Once every `retire_after` has passed and the job has run, zero `customer_addresses`
  rows are live.
- **SC-004**: No storefront, admin or API path can create or edit a personal-book row. A contract
  test covers every former write.

## Assumptions

- Every transacting customer has an Organization (Principle XI). A B2C customer's is personal
  (`organizations.is_personal`). `OrganizationRecord.isPersonal` is the one test of "B2C" used
  everywhere, as it already is in `storefront/lib/account/organization-area.ts`.
- #769 lands before or with this feature's release, so `quick_order` no longer reads the personal
  book when this feature removes the read port.
- The worker process runs in every deployment that runs the storefront (the anonymisation sweep
  already depends on it).
- The number of personal-book rows on real installations is small (see `plan.md` § Counting; the
  local development database holds none).
