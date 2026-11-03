# Feature Specification: Organization roles and permissions

**Feature Branch**: `spec/organization-roles`
**Created**: 2026-11-03
**Status**: Draft — owner rulings OR-1 to OR-8 recorded 2026-11-03; oracle rulings PR-3 to PR-12 (`plan.md`) recorded 2026-11-03 from the WP-00 oracle (#689); no open questions; `plan.md` and `tasks.md` merged (#683), implementation not started
**Input**: Owner request (translated from Polish): *"Customers should be able, within their
Organization, to define their own Roles and assign them to Organization Members. Roles carry
permissions over the actions an Organization member can perform. The Organization Administrator
can do everything. Only two roles are predefined: Organization Administrator and Organization
Member (User). Permissions that can be granted to roles: creating RFQs, approving RFQs, creating
carts, approving carts, creating shopping lists, converting shopping lists into RFQs and orders.
Admin UI users already have such a mechanism; model it on that, with the difference that these
permissions are dedicated to Organization Members only."*

**Related**: `specs/026-admin-roles-permissions/` (pre-migration, cited as the operator-side
precedent; its contract survives as `packages/modules/admin_roles/` and
`specs/conventions/module-admin-surfaces.md`), feature 027 cart approval (pre-migration; today's
behaviour is in `packages/modules/carts/docs/carts.md` § *Lifecycle*), feature 056 organization
hierarchy and roll-up (pre-migration; `packages/modules/organizations/docs/organization-hierarchy.md`),
`specs/154-sales-channel-access/` (the per-Organization cache whose obligations — bounded staleness,
write-path drop, never fall open — this feature's permission reads meet; the mechanism is a
per-process cache with a pub/sub drop, `research.md` R-16), issues #619 (merged in #647), #648, #649,
#650, #651, **#653**, **#665** (clone-to-quote order scope), **#667** (invitation role label),
**#668** (organization addresses).

**Design decisions and rejected alternatives**: [`research.md`](./research.md). This file states
behaviour; `research.md` states why, and what the plan has to build.

## Context

Inside a customer Organization there are exactly two kinds of person today: an
**Organization administrator** and a **regular user**. The difference is hard-wired: about sixty
places across eleven modules and the storefront ask *"is this account `organization_admin`?"* and
branch on the answer (inventory in *Impact*). An administrator manages members and invitations,
sees every colleague's orders, quote requests and carts, sets the Organization's cart-approval and
MFA policies, and approves or rejects colleagues' carts. A regular user can do everything a buyer
does — build carts, check out, request quotes, keep shopping lists, buy with one click — for
themselves only. When the Organization switches on *requires cart approval*, every regular user's
cart has to be approved by an administrator before it can be ordered; the administrator's own cart
never does.

That is too coarse for a real purchasing department. A company wants *a buyer who may prepare
carts but not order them*, *a purchasing manager who approves carts but does not manage the team*,
*a warehouse clerk who keeps shopping lists but never commits money*. None of that can be said
today: the only lever is the Organization-wide approval switch, and the only approver is the
administrator.

This feature lets an Organization's administrator define **roles**, choose what each role may do
from a list of **organization permissions**, and give each member one role. The two roles the
platform has always had stay, predefined: **Administrator** (everything, cannot be changed) and
**Member** (editable — it starts out as exactly what a regular user may do today, so nothing
changes for anyone on upgrade).

Organization permissions are a **customer-side** vocabulary, separate from the permissions an
operator holds in the Admin UI. They are declared by the module whose action they gate, so a module
that is switched off takes its permissions off the role editor and a module that is detached takes
them away entirely.

## Owner rulings *(binding; recorded 2026-11-03, not to be reopened by this feature)*

- **OR-1 — One-click purchase is a permission of its own.** The quick-order module declares a
  dedicated organization permission for one-click purchase. A member whose role holds it may use
  one-click buy; a member whose role does not cannot — the one-click eligibility answers *disabled*
  with a reason, and the storefront hides the button. This is how issue **#653** (one-click buy
  bypasses cart approval) is resolved; #653 is otherwise left unfixed until this feature lands.
- **OR-2 (Q-1) — "Approving RFQs" is an internal approval before the request reaches the seller.**
  Option B, mirroring carts: a member whose role lacks **"Send quote requests without approval"**
  (`quote_requests.send_without_approval`) submits into a state *awaiting internal approval* that
  the seller does not see; a holder of **"Approve quote requests"** approves (the request is then
  sent to the seller) or rejects it with a reason. FR-040–FR-046.
- **OR-3 (Q-2) — The Organization's *requires cart approval* switch is replaced** by the permission
  **"Place orders without approval"** (`carts.order_without_approval`). Anyone whose role holds
  **"Approve carts"** may approve, not only the administrator. The switch and its two screens are
  removed. `research.md` R-4.
- **OR-4 (Q-3) — No versioning and no compatibility window.** The project is still at a stage where
  it may break freely: the legacy `role` field is removed from every request and response in the
  same release that introduces roles, and there is no removal phase. FR-073, *Upgrade note*,
  `research.md` R-8.
- **OR-5 (Q-4) — "View the organization's orders" is a permission now**
  (`orders.view_organization`), grantable to any role, held implicitly by *Administrator*, not
  member-default. It is not on the reserved list. Every path that reaches a colleague's order honours
  it, including clone-to-quote (issue **#665**, being fixed separately: it skipped the order scope and
  defaulted `isOrgAdmin ?? true`). FR-013, FR-049.
- **OR-6 (Q-5) — One-click purchase also requires "Place orders without approval".** FR-050.
- **OR-7 (Q-6) — Operator codes** `organizations:read-roles` (*View organization roles*) and
  `organizations:manage-roles` (*Manage organization roles*), owned by `organizations`; assigning a
  role to a member stays under `customers:manage`. FR-060–FR-062.
- **OR-8 (Q-7) — Managing the Organization's addresses is a permission** (#668):
  `addresses.manage` (*Manage organization addresses*), declared by the `addresses` module (the
  owner of the write behind `addressServicePort`), held implicitly by *Administrator*,
  **member-default** so nothing changes on upgrade, revocable per Organization by removing it from a
  role, and enforced on the `organizations` address routes
  (`packages/modules/organizations/src/backend/routes.customer.ts`). Reading addresses stays open to
  every member. FR-014a.

## Resolved questions *(kept for the record; rulings above)*

- **Q-1** — Options were A (act on colleagues' RFQs), B (internal approval before sending), C
  (committing to the seller's quote needs approval). Recommendation B. **Resolved 2026-11-03: B (OR-2).**
- **Q-2** — Replace the switch with a permission. Recommendation yes. **Resolved 2026-11-03: yes (OR-3).**
- **Q-3** — Contract change shipping. Recommendation was one release of overlap. **Resolved
  2026-11-03: no versioning, no window; `role` removed in the same release (OR-4).**
- **Q-4** — Colleagues' orders. Recommendation was Administrator-only for now. **Resolved
  2026-11-03: a grantable `orders.view_organization` permission now (OR-5).**
- **Q-5** — One-click also needs "Place orders without approval". Recommendation yes. **Resolved
  2026-11-03: yes (OR-6).**
- **Q-6** — Operator codes. Recommendation two new codes. **Resolved 2026-11-03: as recommended (OR-7).**
- **Q-7** — Organization addresses (#668). Options were A (`addresses.manage`, member-default),
  B (the same, not member-default), C (no permission). Recommendation A. **Resolved 2026-11-03: A (OR-8).**

## User Scenarios & Testing *(mandatory)*

*Priority* on a user story (P1, P2, P3) ranks the story's importance; it is **not** the delivery
phase. The delivery phases are the P1+P2 release and P3 (internal RFQ approval, OR-2), defined by
FR-022's *Phase* column and `plan.md` § *Delivery model*. Every user story here is delivered in the
P1+P2 release — including User Story 8 (Priority: P3), whose behaviour FR-007 and FR-025 require
there; P3 adds FR-040–FR-046, which no user story below covers.

### User Story 1 — An administrator defines a role and gives it to a member (Priority: P1)

Anna administers *Acme Sp. z o.o.* on the storefront. She opens **Organization → Roles**, creates
a role *Junior buyer*, ticks *Create carts* and *Create shopping lists* and nothing else, and saves.
On **Organization → Members** she changes Piotr's role from *Member* to *Junior buyer*. Piotr can
now build carts and keep lists but must send every cart for approval and cannot request quotes.

**Why this priority**: it is the feature. Without it no other story has anything to configure.

**Independent Test**: as an administrator create a role with a chosen subset, assign it, sign in as
the member and confirm over HTTP that every gated action outside the subset is refused and every
one inside it succeeds.

**Acceptance Scenarios**:

1. **Given** an administrator on the Roles screen, **When** she creates *Junior buyer* with two
   permissions, **Then** the role is listed with those two permissions and no members, and an audit
   entry names her, the role and the permissions granted.
2. **Given** *Junior buyer* exists, **When** the administrator assigns it to Piotr, **Then** Piotr's
   next request is judged by *Junior buyer*'s permissions, the members list shows his new role, and
   an audit entry records the old and the new role.
3. **Given** Piotr holds *Junior buyer* (no *Create quote requests*), **When** he tries to request a
   quote — from scratch, from his cart or from a shopping list — **Then** each is refused with a
   message naming the missing permission, and the storefront does not offer those buttons.
4. **Given** a role name already used in the Organization (case-insensitive), **When** the
   administrator creates another role with it, **Then** it is refused and nothing is created.
5. **Given** a member who is not the administrator, **When** they open the Roles or Members screen
   or call their endpoints, **Then** they are refused; role and member management are never
   grantable (FR-010).

---

### User Story 2 — Nothing changes for anybody on upgrade (Priority: P1)

An instance upgrades. Every existing Organization now has the two predefined roles; every former
`organization_admin` holds *Administrator*, every former `regular_user` holds *Member* (a personal
Organization's individual excepted: *Administrator*, FR-070a), every pending
invitation names the matching role, and *Member*'s permissions in each Organization reproduce what a
regular user of that Organization could do the day before — including whether their carts needed
approval.

**Why this priority**: a permission system that changes behaviour on upgrade is a regression in
every shop that did not ask for it.

**Independent Test**: seed Organizations with and without cart approval, members of both kinds and
pending invitations of both kinds; run the upgrade; replay one request per gated action per member
and compare the outcome with the pre-upgrade outcome. Every outcome is identical except the rows the
design deliberately changes, each listed by request with its old and new outcome — the #653 bypass
closed, the personal Organization's member now an administrator, refusal codes that now name the
permission, expired invitations no longer listed (FR-072).

**Acceptance Scenarios**:

1. **Given** an Organization that did not require cart approval, **When** the upgrade runs, **Then**
   its Member role holds every member-default permission including *Place orders without approval*
   and *One-click purchase*.
2. **Given** an Organization that required cart approval, **When** the upgrade runs, **Then** its
   Member role holds every member-default permission **except** *Place orders without approval* and
   *One-click purchase*, and every cart that was `pending` or `approved` before stays exactly so.
3. **Given** a pending invitation as `regular_user`, **When** the upgrade runs and the invitee later
   accepts, **Then** the new account holds *Member*.
4. **Given** a client that sends or reads the removed `role` field, **When** it runs against the
   upgraded instance, **Then** a request carrying `role` is refused as invalid and no response
   carries it (OR-4); the upgrade note tells the client author what to read and send instead.
5. **Given** an Organization member who was a `regular_user`, **When** the upgrade runs, **Then**
   they see only their own orders, as before — *Member* is not granted *View the organization's
   orders* (OR-5).
6. **Given** a personal (B2C) Organization whose individual was a `regular_user`, **When** the
   upgrade runs, **Then** they hold *Administrator*, and the storefront still offers them no
   Members, Roles or Carts-to-approve screen (FR-070a).

---

### User Story 3 — Anyone with "Approve carts" can approve, and approval follows the role (Priority: P1)

Acme gives its purchasing manager Ewa a role *Purchasing* with *Approve carts* and *Place orders
without approval*. Piotr (*Junior buyer*) submits his cart; Ewa sees it in **Organization → Carts**,
reviews it and approves; Piotr checks out. Anna, the administrator, can still approve too.

**Why this priority**: it is the business reason the owner gave for roles, and it retires an
Organization-wide switch that cannot express "some members need approval and some do not".

**Independent Test**: over HTTP, a member without *Place orders without approval* is offered
*Submit for approval* and is refused placement until approved; a member holding *Approve carts* lists,
approves and rejects it; a member holding neither is refused the approval endpoints.

**Acceptance Scenarios**:

1. **Given** a member whose role lacks *Place orders without approval*, **When** they open their
   cart, **Then** its primary action is *Submit for approval*, and placing an order from it before
   approval is refused (the #648 placement gate, judged by the permission).
2. **Given** a member whose role holds *Approve carts*, **When** they open the Organization's carts,
   **Then** they see the Organization's carts and may approve or reject a pending one; the approval
   e-mails (#651) go to the submitter and are sent on approval/rejection by whoever acted.
3. **Given** an approver who must themselves have carts approved, **When** they try to approve
   **their own** cart, **Then** it is refused; somebody else must approve it.
4. **Given** a role that gains *Place orders without approval*, **When** the change is saved,
   **Then** every `pending` cart of that role's members returns to *not required* and can be
   checked out directly — the behaviour switching the Organization policy off has today.
5. **Given** a role that loses *Place orders without approval*, **When** the change is saved,
   **Then** its members' unsent carts read *Submit for approval*, and an already `approved` cart stays
   approved (it was approved by someone entitled to).
6. **Given** a member holding neither *Approve carts* nor Administrator, **When** they call the
   organization carts endpoints, **Then** they are refused with `403`.

---

### User Story 4 — One-click purchase is a permission (Priority: P1)

Acme's *Junior buyer* role does not hold *One-click purchase*. On a product page Piotr sees no
one-click button; calling the one-click endpoint directly is refused. Ewa (*Purchasing*: holds
*One-click purchase* and *Place orders without approval*) buys with one click as before.

**Why this priority**: owner ruling OR-1; it is the resolution of #653, a live way round cart
approval.

**Independent Test**: over HTTP, the one-click eligibility answer and the one-click placement for
three members — holding the permission (and *Place orders without approval*), lacking it, holding it
but lacking *Place orders without approval* — and the storefront rendering for each.

**Acceptance Scenarios**:

1. **Given** a member whose role lacks *One-click purchase*, **When** the storefront asks for
   one-click eligibility, **Then** it answers disabled with reason *permission required* and the
   button is not rendered; a direct placement call is refused before any basket is written.
2. **Given** a member whose role holds *One-click purchase* but not *Place orders without approval*
   (OR-6), **When** eligibility is asked, **Then** it answers disabled with reason
   *cart approval required*.
3. **Given** a member holding both, **When** they buy with one click, **Then** the order is placed as
   today.

---

### User Story 5 — An invitation names the role (Priority: P2)

Anna invites a new colleague and picks *Purchasing* from the Organization's roles (default
*Member*). The invitation e-mail names the role. When the colleague accepts, they hold *Purchasing*.

**Why this priority**: without it every new member arrives as *Member* and has to be changed by
hand, but the feature works without it.

**Independent Test**: invite with a custom role, accept, read the new member's role.

**Acceptance Scenarios**:

1. **Given** the invite form, **When** the administrator opens the role list, **Then** it offers
   every role of the Organization, *Member* preselected.
1a. **Given** an invitation naming a role, **When** its e-mail is rendered, **Then** the role label is
   the role's own — the translated name of a predefined role in the e-mail's language, the custom
   role's name verbatim — and never a hard-coded English string (#667).
2. **Given** an invitation naming a custom role, **When** that role is deleted before acceptance,
   **Then** the invitation names the replacement role chosen at deletion (FR-024), and the
   invitee is told nothing has changed for them except the role.
3. **Given** an invitation naming *Administrator*, **When** it is accepted, **Then** the new member
   is an administrator (today's behaviour for an `organization_admin` invitation).

---

### User Story 6 — Deleting a role never leaves anyone without one (Priority: P2)

Anna deletes *Junior buyer*, which three members and one pending invitation hold. The dialog asks
which role they move to, with *Member* preselected. After confirming, the three members and the
invitation hold the chosen role and the audit log has one entry for the deletion and one per member
moved.

**Acceptance Scenarios**:

1. **Given** a role with members, **When** it is deleted, **Then** a replacement role must be named;
   the deletion and every reassignment happen together or not at all.
2. **Given** a role with no members and no invitations, **When** it is deleted, **Then** no
   replacement is asked for.
3. **Given** the *Administrator* or *Member* role, **When** someone tries to delete it, **Then** it is
   refused as protected.

---

### User Story 7 — The operator can see and repair an Organization's roles (Priority: P2)

A support operator opens the Organization in the Admin UI. A **Roles** tab lists its roles and their
permissions; the members tab shows each member's role. With the right operator permission the
operator edits a role, or reassigns a member, on the customer's behalf; the audit log says it was an
operator.

**Acceptance Scenarios**:

1. **Given** an operator holding `organizations:read-roles`, **When** they open the Roles tab,
   **Then** they see the roles read-only.
2. **Given** an operator holding `organizations:manage-roles`, **When** they edit a role, **Then** the
   same rules as on the storefront apply (protected roles, unique names, last-administrator
   protection) and the audit entry names the operator.
3. **Given** an operator lacking both, **When** they open the Organization, **Then** no Roles tab is
   shown and its endpoints answer `403`.

---

### User Story 8 — A switched-off module's permissions disappear, and come back (Priority: P3)

The operator switches `shopping_lists` off. Its two permissions vanish from every Organization's role
editor and from the members' effective permission lists; shopping-list actions are off anyway.
When the operator switches it back on, every role holds again exactly what it held before.

**Acceptance Scenarios**:

1. **Given** a module that is off, **When** an administrator opens the role editor, **Then** its
   permissions are not listed, and saving the role keeps their grants untouched.
2. **Given** the module switched back on, **When** a member acts, **Then** the grants held before
   apply again; nothing was lost.

### Edge Cases

- **Last administrator.** An Organization always has at least one active member holding
  *Administrator*. Changing the last one's role, removing, blocking or deleting them, or moving them
  to another Organization is refused — on the storefront and by the operator — with the existing
  `CANNOT_DEMOTE_LAST_ADMIN` / `CANNOT_REMOVE_LAST_ADMIN` refusals. The operator's existing
  *recover administrator access* action (promote a member) stays the repair for an Organization that
  has lost its administrator some other way.
- **Personal (B2C) organizations** have exactly one member, who holds *Administrator* — on upgrade
  and for every personal Organization created afterwards (FR-070a); they cannot invite (unchanged),
  so no Roles screen is offered there. What is hidden for a personal Organization is hidden because
  the Organization is personal, not because of the member's role.
- **Guests.** An anonymous visitor keeps the guest basket exactly as today; organization permissions
  judge signed-in members only (FR-030). When a visitor signs in, their guest basket is merged into
  their basket only if their role holds *Create and edit carts*; otherwise it is left unmerged and
  unchanged (FR-030a).
- **Organization hierarchy and roll-up.** Permissions are always those of the member's role in
  their own Organization. Roll-up (a head-office login acting across its subtree) widens *where* a
  permission reaches exactly as it widens the administrator's reach today; it never adds a
  permission.
- **Impersonation.** An operator impersonating a member acts with exactly that member's
  permissions.
- **A permission whose module is off** grants nothing; the module's own endpoints already answer
  "module disabled". A grant is retained, not removed (US 8).
- **A permission that is no longer declared by any installed module** (its module was uninstalled)
  is ignored when reading and dropped from a role the next time that role is saved.
- **Composite actions.** Converting a shopping list into a quote request needs *Convert shopping
  lists* **and** *Create quote requests*; into a cart, *Convert shopping lists* **and** *Create carts*.
  Converting a cart into a quote request needs *Create quote requests*. Converting an approved quote
  into a cart needs *Create carts*.
- **Concurrent edits.** Two administrators editing the same role: the second save is refused as
  stale rather than silently overwriting.
- **A member's role changes mid-session.** The next request is judged by the new role (FR-082); no
  sign-out is required.
- **External order API.** Orders placed by an API client bound to the Organization (not by a
  member) are not subject to organization permissions; they never were subject to cart approval and
  this feature does not change that (#653 asked for a ruling; this is the recommendation, recorded in
  `research.md` R-6).
- **Cart and audit wording.** A cart rejected by a non-administrator approver keeps the existing
  status value; only its label changes to "rejected by an approver".

## Requirements *(mandatory)*

### Functional Requirements

**Roles**

- **FR-001**: Every Organization MUST have exactly one *Administrator* role and exactly one *Member*
  role, created with the Organization and present for every existing Organization after upgrade.
- **FR-002**: The *Administrator* role MUST hold every organization permission, including any
  permission declared after it was created, and MUST NOT be editable, renamable or deletable.
- **FR-003**: The *Member* role's permissions MUST be editable by the Organization's administrator;
  it MUST NOT be deletable or renamable. Both predefined roles are displayed under their translated
  names (EN, PL).
- **FR-004**: An administrator MUST be able to create, rename, describe, edit the permissions of
  and delete custom roles. A role name MUST be 1–80 characters and unique within the Organization,
  ignoring case and surrounding whitespace. An Organization MAY hold at most 50 custom roles.
- **FR-005**: Roles MUST be Organization-scoped: a role is visible to, assignable in and evaluated
  for its own Organization only; any request naming another Organization's role MUST be answered as
  if the role did not exist (Principle XI).
- **FR-006**: Every member MUST hold exactly one role at all times; every pending invitation MUST
  name exactly one role.
- **FR-007**: A member's effective permissions MUST be exactly the permissions of their role whose
  declaring module is present (both activation axes), or every present permission for the
  Administrator role.
- **FR-008**: Wherever a role is shown to a person — the invitation e-mail, the members list, the
  account page, the operator's screens — its label MUST come from the role: the translated name of a
  predefined role in the reader's language, a custom role's own name verbatim (#667).

**Reserved administrator capabilities** *(never grantable; colleagues' orders are not on this list since OR-5)*

- **FR-010**: Managing members (changing roles, removing members), managing invitations and managing
  roles MUST be reserved to the *Administrator* role and MUST NOT be grantable to another role.
- **FR-010a** *(PR-7)*: The Organization's list of pending invitations MUST list only invitations
  that are neither accepted, revoked nor expired, and a role's count of pending invitations MUST
  count the same set (#689's oracle recorded expired invitations in the list).
- **FR-011**: Setting the Organization's MFA policy MUST stay reserved to the *Administrator* role.
- **FR-012**: Managing Organization-scoped one-click defaults for other members MUST stay reserved to
  the *Administrator* role.
- **FR-013**: *(Superseded by OR-5.)* Seeing every colleague's orders is **not** reserved; it is the
  grantable permission `orders.view_organization` (FR-049), held implicitly by *Administrator*.
- **FR-014**: Behaviour not gated by a permission in this feature MUST be unchanged for every role.
- **FR-014a** *(OR-8)*: Creating, editing and deleting the Organization's shared
  addresses MUST require `addresses.manage`; reading them MUST NOT (#668).

**Permission vocabulary**

- **FR-020**: Organization permissions MUST be declared by the module that owns the gated action,
  never by `organizations`, and MUST be a vocabulary separate from operator (Admin UI) permission
  codes: no string may be both.
- **FR-021**: Each declaration MUST carry a label and a one-sentence description in English and
  Polish, and whether the permission is **member-default** (granted to an Organization's *Member*
  role when first offered to it, FR-023).
- **FR-022**: This feature MUST declare these permissions, each in the phase shown. The nine **P2**
  codes ship in the P1+P2 release; the two **P3** codes MUST NOT be declared before P3, which
  introduces the internal RFQ approval they govern (OR-2, FR-042–FR-046; `research.md` R-30):

  | Code | Owner | Label (EN) | Member-default | Phase |
  | --- | --- | --- | --- | --- |
  | `carts.create` | carts | Create and edit carts | yes | P2 |
  | `carts.approve` | carts | Approve and reject colleagues' carts | no | P2 |
  | `carts.order_without_approval` | carts | Place orders without approval | yes (FR-071) | P2 |
  | `quote_requests.create` | quote_requests | Create quote requests | yes | P2 |
  | `shopping_lists.create` | shopping_lists | Create and edit shopping lists | yes | P2 |
  | `shopping_lists.convert` | shopping_lists | Convert shopping lists into quote requests and carts | yes | P2 |
  | `quick_order.one_click` | quick_order | One-click purchase (OR-1) | yes (FR-071) | P2 |
  | `orders.view_organization` | orders | View the organization's orders (OR-5) | no | P2 |
  | `addresses.manage` | addresses | Manage organization addresses (OR-8) | yes | P2 |
  | `quote_requests.approve` | quote_requests | Approve quote requests | no | **P3** |
  | `quote_requests.send_without_approval` | quote_requests | Send quote requests without approval (OR-2) | yes | **P3** |

- **FR-023**: When a member-default permission is first offered to the *Member* role of an
  Organization (its module is installed, or the Organization is created while it is), it MUST be
  granted to that *Member* role, and to no custom role. It MUST NOT be granted again afterwards — an
  administrator's removal of it from *Member* survives the module being switched off and on, and
  being uninstalled and reinstalled (`research.md` R-17, `data-model.md` §1
  `member_defaults_offered`).
- **FR-024**: Deleting a role that members or pending invitations hold MUST require a replacement
  role and MUST move all of them to it in the same operation; a role nobody holds MUST be deletable
  without one.
- **FR-025**: The role editor MUST list only permissions of present modules, grouped by module,
  each with its label and description in the viewer's language; a grant of an absent module's
  permission MUST be kept unchanged by any save.

**Carts (OR-3)**

- **FR-030**: Adding to, changing or emptying a cart, applying a coupon, and building a cart from a
  quote request, a shopping list or a quick-order list MUST require `carts.create`. Reading one's own
  cart MUST NOT. The permission is checked for a **signed-in member** only: an anonymous visitor
  MUST keep adding to and editing the guest basket as today (PR-4).
- **FR-030a** *(PR-12)*: Merging a guest basket into the member's basket at sign-in MUST require
  `carts.create`. For a member whose role lacks it the merge MUST be skipped — no line moves and the
  guest basket stays as it was — and the sign-in MUST still succeed.
- **FR-031**: A cart of a member whose role lacks `carts.order_without_approval` MUST be submitted
  for approval and approved before an order can be placed from it; every other member's cart MUST
  NOT require approval. The Organization-wide *requires cart approval* switch MUST be removed.
- **FR-032**: Approving or rejecting a pending cart MUST require `carts.approve` (or *Administrator*);
  approving or rejecting **one's own** cart MUST be refused.
- **FR-033**: Listing and reading the Organization's carts MUST require `carts.approve` (or
  *Administrator*), with the reach the administrator has today (own Organization; subtree for a
  roll-up login).
- **FR-034**: A role gaining `carts.order_without_approval` (or a member moving to such a role) MUST
  return that role's members' `pending` carts to *not required*; a role losing it MUST leave
  `approved` carts approved.
- **FR-035**: The cart-approval e-mails MUST address the submitter and the approver who acted, and
  the "cart submitted" e-mail MUST go to every member who may approve it.

**Quote requests (OR-2)**

- **FR-040**: Creating a quote request — from scratch, by resubmitting, from a cart or from a
  shopping list — MUST require `quote_requests.create`.
- **FR-041**: A member whose role holds `quote_requests.approve` MUST see every quote request of the
  Organization (with today's roll-up reach). Until P3 declares that code, only *Administrator* sees
  every quote request of the Organization, as today (`research.md` R-30).
- **FR-042**: A quote request created by a member whose role lacks
  `quote_requests.send_without_approval` MUST enter a state *awaiting internal approval* that the
  seller does not see, list or count.
- **FR-043**: A holder of `quote_requests.approve` MUST be able to approve such a request (it is
  then submitted to the seller exactly as a request sent directly) or reject it with a required
  reason; approving one's own MUST be refused.
- **FR-044**: The requester MUST be able to edit or withdraw a request awaiting internal approval;
  an edit after submission withdraws it to draft-for-resubmission, as an edit of a pending cart does
  (#649's rule).
- **FR-045**: The internal approval transitions MUST be recorded in the request's history and MUST
  send EN/PL e-mails to the approvers (submitted) and the requester (approved/rejected).
- **FR-046**: Accepting or rejecting the seller's revision MUST stay available to the request's owner
  and to anyone who sees the request under FR-041.

**Shopping lists**

- **FR-047**: Creating, renaming, editing and deleting shopping lists, and saving a cart line to a
  list, MUST require `shopping_lists.create`; reading one's own lists MUST NOT.
- **FR-048**: Converting a list (or selected lines) MUST require `shopping_lists.convert` plus the
  target's create permission (Edge Cases, *Composite actions*).

**Orders (OR-5)**

- **FR-049**: Listing and reading colleagues' orders, and every action that reads a colleague's
  order as its source — reorder, clone to quote request (#665), returns started from it, its
  documents — MUST require `orders.view_organization` (or *Administrator*), with the reach the
  administrator has today (own Organization; subtree for a roll-up login). Without it a member
  sees and acts on only the orders they placed.

**One-click purchase (OR-1, OR-6)**

- **FR-050**: One-click purchase MUST require `quick_order.one_click` **and**
  `carts.order_without_approval`. The eligibility answer MUST be *disabled* with reason
  `permission_required` when the first is missing and `cart_approval_required` when the second is,
  and placement MUST be refused on the same rule before any basket is written.
- **FR-051**: The storefront MUST NOT render the one-click button for a member to whom eligibility
  answers *disabled*.

**Refusals and the storefront**

- **FR-055**: An action refused for a missing permission MUST answer `403` with a dedicated error
  code and a localized sentence naming the permission's label; it MUST be distinguishable from
  "not signed in", "module disabled" and "not found".
- **FR-056**: The member's own session view MUST include their role (id, name, kind) and their
  effective permission codes, so the storefront hides or disables actions the member cannot take.
- **FR-057**: The storefront MUST hide or disable every action the member lacks the permission for:
  add-to-cart and cart editing, quick order, one-click, request a quote, shopping-list creation and
  conversion, and the carts approval queue; the account navigation MUST show *Members* and *Roles*
  to administrators and *Carts to approve* to approvers.
- **FR-058**: The account page MUST show the member their role and a plain-language list of what it
  allows.

**Operator side (OR-7)**

- **FR-060**: The operator MUST be able to view an Organization's roles with
  `organizations:read-roles` and create, edit and delete them with `organizations:manage-roles`,
  under the same rules as the storefront.
- **FR-061**: Both codes MUST be declared in the `organizations` manifest with EN and PL labels and
  enforced on the routes; the Roles tab lives on the Organization detail screen.
- **FR-062**: Assigning a role to a member, and choosing the role of a directly created member or of
  an invitation, MUST stay gated by `customers:manage` and MUST offer the Organization's roles.

**Auditing (Principle XIII)**

- **FR-065**: Creating, editing and deleting a role, assigning a role to a member, creating an
  invitation with a role and the reassignments caused by a deletion MUST each run as an audited
  command recording the actor (member or operator), the Organization, and the before/after role
  name and permission set. A save that changes nothing MUST record nothing.
- **FR-066**: The audit entries MUST be visible in the Organization's history in the Admin UI.

**Migration and contracts**

- **FR-070**: The upgrade MUST create both predefined roles for every Organization and assign
  *Administrator* to every `organization_admin`, *Member* to every `regular_user` (a personal
  Organization's member excepted, FR-070a), including deleted and blocked accounts and every pending,
  expired or accepted invitation.
- **FR-070a** *(PR-3)*: A personal Organization's member MUST hold *Administrator*: the upgrade MUST
  assign it whatever the legacy role, and every path that creates or moves an account into a
  personal Organization — self-registration, federated sign-in, the operator's detach — MUST assign
  it. The storefront MUST NOT offer a personal Organization the Members, Roles or Carts-to-approve
  screens, and this MUST be decided by the Organization being personal, never by the role. The
  operator's deleting or blocking of a personal Organization's member MUST NOT be refused as leaving
  the Organization without an administrator.
- **FR-071**: For each Organization, *Member* MUST receive every member-default permission, except
  that an Organization that required cart approval MUST NOT receive `carts.order_without_approval`
  or `quick_order.one_click`. Carts' approval states MUST NOT change.
- **FR-072**: After the upgrade, the outcome of every gated action for every existing member — its
  status **and** its error code or observed result — MUST equal its outcome before the upgrade,
  except the outcomes this feature deliberately changes, each listed by request with its old and new
  outcome (`contracts/migration-and-replay.md` §6.1, PR-5): one-click purchase by a member of an
  Organization that required cart approval (#653, PR-6); every outcome of a personal Organization's
  member, whose refusals become an administrator's answers (FR-070a, PR-3); refusals that now carry
  the permission's code; and expired invitations no longer listed (FR-010a, PR-7). (The removal of the
  `role` field changes the API shape, not any member's outcome.)
- **FR-073**: The legacy `role` field MUST be removed from every request and response in the same
  release (OR-4): responses carry the member's role (id, name, kind) and effective permissions, and
  requests name a role by its id. A request that still sends `role` MUST be refused as invalid
  rather than silently ignored.
- **FR-074**: The upgrade MUST be repeatable without effect on an Organization already migrated.

**Performance**

- **FR-080**: Checking a permission on the cart, checkout, placement and one-click paths MUST add no
  database read per request once the member's role has been read in that process recently.
- **FR-081**: A change to a role's permissions or to a member's role MUST take effect on the next
  request served by the process that made it, and on every other process within 30 seconds even if
  the cross-process announcement is lost — stale for a bounded time, never open beyond it.
- **FR-082**: A revoked permission MUST NOT remain usable beyond the bound in FR-081.

### Key Entities

- **Organization role**: belongs to one Organization; has a kind (*administrator*, *member*,
  *custom*), a name, an optional description, and a set of granted organization-permission codes.
- **Organization permission**: a code declared by a module, with EN/PL label and description and a
  member-default flag. Not stored per Organization; the vocabulary is the union of present modules'
  declarations.
- **Member role assignment**: each Customer account holds a reference to one role of its
  Organization (replacing the `role` enum).
- **Invitation**: names a role of the inviting Organization (replacing the `role` enum).
- **Permission first-seen ledger**: per Organization, the record on its *Member* role of which
  member-default permission codes that *Member* has already been offered by FR-023, so it never
  happens twice; a code not yet offered is held implicitly (`research.md` R-17, `data-model.md` §1
  `member_defaults_offered`).

## Impact

Measured on `origin/master` at `75b069175`, excluding tests, docs, `dist/` and migrations, by
`rg "organization_admin|regular_user|isOrgAdmin|CustomerAccountRole|organizationRoleSchema|OrganizationRole\b|countByOrganizationRole|requiresCartApproval|requires_cart_approval"`.
**154 references in 57 files**, plus **68 test files**.

| Area | Files / refs | What changes |
| --- | --- | --- |
| `packages/contracts` | 6 / 22 | `common.ts` `organizationRoleSchema`; `admin.ts` impersonation response; `customer-accounts.ts` `CustomerAccountRole`, `countByOrganizationRole`; `organizations.ts` member, login, invite, change-role, operator direct-member and patch-role shapes, `requiresCartApproval`; `carts.ts` policy shape; `quote-requests.ts` `isOrgAdmin` context. New: role, permission-catalogue and effective-permission shapes, manifest `organizationPermissions` field |
| `organizations` | 13 / 35 | New roles entity, role commands, permission port and catalogue, storefront and operator role routes, Roles tab on `OrganizationDetail.tsx`; invitations (`invitation.entity`, `invitation-service.ts`, e-mail template) take a role reference; `registration-service.ts` assigns *Administrator*; `organization-moderation-service.ts` recipient; `set-cart-approval-policy.command.ts`, `requiresCartApproval` on the entity, details port and context service removed |
| `customer_accounts` | 5 / 15 | `customer-account.entity.ts` `role` → role reference; `role-service.ts` (change role, remove member, last-admin guards) moves to audited commands; read/write/lifecycle ports; `index.ts` |
| `carts` | 8 / 23 | `cart-approval-service.ts`, `cart-approval-policy.ts` (from #648), `routes.organization.ts` `requireOrgAdmin`, `organization-cart-reach.ts`, `routes.admin.ts` policy endpoints and `CartApprovalPolicyPanel.tsx` removed, cart write routes gated, manifest declares three permissions |
| `customers` | 5 / 11 | `customer-org-assignment-service.ts`, `customer-deletion-service.ts`, `customer-moderation-service.ts` last-admin guards; `routes.admin.ts`, `routes.self.ts` context |
| `quote_requests` | 2 / 4 | `index.ts` customer context, `rfq-service.ts` visibility; create paths gated; option B adds a state, history kinds and e-mails |
| `quick_order` | 3 / 4 | `routes.preferences.ts`, `quick-order-build-service.ts`; `one-click-service.ts` eligibility and placement (OR-1, #653); manifest declares one permission |
| `shopping_lists` | 1 / 1 | `shopping-list-service.ts`; write and convert routes gated; manifest declares two permissions |
| `orders` | 2 / 3 | `order-access-service.ts` (colleagues' orders → `orders.view_organization`), `order-clone-to-quote-service.ts` (honours the same permission once #665's scope fix lands); manifest declares one permission |
| `addresses` | 0 / 0 | OR-8: manifest declares `addresses.manage`; the write routes in `organizations/routes.customer.ts` enforce it (#668) |
| `mfa` | 2 / 2 | `account-identity.ts`, `routes.org.ts` — *Administrator* check |
| `storefront` | 9 / 33 | `(account)/layout.tsx`, `organization/members`, `organization/carts`, `organization/settings/cart-approval` (removed), `lib/api/{account,cart,organization}.ts`, `lib/i18n/messages/account.ts`, `CartApprovalBanner.tsx`; new `organization/roles` pages; permission-aware buttons on PDP, cart, quick order, quote requests, shopping lists |
| `demo-composition` (counted above), `backend/scripts/acceptance/instance-actor-scope.ts`, `backend/test/helpers/` (seed-commerce, seed-credit-limit, seed-organizations, seed-roles, test-server, admin-search-fixtures) | outside the count | Seeds and fixtures build roles instead of enum values |
| `admin_roles` | 0 | Untouched; its catalogue service is the pattern, not a dependency |

## Upgrade note *(draft for `docs/docs/upgrading-an-instance.md`)*

> **Organization roles (feature 170).** Every Organization now has roles. The upgrade creates two
> in each — *Administrator* and *Member* — and gives every former `organization_admin`
> *Administrator* and every former `regular_user` *Member*. *Member* is granted exactly what a
> regular user could do before; in an Organization that required cart approval it is not granted
> *Place orders without approval*, so its members' carts still need approval. Nothing changes for
> your customers on upgrade, with one exception: **in an Organization that required cart approval,
> members can no longer buy with one click** — that was a way round approval (#653). Its
> administrator can grant it back to a role.
>
> **Individual (B2C) customers** — the sole member of a personal Organization — now hold
> *Administrator* of it, as do individuals who register after the upgrade. The storefront still shows
> them no Members, Roles or approval screens. The pending-invitations list no longer shows expired
> invitations.
>
> The *requires cart approval* switch is gone from the storefront's Organization settings and from
> the Admin UI. It is replaced by the *Place orders without approval* permission on each role.
>
> **API — breaking, with no compatibility window.** `role` (`organization_admin` | `regular_user`)
> is **removed** from the login response, `/api/v1/me`, the member and invitation endpoints, the
> impersonation response and the operator's organization endpoints, in this release. Read
> `organizationRole` (`{ id, name, kind }`) and `permissions` instead, and send `roleId` instead of
> `role`; a request that still sends `role` is refused. `PATCH
> /api/v1/organization/policies/cart-approval` and the operator's cart-approval-policy endpoints are
> removed. A custom storefront that tests `role === 'organization_admin'` must be changed in the same
> upgrade: test `organizationRole.kind === 'administrator'` for administrator-only screens — and,
> for the organization-management ones (members, roles, carts to approve), also
> `!organization.isPersonal`, because a personal Organization's member is an administrator — and
> `permissions` for everything else. Refusals of the organization carts endpoints now answer
> `403 ORGANIZATION_PERMISSION_REQUIRED` instead of `403 FORBIDDEN`, and an administrator's
> *submit for approval* answers `CART_APPROVAL_NOT_REQUIRED` instead of `CART_APPROVAL_SELF_SUBMIT`.
>
> **Colleagues' orders.** Seeing every order of the Organization is now the permission *View the
> organization's orders*. Administrators hold it; *Member* does not, as before. Grant it to any role
> that should see colleagues' orders.
>
> **Operator roles.** Two new operator permissions, `organizations:read-roles` and
> `organizations:manage-roles`, gate the new Roles tab. *Platform administrator* has them; grant
> them to any support role that should see or edit customers' roles.
>
> **Custom modules** that gate a buyer action can declare their own organization permissions in
> their manifest; see `docs/docs/architecture/permissions.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can create a role with a chosen set of permissions and assign it to
  a member in under 2 minutes, without help.
- **SC-002**: After the upgrade, 100% of a replay of every gated action by every seeded member
  produces the pre-upgrade outcome, except the listed expected differences, each of which produces
  exactly its listed new outcome (FR-072).
- **SC-003**: 100% of the permission codes declared in the release (FR-022's P2 codes in P1+P2; the
  P3 codes when P3 ships) are enforced by the backend, so a request bypassing the storefront is
  refused exactly as the hidden button implies.
- **SC-004**: Cart, checkout and placement response times do not regress by more than 5% at the
  95th percentile compared with the release before.
- **SC-005**: A revoked permission stops working within 30 seconds on every server, and immediately
  on the server that made the change.
- **SC-006**: Every role and assignment change is attributable to a named member or operator in the
  Organization's history.
- **SC-007**: With a module switched off and on again, every role holds exactly the grants it held
  before.

## Assumptions

- A member belongs to exactly one Organization (the account's own) and holds one role. Multiple
  roles per member, per-sales-channel roles and role hierarchies are out of scope.
- Permissions are allow-only; there are no deny rules and no amount thresholds ("approve carts up to
  10 000 PLN") in this feature — both are plausible follow-ups.
- Per-role MFA requirements (the admin-side `requires2fa` analogue) are out of scope.
- No new operator Setting is introduced; the custom-role limit (50) is fixed.
- The open cart-approval fixes #648 (placement gate), #650 (storefront approve UI) and #651
  (approval e-mails) merge before this feature's cart phase; this spec builds on their behaviour.
  #652 (customer e-mail language) is not solved here; role e-mails follow whatever language rule
  the other customer e-mails follow.
- API clients bound to an Organization (external order API) are not members and are not subject to
  organization permissions.
- The storefront's own catalogue translates the screen chrome; permission labels and descriptions
  come from the declaring modules' bundles, delivered by the backend in the requested language,
  because the storefront cannot know at build time which modules an instance has.
