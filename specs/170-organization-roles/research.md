# Research: Organization roles and permissions

**Feature**: [spec.md](./spec.md) · **Date**: 2026-11-03

Each entry is *decision → rationale → alternatives rejected*. They are the input `/speckit.plan`
works from; the plan may refine a mechanism but should not reverse a decision without saying why
here.

## R-1 — Who owns what

**Decision.**

- **Each gating module declares its own organization permissions** in its manifest, in a new
  optional field (working name `organizationPermissions`, shape `{ code, label, description,
  memberDefault }`), beside and separate from the operator `permissions` field
  (`packages/contracts/src/admin.ts` `modulePermissionDeclarationSchema`). Labels and descriptions
  live in the declaring module's own `i18n/{en,pl}.json` under a dedicated key prefix, exactly as
  operator permission labels do (`specs/conventions/module-admin-surfaces.md` item 4).
- **`organizations` owns the mechanism**: the role entity (Organization-scoped), the role commands,
  the merged catalogue (the union of present modules' declarations, presence-filtered like
  `PermissionCatalogueService.listAssignable()` in
  `packages/modules/admin_roles/src/backend/services/permission-catalogue.service.ts`, with the same
  *vocabulary vs grantable* split), the first-seen ledger (FR-023) and a published
  **permission-check port** other modules resolve.
- **`customer_accounts` owns the assignment**: the account's role reference replaces the `role`
  column it already owns (`customer-account.entity.ts:100`); member management (`role-service.ts`)
  stays there and becomes audited commands. The reference is a foreign key into `organizations`'
  roles table, which is legal because `customer_accounts` already depends on `organizations`
  (`packages/modules/customer_accounts/src/manifest.ts:55`).
- `invitation.role` (owned by `organizations`) becomes a role reference inside the same module.

**Rationale.** Principle I: a module that is detached takes its permissions with it, and
`organizations` never has to know what `quick_order` is. Principle XVII: both `organizations` and
`customer_accounts` are `nonDeactivatable`, so the mechanism is always present; the permissions of a
switchable module (`quote_requests`, `quick_order`, `shopping_lists`) follow its effective state.
This is the exact shape the operator side already proved (`admin_roles` + manifest `permissions`),
so reviewers have one model in their head, not two.

**Alternatives rejected.**

- *A fixed list in `packages/contracts`.* Couples the contracts package to every module's
  vocabulary and cannot hide an absent module's permission without a second presence rule.
- *Extend `admin_roles` to hold customer roles.* Mixes operator and buyer authorisation in one
  table and one catalogue; an operator code could be granted to a buyer by a bug in one filter.
  `admin_roles` is also an operator-side module a deployment may reasonably want to reason about on
  its own.
- *Assignment table owned by `organizations`.* It would reference `customer_accounts`' table from
  the module `customer_accounts` depends on — a dependency cycle
  (`specs/conventions/module-migrations.md` item 4).
- *A new `organization_roles` module.* Ownership argument fails: roles are a property of the
  Organization, the module is the tenancy root, and a separate module would need to be
  non-deactivatable anyway (every buyer path reads it), so it would buy a package boundary and
  nothing else.

## R-2 — Vocabulary separation

**Decision.** Organization permission codes are `<module>.<action>` (lower snake case), operator
codes stay `<area>:<action>`. A static check (extend the existing permission-inventory test rather
than add a `check-*` script; `module-admin-surfaces.md` item 6 is the precedent) refuses a code
present in both vocabularies, a code whose `<module>` segment is not its declarer, an undeclared
code passed to the permission port, a declared code no route or service checks, and a missing EN or
PL label/description.

**Rationale.** FR-020. Two distinct shapes make a mix-up visible in review; the inventory sweep
makes it fail the build.

**Alternatives rejected.** *A shared namespace with a `scope` flag* — a single typo then crosses the
operator/buyer boundary silently.

## R-3 — The predefined roles

**Decision.** A role has `kind ∈ {administrator, member, custom}`. *Administrator* is evaluated as
a wildcard (it stores no list), like `platform_admin`'s `*`
(`admin_roles/src/backend/services/platform-administrator-role.ts`), so a newly declared permission
is held without a migration. *Member* stores an explicit list. Both are created by
`organizations` when an Organization is created (registration, operator create, personal
organizations) and by the upgrade migration; neither is renamable or deletable; their names are
translated labels, not stored text. Last-administrator protection reuses
`CANNOT_DEMOTE_LAST_ADMIN` / `CANNOT_REMOVE_LAST_ADMIN` and is applied at every seam that applies it
today (`customer_accounts/role-service.ts`, `organizations/invitation-service.ts`,
`customers/customer-org-assignment-service.ts`, `customer-deletion-service.ts`,
`customer-moderation-service.ts`), now counting holders of the administrator-kind role.

**Rationale.** Owner request: "the Administrator can do everything"; "Member is predefined but
editable"; no behaviour change.

**Alternatives rejected.** *Member as a non-editable template* — an Organization would have to
create a custom copy and reassign every member to change anything, which is the common first step.
*Administrator with an explicit list* — needs a data migration per new permission, and a missed one
is an administrator who cannot do something.

## R-4 — Replace `requiresCartApproval` with `carts.order_without_approval` (owner ruling OR-3, 2026-11-03)

**Decision.** Replace. The rule "must this buyer's basket be approved?" becomes
`!can(buyer, 'carts.order_without_approval')`. That one predicate replaces
`approvalSubmissionRequired` (`carts/src/backend/services/cart-approval-policy.ts` on the #648
branch), so the primary call to action, submit-for-approval and the placement gate keep sharing a
single statement of the rule. Approvers are holders of `carts.approve`; self-approval is refused.
The policy endpoints (`PATCH /api/v1/organization/policies/cart-approval`, operator
`GET|PATCH /api/v1/admin/organizations/:id/cart-approval-policy`), the
`organization.set_cart_approval_policy` command, `CartApprovalPolicyPanel.tsx` and the storefront
`organization/settings/cart-approval` page are removed; the `requires_cart_approval` column is
dropped by an `organizations` migration after the data migration has read it.

**Rationale.** The flag answers the same question as the permission, at a coarser grain. Keeping
both was analysed:

| | Keep flag + permissions | Permission only *(chosen)* |
| --- | --- | --- |
| "Some members need approval, some do not" | Needs a combination rule (flag AND lacks permission) the administrator cannot see on either screen | Expressed directly on the role |
| "Who may approve?" | Separate question; still needs `carts.approve` | Same |
| Migration | None for the flag | Flag → Member's grant (FR-071); exact |
| Screens | Two places to look | One |
| Risk | An Organization with the flag off and a role lacking the permission: is approval required? Either answer surprises someone | None — one lever |

Toggling the flag off today resets pending carts (`carts.md` § *Lifecycle*); FR-034 keeps that as
the effect of a role gaining the permission, so nothing an administrator relied on disappears.

**Alternatives rejected.** *Keep the flag as an Organization-wide override that forces approval for
everyone but administrators* — redundant with removing the permission from every role, and it would
reintroduce the invisible combination rule above.

## R-5 — `carts.create` and the lazy basket

**Decision.** `GET /api/v1/cart` still lazily creates and returns an empty basket for every member;
`carts.create` gates the **mutations** and the builders (from quote, from list, quick order,
`save-to-shopping-list` also needs `shopping_lists.create`). The cart payload's `primaryCta` gains
no new value; the storefront reads `permissions` to hide add-to-cart.

**Rationale.** A member without `carts.create` (a quote-only or list-only role) must still be able
to open pages that read the basket count; refusing the read would break every page header.

## R-6 — One-click (OR-1, OR-6, #653)

**Decision.** `quick_order` declares `quick_order.one_click`. `OneClickService.eligibility`
(`quick_order/src/backend/services/one-click-service.ts:71-88`) gains two reasons,
`permission_required` and `cart_approval_required`, checked before the setting and defaults
reasons; `placeOneClick` refuses on the same predicate before the working basket is written. The
external order API (`packages/modules/orders/src/backend/services/order-api-intake-service.ts`) is not a member action and stays
exempt.

**Rationale.** OR-1. The conjunction with `carts.order_without_approval` (OR-6) makes "approval
cannot be bypassed" a property of the platform rather than of every Organization's configuration.
Migration: Member gets `quick_order.one_click` only where it gets `carts.order_without_approval`
(FR-071) — granting it in an approval-requiring Organization would migrate the bug.

**Alternatives rejected.** *Fix #653 now, separately, by reading the approval policy* — the owner
ruled it waits for roles; a fix now would be replaced by this feature in the same release window.

## R-7 — Reaching the permission check from a module

**Decision.** `organizations` publishes `organizationPermissionPort` with, in substance:
`can(actor, code): Promise<boolean>`, `assert(actor, code): Promise<void>` (throws the `403
ORGANIZATION_PERMISSION_REQUIRED` refusal of FR-055) and `effective(actor): Promise<ReadonlySet<string>>`,
where `actor` is the `{ customerAccountId, organizationId }` the platform's `customerActorResolver`
already yields. A route helper (`requireOrganizationPermission(code)`) is offered as a `preHandler`,
so a refusal answers before validation as operator gates do
(`module-admin-surfaces.md` item 3). Consumers resolve the port lazily, as they resolve
`customerAccountReadPort` today; no new lifecycle edge is needed for `carts`, `customer_accounts`
or `orders` (they already depend on `organizations`); `quote_requests`, `quick_order` and
`shopping_lists` follow `module-composition.md` for the edge type.

The `isOrgAdmin` booleans threaded through `quote_requests` (`index.ts:271`, `rfq-service.ts:114`),
`orders` (`order-access-service.ts`), `quick_order`, `customers` and `shopping_lists` are replaced
by the port's answer for the specific capability (*sees every RFQ of the Organization*, *sees every
order*), never by a renamed boolean.

**Rationale.** One rule, one home. Sixty `=== 'organization_admin'` comparisons are sixty copies of
the rule; FR-072 is only provable if they become calls to one predicate.

## R-8 — Contract change (owner ruling OR-4, 2026-11-03)

**Decision.** No versioning and no compatibility window. In the release that ships roles, `role` is
removed from every request and response that carried it (login, `/api/v1/me`, member list,
invitations, operator member and impersonation shapes); responses carry
`organizationRole: { id, name, kind }` and `permissions: string[]`, requests send `roleId`, and a
request still sending `role` is refused by schema validation (strict object) rather than ignored.
The changeset is a `minor` for `@endora-commerce/contracts` (D-225: `major` is refused in `0.x`)
and names the old and the new field; the upgrade note carries the migration for client authors.
Every path stays under `/api/v1`.

**Rationale.** The owner ruled that the project is still at a stage where it may break freely. In
this repository's `0.x` lockstep series a `minor` already takes every caret dependent out of range,
so the release number plus the upgrade note is the versioning Principle II asks for.

**Alternatives rejected.** *One release of overlap* (the architect's original recommendation) —
ruled out by the owner; it would have cost a derived field and a request mapping for one release.
*`/api/v2` for the affected routes* — doubles the session surface for one field.

## R-8a — Colleagues' orders (owner ruling OR-5, 2026-11-03)

**Decision.** `orders` declares `orders.view_organization` (not member-default; *Administrator*
implicitly). `OrderAccessService.scopedWhere` / `scopedWhereWithEm`
(`packages/modules/orders/src/backend/services/order-access-service.ts`) ask the permission port for
this code instead of `role === 'organization_admin'`, keeping today's reliance on the tenant filter
for the org/subtree predicate. Every reader of a colleague's order goes through that scope —
including clone-to-quote, whose missing scope and `isOrgAdmin ?? true` default are issue #665
(being fixed separately now; this feature then swaps its admin test for the permission).

## R-8b — Organization addresses (open question Q-7, #668)

**Recommendation.** `addresses.manage`, declared by `addresses` (it owns the entity and the write
behind `addressServicePort`), enforced by the route seam in
`packages/modules/organizations/src/backend/routes.customer.ts`, member-default so FR-072 holds.
Rejected: declaring it in `organizations` (it would name another module's action, against R-2's
"`<module>` segment is the declarer"); not member-default (a behaviour change on upgrade nobody
asked for in this feature).

## R-9 — Caching on hot paths (FR-080–FR-082)

**Decision.** Two-layer cache of **`(organizationId) → { roleId → granted codes }`** following
`packages/platform/src/kernel/sales-channels/sales-channel-access-cache.ts`
(`specs/154-sales-channel-access/` research R-6): per-process LRU with a 30-second age bound, Redis
under `organization-roles:v1:org:<id>`, PostgreSQL as source. Invalidation is part of the write
(D-93): every role command and every assignment command drops the shared and the local entry after
commit and publishes `{ organizationId }` on a dedicated pub/sub channel so every other process
drops its local entry; a lost announcement degrades to the 30-second bound. The member's role id is
read from the account record the request already loads (customer actor resolution); if that read is
not already per-request-cached, the plan adds the account's role id to the same cache entry keyed by
account. Presence filtering is applied on read, from the registry cache, so a module flip needs no
invalidation.

**Rationale.** The cart read computes `primaryCta` on every page view; placement, one-click
eligibility and every cart mutation check a permission. Without a cache that is up to three extra
reads per request. The sales-channel cache already carries the exact obligations (bounded
staleness, write-path invalidation, no fall-open) and its tests are the template.

**Alternatives rejected.** *Embed permissions in the session* — a revoked permission would live as
long as the session (FR-082). *No cache* — measurable on the cart path, which SC-004 bounds.

## R-10 — Auditing (Principle XIII)

**Decision.** Commands, run through `CommandBus.run`:
`organization_role.create`, `organization_role.update`, `organization_role.delete` (its
reassignments recorded as `customer_account.change_role` entries in the same transaction),
`customer_account.change_role` (exists as an action name in `role-service.ts`; becomes a command
owned by `customer_accounts`), `organization_invitation.create`. Before/after carry role name, kind
and the sorted permission list, so a diff reads without a join. The actor comes from the ambient
context, so one command serves the storefront administrator and the operator, as
`set-cart-approval-policy.command.ts` does today. An unchanged save is `skipAudit`.

`role-service.ts` today calls `recordAuditFromContext` by hand; moving it onto the bus is in scope
because this feature rewrites both of its methods.

## R-11 — i18n

**Decision.** Storefront chrome (Roles screen, members screen, refusal banners, nav) in
`storefront/lib/i18n/messages/` (`defineMessages`, EN + PL, so a missing PL key is a `tsc` error).
Permission labels and descriptions in the declaring module's bundle, delivered translated by the
backend's catalogue endpoint for the request language, because the set depends on the instance's
modules (`specs/conventions/module-i18n.md`). Predefined role names are keys, not stored text. The
operator Roles tab uses the `organizations` admin bundle. The `organization_invitation` e-mail's
`roleLabel` variable carries the translated predefined name or the custom name verbatim — the
label comes from the role, never from a hard-coded English string as it does today in
`invitation-service.ts:188` and `email-templates/invitation.ts:30` (#667).

## R-12 — Storefront UX outline (for `endora-commerce-designer`)

- `/organization/roles` (administrators): table — name, kind badge, members, permissions count;
  *New role*. Administrator row: "All permissions", no actions. Member row: *Edit permissions*.
- `/organization/roles/new`, `/organization/roles/[id]`: name, description, permissions grouped by
  module as checkboxes with descriptions; OR-6's note beside one-click; *Delete* opens a dialog with
  a replacement-role select (Member preselected) and the count of members and invitations moved.
- `/organization/members`: role column as a select of the Organization's roles; invite form with
  the same select, Member preselected.
- `/organization/carts`: shown to approvers as well as administrators; nav label *Carts to
  approve* with a pending count.
- Account page: *Your role: X* and the list of what it allows.
- Every gated action not allowed is hidden where its absence is self-explanatory (add-to-cart on a
  list role) and disabled with an explanation where the member would otherwise look for it (the
  cart's checkout button for a role that must submit).
The UX laws (`.claude/skills/ux-laws/SKILL.md`) apply; the designer owns the final layout.

## R-13 — Phasing

| Phase | Content | Size |
| --- | --- | --- |
| **P1 — Mechanism** | Contracts (breaking: `role` removed, OR-4), roles entity + commands + catalogue + port + cache, assignment column, invitations, migration and first-seen ledger, last-admin, every `organization_admin` comparison replaced by *is Administrator* (no behaviour change), storefront Roles and Members screens, operator Roles tab and codes, docs EN+PL | L |
| **P2 — Commerce permissions** | `carts.*` (flag removed, approvers), `quick_order.one_click` (#653), `shopping_lists.*`, `quote_requests.create`, `orders.view_organization` (incl. clone-to-quote after #665), `addresses.manage` if Q-7 = A/B; storefront buttons | M–L |
| **P3 — RFQ approval** | OR-2: internal approval state, `quote_requests.send_without_approval`, e-mails, approval queue, seller-side invisibility | L |

There is no removal phase (OR-4). P1 is releasable on its own (two predefined roles, nothing
grantable yet but *Member*'s list is inert until P2 gates on it), but since it already carries the
breaking contract change it is best released together with P2; P2 is the first release with user-visible permissions; P3 can ship in
the same or a later release.

**FR-071's exception belongs to P2's migration, not P1's.** The `carts` and `quick_order` codes are
first declared in P2, so FR-023 grants them to *Member* then; the same P2 migration reads
`requires_cart_approval` *at that moment* — an Organization may flip it between P1 and P2 — withholds
the two codes where it is true, and only then drops the column. If P1 and P2 ship in one release
the two migrations simply run back to back.

## Preliminary Constitution Check *(the plan restates it as the gate)*

| Principle | Verdict |
| --- | --- |
| I Modular (NN) | Pass — permissions declared by their owners; `organizations` owns the mechanism behind a port; no module reads another's tables (R-1) |
| II API-first | Pass — contracts first; breaking change versioned as a `0.x` minor with an upgrade note, no window, per owner ruling OR-4 (R-8) |
| III TDD (NN) | Plan obligation — every FR maps to a test; FR-072 by a before/after replay |
| IV Minimal deps | Pass — no new dependency |
| XI Multi-tenant (NN) | Pass — roles Organization-scoped and tenant-filtered; no no-organization path (FR-005) |
| XIII Command Bus (NN) | Pass — every role and assignment write is a command (R-10); `role-service.ts`'s hand-placed audit is retired |
| XVI Palette | Pass — no new static admin route (Roles is a tab of `/organizations/:id`); the existing `open-organizations` action covers it |
| XVII Toggleable (NN) | Pass — absent module's permissions not listed, not effective, grants retained (FR-025, US 8); mechanism lives in non-deactivatable modules |

Verdict: **no violation; no Complexity Tracking entry needed.**
