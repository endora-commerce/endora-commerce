---
'@endora-commerce/mod-inventory': patch
---

**A back-in-stock subscription the stock worker notified now reads as notified.** `AvailabilityWorker.dispatchForStockIncrease` — the sender `inventory.adjusted.v1` triggers — stamped only `notifiedAt` on a subscription it had consumed, so the row kept `status = 'queued'` and showed as still waiting in the admin back-in-stock list, its status filter and its counts. It now writes `status = 'notified'` beside `notifiedAt`, as `AvailabilityNotificationService.processRestockedFanOut` always did — also when the operator has the e-mail switched off and the subscription is consumed without a message. A subscription whose account no longer exists is closed as `cancelled`, as in the fan-out.

- A migration corrects the rows the worker already left behind: every `availability_notifications` row with `notified_at` set and `status = 'queued'` becomes `notified`. Its `down()` changes nothing, because the corrected rows can no longer be told apart from rows notified correctly.
