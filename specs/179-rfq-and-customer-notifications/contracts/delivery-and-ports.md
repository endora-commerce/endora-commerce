# Contract: delivery worker, published ports and the History extension

**Normative for** the `quote_requests` delivery worker (FR-010 – FR-016), the two new published
ports (FR-040, FR-060) and the History extension (FR-070, FR-071). Types in-process are plain
TypeScript in `packages/contracts/src/` (the `admin-notifications.ts` precedent); HTTP shapes are
Zod schemas.

## 1. `customerNotificationRecordPort` — owner `customer_notifications`

File: `packages/contracts/src/customer-notifications.ts` (new).

```ts
/** Same shape as AdminNotificationMessage, deliberately (research R-13). */
export interface CustomerNotificationMessage {
  scope: string;                                   // a module id
  key: string;                                     // a key in that module's bundle
  params?: Record<string, string | number>;
}

export interface RecordCustomerNotificationInput {
  organizationId: string;
  customerAccountId: string;
  /** The channel the entry concerns; null = shown on every channel. */
  salesChannelId: string | null;
  /** The producing module's id; the list hides entries whose producer is absent. */
  sourceModule: string;
  /** Unique per sourceModule; a second record with the same key is refused (see below). */
  sourceKey: string;
  kind: string;                                    // e.g. 'quote_requests.approved'
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;                                   // the English sentence, always
  titleMessage: CustomerNotificationMessage;
  body?: string | null;
  bodyMessage?: CustomerNotificationMessage | null; // rejected without body
  /** Storefront-relative: starts with one '/', no scheme, no '//' (FR-047). */
  linkPath?: string | null;
}

export interface CustomerNotificationRecord {
  id: string;
  createdAt: Date;
}

/**
 * Container name: `customerNotificationRecordPort`. Owner: `customer_notifications`.
 *
 * Owner off: the gate fails closed (ModuleDisabledError). Callers decide presence in front of it
 * (effectiveState.isPresent('customer_notifications')) and never catch the refusal (D-60).
 *
 * `recordWithin` persists into the caller's unit of work, with no fork and no flush, and commits
 * or rolls back with it — the admin bell's `recordWithin` semantics. It validates before
 * persisting and throws a plain Error on invalid input (link, params, body/bodyMessage pairing):
 * a programming error, not a delivery outcome.
 *
 * Idempotency: (sourceModule, sourceKey) is unique in the database. `recordWithin` relies on the
 * caller's own idempotency (quote_requests' closing of the delivery record in the same transaction
 * makes a second call for the same record impossible); `record` answers the existing entry when the
 * key is already present.
 */
export interface CustomerNotificationRecordPort<EM = unknown> {
  record(input: RecordCustomerNotificationInput): Promise<CustomerNotificationRecord>;
  recordWithin(em: EM, input: RecordCustomerNotificationInput): CustomerNotificationRecord;
}
```

## 2. `customerPushPort` — owner `pwa`

File: `packages/contracts/src/pwa.ts` (extended).

```ts
export type CustomerPushCategory = 'quote';      // 'order' stays on pwa's own subscription

export interface CustomerPushInput {
  organizationId: string;
  customerAccountId: string;
  /** The channel whose push settings apply; null = the system default channel. */
  salesChannelId: string | null;
  category: CustomerPushCategory;
  /** Already rendered by the caller in the language it chose. */
  title: string;
  body: string;
  /** Storefront-relative path the notification opens. */
  url: string;
  /** Idempotency key; becomes push_messages.source_event_id under trigger 'quote_request'. */
  sourceKey: string;
}

export type CustomerPushOutcome =
  | 'enqueued'
  | 'skipped:switched_off'          // pwa.push_enabled or the category setting off on the channel
  | 'skipped:customer_preference'   // the account's quoteStatusEnabled is false
  | 'skipped:no_account'            // deleted or anonymised
  | 'skipped:no_subscription';      // the account has no active device subscription

/**
 * Container name: `customerPushPort`. Owner: `pwa`. Owner off: fails closed; callers decide
 * presence first. Producer only: it writes the push message and enqueues pwa's own delivery
 * worker; it never sends inline (Principle X). A repeated sourceKey answers 'enqueued' and writes
 * nothing (push_messages_trigger_event_uniq).
 */
export interface CustomerPushPort {
  push(input: CustomerPushInput): Promise<CustomerPushOutcome>;
}
```

The gate order is the one `status-push-composer.ts` documents today (research R-11 of
`specs/149-pwa-order-status-push/`): channel → `pwa.push_enabled` and
`pwa.push_quote_status_enabled` → account live → preference → subscriptions → enqueue. The order
branch of the composer is untouched.

## 3. Delivery worker — `quote_requests`

Files: `src/backend/workers/rfq-notification-delivery-worker.ts`,
`src/backend/services/notifications/{notification-matrix,recipients,delivery-service,channel-adapters}.ts`.

| Item | Value |
| --- | --- |
| Queue | `quote_requests.notifications.deliver` |
| Scheduler | id `quote_requests.notifications.deliver`, every 60 000 ms, empty data |
| Kick | `queue.add('kick', {}, { jobId: 'quote_requests.notifications.kick' })` after each committing writer; a failed `add` is logged at `warn` and never fails the transition |
| Idle probe | `hasDeliverable()`: `select exists(… status = 'pending' and next_attempt_at <= now())`, outside any scope; a failed probe counts as yes |
| Scope | `enterSystemScope('quote_requests: deliver quote request notifications', …)` only for a non-idle tick |
| Batch | up to 200 records per tick, oldest first, `for update skip locked`, one transaction per record |
| Stale | `now() - source_occurred_at > 24 h` → `skipped_stale` (FR-011) |
| Presence | channel owner not effectively present → `skipped_module_off` (FR-012) |
| Backoff | after attempt 1, 2, 3, 4: +1 min, +5 min, +30 min, +2 h; attempt 5 failing → `failed` |
| Concurrency | 1 per process; several processes share the table through `skip locked` |
| Registration | `ctx.worker(...)` in `backend/index.ts`, beside the expiry sweep |

Per channel, inside the record's transaction:

| Channel | Owner probed | Action | Closing |
| --- | --- | --- | --- |
| `admin_in_app` | `admin_notifications` | admin still active and holds `rfqs:handle`, else `skipped_no_recipient`; `adminNotificationRecordPort.recordWithin(em, …)` (matrix §2) | `sent` |
| `customer_in_app` | `customer_notifications` | account live, else `skipped_no_recipient`; `customerNotificationRecordPort.recordWithin(em, …)` with `sourceModule: 'quote_requests'`, `sourceKey: <record id>` | `sent` |
| `customer_email` / `admin_email` | `transactional_emails` (non-deactivatable) | resolve address and language; `sender.send({ code, messageId: 'quote_request_notification:' + id, salesChannelId, language, to, variables })` | matrix §4 |
| `customer_push` | `pwa` | render the sentence in the channel's default language; `customerPushPort.push({ …, sourceKey: id })` | `enqueued` → `sent`; each `skipped:*` → `skipped_preference` / `skipped_no_recipient` (`no_account`) / `skipped_no_subscription` / `skipped_module_off` (`switched_off` is reported as `skipped_deactivated`) |

A `ModuleDisabledError` raised by a port despite the presence check (the flip landed between the
two) closes the record `skipped_module_off`; any other error is a failed attempt. A
`ModuleDisabledError` for `quote_requests` itself is re-thrown and fails the job, which the worker
gate then holds (module-composition item 7).

## 4. Admin History extension — `quote_requests`

`GET /api/v1/admin/quote-requests/:id/history` (existing, `rfqs:handle`): each
`quoteRequestHistoryEntrySchema` gains an **optional** `deliveries` array (additive; minor bump of
`@endora-commerce/contracts`):

```ts
export const quoteRequestDeliverySchema = z.object({
  id: uuidSchema,
  channel: z.enum(['admin_in_app', 'admin_email', 'customer_email', 'customer_in_app', 'customer_push']),
  recipient: z.object({
    kind: z.enum(['admin', 'customer']),
    id: uuidSchema,
    displayName: z.string(),        // resolved at read; '' when the person is gone
  }),
  status: z.enum([
    'pending', 'sent', 'skipped_stale', 'skipped_module_off', 'skipped_deactivated',
    'skipped_no_transport', 'skipped_logged', 'skipped_no_recipient', 'skipped_preference',
    'skipped_no_subscription', 'failed',
  ]),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  closedAt: z.string().datetime().nullable(),
}).strict();
```

Deliveries attach to the entry whose `eventIds` contains their `source_event_id`. The customer
history route (`GET /api/v1/quote-requests/:id`) never carries them (FR-071); the customer
allow-list in `services/customer-projection.ts` is not widened.

The admin `RfqHistory.tsx` renders them under the entry as a compact list: recipient, a channel
label, a status label (pl+en in the `core` bundle `rfq.detail.history.delivery.*`, where the
screen's other keys live), and the error behind a disclosure for `failed`.
