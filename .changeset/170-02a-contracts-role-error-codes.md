---
'@endora-commerce/contracts': minor
---

`ERROR_CODES` gains the seven organization-role codes (`specs/170-organization-roles/`): `ORGANIZATION_PERMISSION_REQUIRED` (403 — the member's role lacks the organization permission an action needs; `details: { permission, permissionLabel }`), `ORGANIZATION_ROLE_NAME_TAKEN` (409), `ORGANIZATION_ROLE_STALE` (409), `ORGANIZATION_ROLE_LIMIT_REACHED` (422), `ORGANIZATION_ROLE_PROTECTED` (409), `ORGANIZATION_ROLE_REPLACEMENT_REQUIRED` (422) and `ORGANIZATION_PERMISSION_UNKNOWN` (422). A consumer switching exhaustively over `ErrorCode` has seven more cases.
