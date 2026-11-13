---
'@endora-commerce/mod-carts': patch
---

The cart abandonment sweep (`CartAbandonmentWorker.sweep()`, run by `pnpm run cli carts abandonment-sweep`) now also deletes working baskets that were created more than an hour ago (`ORPHANED_WORKING_BASKET_MINUTES`, 60). Their lines and audit rows are deleted with them. A working basket is the basket an admin order, a one-click buy or an external order is placed from. One is left behind only if the process stops between writing it and placing the order, and nothing read it again (issue #602). The sweep matches `status = 'working'` only, so no buyer's basket is touched. It runs even when `carts.abandonment.inactivity_minutes` is `0`. `CartAbandonmentSweepResult` gains `workingBasketsRemoved`, and the command's output line gains `working_baskets_removed=<n>`.
