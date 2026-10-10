---
'@endora-commerce/mod-quote-requests': minor
---

The Quote Request expiry sweep runs. Until now nothing called it.

`RfqExpiryWorker.sweep()` was built, exposed on the module's handle and documented as running every
30 minutes, and no scheduler, timer or command ever reached it. With `quote_requests.expiry_days`
set, a Pending or Created from admin Quote Request never became `Expired`, nobody was told, and
`rfq.expired.v1` was never emitted.

**This changes what a running instance does.** The module now installs a BullMQ Job Scheduler on the
queue `quote_requests.expiry.sweep` and a consumer for it, in every process that consumes queues.
It fires every 30 minutes and stops with the module.

**What the first run does on an existing instance — read this before upgrading.** If
`quote_requests.expiry_days` is `0`, the default, nothing happens. If it is set, every request that
has been due since — possibly for months — is expired over the first ticks:

- they all become `Expired` and get their `expired` history row, and `rfq.expired.v1` is emitted for
  each (so subscribers on the event bus, outbound webhooks included once that event is offered,
  hear about every one);
- **no notification is queued for a request that became due more than 24 hours before the tick that
  reached it**, for the customer or for the sales side. A request that became due within the last 24
  hours is notified about as usual. This is a property of every run, not of the first one;
- at most 500 requests are expired per tick, oldest first, so a large backlog takes several ticks.

Set `quote_requests.expiry_days` to `0` before upgrading to review the backlog first.

Also fixed in the sweep itself:

- **A failure no longer loses events.** The pass flushed every due request to `Expired` and then
  walked them; a throw on the second of three left three requests `Expired`, one announced, and
  nothing for the next pass to find. Each request is now one transaction — status, history row and
  notification rows together — and its event is emitted after that transaction commits. A request
  that fails stays due for the next tick and does not stop the others.
- **`rfq.expired.v1` carries `organizationId`**, the Organization the request belongs to. An
  additive field.
- **An idle tick writes no audit row.** The tick asks whether anything is due before it enters its
  system scope.

`RfqExpiryWorker.sweep()` now resolves to `{ expiredCount, failedCount,
notificationsSuppressedCount, reachedBatchLimit }`; `expiredCount` is unchanged in meaning.
`RfqEventService.append` and `RfqNotificationService.enqueue` accept an optional transactional
EntityManager.
