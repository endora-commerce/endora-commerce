# Feature Specification: Tax-ID scope, personal organizations without a tax ID, and personal-to-company conversion

**Feature Branch**: `spec/177-tax-id-scope`
**Created**: 2026-11-10
**Status**: Draft — scope accepted by the owner on 2026-11-10 (instance-extensibility rulings: tax-ID
scope option in core, removal of the synthetic personal tax ID in the same release, operator-only
personal → company conversion). One release, labelled **breaking change**.
**Input**: "Tax-ID uniqueness modes `global` (default) and `per-tree-root`, enforced by the database
and chosen by an audited operator command; lookups by tax ID that return every match; personal
organizations stop carrying a synthetic tax ID; an operator can convert a personal organization into
a company organization."

Related work: `specs/176-command-hooks-outbox/` (registration becomes one Command — this feature's
registration changes sit on it, see `plan.md` *Delivery*), `specs/178-extensible-columns/`
(independent), open PR #990 (`organizationCustomFieldWritePort`). The feature changes only what the
`organizations` module owns, plus the readers of `Organization.taxId` listed in
`contracts/personal-tax-id-removal.md` §3.

## Vocabulary

- **Company organization** — an Organization with `isPersonal = false`. It always has a tax ID.
- **Personal organization** — the single-member Organization a B2C customer gets
  (`specs/051-*`, cited). From this feature on it has **no** tax ID.
- **Tree / root** — an Organization and its descendants (feature 056, `organization-hierarchy.md`).
  The root is the ancestor with no parent; a root's tree contains itself.
- **Tax-ID scope** — the rule that decides where the same tax ID may appear twice: `global` (nowhere)
  or `per-tree-root` (only inside one tree).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A deployment lets branches share the head office's tax ID (Priority: P1)

A platform operator runs a B2B store where a company's branches are separate Organizations under its
head office and legally share the head office's tax ID. They switch the tax-ID scope to
*one tree per tax ID*. From then on they can create a branch under the head office with the head
office's tax ID, invoices and quote documents for the branch print the real tax ID, and two unrelated
companies still cannot share one.

**Why this priority**: it is the business need the owner ruled on; without it a deployment must store
a fake key in the tax-ID field and print it on legal documents.

**Independent Test**: switch the scope, create a head office and a branch with one tax ID under it,
then try the same tax ID on an unrelated root — the first succeeds, the second is refused with a
clear message; switch back to *global* — refused while the branch shares the tax ID.

**Acceptance Scenarios**:

1. **Given** a fresh or upgraded installation, **When** an operator opens *Tax-ID scope*, **Then** it
   shows *Global — every tax ID belongs to one organization* as the current mode.
2. **Given** scope `global` and an organization with tax ID X, **When** an operator creates another
   organization with X (with or without a parent), **Then** it is refused with
   `409 ORGANIZATION_TAX_ID_EXISTS`.
3. **Given** a platform administrator holding the scope permission, **When** they switch to
   `per-tree-root` and confirm, **Then** the mode changes, one audit entry records `global →
   per-tree-root`, and the database now enforces the tree rule.
4. **Given** scope `per-tree-root` and a root organization R with tax ID X, **When** an operator
   creates an organization with X under R (or under any descendant of R), **Then** it is created.
5. **Given** scope `per-tree-root` and R with tax ID X, **When** anyone creates a **root**
   organization with X (admin create without parent, or self-registration), **Then** it is refused
   with `409 ORGANIZATION_TAX_ID_EXISTS`.
6. **Given** scope `per-tree-root` and a branch B under R sharing X, **When** an operator detaches B
   to a root or moves it under another tree, **Then** it is refused with
   `409 ORGANIZATION_TREE_INVALID` (token `tax_id_shared_across_trees`) and nothing changes.
7. **Given** scope `per-tree-root` and at least one tax ID on two organizations, **When** an operator
   switches back to `global`, **Then** it is refused with `409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES`,
   the screen lists how many tax IDs are shared and links up to 20 of them, and nothing changes.
8. **Given** two concurrent requests that would each be valid alone but together put X into two
   trees, **When** both commit, **Then** exactly one succeeds and the other receives the same 409 a
   pre-check would have given — never a 500.
9. **Given** a scoped administrator (one whose reach is not the whole platform) holding the scope
   permission, **When** they try to change the mode, **Then** it is refused `403`.

---

### User Story 2 — Personal organizations carry no tax ID (Priority: P1)

A B2C customer's personal organization no longer stores an invented tax ID. Every screen, document,
search and API that shows a tax ID shows none for it, and the platform still finds "the customer's own
personal organization" reliably.

**Why this priority**: the owner ruled it into the same release; it removes the last reason anything
could print a fake tax ID, and makes `taxId` honest in the API. It is the breaking part of the release.

**Independent Test**: upgrade a database holding personal organizations; every personal row has an
empty tax ID, `GET /api/v1/me` for a B2C customer returns `taxId: null`, a B2C order placed afterwards
has no billing tax ID, and unassigning a member from a company still lands them in their own personal
organization.

**Acceptance Scenarios**:

1. **Given** an upgraded database, **When** the migration has run, **Then** no personal organization
   has a tax ID and every company organization still has its own.
2. **Given** a new B2C sign-up, **When** its personal organization is provisioned, **Then** it has no
   tax ID; provisioning twice for the same account returns the same organization.
3. **Given** a customer who belongs to a company, **When** an operator unassigns them, **Then** they
   are moved to their **own** personal organization (the one that existed before, if any).
4. **Given** a personal organization, **When** an operator requests a VAT validation for it, **Then**
   it is refused `422 VALIDATION_FAILED` ("This organization has no tax ID") and no validation row is
   written.
5. **Given** any API that returns an organization, **When** the organization is personal, **Then**
   `taxId` is `null` (never an empty string, never a placeholder).
6. **Given** orders, invoices and audit entries written before the upgrade, **When** they are read,
   **Then** they are unchanged (no historical document is rewritten).

---

### User Story 3 — An operator converts a personal organization into a company (Priority: P2)

A customer who shopped as an individual starts a business. The operator opens the customer's personal
organization, chooses *Convert to company*, enters the company name, tax ID and registered address,
and confirms. The organization keeps its id, orders, carts, addresses and prices; from now on it can
have members and roles. The customer cannot do this themselves.

**Why this priority**: useful, but no deployment is blocked without it.

**Independent Test**: convert a personal organization that has an order; the organization page now
shows *Company*, a Members and a Roles tab, the former owner is its *Administrator*, the old order is
still there, and no storefront or customer API can trigger a conversion.

**Acceptance Scenarios**:

1. **Given** an operator holding `organizations:convert-to-company` and a personal organization in
   reach, **When** they open its page, **Then** a *Convert to company* button is shown; without the
   permission, or on a company organization, it is not.
2. **Given** the dialog, **When** they submit a valid name, tax ID, registered address and VAT status,
   **Then** in one transaction the organization becomes a company with those values, its id is
   unchanged, its member holds *Administrator*, one audit entry is written, and after commit
   `organization.converted_to_company.v1` is emitted once.
3. **Given** the submitted tax ID is already used where the active scope forbids it, **When** they
   submit, **Then** it is refused `409 ORGANIZATION_TAX_ID_EXISTS` and nothing changes.
4. **Given** the operator ticked *Validate the tax ID after converting*, **When** the conversion
   commits, **Then** a VAT validation runs through the existing validation flow and its outcome is
   shown; a failed or deferred validation does not undo the conversion.
5. **Given** a company organization, a deleted or anonymised personal organization, **When**
   conversion is requested, **Then** it is refused `409 ORGANIZATION_CONVERSION_REFUSED` with the
   token `not_personal`, `deleted` respectively.
6. **Given** the command palette, **When** an operator with the permission types "convert to
   company", **Then** an action opens the *Convert personal organization* screen where they pick a
   personal organization and fill the same form.
7. **Given** any storefront, customer or public route, **When** a request tries to
   convert, **Then** no such route exists (`404`) and a test enumerating every registered non-admin
   route proves none reaches the conversion command.
8. **Given** a converted organization, **When** a return is filed for an order placed **before** the
   conversion, **Then** it is classified as the consumer's withdrawal exactly as it would have been
   before the conversion.
9. **Given** a converted organization, **When** anyone asks to convert it back, **Then** there is no
   such operation.

---

### User Story 4 — Integrators look an organization up by tax ID (Priority: P3)

Server code (an ERP import, an overlay module) asks "which organization has this tax ID?" and gets an
answer that is right in both scopes: every match, the root first, or a single resolved target.

**Independent Test**: in `per-tree-root` with a head office and two branches on X, `findByTaxId(X)`
returns three records, root first; `resolveByTaxId(X)` returns `one` with the root.

**Acceptance Scenarios**:

1. **Given** no organization with X, **Then** `findByTaxId(X)` is `[]` and `resolveByTaxId(X)` is
   `{ kind: 'none' }`.
2. **Given** scope `global` and one organization with X, **Then** both answer that organization.
3. **Given** scope `per-tree-root`, a root R and descendants on X, **Then** `findByTaxId(X)` lists R
   first and the rest by depth, then creation time, then id; `resolveByTaxId(X)` is
   `{ kind: 'one', organization: R }`.
4. **Given** an input with spaces, dashes or lower case, **Then** it is normalised exactly as the
   admin and registration boundaries normalise it before the lookup.

### Edge Cases

- **Soft-deleted organizations keep their tax ID** for uniqueness, as today; `findByTaxId` excludes
  them unless asked (`includeDeleted`).
- **A branch whose head office is soft-deleted** still shares the tree; the root is the stored path's
  first segment, deleted or not.
- **Moving a whole subtree** whose members share X into another tree that has no X is allowed; the
  check is per tax ID, across the whole moved subtree, not per node.
- **Switching to `per-tree-root` twice** is a no-op the second time (no audit entry, enforcement
  re-asserted).
- **The scope command fails half-way** (DDL error, lost connection): the policy row and the database
  enforcement change together or not at all.
- **A database whose policy row and enforcement disagree** (hand-edited): boot logs an error naming
  both, and re-running the command for the intended mode repairs it.
- **A personal organization with no live member** (retention sweep) is refused conversion with
  `deleted` once it is anonymised; before that it converts like any other.
- **A personal organization whose member does not hold *Administrator*** (an invariant breach of
  `specs/170-organization-roles/` FR-070a): conversion is refused with `owner_not_administrator`
  rather than silently producing a company with no administrator.
- **Personal rows whose stored tax ID is not the 32-hex placeholder** (hand-made test data): the
  migration clears the tax ID anyway and leaves the account link empty; the count is logged.
- **Registration in `per-tree-root` with a head office's tax ID** is refused, not joined — joining a
  company is a separate, later decision (join request).

## Requirements *(mandatory)*

### Functional Requirements

**Personal organizations without a tax ID**

- **FR-001**: A personal organization MUST store no tax ID, and a company organization MUST store one;
  the database MUST refuse any row breaking either half.
- **FR-002**: The upgrade MUST clear the tax ID of every existing personal organization and MUST keep,
  for each, a durable link to the customer account it was provisioned for, derived from the old
  placeholder.
- **FR-003**: Personal-organization provisioning MUST stay idempotent per customer account, and "the
  account's own personal organization" (the unassign destination) MUST keep resolving to the same
  organization, by that link rather than by tax ID.
- **FR-004**: Every published organization shape MUST type the tax ID as `string | null`
  (`organizationSchema`, `OrganizationRecord`, `/api/v1/me`, admin organization responses, picker
  rows), `null` for a personal organization; the change MUST ship as a breaking changeset.
- **FR-005**: Every reader of an organization's tax ID listed in
  `contracts/personal-tax-id-removal.md` §3 MUST handle `null` — a printed document, e-mail or screen
  omits its tax-ID line, a search treats it as no match, an exact lookup never matches it.
- **FR-006**: A VAT validation MUST be refused for an organization with no tax ID, before any
  provider is called.
- **FR-007**: Orders, invoices, quote documents and audit entries written before the upgrade MUST NOT
  be rewritten.

**Tax-ID scope**

- **FR-010**: The platform MUST offer exactly two tax-ID scopes, `global` and `per-tree-root`, and
  MUST start every fresh and upgraded installation in `global`.
- **FR-011**: In `global` a tax ID MUST belong to at most one organization (soft-deleted included).
- **FR-012**: In `per-tree-root` a tax ID MAY belong to several organizations only when they all have
  the same root.
- **FR-013**: Both rules MUST be enforced by the database, so that no concurrency, import path or
  future write path can break them.
- **FR-014**: The scope MUST change only through the audited command `organization.tax_id_scope.set`,
  which MUST change the stored scope and the database enforcement in one transaction.
- **FR-015**: Switching to `global` MUST be refused while any tax ID belongs to more than one
  organization; the refusal MUST carry the number of shared tax IDs and up to 20 of them with their
  organizations.
- **FR-016**: Setting the scope already in force MUST change nothing, record no audit entry, and
  re-assert the database enforcement for that scope.
- **FR-017**: Only an unscoped platform administrator holding `organizations:manage-tax-id-scope` MAY
  read or change the scope.
- **FR-018**: Admin creation of an organization MUST accept an optional parent, so that a branch can
  be created under its head office with the head office's tax ID in `per-tree-root`; naming a parent
  MUST require an unscoped platform administrator (D-260's rule for parentage).
- **FR-019**: Creation (admin and self-registration) MUST be refused `409 ORGANIZATION_TAX_ID_EXISTS`
  when the tax ID exists anywhere the active scope forbids.
- **FR-020**: Set-parent and move MUST be refused `409 ORGANIZATION_TREE_INVALID` with the token
  `tax_id_shared_across_trees` when the result would put one tax ID into two trees.
- **FR-021**: A database refusal of either rule — unique violation (`23505`) or exclusion violation
  (`23P01`), whether raised at a statement or at commit — MUST be answered with the same 409 the
  pre-check gives at registration, admin create, set-parent, move and conversion, never a 500.
- **FR-022**: Registration with a tax ID that already resolves to an organization MUST be refused in
  both scopes; the registration conflict policy MUST be `refuse`, the only policy this release offers.
- **FR-023**: The organizations module MUST publish `findByTaxId(taxId)` — every live match, root
  first, then by depth, creation time and id — and `resolveByTaxId(taxId)` → `none` | `one` (the root)
  | `ambiguous`, on its read port; `ambiguous` MUST be unreachable in both scopes and typed for later
  scopes.
- **FR-024**: Every internal exact lookup by tax ID (registration, admin create, demo seed and reset)
  MUST go through those two functions.
- **FR-025**: The admin MUST offer a *Tax-ID scope* screen showing the current mode, what each mode
  means, and the number of shared tax IDs, reachable from the Organizations area and from a ⌘K action,
  in English and Polish.
- **FR-026**: Every write path MUST read the scope from the database inside its own transaction, so no
  process acts on a stale scope after a change.
- **FR-027**: CI MUST run the organizations backend suites once in each scope.

**Personal → company conversion**

- **FR-030**: An operator MUST be able to convert a personal organization into a company
  organization, supplying name, optional legal name, tax ID, registered address and VAT status.
- **FR-031**: Conversion MUST be reachable only through an admin route gated by
  `organizations:convert-to-company` and the organization's reach, and through the published server
  port `organizationCommandPort.convertToCompany`; no storefront, customer or public route MAY reach it,
  and a test MUST prove that over every registered route.
- **FR-032**: Conversion MUST run as one Command, `organization.convert_to_company`, in one
  transaction, keeping the organization's id.
- **FR-033**: Conversion MUST check the tax ID in the active scope and refuse a conflict exactly as
  registration does.
- **FR-034**: Conversion MUST be refused unless the organization is personal, not deleted and not
  anonymised, and its member (if any) holds *Administrator*.
- **FR-035**: After conversion the organization MUST have both predefined roles, its member MUST hold
  *Administrator*, and member and role management MUST be offered for it.
- **FR-036**: Conversion MUST clear the organization's link to the personal account, so that a later
  unassign of that member provisions a new personal organization.
- **FR-037**: Conversion MUST keep the organization's status and MUST stamp it approved by the acting
  operator when it carries no approval yet.
- **FR-038**: The operator MAY request a VAT validation with the conversion; it MUST run after the
  commit through the existing validation flow, and its failure MUST NOT undo the conversion.
- **FR-039**: Conversion MUST record when it happened and MUST emit
  `organization.converted_to_company.v1` once, after commit, never on rollback.
- **FR-040**: A return filed for an order placed before the conversion MUST be classified as a
  consumer withdrawal exactly as before the conversion.
- **FR-041**: There MUST be no reverse conversion.
- **FR-042**: The organization page MUST show *Convert to company* for a personal organization to an
  operator holding the permission; a ⌘K action MUST open a conversion screen with a picker of personal
  organizations; both in English and Polish.

**Cross-cutting**

- **FR-050**: Every new permission code MUST be declared in the manifest and labelled in English and
  Polish; every new error code and token MUST be declared and carry a sentence in both languages.
- **FR-051**: The audit entries MUST follow `specs/conventions/audit-state.md`: the conversion records
  field names, booleans and codes, never the name, tax ID or address; the scope command records the
  two mode codes.
- **FR-052**: The organizations documentation (`organizations.md`, `organization-hierarchy.md`) MUST
  describe the scopes, the conversion and the null tax ID, in English and Polish.
- **FR-053**: The release MUST carry a breaking changeset for `@endora-commerce/contracts` and
  `@endora-commerce/organizations` giving the old and the new types, and the upgrade note MUST say
  that historical documents keep the placeholder.

### Key Entities

- **Organization** — gains a nullable tax ID, a link to the personal account (personal rows only), the
  derived root, and the time it was converted to a company.
- **Tax-ID policy** — one record per installation: the current scope, when and by whom it was set.

## Success Criteria *(mandatory)*

- **SC-001**: After the upgrade, zero personal organizations hold a tax ID, and zero company
  organizations lack one (database query).
- **SC-002**: In `per-tree-root`, a branch is created under its head office with the head office's tax
  ID in one operator step, and its order, invoice and quote document print that tax ID.
- **SC-003**: Under a concurrency test of 50 paired conflicting writes per path (registration, create,
  set-parent, move, conversion), every loser receives a 409 and none a 500.
- **SC-004**: The organizations backend suites pass in both scopes in CI.
- **SC-005**: No storefront or customer route reaches the conversion command (route-enumeration test
  green).
- **SC-006**: A conversion completes for the operator in one dialog without leaving the organization
  page.

## Assumptions

- The tax-ID **format** rules do not change (8–32 characters, the admin boundary strips whitespace and
  dashes).
- `organizations` stays non-deactivatable, so no off-state path exists for any surface here.
- No consumer outside `organizations` branches on `isPersonal` for pricing, credit limits or sales
  channels today (verified on `origin/master` 2cc56ea9b, `research.md` R-12); the only module whose
  answer would silently change on conversion is `returns`.
- Joining an existing company at registration (join request) is a later feature; this release only
  refuses.
