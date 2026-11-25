---
'@endora-commerce/mod-organizations': minor
---

Approving, rejecting, blocking and unblocking an Organization are now Commands (issue #1821,
`specs/186-aggregate-ports/` T026): `organization.approved`, `organization.rejected`,
`organization.blocked` and `organization.unblocked`, the same action strings as before. The status
change and its audit entry now commit in one transaction. Before, the entry was written after the
commit, and a failed audit write left a transition nobody had recorded. The entry's actor is the
ambient one: the administrator of the request, or the `system` actor for the approval that `auto`
moderation makes on registration. `organization.status_changed.v1` is dispatched once, on commit.
The customer e-mail is still sent after the commit, best effort. The HTTP API, the refusals
(`404`, `409 VERSION_CONFLICT` with `currentVersion`, `422 ORGANIZATION_STATUS_INVALID`) and the
audit state are unchanged.

`OrganizationModerationService` changes for code that builds it by hand. Its second constructor
argument is now the Command Bus (`Pick<CommandBus, 'run'>`), in place of the audit port and the
event bus. `ApproveOptions`, `RejectOptions`, `BlockOptions` and `UnblockOptions` no longer take
`actorAdminUserId` or `requestId`; the bus takes both from the ambient scope. A caller outside a
request runs the service under `withSystemScope`, or the bus refuses to run. The three moderation
error classes now live in `organization-moderation-errors.ts`, and the service module still
re-exports them.
