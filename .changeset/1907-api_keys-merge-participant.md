---
'@endora-commerce/mod-api-keys': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) API keys bound to the loser are re-pointed to the survivor, so their integrations keep working (new audited, irreversible Command `api_key.merge_reassign`). The merge preview lists them with the warning `API_KEY_BOUND_KEYS_REPOINTED`.
