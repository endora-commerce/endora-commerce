# Contract: the command outbox and its operator API (P3, P4)

**Amended (P3, 2026-11-12)** — reconciled with `master` and the conventions while implementing
§ Delivery; master won where they conflicted, and each remaining choice is listed:

1. **The list-1 guard is structural and shared.** `outboxDataViolations` in
   `@endora-commerce/contracts` refuses a nested object, a non-finite number, and a string over 128
   characters or with whitespace in it; arrays are allowed when every member passes. The bus raises a
   plain `500` naming the keys (never the values) and test-kit's `expectHookableCommand` applies the
   same guard. A hooked Command with a present handler and no `outboxData` answers
   `500 COMMAND_HOOK_DATA_MISSING`, the code `hookData` already used. No new error code.
2. **`organizationId` stays in `data`** — every organization outbox type carries it — and is also the
   row's routing column.
3. **No order between `afterCommit` handlers.** The table above promises none across rows, so two
   unrelated modules' handlers on one action are not refused as unordered and need no
   `commandHookOrder` entry. The registry lists them by module id, then registration order.
4. **Failure codes.** `last_error_code` is the error's own code when it is code-shaped
   (`[A-Za-z0-9_.:-]{1,64}`: an `HttpError`'s, a `PermanentOutboxFailure`'s, a Node `code`), and
   `handler-failed` otherwise; a `PermanentOutboxFailure` whose code is not code-shaped is stored as
   `permanent-failure`. A `ModuleDisabledError` thrown by the handler counts as an absent module.
5. **Dead rows are purged after 90 days**, as research R-17 and data-model §4 say; the table above
   named only the delivered retention.
6. **A tick is bounded**: at most 20 batches of 50; the next tick continues.
7. **A row with no Organization** runs in the tick's system scope, re-entered so the recorded request
   id is the scope's too.
8. **The wake-up** builds its producer queue on first use, is never awaited by the bus, and never
   rejects. Both roots build it (`compose-app.ts`, `packages/test-kit/src/server/compose-test-server.ts`).
9. **`command_outbox.sequence` is not mapped on the entity**: the database assigns it.

## Delivery

| Aspect | Contract |
| --- | --- |
| Guarantee | At least once, per (Command execution, handler). No ordering across rows. |
| Idempotency key | `messageId` = `command_outbox.id` (uuid), stable across retries |
| Claim | `select … where status='pending' and available_at <= now() order by sequence for update skip locked limit 50`, set `status='in_flight'`, `locked_until = now()+5 min`, `attempts += 1`, commit; expired leases are reclaimed as pending |
| Clock | BullMQ job scheduler `command_outbox.drain` every 10 s + deduplicated wake job `command_outbox.drain.wake` enqueued after a commit that wrote rows |
| Scope | one `enterSystemScope('command_outbox: drain', …)` per non-idle tick; per row `orgPinnedTenantContext(organizationId)` when present, the tick's system scope otherwise; `requestMeta.requestId` = recorded request id |
| Success | `status='delivered'`, `delivered_at`; purged after 7 days |
| Failure | `status='pending'`, `available_at = now() + min(30 s·2^(attempts-1), 1 h)`, `last_error_code`, `last_error_class`; after 10 attempts `status='dead'` |
| Permanent failure | `PermanentOutboxFailure` → `dead` at once with its `code` |
| Handler module absent | row returned to `pending`, `attempts` restored, `available_at = now() + 30 s` |
| Handler unregistered (module present) | `dead`, `last_error_code='hook-unregistered'` |
| `--hard` uninstall of module M | delete rows where `hook_module = M` |

## Admin API (`_lifecycle`, contract-first in `packages/contracts/src/command-hooks.ts`)

### `GET /api/v1/admin/command-hooks` — `platform.modules.read`

```json
{ "data": { "actions": [ { "action": "organization.register", "owner": "organizations",
  "phases": ["beforeCommit","afterCommit"],
  "hooks": [ { "phase": "beforeCommit", "position": 1, "module": "acme_erp", "id": "write-erp-code",
               "moduleEnabled": true } ] } ] } }
```

### `GET /api/v1/admin/command-outbox?status=dead|pending|in_flight&limit=&cursor=` — `platform.command_outbox.read`

Each item has these fields: `id`, `action`, `objectType`, `objectId`, `organizationId`, `hookModule`,
`hookId`, `status`, `attempts`, `lastErrorCode`, `lastErrorClass`, `createdAt`, `availableAt`,
`deadAt`. `data` is **not** returned: an operator cannot read anything here that the audit log
would not show. The list is keyset-paginated by `sequence`, descending.

### `POST /api/v1/admin/command-outbox/:id/retry` — `platform.command_outbox.manage`

Runs Command `command_outbox.retry` (objectType `command_outbox`). It moves a `dead` row to
`pending`, with `attempts=0` and `available_at=now()`. Audit state:
`{ status: 'dead' } → { status: 'pending' }`. It answers `404` for an unknown id and
`409 COMMAND_OUTBOX_NOT_DEAD` for a row that is not dead.

## Admin UI

- A *Command hooks* screen in the platform area. It has two tabs: *Execution plan* and *Outbox*
  (filter by status, with a retry button on dead rows that is shown only with the manage
  permission). It is built from admin-kit primitives (Principle IX) and goes through
  `endora-commerce-designer` for review.
- ⌘K action `open-command-hooks` in the `_lifecycle` manifest. It requires `platform.modules.read`.
  Its keywords are EN-only, with `keywordsKey` translations.
- Every string ships in `pl` and `en`. The two permission labels go in `adminRoles.permission.<code>`.
