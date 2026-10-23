---
'@endora-commerce/mod-price-lists': patch
---

The price surface's coverage check (whether a buyer surface holds every product of the everyone surface, which lets an all-products buyer's sorted page skip the everyone stream) probes each everyone row by primary key with a scalar `limit 1` sub-select instead of a `not exists`. On a `price_profile_prices` analysed while empty — a fresh install's, before autovacuum catches up — the `not exists` was planned as a nested-loop anti join filtering every buyer row per everyone row, and the first price-sorted page of an all-products buyer took 428 s on a 50 000-product catalogue; the probe takes about 0.2 s whatever the statistics.

Follow-up in the same release: the probe still took 47 s there, because with no statistics the planner served it from the ordering index (a range scan of the buyer surface per probe). The coverage check now reads each surface's product ids by itself and compares them in memory, and a whole build that writes a large share of `price_profile_prices`, or the first rows of a table with no statistics, analyses the table inside its own transaction, so the statistics are visible together with the rows.
