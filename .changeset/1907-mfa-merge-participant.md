---
'@endora-commerce/mod-mfa': minor
---

In an Organization merge (issue #1907, `specs/192-organization-merge/`) the customer MFA policy takes the stricter of the two: a survivor without a policy adopts the loser's, and a survivor that does not enforce TOTP is raised to enforcement when the loser did (new audited, irreversible Command `mfa.merge_reassign`).
