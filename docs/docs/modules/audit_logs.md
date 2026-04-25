---
title: audit_logs
---

# `audit_logs`

Append-only audit trail of every sensitive action. Each row records who did
what, when, and (during impersonation) on whose behalf.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/audit-logs` | List entries with filters by actor / object / action |
| `GET /api/v1/admin/audit-logs/:id` | Detail with `stateBefore` / `stateAfter` JSON |

## Recording

`AuditLogService.record({ ... })` is invoked from every sensitive
mutation: catalog price change, role change, credit-limit adjust, order
status / payment status change "on behalf", impersonation start/end, API
key out-of-scope, and others. Adding a new sensitive mutation is a
two-line change at the call site.

## Entities

`AuditLogEntry` — `actorAdminUserId`, optional
`impersonatedCustomerAccountId`, `action`, `objectType`, `objectId`,
`stateBefore`, `stateAfter`, `requestId`, `recordedAt`.

## Extension points

- **External SIEM ship-out** — emit a domain event on each new audit row
  and let an integration drain the stream into Splunk / Elastic / etc.
- **Retention** — no automatic pruning today; retention windows belong to
  whoever runs the platform.
