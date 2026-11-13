---
'@endora-commerce/contracts': minor
---

**The command outbox operator API, and no position for an `afterCommit` handler** (`specs/176-command-hooks-outbox/` P4, FR-040).

- **`CommandHookPlanItemSchema.position` is now `number | null`.** A `beforeCommit` hook keeps its 1-based position; an `afterCommit` handler carries `null`, because each one is an outbox row delivered on its own and the outbox promises no order across rows. A consumer that read `position` as a number must handle `null` for `phase: 'afterCommit'` items.
- **New schemas** for `GET /api/v1/admin/command-outbox` and `POST /api/v1/admin/command-outbox/:id/retry`: `CommandOutboxStatusSchema` (`COMMAND_OUTBOX_STATUSES`), `COMMAND_OUTBOX_LISTED_STATUSES`, `CommandOutboxListQuerySchema` (`status` defaulting to `dead`, `limit` 1–`COMMAND_OUTBOX_PAGE_MAX`, an opaque `cursor`), `CommandOutboxListItemSchema` (names, ids, codes, counts and dates — never the row's `data`), `CommandOutboxListResponseSchema` (`{ items, nextCursor }`), `CommandOutboxRetryParamsSchema` and `CommandOutboxRetryResponseSchema` (`{ item }`), with their types.
- **`COMMAND_OUTBOX_FAILURE_CODES`** names the drain's own stored failure codes (`hook-unregistered`, `permanent-failure`, `handler-failed`), and **`commandOutboxFailureKey(code)`** the bundle key a stored code may be translated under besides `errors.<CODE>`: `commandOutbox.failure.<code>`. A hook module SHOULD translate every code it throws a `PermanentOutboxFailure` with there.
- **`ERROR_CODES.COMMAND_OUTBOX_NOT_DEAD`** — a retry of a row that is not dead (409).
