---
'@endora-commerce/platform': minor
---

The record merge runner tells the host when a merge stops in `needs_attention` or completes, by
calling the host's optional `MergeHostImplementation.onStateChanged` after the state is committed
and announced (issue #1907). A host that throws is logged and changes nothing.
