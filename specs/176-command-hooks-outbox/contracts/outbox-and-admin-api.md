# Contract: the command outbox and its operator API (P3, P4)

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
