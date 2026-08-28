---
'@endora-commerce/mod-tpay': patch
'@endora-commerce/mod-autopay': patch
---

Bound what these two gateways persist by this platform's schema instead of by
the provider's payload.

`@endora-commerce/mod-tpay` — `parseTpayNotificationBody`'s JSON branch was
`JSON.parse(text) as NotificationBody`, a type assertion over an inbound webhook
body, so every field TPay sent survived into the parsed body. It is now a Zod
parse against a schema for the fields this module reads, and the exported
`NotificationBody` type is inferred from that schema so the two cannot drift.
The behaviour it defines, deliberately and not by default: **an unnamed key is
projected away, a named key of the wrong type is refused.** TPay extending its
notification is the ordinary case, and refusing the whole body for it would mean
a settlement notification that cannot be parsed — a payment never recorded — so
additions are dropped and the rest of the notification settles. A field the
module acts on (`tr_id`, `tr_status`, `transactionId`, …) arriving with a type it
cannot read throws instead, and the throw is not swallowed: `handle` records the
notification event as `failed` with the offending field named in the reason and
answers non-OK, so TPay resends and an operator sees it. The refusal reason on
`{ result: false, reason }` therefore now carries the parser's own sentence
rather than the flat `'Invalid notification body'`.

The settlement write persisted `providerDetails: { source, body }` — the whole
parsed body, into a column `payments`' route serialises in full. It is now a
named projection: `{ source, trId?, trStatus?, cardBrand?, cardTail? }`.
`card_token` is deliberately not among them — it is already stored once,
customer-scoped, in `tpay_saved_cards.card_token`, and the saved-card mirror is
unchanged.

`@endora-commerce/mod-autopay` — a rejected refund persisted
`providerDetails: { remoteId, messageId, httpStatus, body: result.body.slice(0, 2000) }`,
the raw settlement-API response truncated. The body is diagnostic material and
now goes to the module's logger; the persisted projection is the three named
fields. **`AutopayRefundHandler`'s constructor takes a sixth argument**, a
`WorkerLogger`, and `buildAutopayServices` requires a `log` alongside its
existing options — pass `ctx.log`. Both are the only call-shape changes.

No schema change and no migration: `payments.provider_details` and
`refunds.provider_details` are `json` columns and only what is written into them
going forward differs. Existing rows are left exactly as they are.
