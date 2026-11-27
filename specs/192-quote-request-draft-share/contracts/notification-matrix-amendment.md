# Contract amendment: `prepared` is announced by the share

Amends `specs/179-rfq-and-customer-notifications/contracts/notification-matrix.md` §1, row
`prepared`. Feature `specs/192-quote-request-draft-share/`, research R-5. Order of change
(the matrix test's own rule): this document and 179's §1 first, then
`notification-matrix.ts` and `notification-matrix.test.ts` in the same commit.

## §1 row, before

| Change (`change`) | Caused by | Source history entry (`event_type`) | `customer_email` | `customer_in_app` | `customer_push` | `admin_in_app` | `admin_email` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `prepared` | operator creates on the buyer's behalf → *Created from admin* | `created` (admin) | C | C | C | — | — |

## §1 row, after

| Change (`change`) | Caused by | Source history entry (`event_type`) | `customer_email` | `customer_in_app` | `customer_push` | `admin_in_app` | `admin_email` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `prepared` | operator shares an operator-created quote with the buyer (Command `quote_request.share`) | `shared` (admin) | C | C | C | — | — |

Channels, audiences, the e-mail definition `quote_request_customer_prepared` (§3) and its
variables (`quote.validUntil` is now the date the share wrote) are unchanged.

## Rules added

- **R-A1** No customer-side record is written for a quote that is unshared at the moment of the
  change: `revised` (a `modify`) and `canceled` (an admin cancel) are skipped while
  `shared_with_customer = false`. Admin-side cells are unaffected (none of these rows has one).
- **R-A2** Records written before this amendment that name a `created` event as the source of
  `prepared` stay as they are; delivery and History read the record, not the matrix.

## Edit to make in 179

Replace the `prepared` row of `specs/179-rfq-and-customer-notifications/contracts/notification-matrix.md`
§1 with the *after* row, and add one line under the table: *"Amended by
`specs/192-quote-request-draft-share/contracts/notification-matrix-amendment.md` (R-A1, R-A2)."*
