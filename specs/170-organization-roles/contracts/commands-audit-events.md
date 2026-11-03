# Contract: Commands, audit entries, events and cache drops

**Normative for**: WP-01 (bus extensions), WP-02a, WP-02b, WP-03, WP-04. Decisions: research
R-10, R-21, R-22, R-25, R-32. Principle XIII.

## 1. Platform extensions — WP-01

| Change | File |
| --- | --- |
| `CommandActor.actorCustomerAccountId: string \| null` | `packages/platform/src/commands/command.ts`, `actor.ts` |
| `audit_log_entries.actor_customer_account_id` (M1) and the entity property | `packages/platform/src/kernel/audit/audit-log-entry.entity.ts`, core migration |
| `RecordAuditInput.actorCustomerAccountId?` | `packages/platform/src/kernel/ports/audit.ts` and the writer |
| `CommandContext.run(child)` — child on the parent's `em` and actor, its own single audit entry inside the parent's transaction, its event buffered in the parent's scope | `command.ts`, `command-bus.ts` |

Unit tests in `packages/platform/src/commands/command-bus.test.ts`: a child's entry and the
parent's commit together; a throwing child rolls back the parent and every sibling's entry; a
`skipAudit` child records nothing; the customer actor lands on the column; impersonation still lands
on the two impersonation columns and leaves the new one `null`.

## 2. Commands

All audit against `objectType: 'organization'`, `objectId: <organizationId>` (R-32). State
snapshots carry sorted permission lists so a diff reads without a join.

| Action | Owner | Before → after | Event on commit | Cache drop |
| --- | --- | --- | --- | --- |
| `organization_role.create` | `organizations` | `null` → `{ role: { id, kind, name, description, permissions } }` | — | org |
| `organization_role.update` | `organizations` | `{ role }` → `{ role }`; `skipAudit` when equal | `organization_role.permissions_changed.v1` when `permissions` changed | org |
| `organization_role.delete` | `organizations` | `{ role, memberCount, invitationCount }` → `{ deletedRoleId, replacementRoleId, reassignedInvitations: [id…] }`; one child `customer_account.change_role` per held account | — (children emit) | org |
| `customer_account.change_role` | `customer_accounts` | `{ customerAccountId, role: { id, name, kind } }` → same | `customer_account.organization_role_changed.v1` | — (the assignment is read per request, R-15) |
| `customer_account.remove_member` | `customer_accounts` | `{ customerAccountId, role }` → `null` | — | — |
| `customer_account.promote_organization_admin` | `customer_accounts` | as today, now `{ role }` refs | `customer_account.organization_role_changed.v1` | — |
| `organization_invitation.create` | `organizations` | `null` → `{ invitationId, email, role: { id, name, kind } }` | — | — |
| `organization_invitation.revoke` | `organizations` | as today, moved onto the bus if not already | — | — |

`customer_accounts` publishes `customer_account.change_role` to `organizations` as a **Command
factory** behind a port whose signature takes no `EntityManager` (the child runs on the parent's
through `ctx.run`): `customerAccountRoleCommandPort.changeRole(input): Command<…>` and
`customerAccountRoleCommandPort.holdersOf(organizationId, roleId): Promise<string[]>` — registered
with `ctx.di.providePort`, type in `packages/contracts/src/customer-accounts.ts`, resolved by
`organizations` with `lazyPort`, and recorded as one more entry in `organizations`'
`acknowledgedDependencies` (the existing mutual pair, `manifest.ts` "Same mutual pair, same trade").

**`role-service.ts`'s hand-placed `recordAuditFromContext` calls are removed in the same change**
(Principle XIII gate 12), and `customer_accounts` is checked by the command-coverage instrument
as a migrated module from WP-02b on.

## 3. Last-administrator guard

Inside `customer_account.change_role` and `customer_account.remove_member`, before counting:
`select id from customer_accounts where organization_id = $1 and organization_role_id = $adminRoleId
and deleted_at is null and blocked_at is null for update`. The administrator role id comes from
`organizationRoleReadPort.predefinedRoleId(organizationId, 'administrator')`. `customers`' three
guards (`customer-org-assignment-service.ts`, `customer-deletion-service.ts`,
`customer-moderation-service.ts`) call `customerAccountReadPort.countAdministrators(organizationId,
{ excludeCustomerAccountId?, activeOnly })`, which replaces `countByOrganizationRole`.

## 4. Subscribers

| Subscriber | Module | On | Does |
| --- | --- | --- | --- |
| cart approval reset | `carts` (`ctx.subscribe`) | `organization_role.permissions_changed.v1` with `carts.order_without_approval ∈ added` | every `pending` cart of an account holding `roleId` → `not_required`, through `carts`' own audited transition (FR-034) |
| cart approval reset | `carts` | `customer_account.organization_role_changed.v1` where the new role holds `carts.order_without_approval` and the old did not | the account's `pending` carts → `not_required` |

Loss of either event leaves a `pending` cart that is nonetheless placeable (R-25); the subscriber's
integration test asserts both the reset and, with the subscriber disabled, the placeability.

## 5. Cache drops

The cache holds roles and their grants, never assignments (R-15), so only the three
`organization_role.*` Commands drop it. The `organizations` service that called `commandBus.run`
drops **after the call resolves** — i.e. after commit — with `OrganizationRoleCache.dropAndAnnounce(
organizationId)`: local drop, then publish on `b2b:organization-roles:changed`. A rolled-back
Command drops nothing. An assignment change takes effect on the next request everywhere, because the
auth hook reads the account row on every request.
