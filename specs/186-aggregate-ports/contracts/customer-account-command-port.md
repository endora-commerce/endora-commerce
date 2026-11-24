# Contract: `customerAccountCommandPort` (CustomerAccount, #1822)

Owner `customer_accounts` (non-deactivatable). Declared in `packages/contracts/src/customer-accounts.ts`.
The admin routes for accounts are registered by **`customers`** (`/api/v1/admin/customers/…`) and by
`organizations` (`/api/v1/admin/organizations/:id/members/…`); both today call the narrow ports, and
both move onto this one — which is how "the admin route and the port run the same Command" holds for
an aggregate whose admin surface another module owns.

## Operations

| Method | Command action (kept) | Admin route (module) | Readiness | Work |
| --- | --- | --- | --- | --- |
| `create(input, options?)` | `customer_account.create` | `POST …/organizations/:id/members` (organizations) | C | port only |
| `createStandalone(input, options?)` | the action `createStandalone` records today (T002 confirms) | none — server-side only today | H-in | convert |
| `updateProfile(id, patch, options?)` | `customer_account.update_profile` | `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId` (organizations) | ? | T002 confirms; convert if H |
| `block(id, { reason }, options?)` | `customer_account.blocked` | `POST /admin/customers/:id/block` | H-in | convert; drop `actorAdminUserId` |
| `unblock(id, options?)` | `customer_account.unblocked` | `POST …/:id/unblock` | H-in | convert |
| `softDelete(id, options?)` | `customer_account.deleted` | `DELETE /admin/customers/:id` | H-in | convert |
| `restore(id, options?)` | `customer_account.restored` | `POST …/:id/restore` | H-in | convert |
| `setCustomerGroup(id, { customerGroupId }, options?)` | `customer_account.group_assigned` | `PUT …/:id/customer-group` | H-in | convert |
| `setCustomFieldValues(id, merge, options?)` | `customer.custom_fields.update` | `PATCH …/:id/custom-fields` | C | port only |
| `setSubtreeRollup(id, { enabled }, options?)` | `customer_account.set_subtree_rollup` | `PATCH …/members/:customerAccountId/rollup` (organizations) | C | port only |
| `promoteToOrganizationAdmin(id, options?)` | `customer_account.promote_organization_admin` | members area | C | port only |
| `markEmailVerified(id, { verifiedAt }, options?)` | `customer_account.email_verified` | (server-only today) | ? | T002 confirms; convert if H |
| `changeRole(id, { organizationRoleId }, options?)` | `customer_account.change_role` | `PATCH …/members/:customerAccountId/role` (organizations) | C | runs `customerAccountRoleCommandPort.changeRole`'s Command as a root Command |
| `setPreferredLanguage(id, { language }, options?)` | `customer_account.set_preferred_language` | `PATCH /api/v1/me/customer/preferred-language` (buyer, self) | C | port only |
| `removeMember(id, options?)` | `customer_account.remove_member` | `DELETE …/members/:customerAccountId` (organizations) | C | port only |
| `anonymize(id, options?)` | `customer_account.anonymized` | retention worker | H-in | convert |

**Not offered**: `setOrganization`, `detachToPersonalOrganization`, `attachToOrganization` — moving an
account between Organizations is `membershipPort` (`specs/191-membership-join-requests/`, #1831), which
deprecates those methods in the same release. Password change and reset, sign-in throttling, social
registration — authentication flows, not aggregate lifecycle writes an integration performs.

**Reads moved**: `listDueForAnonymization`, `hasDueForAnonymization` → `customerAccountReadPort`.

## Interface (shape)

```ts
export interface CustomerAccountCommandPort {
  create(input: CustomerAccountCreateInput, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  createStandalone(input: CustomerAccountStandaloneCreateInput, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  updateProfile(id: string, patch: CustomerAccountProfilePatch, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  block(id: string, input: { reason: string | null }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  unblock(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  softDelete(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  restore(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setCustomerGroup(id: string, input: { customerGroupId: string | null }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setSubtreeRollup(id: string, input: { enabled: boolean }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  promoteToOrganizationAdmin(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  markEmailVerified(id: string, input: { verifiedAt: Date }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  changeRole(id: string, input: { organizationRoleId: string }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  setPreferredLanguage(id: string, input: { language: string }, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
  removeMember(id: string, options?: AggregateCommandOptions): Promise<void>;
  anonymize(id: string, options?: AggregateCommandOptions): Promise<CustomerAccountRecord>;
}
```

`block` with a session end: the conversion keeps whatever the lifecycle port does today after the
write (session revocation) on the Command's after-commit path (FR-013).

## Owner off

`customer_accounts` is non-deactivatable; sentence as on `customerAccountReadPort`.

## Deprecated by this port

See `data-model.md` § *Port disposition* — `customerAccountLifecycleWritePort` and
`customerAccountMemberWritePort` (all but the membership methods), and
`customerAccountPreferencePort.setPreferredLanguage`.

## Tests

`backend/test/contract/customer_accounts/customer-account-command-port.test.ts` (parity),
`backend/test/integration/customer_accounts/customer-account-command-port.worker.test.ts` (block from
a worker with no administrator; sessions ended), `backend/test/contract/customers/` admin-route
regression (the `customers` routes now call the port), delegation tests.
