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

**Which requests it expires.** `quote_requests.expiry_days = 0`, the default, disables the sweep.
Otherwise a request is expired when all three hold:

- it is still `Pending` or `Created from admin`;
- nothing has been added to its history for `expiry_days` — the clock is the request's latest
  history entry, so a submission, an edit, a revision or a note restarts it, and the customer merely
  opening the request, or an assignment, does not;
- **it carries no offer that is still valid**: when the seller dated an offer (`expiresAt`), that
  date wins, and the request is never expired by inactivity while the date is ahead. The sweep does
  not expire a request because its validity date passed; that date is enforced on accept and
  convert, as before.

**Turning the setting on expires the backlog — read this before upgrading or changing it.** The rule
applies to everything that is open, not from the day it is set. Moving `expiry_days` from `0` to
`N`, or lowering it, expires over the next ticks every open request that has been inactive for more
than `N` days. Releases up to 0.104.0 never ran the sweep, so an instance that already has the
setting set meets the same backlog on the first ticks after this upgrade:

- they all become `Expired`, get their `expired` history entry, and `rfq.expired.v1` is emitted for
  each;
- **no notification record is written for a request that became due more than 24 hours before the
  tick that reached it.** A property of every run, not of the first one;
- at most 500 requests are expired per tick, oldest first.

Set `quote_requests.expiry_days` to `0` before upgrading to review the open requests first. The
sweep reads the value of the default sales channel and applies it to requests of every channel; a
channel set to `0` is not exempt.

**The sweep and an answer are mutually exclusive.** A buyer's accept or decline, a customer's edit,
and a seller's approve, revise, cancel or assign now take the request's row and check its `version`
before writing; the sweep skips a request that is held. A transition that loses to the sweep — or
to any other concurrent transition — is refused with `409 VERSION_CONFLICT`, where it used to
succeed and overwrite. Before this, an accept racing the sweep answered `200` and left a request
`Approved` with `expiredAt` set and an `rfq.expired.v1` announced for it.

Also fixed in the sweep itself:

- **A request that fails is retried later, not first.** The worker process leaves a request whose
  expiry failed alone for two hours, so requests that keep failing cannot be the head of every
  batch.
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
