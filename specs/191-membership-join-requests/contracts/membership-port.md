# Contract: `membershipPort` and `customer_account.organization.change` (#1831)

Owner: `customer_accounts`. Types in `packages/contracts/src/customer-accounts.ts` (platform-free,
structural Command type as `CustomerAccountRoleChangeCommand` already is). Research R-1 – R-7.

## 1. Types

```ts
/**
 * A code, never prose: who or what asked for the move (research R-7). The shape of
 * `specs/186-aggregate-ports/`' caller source (its R-4); when 186's schema lands in
 * `aggregate-ports.ts` this is an alias of it, not a second regex.
 */
export const membershipChangeSourceSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
export type MembershipChangeSource = z.infer<typeof membershipChangeSourceSchema>;
/** Core writes these; a deployment may write its own code. */
export const MEMBERSHIP_CHANGE_SOURCES = { operator: 'operator', joinRequest: 'join_request', integration: 'integration' } as const;

export type MembershipChangeMode = 'move' | 'detach_to_personal';

export interface MembershipChangeInput {
  customerAccountId: string;
  organizationId: string;
  /** Absent: the target's predefined Member role (R-4). Must be a role of `organizationId`. */
  organizationRoleId?: string;
  source: MembershipChangeSource;
  /** Extension input for hook modules, keyed by module id (spec 176 FR-018). */
  extensions?: Readonly<Record<string, unknown>>;
}

export interface MembershipDetachInput {
  customerAccountId: string;
  source: MembershipChangeSource;
  extensions?: Readonly<Record<string, unknown>>;
}

export interface MembershipChangeResult {
  customerAccount: CustomerAccountRecord;
  fromOrganizationId: string;
  toOrganizationId: string;
  organizationRoleId: string;
  mode: MembershipChangeMode;
  /** `false` when the account already was there with that role: nothing written, nothing emitted. */
  changed: boolean;
}

/** `customer_account.organization.change` as the bus runs it — hand it to `commandBus.run` or `ctx.run`. */
export interface MembershipChangeCommand {
  readonly action: 'customer_account.organization.change';
  readonly objectType: 'customer_account';
  readonly objectId: string;
  run(ctx: never): Promise<{ readonly result: MembershipChangeResult }>;
}
```

## 2. The port

```ts
/**
 * Container name: `membershipPort`. Owner: `customer_accounts`.
 *
 * Moves a customer account to another Organization with its role, as one audited, hookable
 * Command (`customer_account.organization.change`). **No permission is checked here** — the
 * caller is the gate: an admin route behind `customers:manage` and the reach rule, an
 * `organizations` Command that decided a join request, or server code (an ERP import) running
 * under `enterSystemScope` / `withSystemScope(reason)`. Never resolve it for a customer-facing
 * route that has not decided authority itself.
 *
 * The actor is the ambient one (Principle XIII): an administrator, a customer acting for its
 * Organization, or `system` when neither — automation is told apart by `source`, the caller's
 * code, recorded in the audit entry (owner answer to 186 Q-1, research R-3). Sessions are not
 * touched (OR-5).
 *
 * Refusals: `404 CUSTOMER_NOT_FOUND` (account missing or soft-deleted — as the lifecycle port's
 * live load answers today), `404 NOT_FOUND` (target missing or deleted; role not of the target),
 * `409 ORG_OWNER_DEPLETION` (last active administrator leaving a company), and whatever a
 * `beforeCommit` hook vetoes with. A blocked account may be moved, as today.
 *
 * Owner off: `customer_accounts` is non-deactivatable; the gate exists and is never closed.
 */
export interface MembershipPort {
  changeOrganization(input: MembershipChangeInput): Promise<MembershipChangeResult>;
  /** The D-178 detach: to the account's own personal Organization, as its Administrator, provisioned if absent. */
  detachToPersonal(input: MembershipDetachInput): Promise<MembershipChangeResult>;
  /** The same move as a Command, for a caller that runs it as a child on its own transaction. */
  changeCommand(input: MembershipChangeInput | (MembershipDetachInput & { mode: 'detach_to_personal' })): MembershipChangeCommand;
}
```

No optional methods (`check:port-shape`). Consumers declare the edge: `customers` (dependency, it
already has `customer_accounts`), `organizations` (acknowledged edge `membershipPort`, the mutual
pair recorded in its manifest beside `customerAccountRoleCommandPort`).

## 3. The Command

`packages/modules/customer_accounts/src/backend/commands/customer-account-change-organization.command.ts`.

`run({ em, run })`, on the bus's transaction:

1. load the account `for update`; missing / soft-deleted → `404 CUSTOMER_NOT_FOUND` (a blocked one
   moves, as today);
2. resolve the target: `mode: 'detach_to_personal'` → `personalOrganizations.provisionFor(em, …)`
   (the co-transactional seam `createStandalone` already uses) and its `administratorRoleId`;
   `mode: 'move'` → `organizationDetailsPort.findById(organizationId)`, missing / deleted → `404`;
3. resolve the role (R-4); not of the target → `404`;
4. same Organization and role → return `changed: false`, `skipAudit`, no event;
5. if the account holds *Administrator* of a **company** source, `refuseLosingLastAdministrator`
   under the holder lock → `409 ORG_OWNER_DEPLETION`;
6. write `organizationId` + `organizationRoleId` in one statement (`em.flush()` on the bus `em`);
7. audit: `organizationMoveAuditState(before, after)` plus `mode`, `source` (R-22);
8. `hookData` / `outboxData` / `event` as §4.

## 4. Hookable action, outbox, event

`packages/contracts/src/customer-account-hooks.ts` (new, beside `organization-hooks.ts`):

```ts
export interface CustomerAccountOrganizationChangeHookData {
  customerAccountId: string;
  fromOrganizationId: string;
  toOrganizationId: string;
  fromOrganizationIsPersonal: boolean;
  toOrganizationIsPersonal: boolean;
  organizationRoleId: string;
  mode: MembershipChangeMode;
  source: string;
}
export type CustomerAccountOrganizationChangeOutbox = {
  customerAccountId: string; fromOrganizationId: string; toOrganizationId: string;
  organizationRoleId: string; mode: MembershipChangeMode; source: string;
  organizationId: string; // = toOrganizationId: the drain pins the handler to the destination
};
export const CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS = {
  changeOrganization: hookableAction<CustomerAccountOrganizationChangeHookData, CustomerAccountOrganizationChangeOutbox>(
    'customer_account.organization.change', 'customer_account', ['beforeCommit', 'afterCommit']),
} as const;
export const CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT = 'customer_account.organization_changed.v1';
export interface CustomerAccountOrganizationChangedEvent {
  customerAccountId: string; fromOrganizationId: string; toOrganizationId: string;
  organizationRoleId: string; mode: MembershipChangeMode; source: string;
}
```

`customer_accounts' manifest.ts` gains `hookableActions: [CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS.changeOrganization].map(toHookableActionDeclaration)`.
The Command's test holds it to the ref with `expectHookableCommand`. A `beforeCommit` hook sees the
data and may throw a `CommandHookRefusal` (any `HttpError`); the bus rolls back and publishes
nothing. Not reversible.

## 5. Deprecations (one release, OD-4)

| Old | Becomes |
| --- | --- |
| `CustomerAccountLifecycleWritePort.setOrganization(id, orgId, { actorAdminUserId, organizationRoleId })` | `@deprecated` — runs `changeOrganization({ …, source: 'operator' })`; `actorAdminUserId` ignored (R-3) |
| `CustomerAccountLifecycleWritePort.detachToPersonalOrganization(id, personalId, input)` | `@deprecated` — runs `detachToPersonal`; `personalId` must equal the account's own personal Organization, else `409` (it always was by contract) |
| `CustomerAccountOrganizationMoveInput.actorAdminUserId` | `@deprecated` |
| `CustomerAccountMemberWritePort.attachToOrganization(id, orgId, roleId)` | `@deprecated` — its one caller is the repair arm of `PersonalOrganizationService.ensureForCustomerAccountId` (an account written before D-178 whose Organization row is missing), which becomes `membershipPort.detachToPersonal({ customerAccountId, source: 'personal_organization_repair' })`: provision and bind in one recorded Command instead of a provisioning write plus an unaudited bind. `specs/186-aggregate-ports/` data-model lists it as deprecated by this spec |
| `#writeOrganization` and its hand-written audit | deleted in the same change (XIII "no double-audit") |

If `specs/186-aggregate-ports/` lands `customerAccountCommandPort` first, the two deprecated
methods there delegate the same way; this feature adds no move method to it (#1822 leaves the
move to Membership).

## 6. `customers` adopts it

`CustomerOrgAssignmentService.assign` → `membershipPort.changeOrganization({ customerAccountId,
organizationId, organizationRoleId: await this.roleInTarget(…), source: 'operator' })`;
`unassign` → `membershipPort.detachToPersonal({ customerAccountId, source: 'operator' })`, with its
own depletion pre-check removed (R-5). Both keep `assertAuthorized`. Routes and admin UI unchanged.

## 7. Tests (failing first)

- unit: role default, foreign role `404`, same-place no-op, company last-admin refusal, personal
  source never refused, detach provisions;
- audit sentinel (`expectNoAuditValues`) with a fresh Organization id and name as sentinels;
- hookable: `expectHookableCommand`; a `beforeCommit` veto writes nothing and emits nothing;
- integration: a worker under `enterSystemScope` moves an account to a branch with no administrator
  (actor `system`, `source: 'integration'` in the audit entry and the event), the next
  authenticated request resolves the branch (SC-004);
- event: exactly one `customer_account.organization_changed.v1` per commit, none per rollback.
