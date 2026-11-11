---
'@endora-commerce/contracts': minor
---

New types for creating a customer account as a child Command
(`specs/176-command-hooks-outbox/` FR-002, FR-005):

- `CustomerAccountMemberCommandPort` (container name `customerAccountMemberCommandPort`, owner
  `customer_accounts`) with `prepareCreate(input)`. It hashes the password and returns a
  `PreparedCustomerAccountCreate`.
- `PreparedCustomerAccountCreate.command({ organizationId, organizationRoleId })` returns the
  `customer_account.create` Command.
- `CustomerAccountCreateCommand` is that Command's structural type, assignable to and from the
  platform's `Command<CustomerAccountRecord>`, like `CustomerAccountRoleChangeCommand`.
- `CustomerAccountCreatePreparation` is `CustomerAccountCreateInput` without `organizationId` and
  `organizationRoleId`.

Additive. `CustomerAccountMemberWritePort` is unchanged.
