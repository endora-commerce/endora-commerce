# Contract: `customerAccountCommandPort` (CustomerAccount, #1822)

Owner `customer_accounts` (non-deactivatable). Declared in `packages/contracts/src/customer-accounts.ts`.
The admin routes for accounts are registered by **`customers`** (`/api/v1/admin/customers/…`) and by
**`organizations`** (`/api/v1/admin/organizations/:id/members/…`, in `routes.admin.ts`); both called
the narrow ports, and both move onto this one — which is how "the admin route and the port run the
same Command" holds for an aggregate whose admin surface other modules own.

## Operations

Readiness codes: research R-2, **as measured by the T002 inventory** (2026-11-26, `origin/master` at
`71035e51d`). "Route" is the admin route for the operation; "Side effects" is everything the route,
or the service it calls, does outside the write itself, which the port call must reach too (FR-013).
File references are relative to `packages/modules/customer_accounts/src/backend/` unless they say
otherwise; `customers/…` and `organizations/…` are `packages/modules/<id>/src/backend/…`.

| Method | Command action (kept) | Admin route (module) | Readiness | Side effects outside the write | Work |
| --- | --- | --- | --- | --- | --- |
| `create(input, options?)` | `customer_account.create` (`commands/customer-account-create.command.ts`) | `POST …/organizations/:id/members` (`organizations/routes.admin.ts`) | C | the route validates the custom-field values first, emits `customer_account.created.v1` and writes its own `customer_account.admin_create` entry (the host's fact, kept — finding 6) | port only |
| `createStandalone(input, options?)` | `customer_account.register_standalone` | none — the buyer's `POST /api/v1/customers/register` (`customers/routes.register.ts`) | **H-in** (`services/customer-account-lifecycle-ports.ts`: `recordAuditFromContext` on the transaction's `em`, in an `EventBus.run` scope since #1926) | none after commit; the personal Organization is provisioned on the same transaction (D-178) | **convert** |
| `updateProfile(id, patch, options?)` | `customer_account.update_profile` | `PATCH …/organizations/:id/members/:customerAccountId` (`organizations`) | **H-in** (`services/customer-account-ports.ts` `CustomerAccountMemberWriteService`, `recordAuditFromContext` before the flush) — the `?` resolved | the route checks `expectedUpdatedAt` and writes `customer_account.admin_profile_update` (finding 6) | **convert** |
| `block(id, { reason? }, options?)` | `customer_account.blocked` | `POST /admin/customers/:id/block` (`customers`) | **H-post, not H-in** (measured): the lifecycle service flushes, then records through `AuditPort.record`, which forks and commits on its own | **`customers` ends the account's sessions after the port call** (`CustomerModerationService.block` → `sessionService.destroyAllForCustomer`) and, before it, refuses the last administrator of a company Organization (`409 ORG_OWNER_DEPLETION`, `OrganizationDepletionGuard`, a read without a lock); the route passes the request's IP and user agent as `audit` | **convert**; both side effects move into the Command (findings 1, 2); drop `actorAdminUserId` and `audit` |
| `unblock(id, options?)` | `customer_account.unblocked` | `POST …/:id/unblock` | **H-post** | none | **convert** |
| `softDelete(id, options?)` | `customer_account.deleted` | `DELETE /admin/customers/:id` | **H-post** | **`customers` ends the sessions** after the call and runs the depletion guard before it (`CustomerDeletionService.softDelete`) | **convert**; as `block` |
| `restore(id, options?)` | `customer_account.restored` | `POST …/:id/restore` | **H-post** | `customers` refuses a restore past `customers.deletion_retention_days` (`409 CUSTOMER_RESTORE_WINDOW_ELAPSED`) before the sweep has reached the account | **convert**; the window stays the caller's (finding 3) |
| `setCustomerGroup(id, { customerGroupId }, options?)` | `customer_account.group_assigned` | `PUT …/:id/customer-group` | **H-post** | none | **convert** |
| `setCustomFieldValues(id, merge, options?)` | `customer.custom_fields.update` | `PATCH …/:id/custom-fields` | C (inline Command in the lifecycle service) | the route validates inside `merge` and re-reads the detail | port only; the inline Command becomes a factory |
| `setSubtreeRollup(id, { enabled }, options?)` | `customer_account.set_subtree_rollup` | `PATCH …/members/:customerAccountId/rollup` (`organizations`) | C | the route checks `expectedUpdatedAt` | port only |
| `promoteToOrganizationAdmin(id, options?)` | `customer_account.promote_organization_admin` (against the Organization) | **none** — `POST …/:id/recover-admin-access` runs `customer_account.change_role` to the *Administrator* role | C | none | port only; parity against `customerAccountMemberWritePort.promoteToOrganizationAdmin` |
| `markEmailVerified(id, { verifiedAt }, options?)` | `customer_account.email_verified` | none — `organizations`' public verification link (`services/email-verification-service.ts`) | **H-in** (`recordAuditFromContext` before the flush; idempotent, no entry on a repeat) — the `?` resolved | none | **convert** |
| `changeRole(id, { organizationRoleId }, options?)` | `customer_account.change_role` (against the Organization) | `PATCH …/members/:customerAccountId/role`, and `POST …/:id/recover-admin-access` (`organizations`) | C | the route checks membership of `:id` and `expectedUpdatedAt`; `customer_account.organization_role_changed.v1` on commit (the Command's event) | port only; the port reads the account's Organization, which the Command needs |
| `setPreferredLanguage(id, { language }, options?)` | `customer_account.set_preferred_language` | none on the admin side — the buyer's own `PATCH /api/v1/me/customer/preferred-language` (`customers/routes.self.ts`), through `customerAccountPreferencePort` | C | the route checks the tag against the request channel's languages | port only; finding 4 |
| `removeMember(id, options?)` | `customer_account.remove_member` (against the Organization) | `DELETE …/members/:customerAccountId` (`organizations`) | C | the route writes `customer_account.admin_remove` (finding 6) | port only |
| `anonymize(id, options?)` | `customer_account.anonymized` | retention sweep (`customers/workers/anonymization-sweep-worker.ts` → `CustomerDeletionService.sweep`) | **H-in** (`auditLog.recordWithin` on the locked row's transaction; `command-coverage-ignore`) | `customer_account.anonymized.v1` after commit, on the transition only, awaited in a bus scope | **convert** |

**Not offered**: `setOrganization`, `detachToPersonalOrganization`, `attachToOrganization` — moving an
account between Organizations is `membershipPort` (`specs/191-membership-join-requests/`, #1831), which
deprecates those methods (191 T007, T026, T026a). They stay as they are: the first two H-post in
`services/customer-account-lifecycle-ports.ts`, the third H-in in `services/customer-account-ports.ts`.
Password change and reset, sign-in throttling, social registration (`customer_account.register_social`)
— authentication flows, not aggregate lifecycle writes an integration performs.

**Reads moved**: `listDueForAnonymization`, `hasDueForAnonymization` → `customerAccountReadPort`.

### Inventory findings (T002)

1. **The session revocation on block is not the lifecycle port's.** `customerAccountLifecycleWritePort.block`
   only writes and audits; `customers`' `CustomerModerationService.block` and
   `CustomerDeletionService.softDelete` call `authSessionPort.destroyAllForCustomer` after the port
   returns. A server-side caller of the port would block an account and leave its sessions live.
   Decided in research R-17.1: the Command defers the revocation to its commit through
   `EventBus.afterScope`.
2. **The depletion guard of a block and a deletion is `customers`'.** `OrganizationDepletionGuard`
   counts the company Organization's other active, unblocked administrators through
   `customerAccountReadPort.countAdministrators`, outside any transaction and without a lock, before the
   write. A port call would bypass it, and two concurrent blocks can both pass it. R-17.2: the guard
   moves into the Command, under the holders' lock the role Commands already take. It stays in
   `customers` for `unassign`, the Membership move.
3. **The restore window is `customers`' setting.** `customers.deletion_retention_days` is read by
   `customers` (which depends on `customer_accounts`, not the other way round). R-17.3: the window stays
   the caller's gate, documented on the port; the Command keeps the owner's own refusal of an anonymised
   account.
4. **`setPreferredLanguage` has no admin route, and its state already records `source`.** The one route
   is the buyer's own page — customer-facing, where R-7 says the port is never resolved — and
   `customer_account.set_preferred_language` records `source: 'self_service' | 'sign_in'`, the key the
   aggregate ports record a caller's code under (R-4). R-17.4.
5. **The member routes are in `organizations/routes.admin.ts`, not `routes.members.ts`.** The latter is
   the storefront's member area (`requireCustomer` plus the Organization administrator gate), where an
   Organization administrator changes roles (`customerAccountRoleCommandPort`) and removes members
   (`customerRolePort`). R-17.5.
6. **The member-panel routes write a second entry of their own** — `customer_account.admin_create`,
   `.admin_profile_update`, `.admin_remove` through `organizations`' audit helper — recording that an
   operator edited the panel, beside the owner's entry (feature 075 Phase C kept both on purpose). They
   are the host's facts, not the aggregate's: the port does not write them, and the parity test leaves
   them out by action.
7. **No `version` column.** The member routes check `expectedUpdatedAt` against `updatedAt`; that is the
   route's gate. The port ignores `expectedVersion` on every method (R-5).
8. **Request metadata.** `customers` passed the request's IP and user agent to `block` / `unblock` as
   `audit`; the Command Bus stamps the ambient request's IP, user agent and request id on every entry, so
   the parameter goes with the conversion, and the deletion and restore entries gain the same metadata.
9. **`createStandalone` and `markEmailVerified` run from anonymous requests.** Anonymous traffic runs in
   system scope (`packages/platform/src/kernel/actor-tenant-context.ts`), so the Commands record no
   actor, as the hand audits did.
10. **Remaining callers of the deprecated methods after this change**: `organizations`'
    `invitation-service.ts` (`customerAccountMemberWritePort.create`, the invitation accept) and
    `email-verification-service.ts` (`.markEmailVerified`) — token-gated public flows, both delegating
    to the new port's Commands — and the paid `comarch_xl` module
    (`customerAccountLifecycleWritePort.setCustomerGroup`). They move before the removal release (US12).
    `comarch_xl` passes `source: 'comarch_xl'` when it moves (R-17.7). Findings 1–6 are ruled in R-17.1–R-17.6
    (architect, 2026-11-26), each as proposed.

## Interface (shape)

```ts
export interface CustomerAccountCommandPort {
  create(input: CustomerAccountCreateInput, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  createStandalone(input: CustomerAccountStandaloneCreateInput, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  updateProfile(id: string, patch: CustomerAccountProfilePatch, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  block(id: string, input: { readonly reason?: string | null }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  unblock(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  softDelete(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  restore(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setCustomerGroup(id: string, input: { readonly customerGroupId: string | null }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setSubtreeRollup(id: string, input: { readonly enabled: boolean }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  promoteToOrganizationAdmin(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  markEmailVerified(id: string, input: { readonly verifiedAt: Date }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  changeRole(id: string, input: { readonly organizationRoleId: string }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setPreferredLanguage(id: string, input: { readonly language: string }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  removeMember(id: string, options?: AggregateCommandOptions): Promise<void>;
  anonymize(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
}
```

`block`'s reason is the route body's (`blockCustomerRequestSchema`, at most 1000 characters), nullable —
the precedent of R-16.4. The three member methods take the account id alone: the Command is recorded
against the Organization, whose id the port reads off the live account.

`block` and `softDelete` end the account's sessions on the Command's after-commit path (FR-013,
R-17.1), and refuse the last company administrator inside it (R-17.2).

## Owner off

`customer_accounts` is non-deactivatable; sentence as on `customerAccountReadPort`.

## Deprecated by this port (0.113.0 → removed 0.114.0)

See `data-model.md` § *Port disposition* — `customerAccountLifecycleWritePort` (all but
`setOrganization` / `detachToPersonalOrganization`) and `customerAccountMemberWritePort` (all but
`attachToOrganization`). `customerAccountPreferencePort.setPreferredLanguage` is **not** deprecated
(R-17.4): it is the buyer's own write, and runs this port's method with the code `self_service`.

## Tests

`packages/contracts/src/customer-accounts.command-port.test.ts` (shape);
`packages/modules/customer_accounts/src/backend/commands/customer-account-lifecycle.commands.test.ts` and
`customer-account-anonymize.command.test.ts` (the Commands on the real bus);
`backend/test/contract/customer_accounts/customer-account-command-port.test.ts` (parity per method,
`source`, refusals); `backend/test/integration/customer_accounts/customer-account-command-port.worker.test.ts`
(block and delete from a worker with no administrator; sessions ended; system actor); and the existing
`backend/test/contract/customers/` admin-route regression (`admin-block`, `admin-lifecycle`,
`admin-customer-group`), now over the port.
