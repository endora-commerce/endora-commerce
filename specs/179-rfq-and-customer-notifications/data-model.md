# Data model: Quote request notification delivery and the storefront notification centre

Migrations are **not numbered here**. Each is scaffolded by
`pnpm --filter backend run migration:new` inside its owning module and ordered by module
dependency (`specs/conventions/module-migrations.md`). Two migrations, two owners:

| Owner | Migration | Depends on |
| --- | --- | --- |
| `quote_requests` | drop `quote_request_notification_events`; create `quote_request_notifications` | its own earlier migrations |
| `customer_notifications` (new) | create `customer_notifications` (init) | none (no foreign key to another module's table) |

`pwa` gains no schema change: `push_messages` and `push_notification_preferences` are reused.

## 1. `quote_request_notifications` — owner `quote_requests`

Entity `QuoteRequestNotification`, `@OrgScoped()`, file
`packages/modules/quote_requests/src/backend/entities/quote-request-notification.entity.ts`
(replaces `quote-request-notification-event.entity.ts`).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK; also the idempotency key handed to e-mail (`messageId`) and push (`sourceEventId`) |
| `organization_id` | uuid | no | the request's Organization (Principle XI) |
| `quote_request_id` | uuid | no | FK → `quote_requests.id` `on delete cascade` |
| `source_event_id` | uuid | no | FK → `quote_request_events.id` `on delete cascade`; the history entry this delivery announces |
| `change` | varchar(32) | no | the matrix row (`contracts/notification-matrix.md` §1): `submitted`, `resubmitted`, `offer_accepted`, `offer_rejected`, `expired`, `prepared`, `revised`, `approved`, `canceled` |
| `recipient_kind` | varchar(16) | no | `admin` \| `customer` |
| `recipient_id` | uuid | no | `admin_users.id` or `customer_accounts.id` (no FK: other modules' tables) |
| `channel` | varchar(24) | no | `admin_in_app`, `admin_email`, `customer_email`, `customer_in_app`, `customer_push` |
| `status` | varchar(32) | no | default `pending`; see the check constraint |
| `attempts` | integer | no | default 0 |
| `next_attempt_at` | timestamptz | no | default `now()` |
| `last_error` | text | yes | the last failure, truncated to 2000 characters; never contains a recipient address |
| `source_occurred_at` | timestamptz | no | the history entry's `created_at`, copied so the stale check needs no join |
| `created_at` | timestamptz | no | default `now()` |
| `closed_at` | timestamptz | yes | set with any non-`pending` status |

Constraints and indexes:

- `quote_request_notifications_unique` — unique `(source_event_id, recipient_kind, recipient_id, channel)` (FR-002).
- `quote_request_notifications_status_chk` — `status in ('pending','sent','skipped_stale','skipped_module_off','skipped_deactivated','skipped_no_transport','skipped_logged','skipped_no_recipient','skipped_preference','skipped_no_subscription','failed')`.
- `quote_request_notifications_channel_chk`, `…_recipient_kind_chk` — the closed vocabularies above.
- `quote_request_notifications_channel_side_chk` — `admin_*` channels only with `recipient_kind = 'admin'`, `customer_*` only with `'customer'`.
- `quote_request_notifications_closed_chk` — `(status = 'pending') = (closed_at is null)`.
- `quote_request_notifications_due_idx` — partial index on `(next_attempt_at)` `where status = 'pending'` (the worker's claim).
- `quote_request_notifications_request_idx` — `(quote_request_id, source_event_id)` (the History read).

State machine: `pending → pending` (failed attempt: `attempts + 1`, `next_attempt_at` backed off,
`last_error` set) and `pending → <closing status>` once. A closed record never changes again.

Migration `down()`: drop `quote_request_notifications`; re-create
`quote_request_notification_events` with the shape of `20260503T141344_quote_requests_workflow.ts`
(columns, `qrne_dedupe_idx`), empty.

## 2. `customer_notifications` — owner `customer_notifications` (new module)

Entity `CustomerNotification`, `@CustomerScoped()` with a stamped `organizationId` (the
`PushNotificationPreference` / D-187 pattern), file
`packages/modules/customer_notifications/src/backend/entities/customer-notification.entity.ts`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `organization_id` | uuid | no | Principle XI |
| `customer_account_id` | uuid | no | the one reader |
| `sales_channel_id` | uuid | yes | the channel the entry concerns; `null` = every channel (Principle XII) |
| `source_module` | varchar(64) | no | the producing module's id; list filters by presence (research R-14) |
| `source_key` | varchar(128) | no | the producer's idempotency key (for `quote_requests`: the delivery record id) |
| `kind` | varchar(64) | no | e.g. `quote_requests.approved` |
| `subject_type` | varchar(64) | yes | e.g. `quote_request` |
| `subject_id` | uuid | yes | |
| `title` | varchar(255) | no | English fallback sentence |
| `title_message` | jsonb | no | `{ scope, key, params }`; params strings/numbers only |
| `body` | text | yes | English fallback |
| `body_message` | jsonb | yes | never without `body` |
| `link_path` | varchar(512) | yes | storefront-relative, starts with a single `/` (FR-047) |
| `created_at` | timestamptz | no | default `now()` |
| `read_at` | timestamptz | yes | |

Constraints and indexes:

- `customer_notifications_source_unique` — unique `(source_module, source_key)`.
- `customer_notifications_attribution_chk` — `organization_id is not null and customer_account_id is not null` (kept explicit, as D-187 does).
- `customer_notifications_body_chk` — `body_message is null or body is not null`.
- `customer_notifications_link_chk` — `link_path is null or (link_path like '/%' and link_path not like '//%')`.
- `customer_notifications_reader_idx` — `(customer_account_id, created_at desc, id desc)` (keyset paging).
- `customer_notifications_unread_idx` — partial `(customer_account_id, sales_channel_id)` `where read_at is null` (the count).
- `customer_notifications_created_idx` — `(created_at)` (retention sweep).

No foreign key to `customer_accounts`, `organizations` or `sales_channels`: other modules' tables,
and the module must be detachable (Principle I). When an account is anonymised, its entries are
deleted by the retention sweep's second pass, which deletes entries of accounts the
`customerAccountReadPort` reports deleted or anonymised (batched).

## 3. Settings — `customer_notifications`

| Code | Type | Default | Notes |
| --- | --- | --- | --- |
| `customer_notifications.enabled` | boolean | `true` | activation (Principle XVII) |
| `customer_notifications.retention_days` | number | `90` | validated 7–730; platform-wide |

## 4. E-mail definitions — `quote_requests` manifest `transactionalEmails`

Eleven codes; listed with their variables in `contracts/notification-matrix.md` §3.

## 5. Removed

- `quote_request_notification_events` (table), `QuoteRequestNotificationEvent` (entity),
  `QuoteRequestNotificationChannel` / `Status` types.
- `pwa`: the quote branch of `status-push-composer.ts`, `QUOTE_STATUS_EVENTS` and the five `rfq.*`
  subscriptions in `pwa/src/backend/index.ts`; the `quoteRequestReadPort` non-binding edge.
