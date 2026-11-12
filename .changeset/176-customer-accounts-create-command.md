---
'@endora-commerce/mod-customer-accounts': minor
---

An account's creation is now the `customer_account.create` Command (`specs/176-command-hooks-outbox/`
FR-002, FR-004).

- A new port, `customerAccountMemberCommandPort`, prepares it. `prepareCreate(input)` hashes the
  password before any transaction and returns a builder whose `.command({ organizationId,
  organizationRoleId })` a caller runs as a child of its own Command through `ctx.run`.
- `customerAccountMemberWritePort.create` keeps its contract. It now runs the same Command through
  the Command Bus, so the bus writes the `customer_account.create` audit entry. The action, the
  object and the audit state are unchanged, and the port's own hand-written entry is removed. The
  entry now also carries the request id, IP address and user agent.
- `CustomerAccountMemberWriteService`'s fourth constructor argument is now
  `{ commandBus, roles? }`. `create` refuses without a bus instead of writing unaudited. Only a
  hand-built service is affected: the composed port is wired as before.
