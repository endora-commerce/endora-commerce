---
'@endora-commerce/mod-forms': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the form entries attributed to the loser move to the survivor, in batches of the new audited, irreversible Command `form_entry.merge_reassign`. Entries with no Organization are untouched.
