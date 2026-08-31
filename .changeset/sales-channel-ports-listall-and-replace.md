---
'@endora-commerce/platform': minor
---

`SalesChannelResolutionPort` and `SalesChannelMembershipPort` each gain one method, both
implemented by the kernel services behind the `salesChannelResolutionPort` and
`salesChannelMembershipPort` container names.

- `SalesChannelResolutionPort.listAll(): Promise<CachedChannel[]>` — every channel, ordered by
  code. A consumer that needed the whole list previously had to reach the module's admin
  service or query `sales_channels` itself; both are boundary violations.
- `SalesChannelMembershipPort.replaceChannelsForEntity(entityType, entityId, channelIds,
  options?)` — replace an entity's complete membership set in one transaction. Composing
  `removeFromChannel` and `addToChannel` cannot express it: the intermediate state either
  trips the at-least-one-channel invariant or leaves the system default bound alongside the
  channel the caller actually wants. Callers are complete-record integrations, where the
  delivered record names the exact set.

Both are additive. An existing implementation of either interface written outside this
repository needs the new method; every implementation inside it is the kernel's own service.
