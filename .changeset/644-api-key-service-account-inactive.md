---
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/contracts': patch
---

A bound API key whose service account is blocked, deleted or anonymized is refused with an error
code of its own instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #644,
part of #86). **A caller that matches on `VALIDATION_FAILED` for this refusal now sees the specific
code.** The HTTP status is unchanged. Until now all three branches of binding rule B3 shared one
English issue, *"Service account must be an active customer account of the bound organization."*,
in every language.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/api-keys` (the service account of the bound organization is blocked, deleted or anonymized, and nothing else is wrong) | `422 VALIDATION_FAILED`, one issue on `binding.customerAccountId` | `422 API_KEY_SERVICE_ACCOUNT_INACTIVE` | `code: "blocked"` or `code: "removed"` (deleted or anonymized), `field: "binding.customerAccountId"`, `customerAccountId`, `organizationId` |

When any other binding rule fails as well, the answer stays the aggregate `422 VALIDATION_FAILED`
and still lists the inactive account, now as *"Service account is blocked."* or *"Service account
has been removed."* An account that does not exist and an account of another organization stay
`VALIDATION_FAILED`, each with its own issue: *"Service account does not exist."* and *"Service
account does not belong to the bound organization."* The code is a member of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `api_keys` manifest with the tokens `blocked` and
`removed`, and the module's documentation page names it. No setting, permission or migration
changes.
