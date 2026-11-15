---
'@endora-commerce/contracts': patch
'@endora-commerce/platform': patch
---

Issue #1269 — `POST /api/v1/admin/command-outbox/:id/retry` answers an id that is not a uuid with `404 NOT_FOUND`, the same answer as for an unknown id, as every other id route does (issue #781's malformed-id contract). It answered `400 VALIDATION_FAILED`.

- **`@endora-commerce/contracts`**: `CommandOutboxRetryParamsSchema` accepts any string as `id`; it used to refuse a value that is not a uuid.
- **`@endora-commerce/platform`**: the retry route checks the id's shape itself and answers `404` before the database is read.

**On upgrade.** Nothing to migrate. A caller that relied on the `400` for a malformed id gets `404`.
