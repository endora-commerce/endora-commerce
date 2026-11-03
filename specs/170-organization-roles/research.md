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

**Guests (owner ruling PR-4, 2026-11-03).** `carts.create` judges a **signed-in customer** only. An
anonymous visitor keeps the guest basket exactly as today — `POST /api/v1/cart/items` answers `200`
and mints the anonymous token — and the storefront keeps offering add-to-cart to a signed-out
visitor. R-35 records the guard shape.

## R-6 — One-click (OR-1, OR-6, #653)

**Decision.** `quick_order` declares `quick_order.one_click`. `OneClickService.eligibility`
(`quick_order/src/backend/services/one-click-service.ts:71-88`) gains two reasons,
`permission_required` and `cart_approval_required`, checked before the setting and defaults
reasons; `placeOneClick` refuses on the same predicate before the working basket is written. The two
codes are judged in FR-050's order, `quick_order.one_click` first, by both answers: a member lacking
both — B's *Member* after the upgrade (FR-071) — reads `permission_required`, and placement is
refused naming `quick_order.one_click` (pinned by PR-6's table, `contracts/migration-and-replay.md`
§6.1 rows 23–24). The
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

## R-8b — Organization addresses (owner ruling OR-8, 2026-11-03, #668)

**Decision.** `addresses.manage`, declared by `addresses` (it owns the entity and the write behind
`addressServicePort`), held implicitly by *Administrator*, member-default so FR-072 holds, revocable
per Organization by removing it from a role. It is enforced at the route seam in
`packages/modules/organizations/src/backend/routes.customer.ts` (create, update, delete of
`/api/v1/organizations/mine/addresses`); the list stays open to every member. `addresses` is
non-deactivatable, so the code is always grantable.

**Alternatives rejected.** Declaring it in `organizations` (it would name another module's action,
against R-2's "`<module>` segment is the declarer"); not member-default (option B — a behaviour
change on upgrade); no permission (option C — leaves a shared checkout input editable by anyone).

## R-9 — Caching on hot paths (FR-080–FR-082)

**Status: refined by R-15 and R-16** — no shared Redis layer, no per-account entry, and assignment
commands do not drop the cache. The obligations below (bounded staleness, write-path drop, never
fall open) stand; the mechanism is R-16's.

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
| **P2 — Commerce permissions** | `carts.*` (flag removed, approvers), `quick_order.one_click` (#653), `shopping_lists.*`, `quote_requests.create`, `orders.view_organization` (incl. clone-to-quote after #665), `addresses.manage` (OR-8); storefront buttons | M–L |
| **P3 — RFQ approval** | OR-2: internal approval state, `quote_requests.send_without_approval`, e-mails, approval queue, seller-side invisibility | L |

There is no removal phase (OR-4). P1 is releasable on its own (two predefined roles, nothing
grantable yet but *Member*'s list is inert until P2 gates on it), but since it already carries the
breaking contract change it is best released together with P2; P2 is the first release with user-visible permissions; P3 can ship in
the same or a later release.

**FR-071's exception belongs to P2's migration, not P1's.** The `carts` and `quick_order` codes are
first declared in P2, so FR-023 grants them to *Member* then; the same P2 migration reads
`requires_cart_approval` *at that moment* — an Organization may flip it between P1 and P2 — withholds
the two codes where it is true, and only then drops the column. If P1 and P2 ship in one release
the two migrations simply run back to back. *(Refined by R-18: P1 and P2 ship together, so the
exception is written by `organizations`' M2 and the column is dropped by M4 in WP-12.)*

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

---

# Plan-phase decisions *(added by `/speckit.plan`, 2026-11-03)*

The entries above were written by the specify phase and stand. The entries below were written
while planning against `origin/master` at `d31bab44b`. Where one **refines** an entry above it says
so and says why; none reverses a decision above.

## R-14 — Re-measured inventory, and how the plan uses it

**Measurement** (`d31bab44b`, same `rg` pattern and exclusions as the spec's *Impact*, plus
`backend/scripts/ledgers/**` excluded because a ledger records history and is not a role check):
**155 references in 59 non-test files, plus 79 test files and 6 shared test helpers.** The spec's
figure (154 / 57 / 68 at `75b069175`) drifted with the merges of #647, #654, #659, #670 and #674 —
`orders/order-buyer-action-scope.test.ts`, `orders/buyer-order-actions-scope.test.ts` and
`storefront/test/account/module-presence-nav.test.tsx` are among the newcomers.

| Area | Non-test files / refs | Owning work package (plan.md) |
| --- | --- | --- |
| `packages/contracts` | 6 / 22 | WP-01 (additive), WP-12 (removal) |
| `organizations` | 13 / 35 | WP-02a, WP-03, WP-08, WP-12 |
| `customer_accounts` | 5 / 15 | WP-02b |
| `carts` | 8 / 23 | WP-04 |
| `customers` | 5 / 11 | WP-03 |
| `quote_requests` | 2 / 4 | WP-05 |
| `quick_order` | 3 / 4 | WP-06 |
| `shopping_lists` | 1 / 1 | WP-06 |
| `orders` | 2 / 2 | WP-07 |
| `mfa` | 2 / 2 | WP-03 |
| `storefront` | 10 / 34 | WP-09, WP-10 |
| `demo-composition`, `backend/scripts/acceptance` | 2 / 2 | WP-02b |

**Decision.** The plan does not hand an implementer the count; it hands them the command. Every
work package ends by running the inventory over the files it owns and reporting zero hits, and
WP-12 runs it over the whole tree and must report **zero** non-test hits (the pattern minus
`requires_cart_approval`, which survives in the historical `carts` and `organizations`
migrations by design). A count written into a plan is stale on the next merge (D-100); the
pattern is not.

## R-15 — The member's role travels on the actor *(refines R-9)*

**Decision.** `auth`'s request hook already reads the session's customer account **once per
request** through `customerOrgResolver` (`packages/modules/auth/src/backend/plugin.ts:195-201`,
`packages/modules/customer_accounts/src/backend/index.ts:476-500`) to stamp `organizationId` and
`active`. That read returns `organizationRoleId` too, `ActorCustomer` gains an optional
`organizationRoleId` (`packages/contracts/src/actor.ts`), and the platform's
`customerContextResolver` / `cartActorResolver` / `customerActorResolver`
(`packages/platform/src/composition/compose-app.ts:1122-1214`) pass it through. The permission
port's subject therefore normally arrives with its role id; when it does not (a service judging
somebody other than the requester — the "cart submitted" e-mail's recipients, a cascade), the
port reads the account through `customerAccountReadPort`.

The cache is consequently **only** `organizationId → { roleId → { kind, grants } }`. R-9 asked for a
second entry keyed by account "if that read is not already per-request"; it is, so the second
entry is not built.

**Rationale.** FR-080 (no extra read on the hot path) is met by a read that already happens.
FR-081 is met *better* than asked for an assignment change: the next request on **every** process
reads the new role id, because the account row is read fresh each time. Only a change to a role's
permission set rides the cache bound.

**Alternatives rejected.** *A per-account cache entry* — a second invalidation surface for a value
the request already has. *Embedding the permission set in the session* — rejected in R-9, still
rejected (FR-082).

## R-16 — The cache is per-process with a pub/sub drop, not two-layer *(refines R-9)*

**Decision.** `OrganizationRoleCache` in `organizations` follows
`packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.ts`, not the
kernel's `SalesChannelAccessCache`: a per-process LRU (cap 4096 Organizations, entries older than
**30 s** ignored), a generation counter so a fill that raced an invalidation is answered and not
stored, PostgreSQL as source, and a Redis pub/sub channel `b2b:organization-roles:changed`
carrying `{ organizationId }`. Every `organization_role.*` command drops the local entry **after
commit** and publishes; assignment commands drop nothing, because the cache holds roles and their
grants, never assignments (R-15; `contracts/commands-audit-events.md` §5). Every composed process
subscribes in an `onBoot` hook on the `redisSubscriber` connection, exactly as `custom_fields` does
(`packages/modules/custom_fields/src/backend/index.ts:201-202`). No shared Redis value layer.

**Rationale.** The source read is one indexed query returning at most 52 rows (FR-004's 50 custom
plus two predefined). A shared Redis layer saves that read only for a *cold* process and adds the
D-93 drop-marks machinery whose whole purpose is to stop a shared layer re-pinning a stale value —
a risk this design does not have to manage. The obligations that matter (FR-081: immediate in the
writing process, ≤ 30 s elsewhere even with a lost announcement, never open beyond it) are met by
the LRU age bound plus the drop. `organizations` is `nonDeactivatable`, so the `onBoot`
subscriber needs no presence probe (`specs/conventions/module-activation.md` item 3, last
paragraph).

**Alternatives rejected.** *R-9's two layers* — more moving parts for no requirement. *No pub/sub,
TTL only* — meets FR-081's 30 s bound but not SC-005's "immediately on the server that made the
change" for *other* processes' perception; the local drop already makes it immediate in the writing
process, and the publish makes the common case immediate everywhere. *Kernel-hosted cache* — the
platform may not name a module's table or concept it does not own (D-52/D-53).

## R-17 — The first-seen ledger is per *Member* role, and an unoffered default is held implicitly *(refines the spec's Key Entity)*

**Decision.** Instead of a platform-wide table of codes already granted, each role row carries
`member_defaults_offered text[]` — the member-default codes that row has **already been offered**.
*Member*'s effective set is computed, never reconciled:

```
effective(member) = ( permissions ∪ (vocabularyMemberDefaults ∖ member_defaults_offered) ) ∩ present
```

So a member-default code that becomes known (its module is installed, FR-023) is held by every
*Member* that has not been offered it **from the first request on**, with no boot step and no write.
Saving *Member* materialises the decision: `member_defaults_offered` becomes `member_defaults_offered
∪ vocabularyMemberDefaults`, and `permissions` becomes the merge of data-model §1 computed over the
previous *effective-before-presence* set. A code the administrator un-ticked is then in
`member_defaults_offered` and absent from `permissions`, so it is never granted again — across a
switch-off/on and across an uninstall/reinstall (FR-023; `member_defaults_offered` keeps codes no
module declares any more). Custom and administrator roles ignore the column.

**Rationale.** A platform-wide ledger cannot answer correctly for an Organization created while a
module was uninstalled: the code is in the ledger (seen once), the new Organization's *Member* was
never offered it, and reinstalling the module would grant it to nobody there. Per role, the question
"has **this** *Member* been offered this code?" is exactly FR-023's. Computing rather than
reconciling also means a *Member* row created by any path — the M2 trigger (R-28), a test fixture's
raw insert — is correct with empty arrays, and lets R-18 express FR-071's exception as data. The
spec's Key Entity read *"platform-wide record"* and was aligned with this entry on 2026-11-03, and
FR-023 (which read *"known to the platform for the first time"*) was aligned to *"first offered to
the Member role of that Organization"* afterwards; the behaviour the FRs require is unchanged.

**Alternatives rejected.** *Platform-wide `organization_permission_first_seen` table* — the defect
above. *A boot reconciler appending new codes to every Member row* — correct, but a write at boot on
every Organization, a window between creation and the next boot in which a new Organization's
*Member* lacks a default, and a second statement of the rule; the computed form has neither.
*Installing the grant from each declaring module's `installHook`* — a hook may not write another
module's table (`specs/conventions/module-migrations.md` item 4a, R2).

## R-18 — FR-071's exception is written by `organizations`' own migration

**Decision.** The `organizations` data migration that creates the predefined roles reads
`organizations.requires_cart_approval` — a column on this module's own table (its entity property
is `Organization.requiresCartApproval`; `carts`' 2026-06 consolidation migration added it, which is
already ledgered under `backend/scripts/ledgers/migration-foreign-writes/carts.ts`) — and, for every
Organization where it is `true`, writes that Organization's *Member* row with
`member_defaults_offered = '{carts.order_without_approval,quick_order.one_click}'` and those two
codes **absent** from `permissions`. By R-17's rule *Member* then holds every other
member-default code implicitly and not those two, because they read as already offered. The column is
dropped later, by `organizations`' own cleanup migration in WP-12, once nothing reads it.

This writes two code literals owned by `carts` and `quick_order` into an `organizations`
migration. That is accepted, and bounded: the migration translates **its own** column — a policy
whose meaning was always "carts need approval" — into **its own** table, once, frozen in history. No
runtime path in `organizations` names either code.

**Rationale.** R-13 placed the exception in "P2's migration"; with P1 and P2 released together
there is one upgrade, and the only module that may write `organization_roles` is `organizations`
(R2 of `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md`). Reading the
flag in the same migration that creates *Member* is the only point at which the value is both
available and authoritative.

**Alternatives rejected.** *A `carts` migration withholding the grant* — writes `organizations`'
table (R2 violation). *A `carts` `installHook`* — does not run on an upgrade of an installed module,
and is not co-ordered with the migration. *Keeping `requires_cart_approval` and consulting it when
computing *Member*'s effective set* — `organizations` would then encode a carts rule forever.

## R-19 — Migrations, by module and dependency

**Decision.** No migration numbers (`specs/conventions/module-migrations.md`); each file is
scaffolded with `pnpm --filter backend run migration:new -- --module <id> --name <slug>` and
registered by `composer:generate`. Execution order is the manifest graph: `organizations` runs
before `customer_accounts`, which declares it (`packages/modules/customer_accounts/src/manifest.ts`),
so every step below sees the previous step's tables.

| Step | Module | Slug (suggested) | WP | Content |
| --- | --- | --- | --- | --- |
| M1 | core (platform) | `audit_actor_customer_account` | WP-01 | `audit_log_entries.actor_customer_account_id uuid null` (R-21) |
| M2 | `organizations` | `organization_roles` | WP-02a | Create `organization_roles`; insert the two predefined rows for **every** Organization (including suspended and personal ones); install the R-28 `after insert` trigger; FR-071 marker (R-18); add `organization_invitations.organization_role_id`, backfill from `role` (`organization_admin` → administrator row, else member row), `not null`, composite FK |
| M3 | `customer_accounts` | `organization_role_assignment` | WP-02b | Add `customer_accounts.organization_role_id`, backfill from `role` for **every** row (deleted and blocked included, FR-070) — a personal Organization's account → *Administrator* whatever its `role` (PR-3, R-34) — install the R-28 `before insert` default trigger, `not null`, composite FK `(organization_id, organization_role_id) → organization_roles (organization_id, id)` |
| M4 | `organizations` | `drop_legacy_role_columns` | WP-12 | Drop `organizations.requires_cart_approval` and `organization_invitations.role` |
| M5 | `customer_accounts` | `drop_legacy_role_column` | WP-12 | Drop `customer_accounts.role` and its index |

M3 **reads** `organization_roles` (a cross-module read: R1 of the boundary contract, satisfied by
the declared dependency) and **writes** only its own table (R2). M2 and M4 touch only
`organizations`' tables. FR-074 (repeatable): every insert is `insert … select … where not exists`,
every backfill is `update … where organization_role_id is null`, every `add column` is
`if not exists`.

Each migration's `down()` restores the previous **schema** shape (M2's drops the table and the
column; M3's re-creates nothing it did not drop) — FR-072's replay (R-27) depends on the downs of
M2–M5 putting the schema back exactly, so they are written and tested, not left empty.

**Alternatives rejected.** *One migration in `organizations` that also backfills
`customer_accounts`* — R2 violation. *Dropping the legacy columns in M2/M3* — leaves the
integration branch red between WP-02 and WP-12, because Wave 2 still reads them (R-23).

## R-20 — The permission port, the route guard and the refusal

**Decision.** `organizations` publishes **`organizationPermissionPort`** (`ctx.di.providePort`, type
in `packages/contracts/src/organization-roles.ts`, full shape in
[`contracts/organization-permission-port.md`](./contracts/organization-permission-port.md)):
`can`, `assert`, `isAdministrator`, `effective`, and `rolesHolding(organizationId, code)` (for
recipients and cascades). Consumers reach it with `lazyPort<OrganizationPermissionPort>(ctx,
'organizationPermissionPort')`; every consumer already declares `organizations` in `dependencies`
(`carts`, `customer_accounts`, `orders`, `quote_requests`, `quick_order`, `shopping_lists`, `mfa`,
`customers` — measured), so **no new lifecycle edge** is added and `check:port-dependencies` needs
no acknowledgement.

The route guard is **`organizationPermissionPreHandler(getPort, code)`**, a plain function in
`@endora-commerce/contracts` (it needs only the `Actor` type and the port interface, so no Fastify
import), declared after `requireCustomer` in the route's `preHandler` array, so the platform moves
both to `preValidation` and a refused caller is answered before validation
(`specs/conventions/module-admin-surfaces.md` item 3). `getPort` is a thunk: the port is resolved
per request, never at route registration (`module-composition.md` item 4a, third fail-open shape).

The refusal is `403 ORGANIZATION_PERMISSION_REQUIRED`, declared in `organizations`' manifest
`errorCodes`, with `details: { permission, permissionLabel }`; the envelope interpolates
`{permissionLabel}` into the translated sentence (`packages/platform/src/http/error-envelope.ts`
`messageParams`). It is distinguishable from `401 UNAUTHORIZED`, `503 MODULE_DISABLED` and `404`
(FR-055). The reserved administrator capabilities (FR-010–FR-012) refuse with the existing
`403 FORBIDDEN` "Organization administrator required", unchanged — they are not permissions.

**Composite actions** (spec *Edge Cases*) are two guards, never a combined code: the guard array
lists both; the refusal names the first missing one.

**Alternatives rejected.** *A Fastify decorator registered by `organizations`* — a decoration is a
capture of a gated registration. *A guard in `@endora-commerce/platform/http`* — the platform would
name a module's concept. *A per-module copy of the guard* — eight copies of one rule.

## R-21 — A customer actor is recorded on the audit row *(platform extension)*

**Decision.** `CommandActor` gains `actorCustomerAccountId: string | null`, filled by
`actorFromContext` (`packages/platform/src/commands/actor.ts`) from `TenantContext.actor.id` when
the actor is a customer acting for themselves; `audit_log_entries` gains the matching nullable
column (M1); `AuditPort.recordWithin` carries it. Impersonation keeps its two existing columns.

**Rationale.** FR-065 and SC-006 require every role and assignment change to name the member who
made it. Today a customer-issued Command records `actorAdminUserId = null` and nothing else
(`actor.ts`, "plain customer — no acting admin id"), so the storefront administrator's edit would be
anonymous. `organization.set_cart_approval_policy` has had the same gap since #175; this closes it
for every customer-side Command at once.

**Alternatives rejected.** *The actor in `stateAfter`* — server-derived but not queryable, and every
module would invent its own key. *A module-owned history table, as `quote_requests` keeps* — a second
audit substrate for one screen.

## R-22 — Child Commands in one transaction *(platform extension)*

**Decision.** `CommandContext` gains `run<T>(child: Command<T>): Promise<T>`: the child's
`capture`/`run` execute on the **parent's** transactional `em` and actor, the bus records the
child's own single audit entry inside the same transaction, and buffers the child's event in the
parent's `EventBus.run` scope. Every Command still records exactly one entry; parent and children
commit or roll back together.

**Rationale.** FR-024 and US 6 require a role deletion and every reassignment to happen together or
not at all; FR-065 requires each reassignment to be its own audited command. Principle XIII
requires exactly one entry *per Command* and co-transactionality; a second `CommandBus.run` opens a
second fork and transaction. Nested execution is the only shape that satisfies all three without a
hand-placed audit call.

**Alternatives rejected.** *One `organization_role.delete` entry listing every moved member* — fails
FR-065's "each". *Recording the reassignments with `auditLog.recordWithin` by hand* — Principle XIII
gate 12, double-audit shape. *Sequential bus runs* — not atomic.

## R-23 — Delivery: one integration branch, deprecate then delete

**Status: accepted by owner ruling PR-1 (2026-11-03)** — see `plan.md` § *Plan-phase owner rulings*. WP-00 goes to `master` first and waits for #656.

**Decision.** P1 and P2 are built on an integration branch `feat/170-organization-roles` cut from
`origin/master` after WP-00 merges. Every work package branches from it and merges back into it; the
integration branch reaches `master` once, after WP-13. P3 gets its own integration branch later.

Inside the branch, legacy symbols are **deprecated before they are deleted**: WP-01 adds every new
contract shape *beside* the old one and marks the old one `@deprecated`; Wave 2 moves each consumer
to the new shape and stops reading the old; WP-12 deletes the old symbols and columns, and a
compile plus the inventory command (R-14) proves nothing still names them.

The data follows the same rule. From WP-02b until WP-12, `customer_accounts.role` and
`organization_invitations.role` are **dual-written**: every assignment writes the role reference and
the matching enum (`administrator` → `organization_admin`, else `regular_user`), so a Wave 2 module
that has not yet been converted reads a consistent answer. M3's default trigger (R-28) derives the
role from `new.role` while that column exists — a fixture inserting `role: 'organization_admin'`
gets the administrator role — and M5 redefines it to the plain *Member* default when it drops the
column. Only WP-12 sweeps the test files that name the enum (54 at `d31bab44b`).

**Rationale.** OR-4 makes the contract change breaking with no window, so a partial merge to
`master` would leave every release cut in between shipping half a contract. A long-lived branch is
the cost; it is paid by merging `master` into it at least daily, regenerating
`composer:generate` artefacts on conflict rather than hand-merging them
(`module-admin-surfaces.md` § *The generated admin registry conflicts*). Deprecate-then-delete is
what lets six agents work in parallel against a branch that stays green.

**Alternatives rejected.** *WPs straight to `master`* — releases in between would carry a broken
half. *One agent, one MR* — 59 files and 79 test files in one review.

## R-24 — Requests that still send `role` are refused, not ignored (FR-073)

**Decision.** Every request schema this feature touches is a `z.object({...}).strict()`, so an
unknown key — `role` included — fails validation with `400 VALIDATION_FAILED` naming the key.
Response schemas drop `role` and gain `organizationRole: { id, name, kind }` and, on the session
views, `permissions: string[]`. Zod's default `.object` strips unknown keys silently, which is the
behaviour FR-073 forbids, so `.strict()` is load-bearing and each contract test sends `role` once.

## R-25 — Approval is judged by the permission at placement; statuses follow by event *(refines R-4)*

**Decision.** `cartApprovalRequired(buyer)` becomes `!(await permissions.can(buyer,
'carts.order_without_approval'))`. The placement gate from #656 refuses iff approval is required
**and** the cart is not `approved`. The FR-034 cascade (a role gaining the permission returns its
members' `pending` carts to `not_required`) is a `carts` subscriber to two events the role and
assignment commands emit on commit — `organization_role.permissions_changed.v1` and
`customer_account.organization_role_changed.v1` — not a synchronous call from `organizations`
into `carts`.

**Rationale.** With the gate judging the permission, a `pending` cart whose owner has since gained
*Place orders without approval* is placeable even if the event were lost, so the cascade is
presentation consistency (the CTA), never a security boundary. That makes an in-process, post-commit
event the right seam: `organizations` (non-deactivatable) does not reach into `carts`, and no
lifecycle edge is added.

## R-26 — Operator "on behalf" endpoints are not judged by organization permissions

**Decision.** Operator endpoints that act on a buyer's basket or quotes
(`POST /api/v1/admin/quote-requests/:id/prepare-customer-basket`, `quick_order`'s
`onBehalfOf` build in `routes.admin.ts`) are gated by **operator** permissions only. What they
produce is still judged by organization permissions when the **member** acts on it: placement of a
basket the operator prepared is refused for a member who needs approval. Impersonation is different
and stays as the spec says: the impersonated member's permissions apply.

**Rationale.** An operator is not a member and holds no organization role; organization permissions
gate what a member may do, and the placement gate is where approval is enforced (R-25), so no bypass
opens.

## R-27 — FR-072's replay: an oracle recorded before the change, a replay after it

**Decision.** Two tests, in two places in time.

1. **WP-00, on `master`, before any 170 code** — `backend/test/integration/organizations/
   roles-upgrade-oracle.test.ts` seeds the fixture population (Organizations with and without cart
   approval; members of both kinds, including a blocked and a deleted one; pending, expired and
   accepted invitations of both kinds; carts in `not_required`, `pending`, `approved`, `rejected`),
   performs one HTTP request per gated action per member, and asserts the outcome table committed
   at `backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts`. The table is recorded by
   the code it describes.
2. **WP-13, on the integration branch** — `backend/test/integration/organizations/
   roles-upgrade-replay.test.ts` takes a migrated clone (`backend/test/helpers/migrated-database.ts`),
   runs the `down()` statements of M5, M4, M3, M2 in that order to reach the pre-170 schema, inserts
   the same population with raw SQL in the old shape, runs the `up()` statements of M2–M5 (the
   pattern of `backend/test/integration/orders/new-to-paid-edge-migration.test.ts`), boots the test
   server, replays the same requests and asserts the **same table**, except the rows of the
   expected-differences table (R-36; `contracts/migration-and-replay.md` §6.1), each of which must
   equal its stated `after`. *(Originally "exactly one row allowed to differ"; the recorded oracle
   showed four more families the design changes, ruled on as PR-3, PR-5 and PR-7.)*
   It then runs M2–M5 `up()` a second time and asserts nothing changed (FR-074).

The oracle's request list is the source of the replay's; WP-13 imports it.

**Alternatives rejected.** *Hand-writing the expected table* — it would encode the author's belief
about today's behaviour, not today's behaviour. *Running the old code in the replay* — the old code
is not in the tree after WP-12.

## R-28 — Both predefined roles exist by construction; an account without a role is a *Member*

**Status: accepted by owner ruling PR-2 (2026-11-03)** — both triggers are built (WP-02a, WP-02b).

**Decision.** Two database rules, each in the migration of the module that owns the table it fires on:

- **M2 (`organizations`)** installs `after insert on organizations for each row` →
  insert the `administrator` and `member` rows for `new.id` (empty arrays). FR-001 then holds for
  every creation path — `registration-service.ts`, `commands/create-organization.command.ts`,
  `personal-organization-service.ts`, `demo/seed.ts`, and the **84** test files that create an
  `Organization` directly — with nothing to remember. Application code that needs the new
  Organization's role ids in the same transaction reads them after the flush.
- **M3 (`customer_accounts`)** installs `before insert on customer_accounts for each row when
  (new.organization_role_id is null)` → set it to the Organization's `administrator` row when the
  Organization is personal (PR-3, R-34) or the legacy `role` is `organization_admin`, else its
  `member` row. It is the
  database's statement of the default the entity carries today (`role = 'regular_user'`,
  `customer-account.entity.ts:100`). Production paths always pass the role explicitly — the write
  port's input requires it — so the rule exists for the **50** files that `em.create(CustomerAccount,
  …)` directly (45 of them tests) and keeps FR-006's `not null` structural without touching them.

**Rationale.** Measured on `d31bab44b`: 84 files create an `Organization` and 50 a `CustomerAccount`
through the entity manager, most of them tests, most not naming a role at all. A call-site seeder
plus a required entity property would turn this feature into a 130-file fixture sweep whose only
content is boilerplate, on top of the 79 test files that really change; a nullable column would make
FR-006 a convention. `specs/conventions/module-migrations.md` item 4a counts a trigger as a write on
the table it fires on, which is each owner's own table here; M3's trigger function **reads**
`organization_roles`, an R1 read covered by the declared dependency. The repository already holds a
trigger-enforced invariant in `packages/modules/projects/src/migrations/20261026T144350_projects_init.ts`.

**Alternatives rejected.** *Call-site seeding everywhere* — the sweep above, and a missed call is a
latent defect until an account is inserted. *A boot-time repair* — hides a missed path until a
restart. *A MikroORM `onFlush` subscriber* — no module-contributed subscriber seam exists; the
platform's only one is the tenancy write guard.

## R-29 — Custom role names, protected names, and stale edits

**Decision.** A custom role's name is trimmed and compared case-insensitively against the
Organization's other custom roles **and** against the predefined roles' labels in every shipped
language (`Administrator`, `Member`, and their Polish labels), refused with
`409 ORGANIZATION_ROLE_NAME_TAKEN`. Every role write carries `expectedVersion`; a mismatch is
`409 ORGANIZATION_ROLE_STALE` (spec *Edge Cases*, concurrent edits). The 51st custom role is
`422 ORGANIZATION_ROLE_LIMIT_REACHED`.

**Last administrator** keeps today's codes and is made race-free: the change-role and
remove-member Commands lock the Organization's administrator holders (`select … for update` on
`customer_accounts` rows of the administrator role, inside the Command's transaction) before
counting, so two concurrent demotions cannot both pass.

## R-30 — RFQ visibility before and after P3

**Decision.** In P1+P2, "sees every quote request of the Organization" is
`permissions.isAdministrator(ctx)` — today's behaviour with the comparison moved behind the port —
and `RfqCustomerContext.isOrgAdmin` is deleted in WP-12. `quote_requests.approve` and
`quote_requests.send_without_approval` are declared in **P3**, when the state they govern exists;
P3 then switches visibility to `can(ctx, 'quote_requests.approve')` (FR-041). P2 declares only
`quote_requests.create`.

**Rationale.** Declaring *Approve quote requests* before there is anything to approve would put a
checkbox on every Organization's role editor that does nothing but widen a list. When P3 ships, FR-023
grants `send_without_approval` to every *Member* on first sight, so P3 changes nobody's outcome.

## R-31 — Permission labels reach the storefront translated, per request

**Decision.** `GET /api/v1/organizations/mine/permission-catalogue` (administrators) and
`GET /api/v1/organizations/mine/role` (every member, FR-058) answer each permission with `label` and
`description` already translated into the request language, through `_i18n`'s
`adminI18nService.translate(moduleId, 'organizationPermissions.<code>.label', language)` — the port
`organizations` already resolves for global search. The manifest's English `label` / `description`
are the fallback. Case 1 of `specs/conventions/module-i18n.md` (the backend can resolve the reader's
language), and the reason is the one R-11 gives: the storefront cannot know at build time which
modules an instance has.

## R-32 — What is audited, against which object

**Decision.** Every Command this feature adds audits against **`objectType: 'organization'`,
`objectId: <organizationId>`**, with the role or member id and the before/after role name, kind and
sorted permission list in the state. `customer_account.change_role` (today hand-audited by
`role-service.ts` against `customer_account`) moves onto the bus under the same action name and the
Organization object.

**Rationale.** FR-066 puts these entries in *the Organization's* history, and the audit substrate's
only object filter is `(objectType, objectId)` (`packages/modules/audit_logs/src/admin/pages/
AuditLogViewer.tsx`, `?objectType=…&objectId=…`). The Roles tab links to
`/audit-log?objectType=organization&objectId=<id>`; no audit-viewer change is needed.

**Alternatives rejected.** *Per-object types (`organization_role`, `customer_account`)* — the history
would be scattered over one object per role and one per member, with no screen that shows them
together. *An `organization_id` column on `audit_log_entries`* — a platform schema change for one
screen.

## R-33 — Dependencies on work merged or in flight

| Item | State at planning | What this plan assumes / where it bites |
| --- | --- | --- |
| #647, #654, #659 (cart approval CTA, refusal codes, pending edit) | merged | Baseline behaviour of WP-00's oracle and WP-04 |
| #656 (#648, placement gate, `ORDER_CART_APPROVAL_REQUIRED`, `cart-approval-policy.ts`) | open | **Blocks WP-00** (the oracle must record placement outcomes) and **WP-04** (rewrites `approvalSubmissionRequired`) |
| #655 (#651, approval e-mails) | open; **merged 2026-11-03** | **Blocks WP-04**'s FR-035 recipient change (`cart-approval-emails.ts`) |
| #670 (#665, clone/reorder through the order read scope) | merged | WP-07 swaps the admin test inside `OrderAccessService` only; clone and reorder follow it |
| #680 (#669, invoices via `OrderReadPort.findByIdForCustomer`) | open; **merged 2026-11-03** | WP-07: FR-049's "its documents" holds through the order scope once #680 lands; WP-07's colleague-invoice test needs it |
| #674 (#666, storefront module presence in nav) | merged | WP-09 builds the account nav on `storefront/lib/module-gate.ts` |
| #653 | resolved by this feature | WP-06 (`quick_order.one_click`) |
| #667 (invitation role label) | resolved by this feature | WP-03 |
| #668 (organization addresses) | resolved by this feature | WP-03 (`addresses.manage`) |

## R-34 — A personal Organization's member is its *Administrator* (owner ruling PR-3, 2026-11-03)

**Decision.** The spec's *Edge Cases* stand: a personal (B2C) Organization's sole member holds
*Administrator*. The WP-00 oracle showed today's code disagrees — `createStandalone` and the
federated sign-in name no role, so the entity default `regular_user` applies — and the upgrade
changes that:

- **Upgrade.** M3 maps every account of a personal Organization to *Administrator* whatever its
  `role`; the R-28 default trigger does the same for an account inserted without a role
  (`contracts/migration-and-replay.md` §3). M3 does not rewrite the legacy `role` column.
- **Every path into a personal Organization assigns *Administrator*.** Self-registration
  (`customer_accounts` `createStandalone`, `services/customer-account-lifecycle-ports.ts`), the
  federated sign-in's account creation (`customer_accounts/src/backend/index.ts`),
  `ensureForCustomerAccount` (`organizations/services/personal-organization-service.ts`) and the
  operator's detach (`customers` `unassign` → `detachToPersonalOrganization`). The provisioning
  answers — `PersonalOrganizationProvisionApi.provisionFor` and
  `personalOrganizationPort.provisionPersonalOrganization` (`organizations/src/ports/index.ts`) —
  carry `administratorRoleId`, read by `organizations` **on the caller's `EntityManager`** after the
  R-28 trigger has inserted the row: self-registration and federated sign-in create the
  Organization and the account in one transaction, which a read through the cache on another
  connection would not see.
- **Moving an account between Organizations sets its role in the same write**, because the
  composite FK refuses the old Organization's role (data-model §2). The account write port's
  `setOrganization`, `detachToPersonalOrganization` and `attachToOrganization` take
  `organizationRoleId`. Destination personal → *Administrator*. Destination a company (the
  operator's assign) → the target's predefined role of the kind the account held (*Administrator*
  stays *Administrator*, anyone else becomes *Member*; a custom role does not travel), resolved by
  `organizationRoleReadPort.predefinedRoleId` (`contracts/organization-permission-port.md` §1) —
  today's outcome, since the legacy enum travels unchanged. Confirmed as owner ruling PR-11.

**What relied on the role to stay hidden, and what gates it now.** Measured on `origin/master` at
`75b069175`:

| Surface | Hidden for a personal Organization today because | After |
| --- | --- | --- |
| Storefront account nav *Members* (`storefront/app/(account)/layout.tsx`, `isAdmin`) and the pages under `app/(account)/organization/{members,carts}` | the member is `regular_user` | gated by `organization.isPersonal` (already on `/api/v1/me`): *Members*, *Roles* and *Carts to approve* are not rendered and the pages redirect to `/account` (WP-09) |
| Role routes (`/api/v1/organizations/mine/roles…`) | — (new) | `404` for a personal Organization (`storefront-api.md`, unchanged) |
| Invitation create; operator direct add | role first, then `isPersonal` (`invitation-service.ts`, `routes.admin.ts`) | `isPersonal` → `422 VALIDATION_FAILED`, now the first refusal, checked before the role id is resolved |
| Members list, invitations list, organization carts, MFA policy, Organization one-click defaults | the role | answered as for any administrator — harmless for a single-member Organization (oracle rows 1–8 of §6.1) |
| Removing or demoting oneself | the role | the last-administrator guard (`409 CANNOT_REMOVE_LAST_ADMIN` / `CANNOT_DEMOTE_LAST_ADMIN`) |
| Operator deletion, blocking and unassign of a customer (`customers` `customer-{deletion,moderation,org-assignment}-service.ts`, `ORG_OWNER_DEPLETION`) | a `regular_user` is never the last administrator | **would refuse deleting or blocking every B2C customer.** The depletion guards apply to company Organizations only (`isPersonal` from `organizationDetailsPort`); a personal Organization's depletion is its intended end (`anonymizeIfOrphaned`) |
| Moderation e-mail recipient (`organization-moderation-service.ts`, first administrator) | personal Organizations never enter moderation (`requireStatus: 'pending_verification'`) | unchanged |
| Colleague reach (orders, RFQs, organization carts, invoices) | the role | widened to the Organization — a no-op with one member |
| Admin UI *Roles* tab | — (new) | hidden for a personal Organization (T094, unchanged) |

A custom storefront that gates organization-management screens on
`organizationRole.kind === 'administrator'` must also test `!organization.isPersonal` (spec
*Upgrade note*).

**Rationale.** The spec's invariant *"an Organization always has at least one active member holding
Administrator"* is structural in this feature (last-administrator guards on every seam); a personal
Organization with no administrator would be the one Organization kind that violates it. Its member
transacts only for themselves, so "may do everything in their Organization" is the honest statement
of what they can already do. Hiding management surfaces is a property of the Organization's kind,
not of the member's role, and is now gated by that fact.

**Alternatives rejected.** *Keep `regular_user` → Member, as recorded* — every personal Organization
would sit below the last-administrator invariant, and its *Member* role would govern a B2C buyer with
no screen anyone could edit it from. *Hide the personal surfaces by role* — conflates the tenant's
kind with the member's authority; it is exactly what left today's personal Organizations
administrator-less. *Answer `404` on every member and invitation route for a personal Organization,
as the role routes do* — more surface changed for no visible gain, since the storefront offers none of
them. Rejected deliberately by owner ruling PR-10 (2026-11-03): those routes answer as for any
administrator.

## R-35 — The guard judges signed-in customers only where a route admits guests (owner ruling PR-4, 2026-11-03)

**Decision.** `organizationPermissionPreHandler(getPort, code, options?: { guests?: 'refuse' | 'pass' })`.
The default `'refuse'` keeps R-20's rule: a non-customer actor gets the platform's `401` (a second
line behind `requireCustomer`). `'pass'` lets every non-customer actor through **unjudged**, to the
route's own handling exactly as today, and judges a customer actor — impersonation included. It is
declared with `'pass'` on precisely the routes that admit a guest today: `POST /api/v1/cart/items`,
`PATCH`/`DELETE /api/v1/cart/items/:itemId`, `POST`/`DELETE /api/v1/cart/coupon`, and any batch-add
or empty-cart route that admits one (`contracts/storefront-api.md` §5). `GET /api/v1/cart` stays
ungated (R-5). On the storefront, add-to-cart and cart editing are offered to a signed-out visitor;
for a signed-in member they follow `can(session, 'carts.create')`.

**Rationale.** PR-4: the guest basket belongs to no Organization and no role, so there is nothing to
judge; the oracle's blocked and deleted members, who are anonymous, prove today's `200`. Keeping the
default `'refuse'` keeps every other guard fail-closed; the option is opt-in per route.

**Alternatives rejected.** *A second guard function* — two names for one rule, and a call site that
picks the wrong one fails open. *Moving `carts.create` into the handler* — R-20's consumer checklist
(a route gate is a `preHandler`, never a handler check), and the inventory reads pre-handlers.

**The sign-in merge (owner ruling PR-12, 2026-11-03).** The login merge (`carts`
`CartService.mergeAnonymousIntoCustomer`, called by the login hook in `backend/src/composition.ts`,
feature 037) moves a guest basket's lines into the member's basket — a cart write by the now
signed-in member. It is judged against `carts.create`: for a member whose role lacks it the merge is
**skipped** — no line moves, the guest basket keeps its rows and its token, and the outcome is a new
internal value `skipped_permission`, narrowed to `noop` on the login answer (no merge toast). The
login route keeps the `b2b_cart_anon` cookie on that outcome, as it does for `noop_no_anon`, and the
login itself never fails because of it (037 FR-007/FR-008). The oracle has no sign-in row, so FR-072
is unaffected.

*Alternatives rejected.* *Merge anyway* — a role without `carts.create` would build a cart as a
guest and carry it in at sign-in, which is the bypass the gate exists to close. *Discard the guest
basket* — destructive, and the visitor loses their lines on signing in with a restricted role.

## R-36 — Expected differences are stated per row, by oracle request id (owner rulings PR-5, PR-6, 2026-11-03)

**Decision.** WP-13's replay compares every row's whole `{ status, code }` with the oracle, except
the rows of an explicit table, `contracts/migration-and-replay.md` §6.1 — 26 rows in five families —
each of which must equal its stated `after`. The table is a WP-13 fixture
(`backend/test/fixtures/organization-roles/expected-differences.ts`) checked on every merge request
by a service-free unit test against the frozen oracle. The F4 rows are exactly the two
`oneClickInApprovalOrg` rows (PR-6).

Three orderings the table depends on are pinned here, so each `after` is determined (the first and
third confirmed by the owner as PR-9 and PR-8):

1. **Approve and reject check the cart's state before self-approval.** `CART_APPROVAL_NOT_PENDING`
   stays first in `cart-approval-service.ts`; `CART_APPROVAL_SELF_APPROVE` refuses only a pending
   cart of one's own (rows 5–6).
2. **Inviting into a personal Organization is refused before the role id is resolved** (rows 9–10).
3. **One-click judges `quick_order.one_click` before `carts.order_without_approval`**, both in the
   eligibility reason and in the placement refusal (R-6; rows 23–24).

`CART_APPROVAL_SELF_SUBMIT` becomes unreachable (row 22): WP-04 stops raising it and removes it from
`carts`' manifest `errorCodes` and bundles; WP-12 deletes it from `packages/contracts/src/errors.ts`
with the other legacy symbols.

**Rationale.** FR-055 makes `403 FORBIDDEN` and `403 ORGANIZATION_PERMISSION_REQUIRED`
distinguishable on purpose; a status-only comparison would let any unintended code change through.
Keying by request id makes each difference reviewable, and checking `before` against the oracle
stops the table from drifting.

**Alternatives rejected.** *Status-only comparison* — above. *Editing `PRE_UPGRADE_OUTCOMES`* — it
would erase the record of today's behaviour, which is the oracle's only purpose (R-27). *Tagging the
oracle rows* — the oracle is frozen once #689 merges and describes today, not the design.

## R-37 — The pending-invitations list excludes expired invitations (owner ruling PR-7, 2026-11-03)

**Decision.** An invitation is **pending** iff it is neither accepted (`consumedAt`), revoked
(`revokedAt`) nor expired (`expiresAt <= now`, the acceptance path's own test in
`organizations/services/invitation-service.ts`). `InvitationService.listPending` — behind
`GET /api/v1/organizations/mine/invitations` — and `OrganizationRoleView.pendingInvitationCount` use
that one predicate (FR-010a). Unchanged: revoking an expired invitation, and FR-024's deletion moving
every invitation of the deleted role, expired ones included (the FK does not distinguish them).

**Rationale.** An expired invitation cannot be accepted; listing it as pending tells the
administrator a colleague is about to join who cannot. The oracle recorded it (§6.1 rows 25–26).

**Alternatives rejected.** *List expired invitations with a status* — a new response field and UI
nobody asked for. *A sweep that deletes expired invitations* — destructive, and loses the audit
trail of who was invited.
