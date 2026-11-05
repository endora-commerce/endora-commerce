# Feature Specification: One address book — the Organization's, for every customer

**Feature Branch**: `spec/762-address-book-merge`
**Created**: 2026-11-05
**Status**: Draft. OD-1 and OD-3 – OD-12 were ruled 2026-11-05. OD-2 is superseded by the owner's
facts, pending one confirmation (OD-13).
**Issue**: #762
**Input**: Owner rulings of 2026-11-05.

- On the issue: a B2C customer's checkout address and "Moje adresy" must be **one list**.
- On this spec (OD-3): the personal address book of the `customers` module is **retired, for
  everyone**.
- On this spec (OD-9, OD-12): it is **removed in this release**, with no notice period. The owner
  states that company members have no personal-book addresses on demo or production.

**Related**:

- `specs/040-*` (customers, personal address book: US2, FR-008, FR-009, FR-038) and `specs/051-*`
  (personal Organizations): pre-migration directories, cited for provenance; the behaviour is read
  from `packages/modules/customers/`.
- `specs/170-organization-roles/` (FR-014a, FR-057, FR-070a; owner rulings OR-8, PR-3, PR-10).
- PR #758 (issue #757): hid the "Adresy organizacji" entry for personal Organizations.
- Issue #769: `quick_order` eligibility will accept only Organization-book addresses. A
  prerequisite of this feature.

## Background *(non-normative)*

| | Organization book (kept) | Personal book (removed) |
| --- | --- | --- |
| Owner module | `addresses` (`Address`, table `addresses`, `@OrgScoped`); routes served by `organizations` | `customers` (`CustomerAddress`, table `customer_addresses`) |
| Customer API | `/api/v1/organizations/mine/addresses` | `/api/v1/me/customer/addresses` |
| Write gate | organization permission `addresses.manage` (*Member* default) | the customer session |
| Storefront | checkout, `/organization/addresses`, `/preferences` | `/addresses` ("Moje adresy") |
| Order placement | accepted | refused for everyone (`403 ADDRESS_NOT_OWNED`) |

No order has ever been placed to a personal-book address, so removing the book removes no working
capability.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A B2C customer has one address book (Priority: P1)

Anna shops as an individual: her account belongs to a personal Organization. She opens
"Moje adresy", adds a delivery address and makes it the default. Checkout offers it and
pre-selects it. On a later order she types a new delivery address at checkout. After the order it
is listed in "Moje adresy", and she can remove it there.

**Independent Test**: as a personal-Organization customer, add an address on `/addresses` and see
it offered at checkout. Then type one at checkout and see it on `/addresses`. Run in English and in
Polish.

**Acceptance Scenarios**:

1. **Given** a personal-Organization customer on "Moje adresy", **When** she adds a delivery
   address, **Then** checkout offers it.
2. **Given** that customer at checkout, **When** she types a new delivery address and places the
   order, **Then** "Moje adresy" lists it.
3. **Given** that customer, **When** she makes an address the default on "Moje adresy", **Then**
   checkout pre-selects it.
4. **Given** that customer, **When** she removes an address on "Moje adresy", **Then** checkout no
   longer offers it. Orders already placed keep their address.
5. **Given** that customer, **When** "Moje adresy" is shown, **Then** it shows exactly one list and
   no "Organization addresses" / "Adresy organizacji" section.
6. **Given** the storefront in Polish and in English, **When** scenarios 1–5 run, **Then** every
   label is in the store's language.

### User Story 2 — A company member has one address entry (Priority: P1)

Marek belongs to a company Organization. His account navigation has one address entry,
"Adresy organizacji", the company's book, which is what checkout offers him. Opening `/addresses`
takes him there.

**Acceptance Scenarios**:

1. **Given** a company member, **When** the account navigation is shown, **Then** it has one
   address entry, "Adresy organizacji" / "Organization addresses", and no "Moje adresy".
2. **Given** a company member, **When** he opens `/addresses`, **Then** he is redirected to
   `/organization/addresses`.

### User Story 3 — The personal book is gone, safely (Priority: P1)

An operator upgrades an installation. If the installation holds no live personal-book address, the
upgrade removes the personal book. If it holds any, the upgrade **stops before removing anything**,
says why, and the upgrade note tells the operator what to do.

**Acceptance Scenarios**:

1. **Given** an installation with no live personal-book rows, **When** it migrates, **Then** the
   personal book's table no longer exists.
2. **Given** an installation with at least one live personal-book row, **When** it migrates,
   **Then** the migration refuses, names the number of rows and the upgrade-note section, and
   removes nothing.
3. **Given** a client calling any former personal-book endpoint, **When** the call arrives,
   **Then** it is answered `410 Gone`, `CUSTOMER_ADDRESS_BOOK_RETIRED`, with a message in the
   request's language (Polish or English).

### User Story 4 — The operator sees the book the customer orders from (Priority: P2)

**Acceptance Scenarios**:

1. **Given** any customer, **When** an operator opens the customer's addresses card in the admin,
   **Then** it lists the customer's Organization book read-only, with no add form.

### Edge Cases

- **An org-less account** (legacy data predating `specs/051-*`; Principle XI makes it invalid):
  after this feature it has no address page. `/addresses` redirects it to `/account`, as the other
  Organization pages do. It could not order before this feature either.
- **`customers` switched off**: nothing about addresses changes. Every address page and checkout
  are served by `nonDeactivatable` modules. The admin card and the `410` answers are absent, as is
  everything of an absent module.
- **Checkout creates a new row for every typed address**: today's behaviour, unchanged. It is a
  follow-up.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For a customer whose Organization is personal, "Moje adresy" / "My addresses"
  (`/addresses`) MUST show the personal Organization's book and nothing else. *(OD-1)*
- **FR-002**: On that page the customer MUST be able to add and remove addresses, and to set the
  default delivery and billing address. Checkout MUST reflect each change on its next load.
- **FR-003**: An address that customer types at checkout MUST appear on "Moje adresy".
- **FR-004**: A company member MUST be offered one address entry, the company's book. `/addresses`
  MUST redirect them to it. *(OD-11)*
- **FR-005**: The personal address book MUST be removed in this release: its table, entity,
  services, routes, published read port, contract schemas, storefront client and admin form.
  *(OD-3, OD-12)*
- **FR-006**: The migration that removes the table MUST refuse to run while the table holds any
  live (not soft-deleted) row. It MUST report the count and point to the upgrade note. It MUST NOT
  read any other module's table. *(OD-9; OD-13)*
- **FR-007**: Every former personal-book endpoint MUST answer `410 Gone` with
  `CUSTOMER_ADDRESS_BOOK_RETIRED`, for every caller, with the message in Polish or English.
  *(OD-5, OD-8)*
- **FR-008**: `GET /api/v1/me/customer/defaults` MUST report the customer's Organization-book
  default addresses. `PUT` MUST refuse a body that sets an address default, with the code from
  FR-007.
- **FR-009**: A personal Organization's member MUST be able to create, update and delete addresses
  through `/api/v1/organizations/mine/addresses`. No new permission is added. *(OD-4)*
- **FR-010**: The admin customer-detail addresses card MUST list the customer's Organization book,
  read-only. *(OD-6)*
- **FR-011**: When the retention sweep anonymises a B2C customer and its personal Organization is
  scrubbed, every address of that Organization MUST be soft-deleted **and** have its personal
  fields blanked. Order snapshots are untouched. *(OD-7)*
- **FR-012**: `quick_order` MUST NOT refer to the personal book (#769). This feature removes the
  dependency edge that remains.
- **FR-013**: Every new user-facing string MUST ship in Polish and English.

### Key Entities

- **Organization address** (`addresses`): the one book of every customer. No schema change. It
  gains the port method `anonymizeForOrganization` (OD-7).
- **Customer address** (`customer_addresses`): removed.

## Owner decisions

The arguments and the alternatives that were rejected are in `plan.md` § Decisions. Each ruling
becomes a `D-nnn` in the ruling record, numbered above the floor in
`specs/pre-migration-history/README.md`.

| # | Question | Status |
| --- | --- | --- |
| **OD-1** | Canonical book for a personal Organization | **Resolved 2026-11-05, as recommended**: the personal Organization's book. |
| **OD-2** | Existing B2C personal-book rows | **Ruled 2026-11-05 (automatic one-time move); superseded by the owner's later rulings, pending OD-13.** A move job cannot run before a migration that removes the table in the same release (`plan.md` § OD-2). The plan replaces it with the guarded removal. |
| **OD-3** | Role of the personal book for company members | **Resolved 2026-11-05, changed from the recommendation**: retired for everyone, in this feature. |
| **OD-4** | Permissions | **Resolved 2026-11-05, as recommended**: no new permission. |
| **OD-5** | Personal-book writes after the merge | **Resolved 2026-11-05**: refused for everyone. Code and status as OD-8. |
| **OD-6** | Admin customer-detail card | **Resolved 2026-11-05, as recommended**: read-only. Admin editing of Organization addresses is a separate follow-up. |
| **OD-7** | Anonymising a deleted B2C customer's addresses | **Resolved 2026-11-05, as recommended**: cleared **and** blanked, in this feature. |
| — | Rows refused during a move | **Resolved 2026-11-05** (operator-only). Moot now that there is no move. |
| **OD-8** | Code and status of the refusal | **Resolved 2026-11-05, as recommended**: `410 Gone`, `CUSTOMER_ADDRESS_BOOK_RETIRED`, for everyone. |
| **OD-9** | Company members' existing rows | **Resolved 2026-11-05**: delete at once. The owner states that none exist on demo or production. |
| **OD-10** | Notice period and announcement | **Resolved 2026-11-05: not needed.** No notice period; the upgrade note only. |
| **OD-11** | "Moje adresy" for a company member | **Resolved 2026-11-05, as recommended**: one "Adresy organizacji" entry; `/addresses` redirects there. |
| **OD-12** | When the table and code go | **Resolved 2026-11-05**: in this feature and release. |
| **OD-13** | **Open.** Confirm that production also holds no live **B2C** personal-book rows, and accept the guarded removal in place of OD-2's move. | **Recommendation**: confirm, and accept. If an installation does hold rows, its upgrade stops harmlessly, and the contingency in `plan.md` § OD-13 applies. |

## Success Criteria *(mandatory)*

- **SC-001**: For every customer, the addresses on their one address page are the addresses
  checkout offers. A test asserts this in both languages.
- **SC-002**: After the release, the table `customer_addresses` does not exist on any installation
  that completed its upgrade.
- **SC-003**: No API path creates, edits or reads a personal-book address. Every former endpoint
  answers `410`.

## Assumptions

- The owner's statement (2026-11-05): company members have no personal-book rows on demo or
  production. The local development database holds none at all (`plan.md` § Counting).
- #769 merges before this feature.
- Every transacting customer has an Organization (Principle XI). `OrganizationRecord.isPersonal`
  is the one test of "B2C".
