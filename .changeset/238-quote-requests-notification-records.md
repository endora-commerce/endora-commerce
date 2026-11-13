---
'@endora-commerce/mod-quote-requests': minor
---

Quote request notification records are redesigned (issue #238,
`specs/179-rfq-and-customer-notifications/` WP-02). The migration
`Migration20261113T081826QuoteRequestsNotificationsRedesign` drops the table
`quote_request_notification_events` and creates `quote_request_notifications`, which holds one
delivery record per history entry, recipient and channel. **The rows of the old table are
discarded.** Nothing ever delivered them, and none of them would still be sent under the 24-hour
limit. Its `down()` re-creates the old table, empty.

The entity `QuoteRequestNotificationEvent` is replaced by `QuoteRequestNotification`. Its channel
and status vocabularies are new: five channels (`customer_email`, `customer_in_app`,
`customer_push`, `admin_in_app`, `admin_email`) and a `pending` status with one closing status per
outcome.
`RfqNotificationService.enqueue(input, within?)` is replaced by `record(within, { change,
sourceEvent, rfq, actor })`. It writes one record for each cell of the notification matrix and
writes only into the caller's EntityManager.

The channels each change records follow the notification matrix: the buyer's e-mail for every
change except completion, and the admin bell and admin e-mail where the matrix names the operator
side. A buyer now also gets a confirmation e-mail record for their own submission, re-submission,
acceptance or rejection. A request an operator prepares is announced from its `created` history
entry, no longer from the automatic note. A completed request records nothing. The recipients are
the same people as before. Nothing delivers the records yet; the delivery worker comes with a
later release.
