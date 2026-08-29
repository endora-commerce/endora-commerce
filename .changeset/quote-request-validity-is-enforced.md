---
'@endora-commerce/mod-quote-requests': minor
---

The validity deadline an operator sets on a Quote Request is enforced again.

`expiresAt` — written from `expiresInDays` by `RfqAdminService.modify` and
`createOnBehalf`, serialised into `QuoteRequest`/`QuoteRequestSummary`, and shown to both
parties as `expires <date>` — was read by no rule. The feature-008 workflow rewrite
(`4f24dc948`) dropped the live check `accept()` carried and nothing replaced it, so a
customer could accept a revision and convert an approved quote to a cart at its agreed
unit prices for ever. `RFQ_EXPIRED` and `QUOTE_VALIDITY_ENDED` stayed enumerated in
`ERROR_CODES` with sentences in both shipped languages, raised by nothing.

**Two customer transitions now refuse**, both with `410`, both only when the operator
actually set a deadline (`expiresAt` absent still means no deadline):

- `POST /api/v1/quote-requests/:id/accept-revision` → `RFQ_EXPIRED`
- `POST /api/v1/quote-requests/:id/convert-to-order` → `QUOTE_VALIDITY_ENDED`

The two codes are the split
`specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md` already made —
the offer that lapsed undecided, and the accepted quote that ran out — restored rather
than invented. Neither is redundant: they carry different remedies, and a client
discriminating on `error.code` can say which happened.

**Nothing else changes.** `reject-revision` and `resubmit` stay open — declining a lapsed
offer consumes no committed price, and resubmit is the buyer's way forward; it raises a
new request carrying no deadline. Every admin path is untouched, so the operator can
re-quote a lapsed request with a fresh `expiresInDays` and the customer can then accept.
The expiry worker is a different concept and is not touched: it sweeps `updatedAt` against
a settings-wide `expiryDays` and never reaches `Approved`.

**If you consume the customer routes**, handle `410` on those two paths. The envelope
carries the code and the module's own translated sentence; the placeholder strings under
`errors.RFQ_EXPIRED` and `errors.QUOTE_VALIDITY_ENDED` are replaced with real prose in
`en` and `pl`.

There is no data migration. A request whose `expiresAt` is already in the past refuses on
both paths from the moment this lands — that is the rule, not an accident of deployment.
