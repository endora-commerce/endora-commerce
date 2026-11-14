# Contract: the quote request notification matrix

**Normative for** the recording step (FR-001 – FR-007), the e-mail definitions (FR-020) and every
test that asserts who was told. One row per change. Adding a transition (for example
`specs/170-organization-roles/` P3's internal approval) is adding a row here and one in
`notification-matrix.ts`; nothing else decides recipients.

The matrix is implemented once as data, `packages/modules/quote_requests/src/backend/services/notifications/notification-matrix.ts`,
and the recording step reads it. A unit test compares that file with this table.

## 1. Changes

`C` = customer side (research R-3): requester ∪ members who may open the request.
`O` = operator side (research R-5). `actor` = the customer account whose action caused the change.

| Change (`change`) | Caused by | Source history entry (`event_type`) | `customer_email` | `customer_in_app` | `customer_push` | `admin_in_app` | `admin_email` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `submitted` | buyer creates and submits | `submitted` | C | C − actor | C − actor | O | O |
| `resubmitted` | buyer re-submits (new request) | `re-submitted` of the new request (payload `sourceRfqId`) | C | C − actor | C − actor | O | O |
| `offer_accepted` | buyer accepts the offer → *Approved* | `approved` (`approvedBy: 'customer'`) | C | C − actor | C − actor | O | — |
| `offer_rejected` | buyer rejects the offer → *Canceled* | `canceled` (`canceledBy: 'customer'`) | C | C − actor | C − actor | O | — |
| `expired` | expiry sweep | `expired` | C | C | C | O | — |
| `prepared` | operator creates on the buyer's behalf → *Created from admin* | `created` (admin) | C | C | C | — | — |
| `revised` | operator saves a revision (offer awaiting the buyer) | `modified` (admin) | C | C | C | — | — |
| `approved` | operator approves → *Approved* | `approved` (`approvedBy: 'admin'`) | C | C | C | — | — |
| `canceled` | operator cancels → *Canceled* | `canceled` (`canceledBy: 'admin'`) | C | C | C | — | — |
| *(completed)* | order placed from the quote | `completed` | — | — | — | — | — |

Rules:

1. Recipients are resolved **when the change commits**, inside its transaction, and de-duplicated
   per channel (one person, one record per channel).
2. An `expired` change due more than 24 hours before the sweep reached it records nothing (the
   sweep's existing grace rule).
3. `C − actor` writes no record for the actor (FR-007); the actor's `customer_email` record is
   written.
4. A customer recipient is skipped **at recording** if their account is deleted, blocked or
   anonymised; an admin recipient if inactive or lacking `rfqs:handle`. Re-checked at delivery
   (`skipped_no_recipient`).
5. The source history entry is written in the same transaction (research R-6). A new request
   writes `created` and then `submitted` (or `re-submitted`); the records name the second.
6. The customer's own draft edits (`modified` by the buyer, `draft-guard.ts`) and `note-added`,
   `pdf-sent`, `custom-field-carry-skipped` record nothing.

## 2. What each channel carries

| Channel | Content | Link |
| --- | --- | --- |
| `customer_email` | template of §3, channel default language | `<storefront_url>/quote-requests/<id>` when the channel has a `storefront_url`; otherwise none |
| `customer_in_app` | `title` + `titleMessage` `{ scope: 'quote_requests', key: 'customerNotifications.<change>.title', params: { number } }`; no body | `/quote-requests/<id>` |
| `customer_push` | same sentence as `customer_in_app`, resolved in the channel's default language (push is rendered once, on the device) | `/quote-requests/<id>` |
| `admin_in_app` | `title` + `titleMessage` `{ scope: 'quote_requests', key: 'notifications.<change>.title', params: { number } }`; no body | `/quote-requests/<id>` (admin route) |
| `admin_email` | template of §3, administrator's preferred language | `<ADMIN_BASE_URL>/quote-requests/<id>` (`quote.adminUrl`) when `ADMIN_BASE_URL` is set; otherwise none — added in #1204, after #185 (owner ruling OQ-1) |

`number` is the business id (`QR-000153`), or the first eight characters of the id when the
request has no business id. No product names, prices or Organization names travel in the in-app or
push channels.

## 3. E-mail definitions (`transactionalEmails` in `quote_requests/src/manifest.ts`)

All in group `quote_requests`. Common variables: `quote.number`, `quote.url` (empty when there is
no link), `customer.name` (the recipient), `organization.name`, `channel.name`.

| Code | Change | Extra variables |
| --- | --- | --- |
| `quote_request_customer_submitted` | `submitted` | `actor.name` |
| `quote_request_customer_resubmitted` | `resubmitted` | `actor.name`, `quote.previousNumber` |
| `quote_request_customer_offer_accepted` | `offer_accepted` | `actor.name` |
| `quote_request_customer_offer_rejected` | `offer_rejected` | `actor.name`, `reason` |
| `quote_request_customer_expired` | `expired` | — |
| `quote_request_customer_prepared` | `prepared` | `quote.validUntil` |
| `quote_request_customer_revised` | `revised` | `quote.validUntil`, `quote.revisionNumber` |
| `quote_request_customer_approved` | `approved` | `quote.validUntil` |
| `quote_request_customer_canceled` | `canceled` | `reason` |
| `quote_request_operator_submitted` | `submitted` | `actor.name`, `quote.lineCount`, `quote.adminUrl` |
| `quote_request_operator_resubmitted` | `resubmitted` | `actor.name`, `quote.lineCount`, `quote.previousNumber`, `quote.adminUrl` |

Each ships `defaultSubject` and `defaultContent` for `en` and `pl` through `emailDefaultsPort`.
None is `nonDeactivatable`. None carries an attachment.

## 4. Sender outcome → record status

| `TransactionalSendOutcome` / condition | Record |
| --- | --- |
| `sent` | `sent` |
| `logged` | `skipped_logged` |
| `deactivated` | `skipped_deactivated` |
| `no_transport`, or no sender wired | `skipped_no_transport` |
| `no_definition` | `failed` immediately, `last_error = 'no_definition'` (a defect: the manifest declares it) |
| recipient has no address / account gone | `skipped_no_recipient` |
| thrown error | retry (backoff), `failed` after the fifth attempt |
