---
'@endora-commerce/platform': minor
---

Two Command Bus extensions and an audit column (`specs/170-organization-roles/`).

- `CommandContext.run(child)` runs a child Command inside the parent's transaction, on its `em` and actor: the child records its own single audit entry (none when it answers `skipAudit`), its event is dispatched once on the parent's commit, and a throwing child rolls back the parent and every sibling. The bus always supplies `run`; it is optional on the type so that a context built by hand without the bus still compiles — a Command that runs children must throw when it is absent, never skip them.
- `CommandActor.actorCustomerAccountId` names a customer who acted for themselves; it stays `null` for an operator, a system or API-key actor and under impersonation, which keeps `actorAdminUserId` + `impersonatedCustomerAccountId`. `actorFromContext` fills it, `RecordAuditInput.actorCustomerAccountId` carries it through `AuditPort.recordWithin` and `recordAuditFromContext`, and `AuditLogEntry.actorCustomerAccountId` stores it. Optional on `CommandActor` for the same reason as `run`.
- Core migration `Migration20261103T162518CoreAuditActorCustomerAccount` adds the nullable `audit_log_entries.actor_customer_account_id` column. No backfill.
- The platform's `customerContextResolver`, `cartActorResolver` and `customerActorResolver` pass the actor's `organizationRoleId` through, and the error envelope answers the organization-permission guard's `CustomerSessionRequiredError` as `401 UNAUTHORIZED`.
