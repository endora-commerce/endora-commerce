---
'@endora-commerce/contracts': minor
---

Organization merge participants and the membership move (issue #1907, `specs/192-organization-merge/`).

- `ERROR_CODES.RECORD_MERGE_BUSY` and `RECORD_MERGE_ERROR_CODES.BUSY` (409, retryable): a merge cannot
  start while a participant has business in flight for the duplicate — today an unsettled order
  placement intent or a gateway payment still at the provider.
- New `customer-accounts.membership.ts`: `MembershipPort` (container name `membershipPort`, owner
  `customer_accounts`) with `changeOrganization(input)` and `changeCommand(input)`,
  `MembershipChangeInput` (optional `merge: { mergeId, fromOrganizationId }` selects the mode
  `merge`), `MembershipChangeResult`, `MembershipChangeMode` (`move`, `detach_to_personal`,
  `merge`), `membershipChangeSourceSchema`, `MEMBERSHIP_CHANGE_SOURCES` (with `record_merge`),
  the hookable action `CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS.changeOrganization`
  (`customer_account.organization.change`, both phases) with its hook and outbox data, and the event
  `CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT` (`customer_account.organization_changed.v1`). This is
  the part of `specs/191-membership-join-requests/`' port the merge needs; `detachToPersonal`
  follows with #1831. A hook switching on `mode` treats an unknown value as a move.
- `SearchReindexPort` gains `reindexProducts(productIds)`. A consumer that implements the interface
  itself (a test double) adds the method.
