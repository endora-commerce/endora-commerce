---
'@endora-commerce/mod-quote-requests': minor
---

Quote request notification records now commit in the same transaction as the change they announce
(issue #238, `specs/179-rfq-and-customer-notifications/` WP-04). If a transition fails, nothing it
wrote is kept: not the status change, not its history entries, not its revision and not its
records. If it commits, all of them are there. Before this change the status was committed first,
and the history entry and the records were written after it on connections of their own. A failure
in between left a changed request with no history entry or no records.

- Submitting, re-submitting and creating a request on a buyer's behalf write the request, its
  lines, revision 1, its history entries and its records in one transaction.
- Accepting or rejecting an offer, and an operator's approval, cancellation or revision, write
  their history entries, their revision (for a revision) and their records while holding the
  request's row lock. The approval's optional note is written there too, so a failed approval
  leaves no note.
- An order completing its quote request writes the status and the `completed` history entry in one
  transaction. Completion still records no notification.

After each such commit the module adds one job to the BullMQ queue
`quote_requests.notifications.deliver` (fixed job id `quote_requests.notifications.kick`). The job
wakes the delivery worker of a later release. It is added without waiting, and a failure to add it
is logged at `warn` and never fails the transition. Without a module queue connection nothing is
added. Until the delivery worker ships, at most one such job waits in Redis.

`RfqRevisionService.record(input, within?)` accepts the caller's EntityManager. A
`transition-lock.ts` helper, `inTransaction(em, change)`, runs a write with no row to lock in one
transaction on `em`.
