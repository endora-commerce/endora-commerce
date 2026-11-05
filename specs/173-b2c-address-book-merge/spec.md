# Feature Specification: One address book for B2C customers

**Feature Branch**: `spec/762-address-book-merge`
**Created**: 2026-11-05
**Status**: Draft — design; waiting for the owner decisions listed in *Owner decisions* below
**Issue**: #762
**Input**: Owner ruling of 2026-11-05 on issue #762: a B2C customer has a personal Organization,
and two address books that do not know about each other. Checkout reads and writes the
Organization's book. "Moje adresy" (`/addresses`) edits the personal book of the `customers`
module, and checkout never offers it. An address typed at checkout does not land in the person's
own book. The ruling: **for the B2C customer the two lists are merged into one.**

**Related**: `specs/040-*` (customers, the personal address book: US2, FR-008, FR-009, FR-038).
That directory is pre-migration and is not in this tree; it is cited for provenance, the
behaviour is read from `packages/modules/customers/`. `specs/051-*` (personal Organizations),
also pre-migration. `specs/170-organization-roles/` (FR-014a, FR-057, FR-070a, owner rulings
OR-8, PR-3, PR-10). PR #758 (issue #757), which hid the "Adresy organizacji" navigation entry for
personal Organizations and is the step before this one.

## Background *(non-normative)*

| | Organization book | Personal book |
| --- | --- | --- |
| Owner module | `addresses` (entity `Address`, table `addresses`, `@OrgScoped`), routes served by `organizations` | `customers` (entity `CustomerAddress`, table `customer_addresses`, `@CustomerScoped`) |
| Customer API | `/api/v1/organizations/mine/addresses` (`packages/modules/organizations/src/backend/routes.customer.ts`) | `/api/v1/me/customer/addresses` (`packages/modules/customers/src/backend/routes.self.ts`) |
| Write gate | organization permission `addresses.manage` (declared in `packages/modules/addresses/src/manifest.ts`) | the customer session |
| Storefront | checkout (`storefront/app/(commerce)/checkout/page.tsx`, `buildPlaceOrderPayload`), `/organization/addresses`, `/preferences` | `/addresses` ("Moje adresy", `storefront/app/(account)/addresses/page.tsx`) |
| Order placement | accepted: `OrderService` resolves both address ids through `addressReadPort.findById(organizationId, …)` | **refused**: a personal-book id answers `403 ADDRESS_NOT_OWNED` (`packages/modules/orders/src/backend/services/order-service.ts`) |
| Can be switched off | no (`addresses` and `organizations` are `nonDeactivatable`) | yes (`customers.enabled`) |

So the personal book is not usable anywhere an order is placed, for anybody. For a B2C customer
it is also the only book they are shown as "theirs".

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A B2C customer has one address book (Priority: P1)

Anna shops as an individual (her account belongs to a personal Organization). She opens
"Moje adresy", adds a delivery address and makes it the default. At checkout the same address is
offered and pre-selected. On a later order she types a new delivery address at checkout; after the
order it is listed in "Moje adresy" next to the first one, and she can remove it there.

**Why this priority**: it is the owner's ruling and the defect the issue reports.

**Independent Test**: as a personal-Organization customer, add an address on `/addresses`, open
checkout, see it offered; type a new one at checkout, place the order, open `/addresses`, see it
listed. Run once in English and once in Polish.

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

### User Story 2 — Existing personal-book addresses of B2C customers are not lost (Priority: P1)

Piotr is a B2C customer who saved two addresses in "Moje adresy" before the upgrade. They were
never offered at checkout. After the upgrade both are in his one list and checkout offers them.
Nothing is duplicated: an address that was already in his Organization's book (because he once
typed it at checkout) appears once.

**Why this priority**: without it the merge hides data the customer entered.

**Independent Test**: seed a personal-Organization customer with personal-book rows (one of them
identical to an Organization-book row), run the merge, read both books.

**Acceptance Scenarios**:

1. **Given** a B2C customer with live personal-book addresses, **When** the merge has run,
   **Then** each of them is in the Organization book of his personal Organization and the
   personal-book rows are marked merged and no longer listed.
2. **Given** a personal-book address equal to an Organization-book address of the same kind,
   **When** the merge runs, **Then** no second Organization-book row is created.
3. **Given** a personal-book default and no Organization-book default of that kind, **When** the
   merge runs, **Then** the merged address becomes the default. **Given** both have a default,
   **Then** the Organization-book default stays the default (it is what checkout pre-selects today).
4. **Given** the merge has run, **When** it runs again, **Then** nothing changes.
5. **Given** a customer of a **company** Organization, **When** the merge runs, **Then** his
   personal book is not touched.
6. **Given** a soft-deleted personal-book row, **When** the merge runs, **Then** it is not copied.

---

### User Story 3 — An operator sees the same list as the customer (Priority: P2)

An operator opens a B2C customer's detail screen in the admin. The addresses card shows the
addresses of the customer's one book, the same ones the customer sees and checkout offers.

**Acceptance Scenarios**:

1. **Given** a B2C customer, **When** an operator opens the customer's addresses card, **Then** it
   lists the personal Organization's addresses.
2. **Given** a B2C customer, **When** the card is shown, **Then** it does not offer to add an
   address into a book checkout does not use (the outcome of owner decision OD-6).

---

### User Story 4 — Company members are not changed by this feature (Priority: P2)

Marek belongs to a company Organization. His "Moje adresy" page and the company's
"Adresy organizacji" page behave as before this feature (unless owner decision OD-3 rules
otherwise, in which case a follow-up feature changes them).

**Acceptance Scenarios**:

1. **Given** a company member, **When** he opens "Moje adresy", **Then** he sees his personal book
   and the read-only company addresses, as today.
2. **Given** a company member, **When** he adds a personal address, **Then** it is saved as today.

### Edge Cases

- **The merge has not run yet** for a customer (the worker process has not picked it up, or
  `customers` is switched off): her pre-upgrade personal addresses are not in the one list until it
  has. The window is the time between boot and the job's first run; it is documented in the
  upgrade note. While `customers` is off the personal book behaves as if never installed
  (Principle XVII), so those rows are unreachable anyway; the merge runs when the module is next on.
- **A client keeps writing to the personal-book API** for a personal-Organization customer after
  the upgrade: refused (OD-5), so the book cannot split again.
- **An org-less customer** (an account with no Organization at all — only possible on data that
  predates `specs/051-*` and was not backfilled): keeps the personal book unchanged. Principle XI
  makes this an invalid state rather than a supported path; this feature neither repairs nor
  extends it.
- **A customer whose account moves from a personal Organization into a company** (operator detach
  or attach): the addresses stay with the personal Organization, as every other
  Organization-owned row does. Not changed here.
- **The customer is deleted and later anonymised**: the merged addresses now live in the personal
  Organization's book. Today's retention sweep scrubs neither book (see OD-7).
- **Checkout creates a new row for every typed address**, even when an equal one exists. This is
  today's behaviour, unchanged; with one list the duplicates become visible to the customer. Not
  in scope; tracked as a follow-up.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For a customer whose Organization is personal, the storefront MUST show exactly one
  address book on "Moje adresy" / "My addresses", and that book MUST be the personal
  Organization's book (the one checkout reads). *(OD-1)*
- **FR-002**: For that customer, "Moje adresy" MUST let her add, remove and set the default
  delivery and billing address, and every change MUST be visible at checkout on the next load.
- **FR-003**: An address typed at checkout by that customer MUST appear in "Moje adresy" after the
  order is placed. (Checkout already writes it into the Organization book; FR-001 makes that the
  book "Moje adresy" lists.)
- **FR-004**: For that customer, "Moje adresy" MUST NOT show a second, read-only
  "Organization addresses" / "Adresy organizacji" section.
- **FR-005**: Every live personal-book address of a customer whose Organization is personal MUST
  be merged into that Organization's book, once, automatically, without operator action. *(OD-2)*
- **FR-006**: The merge MUST NOT create an Organization-book row equal to an existing live one of
  the same kind; equality is defined in `plan.md` § Data migration.
- **FR-007**: The merge MUST keep an existing Organization-book default and MUST carry a
  personal-book default only where the Organization book has none of that kind.
- **FR-008**: The merge MUST be idempotent and MUST be resumable after an interruption without
  duplicating or losing an address.
- **FR-009**: A merged personal-book row MUST be retained (soft-deleted) with a reference to the
  Organization-book row it was merged into, so the merge can be audited and reverted.
- **FR-010**: Each merged address MUST leave an audit entry (Principle XIII).
- **FR-011**: The merge MUST NOT touch the personal book of a customer whose Organization is a
  company Organization. *(OD-3)*
- **FR-012**: For a customer whose Organization is personal, a write to the personal-book API
  (create, update, delete, set default — self-service and admin) MUST be refused with a stable
  error code and a translated message in Polish and English. *(OD-5, OD-6)*
- **FR-013**: For that customer, the personal-book read API MUST keep its response shape; its
  `organization` list MUST carry the one book, and its `personal` list MUST be empty once the
  merge has run.
- **FR-014**: For that customer, the address defaults reported by `/api/v1/me/customer/defaults`
  MUST be the Organization book's defaults.
- **FR-015**: A personal Organization's member MUST be able to create, update and delete addresses
  through `/api/v1/organizations/mine/addresses`. *(OD-4: confirmed by construction — the member
  holds Administrator, FR-070a of `specs/170-organization-roles/`.)*
- **FR-016**: The admin customer-detail addresses card MUST, for a B2C customer, list the personal
  Organization's book. *(OD-6)*
- **FR-017**: With `customers` switched off, a B2C customer MUST still be able to see and manage
  her one book and use it at checkout; the merge MUST NOT run while `customers` is off and MUST
  run when it is next on.
- **FR-018**: With `customers` switched off, the storefront MUST NOT link to a page served by
  `customers` (a company member's or an org-less customer's personal book).
- **FR-019**: Every new user-facing string MUST ship in Polish and English.
- **FR-020**: Company members' address pages MUST behave as before this feature (unless OD-3
  rules retirement, which is then a separate feature).

### Key Entities

- **Organization address** (`addresses`, owner `addresses`): the one book of a B2C customer. No
  schema change.
- **Customer address** (`customer_addresses`, owner `customers`): the personal book. Gains two
  provenance columns, `merged_into_address_id` and `merged_at`. Live rows remain only for company
  members and org-less accounts.

## Owner decisions

Recommendations and the alternatives are argued in `plan.md` § Decisions. Each becomes a `D-nnn`
ruling, numbered above the floor in `specs/pre-migration-history/README.md`, when it is made.

| # | Question | Recommendation |
| --- | --- | --- |
| **OD-1** | Which book is canonical for a personal Organization? | The personal Organization's book (`addresses`). |
| **OD-2** | What happens to existing personal-book addresses of B2C customers? | Merge them automatically, de-duplicated, keeping the Organization default; keep the source rows soft-deleted with provenance. |
| **OD-3** | Does the personal book keep a role for company members? | Not in this feature (no change for B2B). For the follow-up: **retire** it for company members rather than make it usable at checkout. |
| **OD-4** | Permissions | Confirm: a personal Organization's member is Administrator, which holds `addresses.manage` and cannot be changed. No new permission. |
| **OD-5** | A personal-book write by a B2C customer after the merge | Refuse with `409 CUSTOMER_ADDRESS_BOOK_MERGED` (a `breaking change`), rather than silently redirect into the Organization book. |
| **OD-6** | The admin customer-detail card for a B2C customer | Read-only list of the Organization book; adding there is refused. An admin write to Organization addresses is a follow-up for every Organization. |
| **OD-7** | Anonymisation of a deleted B2C customer's addresses | Scrub the personal Organization's addresses in the existing retention cascade, in this feature, because the merge moves more personal data into that book. |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a B2C customer, the set of addresses on "Moje adresy" equals the set offered at
  checkout — asserted by a test in both languages.
- **SC-002**: After the merge, zero live `customer_addresses` rows belong to an account of a
  personal Organization (the production query in `plan.md` § Counting returns 0 in the
  `live_unmerged_personal` column).
- **SC-003**: The number of Organization-book addresses added by the merge is at most the number
  of live personal-book rows of B2C customers before it, and equals it minus the duplicates found.
- **SC-004**: No contract or storefront test of a company member's address pages changes outcome.

## Assumptions

- Every transacting customer has an Organization (Principle XI); a B2C customer's is personal
  (`organizations.is_personal = true`, `specs/051-*`). `OrganizationRecord.isPersonal` is the one
  test of "B2C" used everywhere in this feature, as it already is in
  `storefront/lib/account/organization-area.ts`.
- The worker process runs in every deployment that runs the storefront (the anonymisation sweep
  already depends on it).
- The number of personal-book rows on real installations is small (see `plan.md` § Counting; the
  local development database holds none). If production holds many, the batch size is the only
  knob that changes.
