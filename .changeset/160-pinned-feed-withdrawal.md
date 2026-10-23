---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-product-feeds': minor
---

A product feed whose pinned price book does not apply at generation time withdraws its published file (feature 160, FR-029, owner ruling 2026-10-23).

- **`@endora-commerce/contracts`.** `feedRunStatusSchema` gains `withdrawn`. `productFeedRunSummarySchema` (and so a feed's `lastRun` and every run) gains `withdrawalReason`: on a `withdrawn` run, one of `pinnedPriceBookUnpublishableReasonSchema`'s reasons; `null` otherwise. A consumer that switches exhaustively on the run status has one more case.
- **`@endora-commerce/mod-product-feeds`.** A run of a feed pinned to a book that does not apply ends `withdrawn` with the reason, before the catalogue is walked: it produces no file, clears the feed's published file, and the public feed URL then answers exactly as for a feed that has never been generated (`404`, the one not-available body). It is not a failed run, so no failed-run notification is sent; the earlier file is detached, not deleted, and is purged by the usual artefact retention. When the book applies again, the next run publishes as usual. A failed run (a configuration error, the skip threshold, storage) still keeps the last good file serving, as before. New column `product_feed_runs.withdrawal_reason` (migration `20261023T195611_product_feeds_run_withdrawal_reason`). `FeedGenerationService` requires a `pinnedPriceBookPublishability` dependency. The admin shows the outcome as *Withdrawn* on the run badge, the run page and the feed page (English and Polish).
