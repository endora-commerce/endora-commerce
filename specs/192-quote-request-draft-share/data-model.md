# Data model: Operator-created quote requests stay drafts until shared

Feature `specs/192-quote-request-draft-share/`. One owner, `quote_requests`; no table of another
module changes. Decisions and rejected alternatives: `research.md` R-1, R-10, R-17.

## 1. `quote_requests` (entity `QuoteRequest`, `src/backend/entities/quote-request.entity.ts`)

| Column | Type | Null | Default | Written by | Meaning |
| --- | --- | --- | --- | --- | --- |
| `shared_with_customer` | `boolean` | no | `true` | `createOnBehalf` (writes `false` when `operatorQuoteStartsUnshared()`), the share Command (`true`) | Whether any customer read may return the quote. `false` = unshared (the UI's *Draft*). |
| `shared_at` | `timestamptz` | yes | — | the share Command | When an operator shared a quote that started unshared. `null` for a quote that never was unshared (legacy rows, customer submissions, *Clone to quote*) and while unshared. |
| `shared_by_admin_user_id` | `uuid` | yes | — | the share Command | Who shared it. Plain uuid, no foreign key (as `created_by_admin_user_id`). Admin replies only. |
| `share_validity_days` | `integer`, `check (is null or >= 0)` | yes | — | `createOnBehalf`, `modify` while unshared | Days of validity applied at share time; `null` = no deadline. Kept after the share as the record of what was applied. |

Entity: `sharedWithCustomer: boolean = true`, `sharedAt?: Date | null`,
`sharedByAdminUserId?: string | null`, `shareValidityDays?: number | null`; all four in
`[OptionalProps]`. `version` is bumped by the share (it is a row mutation).

### Invariants

1. `shared_with_customer = false` ⇒ `shared_at is null` and `expires_at is null`.
2. `shared_at is not null` ⇒ `shared_with_customer = true` and `shared_by_admin_user_id is not null`.
3. `shared_with_customer = false` only on a row whose `created_by_admin_user_id is not null`
   (only `createOnBehalf` writes `false`).
4. `shared_with_customer` never goes from `true` to `false` (FR-025: no un-share). No code path
   writes `false` except the create.

Invariants 1–2 are held by the code paths (create, share, modify) and asserted in their tests;
they are not database checks, because a check would have to be dropped the day the "drafts off"
setting writes `true` with `shared_at` at create (R-2).

### State (orthogonal to `status`)

```text
             createOnBehalf (operatorQuoteStartsUnshared() = true)
                        │
                        ▼
  ┌──────────────────────────────┐    share (Command quote_request.share)
  │ unshared                      │ ───────────────────────────────────────▶ shared
  │ status: Created from admin    │    refused: RFQ_ALREADY_SHARED, RFQ_NOT_QUOTED,
  │ (or Canceled after cancel)    │    QUOTE_INCOMPLETE/share, RFQ_SHARE_CUSTOMER_UNAVAILABLE,
  └──────────────────────────────┘    VERSION_CONFLICT, any beforeCommit hook's own code
                                       (all leave the row unshared, nothing recorded)

  every other creation path (customer submit, resubmit, clone-to-quote, cart conversion) ─▶ shared
```

The status machine (`Created from admin → Approved | Canceled | Expired`, …) is unchanged. While
unshared: the customer cannot reach `Approved`/`Canceled` (every customer action is a 404); the
admin can `cancel` (stays unshared, invisible); the sweep never moves it to `Expired` (§3).

## 2. `quote_request_events` — event type `shared`

`qre_event_type_check` gains `'shared'`. Entity union `QuoteRequestEventType` and the contracts
enum `rfqEventTypeSchema` gain `'shared'`. Payload `{ type: 'shared', validityDays: number | null,
expiresAt: string | null }` (list-1 values: a count and a date). Actor: the sharing admin.
`revisionId`: the current revision (the content the customer is shown).

Customer-visible: it is the first entry of the customer's history (FR-012); its payload passes the existing allow-list only. History entry kind `shared`
(`quoteRequestHistoryEntryKindSchema`), projected in
`src/backend/services/history/history-projection.ts`.

`modified` payload may carry `validityDays: { before: number | null, after: number | null }`
(written by `modify` on an unshared quote); projected as a history change of kind
`validity_days` (new member of `quoteRequestHistoryChangeSchema`).

## 3. Readers that change

| Reader | Change |
| --- | --- |
| `RfqService.findVisibleForCustomer` (`rfq-service.ts:1444`) | unshared → `404 NOT_FOUND` |
| `RfqService.#listSummaries` (`:483`) | `where.sharedWithCustomer = true` |
| `RfqExpiryWorker.dueRequests` (`rfq-expiry-worker.ts`) | `and q."shared_with_customer"` |
| `toQuoteRequestRecord` (`quote-request-read-port.ts`) | maps `sharedWithCustomer` |
| `RfqAdminService.listAll` | optional `sharing` filter; summary carries `sharedWithCustomer` |
| `RfqService.serializeFull` (admin path only) | `sharedWithCustomer`, `sharedAt`, `sharedByAdminUserId`, `shareValidityDays` |
| `customerEventsOf` (`customer-projection.ts`) | for a quote with `sharedAt`: only the events from the `shared` event on (FR-012, R-14) |
| `RfqService.#listSummaries` order | from `customerListOrder()` — today's `createdAt desc` (R-20, OQ-6 open) |
| `carts` `createCartFromQuoteRequest` | `!qr.sharedWithCustomer` → existing `404` |

## 3a. `quote_request_items` — no schema change

`agreed_unit_price` is already nullable. New: `createOnBehalf` may write `null` (FR-013, R-19);
before, only the admin `PATCH` could.

## 4. Module setting

| Code | Type | Default | Scope read | Meaning |
| --- | --- | --- | --- | --- |
| `quote_requests.default_validity_days` | `number` (int ≥ 0) | `0` | global (no channel) | Days of validity a new operator quote carries unless the operator changes them; counted from the share. `0` = no deadline. Snapshotted into `share_validity_days` at create (`0` → `null`). A `0` typed on a draft also means no deadline (FR-032). |

## 5. Audit (Command `quote_request.share`, `objectType: 'quote_request'`)

`stateBefore: { sharedWithCustomer: false, expiresAt: null, version }`,
`stateAfter: { sharedWithCustomer: true, expiresAt, version }` — `audit-state.md` list 1 only
(booleans, dates, counts). `quote_request.create_on_behalf`'s `stateAfter` gains
`sharedWithCustomer` and `shareValidityDays`.
