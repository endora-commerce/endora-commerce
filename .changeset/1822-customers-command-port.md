---
'@endora-commerce/mod-customers': minor
---

The admin customer endpoints — block, unblock, delete, restore, customer group, custom fields — and the standalone registration and the retention sweep now run `customer_accounts`' `customerAccountCommandPort` (issue #1822, `specs/186-aggregate-ports/`). Requests, responses and audit entries are unchanged. The last-administrator refusal of a block or a deletion (`409 ORG_OWNER_DEPLETION`) and the end of the account's sessions now happen inside that module's Command; a session-store failure after a committed block or deletion is logged rather than answered `500`.

For code that builds the services by hand: `CustomerModerationService` takes `(accounts, commands, authority)`; `CustomerDeletionService` takes the aggregate port as its second argument and no longer takes a session revoker or a depletion guard (it reads the sweep's work list from the read port); `CustomerOrgAssignmentService` takes the aggregate port as its seventh argument; `CustomerRegistrationService`'s `accounts` is the aggregate port. The module's options gain `customerAccountCommandPort`.
