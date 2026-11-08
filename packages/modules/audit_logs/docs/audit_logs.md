---
title: Audit log
description: Sensitive-action audit trail
---

# Audit log (`audit_logs`)

Append-only audit trail of every sensitive action, with one exception: erasure
on anonymisation (see *Redaction on anonymisation* below). Each row records who
did what, when, and (during impersonation) on whose behalf.

The actor is one of three. An admin user (`actorAdminUserId`) is shown by name
and e-mail. A customer acting for themselves on the storefront
(`actorCustomerAccountId`), such as an Organization administrator managing
roles, invitations or members, is shown as *Customer: …*. A row with neither is
shown as *system*. During impersonation the row names the real admin user and
keeps the impersonated customer in `impersonatedCustomerAccountId`;
`actorCustomerAccountId` stays empty.

## Public surface

Gated by the `audit_log:read` permission.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/audit-log` | Query the log. Filters: `filter[actor]`, `filter[customer]`, `filter[action]`, `filter[objectType]`, `filter[objectId]`. Default `limit=100`, capped at 500. Each row carries `stateBefore` / `stateAfter` JSON inline so the admin viewer can render side-by-side diffs without a second roundtrip. A row also carries `actorCustomerAccountId` and `actorCustomerLabel`, the customer's audit label: the person as *First Last (e-mail)*, or the e-mail alone when the account has no name. An impersonated customer is named the same way. |

## Recording

`AuditPort.record({ ... })` is invoked from every sensitive
mutation: catalog price change, role change, credit-limit adjust, order
status / payment status change "on behalf", impersonation start/end, API
key out-of-scope, and others. Adding a new sensitive mutation is a
two-line change at the call site.

The port is what a module types on and what the kernel publishes
(`packages/platform/src/kernel/ports/audit.ts`); the container name it is
registered under is `auditLogService` and has not changed. The
implementation behind it, `AuditLogService`, is the platform's own and is
reachable only by its relative path — a module that named the class would
be depending on a writer shape uniform write auditing routes around, since
a domain write goes through `CommandBus.run` and the bus writes the row.

## Redaction on anonymisation

When the retention sweep anonymises a deleted customer, the platform also
erases that customer's personal data from the audit history, in place. It is
the only change ever made to an existing row.

**Scope.** Rows about the customer account, its personal Organization, that
Organization's addresses (including the ones the customer deleted earlier), and
its legacy customer addresses. Rows about anything else keep their own
snapshots, as the objects themselves do: an order the customer placed keeps its
history, even though the customer wrote it.

**What is kept.** Every row, its action, its actors, its time, its object and
its request id. Inside `stateBefore` and `stateAfter` every key is kept, so the
history still shows *which* fields changed. A value is kept only when it is one
of these:

| Kept | For example |
| --- | --- |
| an id (a key `id` or ending in `Id`/`Ids`) holding a UUID | `organizationId` |
| a timestamp (a key ending in `At`) holding an ISO-8601 date-time | `blockedAt` |
| a short code under a code key (`status`, `kind`, `type`, `source`, `action`, `version`, `statusCode`, or a key the owning module lists) | `status: "blocked"` |
| a list of key names under a key ending in `Keys` | `customFieldKeys` |
| a boolean, or `null` | `isDefault: true` |

Every other value becomes the marker `"[erased]"`. That covers names, e-mails,
addresses and phone numbers, any free text, and **every custom-field value**,
whatever its type. A tax id or an external id is erased too, because it is not
a UUID. On the rows the customer wrote for themselves, the IP address and the
user agent are erased as well. On a row an administrator wrote, those are the
administrator's and stay.

**The record of it.** Each anonymised customer gets one `audit.redacted` row,
written by the system, about the customer account. It holds counts and ids
only: how many rows were in scope and how many changed, per object type.

**Idempotent and irreversible.** A row that is already erased is not written
again, so a second run changes nothing and writes no second `audit.redacted`
row. A run that stopped half-way is finished by the next one. Nothing keeps
the erased values: they cannot be restored.

**In the viewer.** The admin audit viewer shows an erased value as *Erased*,
and the dashboard's recent activity never prints the marker as a name. The
raw JSON, the `audit:read` CLI and any export show the stored `"[erased]"`.

The writer of the table owns this write. It is the platform's
`AuditRedactionPort`, registered as `auditRedactionService` beside
`auditLogService` (`packages/platform/src/kernel/ports/audit-redaction.ts`),
and the customers retention sweep is its one caller.

## Entities

`AuditLogEntry` — `actorAdminUserId`, optional
`impersonatedCustomerAccountId`, optional `actorCustomerAccountId`, `action`, `objectType`, `objectId`,
`stateBefore`, `stateAfter`, `ipAddress`, `userAgent`, `requestId`,
`actedAt`. For an anonymised customer, a value in `stateBefore`, `stateAfter`,
`ipAddress` or `userAgent` may be the marker `"[erased]"`.

## Extension points

- **External SIEM ship-out** — emit a domain event on each new audit row
  and let an integration drain the stream into Splunk / Elastic / etc.
- **Retention** — no time-based pruning today; retention windows belong to
  whoever runs the platform. The erasure above is per customer, on
  anonymisation, and removes no row.
