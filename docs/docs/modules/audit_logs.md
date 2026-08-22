---
title: audit_logs
---

# `audit_logs`

Append-only audit trail of every sensitive action. Each row records who did
what, when, and (during impersonation) on whose behalf.

## Public surface

Gated by the `audit_log:read` permission.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/audit-log` | Query the append-only log. Filters: `filter[actor]`, `filter[customer]`, `filter[action]`, `filter[objectType]`, `filter[objectId]`. Default `limit=100`, capped at 500. Each row carries `stateBefore` / `stateAfter` JSON inline so the admin viewer can render side-by-side diffs without a second roundtrip. |

## Recording

`AuditPort.record({ ... })` is invoked from every sensitive
mutation: catalog price change, role change, credit-limit adjust, order
status / payment status change "on behalf", impersonation start/end, API
key out-of-scope, and others. Adding a new sensitive mutation is a
two-line change at the call site.

The port is what a module types on and what the kernel publishes
(`backend/src/kernel/ports/audit.ts`, D-160.10); the container name it is
registered under is `auditLogService` and has not changed. The
implementation behind it, `AuditLogService`, is the platform's own and is
reachable only by its relative path — a module that named the class would
be depending on a writer shape Principle XIII routes around, since a
domain write goes through `CommandBus.run` and the bus writes the row.

## Entities

`AuditLogEntry` — `actorAdminUserId`, optional
`impersonatedCustomerAccountId`, `action`, `objectType`, `objectId`,
`stateBefore`, `stateAfter`, `ipAddress`, `userAgent`, `requestId`,
`actedAt`.

## Extension points

- **External SIEM ship-out** — emit a domain event on each new audit row
  and let an integration drain the stream into Splunk / Elastic / etc.
- **Retention** — no automatic pruning today; retention windows belong to
  whoever runs the platform.
