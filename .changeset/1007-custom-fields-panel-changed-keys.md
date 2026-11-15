---
'@endora-commerce/admin-kit': patch
---

`CustomFieldValuesPanel` hands its host only the custom-field keys the operator changed (issue #1007). Until now the bag given to `save` and `onChange` carried every `edit`-level key the panel had loaded, so saving the order custom-fields panel wrote an unchanged, stale value over one another writer had changed after the page loaded, even though `PATCH /api/v1/admin/orders/:id/custom-fields` merges per key.

- The bag now holds the `edit`-level keys whose value differs from the one the panel loaded. A cleared field is still in it, as `null` (an empty string for text, an empty array for a multiselect); a field edited back to its loaded value is not.
- With its own Save, the panel compares against what its last successful save wrote, so a second save does not send the first one's keys again. A refused save keeps them.
- Under a page Save (`saveSession`), the save session's baseline is the comparison point.
- A host that forwards the bag as it is needs no change. A host that fills in the keys missing from the bag (as cleared, for example) must stop doing so: a missing key now means "unchanged", and filling it in clears a value the operator did not touch.
