---
'@endora-commerce/mod-pim-pimcore': patch
---

Increment the counters concurrent applies of one Pimcore delivery share in SQL,
not in memory.

`PimcoreDeliveryApplyService.finishRecord` wrote `delivery.terminalRecordCount`,
`run.consideredCount`, `run.failedCount`, `run.issueCount` and the six other run
counters as `entity.count += 1` on a loaded row. The apply worker runs at
`concurrency: 4` and the connection claim serialises **deliveries**, not the
records within one, so several records of a delivery finish at the same time —
each inside its own `CommandBus` transaction at PostgreSQL's default READ
COMMITTED. Two of them read the same value and write the same increment, and one
increment is lost.

Reproduced rather than reasoned about: six records of one delivery applied
concurrently left `terminal_record_count` at **1**. Every counter is now
accumulated per record and written as `column = column + ?` on the caller's
transaction, with `returning` handing the post-increment values back to the
loaded entity under the row lock the statement already holds. The same six
records now count six.

The isolation level is deliberately untouched: raising it would trade lost
updates for serialisation failures the worker would have to retry, on counters
nothing branches on. Delivery completion never depended on the counters — it is
decided by a fresh `em.count` over pending records — so no run's outcome changes,
only what it reports.

Spec FR-104 (`specs/092-pimcore-pim-sync/`, corrected 2026-09-01) and the
`specs/deferred-defects.md` entry *"`pim_pimcore` loses counter increments under
`concurrency: 4`"*, which this retires.
