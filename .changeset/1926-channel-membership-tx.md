---
'@endora-commerce/platform': minor
'@endora-commerce/contracts': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-sales-channels': patch
---

`@endora-commerce/platform`: new `EventBus.afterScope(fn)` (issue #1926). Inside an
`EventBus.run` scope it queues `fn`; when the scope's function resolves, the queued functions
run in order, each awaited, and only then do the scope's buffered events dispatch. When the
scope throws, they are discarded with the events. Outside any scope `fn` runs and is awaited
immediately. `CommandBus.run` wraps its transaction in a scope, so for a Command `fn` runs after
the commit. A deferred function that throws makes the scope reject, and its events are not
dispatched.

`SalesChannelMembershipService` (`salesChannelMembershipPort`) now enlists in the caller's
transaction when `options.em` has one open. Each `sales_channel.membership.changed` audit entry is
recorded with `AuditPort.recordWithin(options.em, …)`, so it rolls back with the caller. Before,
a vetoed `organization.create` or a failed `organization.register` left entries behind for an
Organization that was never created. The Organization access-cache drop is deferred with
`EventBus.afterScope`, so it runs after the commit and before `sales_channels.membership_changed`
is dispatched. Before, it ran before the commit, and a request in that gap could re-cache the old
channel set for up to five minutes. Callers that pass no `em`, or an `em` with no transaction
open, behave as before. If you call the writer with `em` from a plain `em.transactional(...)`
outside a Command, wrap that transaction in `eventBus.run(...)` to get the post-commit drop.
Without that wrapper the drop runs at once.

`@endora-commerce/mod-customer-accounts`: standalone registration and the federated sign-in's
account creation run their transaction inside an `EventBus.run` scope, so the personal
organisation's access-cache drop follows the commit.

`@endora-commerce/contracts` and `@endora-commerce/mod-sales-channels`: documentation only. The
`SALES_CHANNEL_AUDIT_ACTIONS` header and the `sales_channels` developer guide say when a
membership entry is co-transactional.
