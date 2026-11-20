---
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-payments': patch
---

Record the credit-release obligation when a credit-limit order is settled through `POST /api/v1/payments/receive`, using the settlement transaction, and attempt the release after commit through the existing retryable order follow-up mechanism.

The orders `applyPaymentStatus` operation records the obligation on the settlement transaction and returns `owesEffects: true` for an applied move that owes a follow-up, even if the obligation already exists. The new `OrderPaymentSettlementEffectsPort` in `@endora-commerce/mod-orders/ports` drains outstanding follow-ups after commit.

**Upgrade:** Credit-limit orders previously settled through `POST /api/v1/payments/receive` may retain active credit reservations without a `credit.release` follow-up. Run the existing repair in dry-run mode with `pnpm run cli orders transition-effects-repair`, review the results, then add `--apply` to release the reservations.
