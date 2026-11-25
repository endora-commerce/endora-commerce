# Contract amendment: `membershipPort` mode `merge` (to `specs/191-membership-join-requests/`)

This is an **additive** amendment to `specs/191-membership-join-requests/contracts/membership-port.md`.
It lands with MR-E, after 191 WP-1 (#1831) is on `master`. If 191 WP-1 is still in review when
MR-E starts, the amendment goes into that MR instead (coordinate with its author). The amendment
does not change 191's behaviour for its existing modes.

## 1. Types

```ts
export type MembershipChangeMode = 'move' | 'detach_to_personal' | 'merge';   // + 'merge'

export interface MembershipChangeInput {
  customerAccountId: string;
  organizationId: string;
  organizationRoleId?: string;
  source: MembershipChangeSource;
  extensions?: Readonly<Record<string, unknown>>;
  /** Present only for mode 'merge'; the merge that moves this account. */
  merge?: { mergeId: string; fromOrganizationId: string };
}
```

## 2. Behaviour of `mode: 'merge'`

The Command is still `customer_account.organization.change`, still hookable, and still one audit
entry per account (191 FR-005). It differs from `move` in these ways:

1. **Who may use it.** The mode is accepted only inside a `record-merge:<mergeId>` system scope
   whose merge is `running` with `loserId = merge.fromOrganizationId` and
   `survivorId = organizationId`. Otherwise it answers `409 RECORD_MERGE_IN_PROGRESS`, so a route
   or an integration cannot use it to skip the last-administrator rule.
2. **Last administrator.** Step 5 of 191's Command (`refuseLosingLastAdministrator`) is skipped for
   the source. The source is being archived, not depleted.
3. **Role.** `organizationRoleId` is required, and it is the role map's value from
   `record_merges.host_context.roleMap`. It must belong to the survivor, as in 191 (`404`
   otherwise).
4. **Audit.** `stateAfter` adds `mergeId`, and `mode = 'merge'`.
5. **Event.** `customer_account.organization_changed.v1` is published with `mode: 'merge'` (191
   FR-007's "kind of move"), so hook and outbox consumers can tell a merge from a move.
6. **Sessions** are untouched (191 FR-008). The next request is scoped to the survivor.
7. **Data.** 191 FR-009 ("data stays with the Organization left") does not apply. The merge's other
   participants move the data, and this Command still moves only the account.

## 3. Hook data

`CustomerAccountOrganizationChangeHookData.mode` widens with `'merge'`, which is additive-only
(`contract-surface.md`). This amendment adds a sentence to 191's
contract telling hook modules that switch on `mode` to treat an unknown value as a move.

## 4. Tests (in `customer_accounts`, co-located)

- `merge` mode inside the merge scope moves the last administrator; outside it, it is refused.
- The role must be the survivor's.
- A `beforeCommit` veto rolls back that account only, so the step retries and then shows *needs
  attention*.
- The event carries `mode: 'merge'`.
- The participant conformance helper covers the batch of accounts.
