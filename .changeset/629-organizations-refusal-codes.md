---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/contracts': patch
---

Four refusals of `organizations` have error codes of their own instead of `VALIDATION_FAILED`,
and a sentence in English and Polish filled from `details` (issue #629, part of #86). **Breaking
change: a client that matches on `VALIDATION_FAILED` for these refusals now receives the new
code.** Match on the code below, and show the envelope's `message` rather than matching on its
text. The status stays `422` everywhere.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/organizations/:id/members` (personal organization) | `VALIDATION_FAILED`, `A personal (individual) organization cannot have additional members.` | `ORGANIZATION_PERSONAL`, token `add_member` | `organizationId`, `organizationName` |
| `POST /api/v1/organizations/mine/invitations` (personal organization) | `VALIDATION_FAILED`, `A personal (individual) account cannot invite members.` | `ORGANIZATION_PERSONAL`, token `invite` | `organizationId` |
| `POST /api/v1/admin/organizations/:id/sales-reps` (personal organization) | `VALIDATION_FAILED`, `A sales representative cannot be assigned to a personal (individual) organization.` | `ORGANIZATION_PERSONAL`, token `sales_rep` | `organizationId`, `organizationName` |
| `POST /api/v1/admin/organizations/:id/approve`, `/reject`, `/block`, `/unblock` (organization in another status) | `VALIDATION_FAILED`, `Organization is in status '…', cannot perform an action that requires '…'.` | `ORGANIZATION_STATUS_INVALID` | `currentStatus`, `requiredStatus` (unchanged), plus `currentStatusLabel` and `requiredStatusLabel` in the reader's language |

An unknown sales channel id on the admin create stays `VALIDATION_FAILED`. `ORGANIZATION_PERSONAL`
and `ORGANIZATION_STATUS_INVALID` are new members of `ERROR_CODES` in `@endora-commerce/contracts`,
declared by the `organizations` manifest. No setting, permission or migration changes.
