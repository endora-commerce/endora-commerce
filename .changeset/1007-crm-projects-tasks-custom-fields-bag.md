---
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
---

The custom-fields panel on the Opportunity, Project and Task Overview no longer clears stored values the operator did not touch (issue #1007). Each screen used to add a `null` for every stored key missing from the panel's bag before sending its `PATCH`, written when the panel reported a cleared field as `undefined`. The panel has reported a cleared field as `null` since issue #176, and leaves out every key it does not offer for editing (a `read` or `hidden` field, or a value with no definition) and, now, every key the operator did not change. The screens forward the panel's bag as it is, so a save writes the changed fields only and the server's merge keeps every other stored value.
