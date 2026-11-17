---
'@endora-commerce/mod-audit-logs': minor
---

`GET /api/v1/admin/audit-log/recent-activity` now answers an invalid query in the platform's standard error envelope (issue #1339), like every other route.

Breaking change for callers that read this error. An out-of-range `limit` (for example `?limit=999`) is still `400`, but:

- `error.code` is now `VALIDATION_FAILED` (from `ERROR_CODES`). Before, it was `validation_error`.
- `error.details` is now a list of `{ path, issue }` entries, for example `[{ path: 'limit', issue: '...' }]`. Before, it was a zod `flatten()` object with `formErrors` and `fieldErrors`.
- `error.requestId` is now included.

To migrate: match `VALIDATION_FAILED` instead of `validation_error`, and read the failed parameter from `details[].path` instead of `details.fieldErrors`. The admin dashboard card does not read this error, so it needs no change.
