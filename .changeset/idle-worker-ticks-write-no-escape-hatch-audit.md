---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-price-lists': patch
---

A scheduled tick that finds nothing to do no longer writes a `tenant.escape_hatch` audit row. Four
repeating jobs entered a system scope on every tick, and each entry is one row in
`audit_log_entries` because ticks are further apart than the audit writer's ten-second aggregation
window: the order follow-up sweep and the CRM event reminders (every 60 seconds, 1,440 rows a day
each), the product feed stale-claim reaper and the price list status sweep (every 5 minutes, 288 a
day each) — on an instance where none of them did anything.

Each now asks first whether a pass would do anything, with a statement that runs outside any scope
and returns one boolean and nothing else, and enters the system scope only when the answer is yes.
A tick with work is recorded exactly as before. A question that fails counts as yes, so a failing
probe can cost an audit row and never save one. The rule is written down in
`docs/docs/architecture/tenant-scoping.md` § *A scheduled tick with nothing to do enters no scope*.

Not changed: the rows a process writes while it starts (`boot: …`), and the search reindex timer,
which reads a setting before it can know whether it has work.

For code that builds these consumers itself — inside 0.x, and nothing in the published surface of
`@endora-commerce/platform` moves:

- `mod-orders`: `TransitionEffectSweepDeps.effects` also needs `hasSweepWork`; new
  `OrderTransitionEffectService.hasSweepWork()` and `runTransitionEffectSweepTick()`.
- `mod-crm`: `startEventReminders()` also takes `isPresent` and `hasWork`; new
  `EventReminderService.hasSweepWork()` and `runEventReminderJob()`.
- `mod-product-feeds`: `createFeedReaperWorker(redis, hasWork, processor)` takes the question as its
  second argument; new `FeedRunReaperService.hasClaimedRuns()`, `runFeedReaperJob()` and
  `runFeedRunReaperTick()`.
- `mod-price-lists`: new `PriceListStatusWorker.hasDueTransitions()` and `statusSweepTick()`.
