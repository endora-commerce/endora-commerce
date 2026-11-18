---
'@endora-commerce/mod-organizations': minor
---

`organization.status_changed.v1` now also carries `previousStatus` and `reason` (issue #1620). `previousStatus` is the status the Organization left. `reason` is the operator's reason for a rejection or a block, and `null` for an approval, an unblock or a block without a reason. Before, a subscriber reacting to a rejection could not read why it happened or which status the Organization had before. The existing fields are unchanged, so subscribers that do not read the new ones need no change.
