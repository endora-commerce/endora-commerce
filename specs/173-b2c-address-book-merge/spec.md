# Feature Specification: One address book — the Organization's, for every customer

**Feature Branch**: `spec/762-address-book-merge`
**Created**: 2026-11-05
**Status**: Ready. Every owner decision (OD-1 – OD-13) was ruled on 2026-11-05.
**Issue**: #762
**Input**: Owner rulings of 2026-11-05.

- On the issue: a B2C customer's checkout addresses and "Moje adresy" must be **one list**.
- On this spec: the `customers` personal address book is **retired for everyone** (OD-3). Its
  B2C rows are moved into the personal Organization's book (OD-2). Every other row is erased at
  once (OD-9).
- The work ships in **two releases** (OD-13). Release 1 retires the book and moves or erases the
  rows. Release 2 drops the table and the remaining code.

**Related**:

- `specs/040-*` (customers, personal address book) and `specs/051-*` (personal Organizations):
  pre-migration directories, cited for provenance. The behaviour is read from
  `packages/modules/customers/`.
- `specs/170-organization-roles/` (FR-014a, FR-057, FR-070a; owner rulings OR-8, PR-3, PR-10).
- PR #758 (issue #757): hid the "Adresy organizacji" entry for personal Organizations.
- Issue #769: `quick_order` eligibility will accept only Organization-book addresses. It is a
  prerequisite of release 1.

## Background *(non-normative)*

| | Organization book (kept) | Personal book (retired) |
| --- | --- | --- |
| Owner module | `addresses` (`Address`, table `addresses`, `@OrgScoped`). Routes are served by `organizations` | `customers` (`CustomerAddress`, table `customer_addresses`) |
| Customer API | `/api/v1/organizations/mine/addresses` | `/api/v1/me/customer/addresses` |
| Write gate | organization permission `addresses.manage` (a *Member* default) | the customer session |
| Storefront | checkout, `/organization/addresses`, `/preferences` | `/addresses` ("Moje adresy") |
| Order placement | accepted | refused for everyone (`403 ADDRESS_NOT_OWNED`) |

No order has ever been placed to a personal-book address. Retiring the book removes no capability
that worked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A B2C customer has one address book (Priority: P1, release 1)

Anna shops as an individual, so her account belongs to a personal Organization. She opens
"Moje adresy", adds a delivery address and makes it the default. Checkout offers that address and
pre-selects it. On a later order she types a new delivery address at checkout. After the order it
is listed in "Moje adresy", and she can remove it there.

**Independent Test**: as a personal-Organization customer, add an address on `/addresses` and
check that checkout offers it. Then type an address at checkout and check that it appears on
`/addresses`. Run the test in English and in Polish.

**Acceptance Scenarios**:

1. **Given** a personal-Organization customer on "Moje adresy", **When** she adds a delivery
   address, **Then** checkout offers it.
2. **Given** that customer at checkout, **When** she types a new delivery address and places the
   order, **Then** "Moje adresy" lists it.
3. **Given** that customer, **When** she makes an address the default on "Moje adresy", **Then**
   checkout pre-selects it.
4. **Given** that customer, **When** she removes an address on "Moje adresy", **Then** checkout no
   longer offers it, and orders already placed keep their address.
5. **Given** that customer, **When** "Moje adresy" is shown, **Then** it shows exactly one list and
   no "Organization addresses" / "Adresy organizacji" section.
6. **Given** the storefront in Polish or in English, **When** scenarios 1–5 run, **Then** every
   label is in the store's language.

### User Story 2 — Existing B2C personal-book addresses are moved, not lost (Priority: P1, release 1)

Piotr is a B2C customer who saved two addresses in "Moje adresy" before the upgrade. After the
upgrade both are in his one list, and checkout offers them. Nothing is duplicated: an address that
was already in his Organization's book appears once.

**Acceptance Scenarios**:

1. **Given** a B2C customer with live personal-book rows, **When** the move job has run, **Then**
   each row is in his personal Organization's book. Each source row is soft-deleted and linked to
   the row it became, and one audit entry exists per row.
2. **Given** a personal-book address equal to a live Organization-book address of the same kind,
   **When** the job runs, **Then** no second Organization-book row is created.
3. **Given** a personal-book default and no Organization-book default of that kind, **When** the
   job runs, **Then** the moved address becomes the default. **Given** both books have a default,
   **Then** the Organization-book default stays.
4. **Given** the job has run, **When** it runs again, **Then** nothing changes.
5. **Given** a row the Organization book's owner refuses (for example, a country that is no longer
   active), **When** the job runs, **Then** the row stays live, marked with the reason, and only the
   operator sees it.

### User Story 3 — Every other personal-book address is erased (Priority: P1, release 1)

A company member's or an org-less account's personal-book rows are not copied anywhere, because
they are private. They are erased: their fields are blanked and they are soft-deleted, at once.
The owner states that no such rows exist on demo or production.

**Acceptance Scenarios**:

1. **Given** a company member with a live personal-book row, **When** the job runs, **Then** the
   row's fields are blanked, the row is soft-deleted, and an audit entry exists. The company book is
   unchanged.
2. **Given** an org-less account with a live personal-book row, **When** the job runs, **Then** it
   is erased in the same way.

### User Story 4 — A company member has one address entry (Priority: P1, release 1)

**Acceptance Scenarios**:

1. **Given** a company member, **When** the account navigation is shown, **Then** it has exactly
   one address entry, "Adresy organizacji" / "Organization addresses", and no "Moje adresy".
2. **Given** a company member, **When** he opens `/addresses`, **Then** he is redirected to
   `/organization/addresses`.

### User Story 5 — The operator sees the book the customer orders from (Priority: P2, release 1)

**Acceptance Scenarios**:

1. **Given** any customer, **When** an operator opens the customer's addresses card, **Then** it
   lists the customer's Organization book read-only, with no add form.
2. **Given** a B2C customer with a row the job refused, **When** the card is shown, **Then** that
   row is listed with its reason. In release 2 the row no longer exists (see FR-016).

### User Story 6 — The personal book's table is dropped, safely (Priority: P1, release 2)

**Acceptance Scenarios**:

1. **Given** an installation that ran release 1's job to completion, **When** it migrates to
   release 2, **Then** `customer_addresses` no longer exists.
2. **Given** an installation with any live personal-book row, **When** it migrates to release 2,
   **Then** the migration refuses. It reports the count and points to the upgrade note, and it
   removes nothing.

### Edge Cases

- **`customers` is switched off during release 1**: the job does not run, and every address page
  and checkout keep working, because `nonDeactivatable` modules serve them. Release 2's migration
  refuses until the operator switches `customers` on and lets the job finish. The upgrade note
  says so.
- **The job has not yet run** for a B2C customer: her pre-upgrade rows are not yet in the one list.
  The window is from the boot until the job's first run, and the upgrade note documents it.
- **An org-less account** (legacy data from before `specs/051-*`, invalid under Principle XI): it
  has no address page. `/addresses` redirects it to `/account`.
- **Checkout creates a new row for every typed address**: this is today's behaviour, unchanged, and
  is tracked as a follow-up.

## Requirements *(mandatory)*

### Functional Requirements

**Release 1**

- **FR-001**: For a customer whose Organization is personal, "Moje adresy" / "My addresses"
  (`/addresses`) MUST show the personal Organization's book and nothing else. *(OD-1)*
- **FR-002**: On that page the customer MUST be able to add addresses, remove them, and set the
  default delivery and billing address. Checkout MUST reflect each change on its next load.
- **FR-003**: An address that customer types at checkout MUST appear on "Moje adresy".
- **FR-004**: A company member MUST be offered one address entry, the company's book, and
  `/addresses` MUST redirect them to it. *(OD-11)*
- **FR-005**: Every former personal-book endpoint MUST answer `410 Gone` with
  `CUSTOMER_ADDRESS_BOOK_RETIRED`, for every caller. The message MUST be in Polish or English.
  *(OD-5, OD-8)*
- **FR-006**: A one-time `customers` job MUST move every live B2C personal-book row into the
  personal Organization's book. It MUST NOT create duplicates (equality as in `plan.md` R-4), MUST
  keep an existing Organization default, MUST soft-delete each source row with a link to its new
  row, and MUST be idempotent and resumable. *(OD-2)*
- **FR-007**: The same job MUST erase every live non-B2C personal-book row (company members and
  org-less accounts): blank its personal fields and soft-delete it. *(OD-9)*
- **FR-008**: A row the Organization book's owner refuses MUST stay live, marked with the reason,
  and MUST be visible to the operator only.
- **FR-009**: Every moved, erased or refused row MUST leave an audit entry (Principle XIII).
- **FR-010**: `GET /api/v1/me/customer/defaults` MUST report the default addresses of the
  customer's Organization book. In release 1, a `PUT` that sets an address default MUST answer as
  in FR-005.
- **FR-011**: A personal Organization's member MUST be able to create, update and delete addresses
  through `/api/v1/organizations/mine/addresses`. No new permission is added. *(OD-4)*
- **FR-012**: The admin addresses card MUST list the customer's Organization book read-only, plus
  any refused rows with their reason. *(OD-6)*
- **FR-013**: When the retention sweep scrubs a B2C customer's personal Organization, every address
  of that Organization MUST be soft-deleted **and** its personal fields blanked. Order snapshots
  are untouched. *(OD-7)*
- **FR-014**: The published `CustomerAddressReadPort` and `quick_order`'s use of it MUST be
  removed. #769 is a prerequisite.
- **FR-015**: Every new user-facing string MUST ship in Polish and English.

**Release 2**

- **FR-016**: A `customers` migration MUST drop `customer_addresses`. It MUST refuse to run while
  any live row exists, refused rows included, and MUST report the counts and point to the upgrade
  note. It MUST read no other module's table. *(OD-12 as amended by OD-13)*
- **FR-017**: The remaining personal-book code MUST be removed: the entity, the job, the 410 stub
  routes, the error code and the contract schemas (see `plan.md` § Release 2).
- **FR-018**: The upgrade note MUST say that an installation passes through release 1, with
  `customers` on and the job finished, before release 2.

### Key Entities

- **Organization address** (`addresses`): the one book for every customer. It has no schema
  change, and gains the port method `anonymizeForOrganization` (OD-7).
- **Customer address** (`customer_addresses`): in release 1 it gains the columns
  `merged_into_address_id`, `merged_at` and `merge_refusal`. Release 2 drops it.

## Owner decisions

The arguments and the rejected alternatives are in `plan.md` § Decisions. Each ruling becomes a
`D-nnn` in the ruling record, numbered above the floor in `specs/pre-migration-history/README.md`.

| # | Question | Ruling |
| --- | --- | --- |
| **OD-1** | Which book is canonical for a personal Organization | **Resolved 2026-11-05, as recommended**: the personal Organization's book. |
| **OD-2** | What happens to existing B2C personal-book rows | **Resolved 2026-11-05**: an automatic one-time move, with no duplicates, the Organization default kept, and each source row soft-deleted with a link to its new row. It was briefly superseded, and was **reinstated 2026-11-05 by OD-13**. It runs in release 1. |
| **OD-3** | What role the personal book keeps for company members | **Resolved 2026-11-05, changed from the recommendation**: the book is retired for everyone. |
| **OD-4** | Permissions | **Resolved 2026-11-05, as recommended**: no new permission. |
| **OD-5** | Personal-book writes after the merge | **Resolved 2026-11-05**: refused for everyone, with the code from OD-8. |
| **OD-6** | The admin addresses card | **Resolved 2026-11-05, as recommended**: read-only. Admin editing of Organization addresses is a separate follow-up. |
| **OD-7** | Anonymisation | **Resolved 2026-11-05, as recommended**: the addresses are cleared **and** blanked. |
| — | Rows refused during the move | **Resolved 2026-11-05**: visible to the operator only. |
| **OD-8** | Code and status of the refusal | **Resolved 2026-11-05, as recommended**: `410 Gone`, `CUSTOMER_ADDRESS_BOOK_RETIRED`, for everyone. |
| **OD-9** | Non-B2C rows | **Resolved 2026-11-05**: deleted at once. The owner states that none exist on demo or production. The release-1 job erases them. |
| **OD-10** | Notice period | **Resolved 2026-11-05**: not needed. |
| **OD-11** | "Moje adresy" for a company member | **Resolved 2026-11-05, as recommended**: one "Adresy organizacji" entry, and `/addresses` redirects there. |
| **OD-12** | When the table and the code are removed | **Resolved 2026-11-05 ("this release"); amended 2026-11-05 by OD-13**: in release 2. |
| **OD-13** | A guarded drop alone, or the move first | **Resolved 2026-11-05**: two releases. Release 1 retires the book and runs the move job, which moves B2C rows and erases the rest. Release 2 runs the guarded drop and removes the remaining code. |

No owner decision is open.

## Success Criteria *(mandatory)*

- **SC-001**: For every customer, the addresses on their one address page are the addresses
  checkout offers. A test asserts this in both languages.
- **SC-002**: After release 1's job, no live, unrefused row remains in `customer_addresses`.
- **SC-003**: After release 2, `customer_addresses` does not exist on any installation that
  completed its upgrade.
- **SC-004**: In release 1 every former personal-book endpoint answers `410`. In release 2 those
  routes no longer exist.

## Assumptions

- The owner's statement (2026-11-05): company members have no personal-book rows on demo or
  production. The local development database holds none (`plan.md` § Counting).
- #769 merges before release 1.
- The worker process runs in every deployment that runs the storefront.
- Every transacting customer has an Organization (Principle XI). `OrganizationRecord.isPersonal`
  is the one test of "B2C".
