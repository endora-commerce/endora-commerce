---
'@endora-commerce/mod-sales-channels': patch
---

Documentation: the developer guide now imports from the published platform barrel —
`getResolvedChannel` and `currentSalesChannel` from `@endora-commerce/platform/kernel` — instead
of a relative path into platform internals that no module can resolve. It also corrects three
other statements: the resolved channel lives on the request's platform scope, not on
`req.salesChannel`; outside a request a module resolves `salesChannelResolutionPort` /
`salesChannelMembershipPort` rather than the unpublished service classes; and direct writes to
`sales_channel_*` bridge tables are caught by `check:module-boundary`, not by a lint rule.
