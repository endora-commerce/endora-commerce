---
'@endora-commerce/platform': minor
---

**Operator routes over the command outbox** (`specs/176-command-hooks-outbox/` P4, FR-040, FR-041).

- **`GET /api/v1/admin/command-outbox?status=dead|pending|in_flight&limit=&cursor=`**, behind the new permission `platform.command_outbox.read`: one page of rows in a status (dead by default), keyset-paginated by the row's `sequence`, newest first. A row is served as its action, object, Organization id, handler (`hookModule`, `hookId`), status, attempts, last failure code and class, and dates. Its `data` is never served.
- **`POST /api/v1/admin/command-outbox/:id/retry`**, behind the new permission `platform.command_outbox.manage` (which `requires` `.read`): runs the audited Command `command_outbox.retry`, which puts a dead row back to `pending`, due now, with its attempts reset, and records `{ status: 'dead' } → { status: 'pending' }`. It answers `404 NOT_FOUND` for an unknown id and `409 COMMAND_OUTBOX_NOT_DEAD` for a row that is not dead.
- Both mount beside `GET /api/v1/admin/command-hooks`, so a composition with no command-hook registry serves neither. Grant the two codes to the admin roles that should see and retry dead deliveries; until then only the platform administrator does.
- **`GET /api/v1/admin/command-hooks`** now answers `position: null` for an `afterCommit` handler (see `@endora-commerce/contracts`).
- `_lifecycle` declares the two permissions and the ⌘K action `open-command-hooks` (`/platform/command-hooks`, behind `platform.modules.read`), labelled in English and Polish.
