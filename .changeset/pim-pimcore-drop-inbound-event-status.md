---
'@endora-commerce/contracts': major
---

Removed `pimcoreInboundEventStatusSchema` and its inferred type
`PimcoreInboundEventStatus`.

They described the status column of `pimcore_inbound_events`, the id-only push inbox
that `pim_pimcore`'s complete-record delivery migration retired: that table became
`pimcore_delivered_records`, whose statuses are `PimcoreDeliveredRecordStatus` — a
different set (`applying`, `applied`, `withdrawn`, `retired_legacy`, `superseded`) with
only `pending`, `failed` and `duplicate` in common. The schema had no reader left
anywhere in this repository, in either its value or its type spelling:

```
grep -rn --exclude-dir=node_modules --exclude-dir=dist \
  'pimcoreInboundEventStatusSchema\|PimcoreInboundEventStatus' .
```

returned the two declarations and nothing else.

There is no drop-in replacement to point at: the successor vocabulary is
`PimcoreDeliveredRecordStatus`, declared beside the `PimcoreDeliveredRecord` entity in
`@endora-commerce/mod-pim-pimcore` and published on none of that package's subpaths
today, and its members are not interchangeable with these — re-map rather than
re-point. Its neighbour `pimcoreInboundEventTypeSchema` is unaffected and still
published: that one is the *action* vocabulary and is still read here.
