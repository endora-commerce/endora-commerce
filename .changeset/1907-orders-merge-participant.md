---
'@endora-commerce/mod-orders': minor
---

Orders take part in an Organization merge (issue #1907): the duplicate's orders — as buyer and as
payer — their external references, transition effects and settled placement intents follow the
organization that stays, through the audited, irreversible Command `order.merge_reassign` (no
per-order event). A merge cannot start while the duplicate has an unsettled placement intent or a
gateway payment awaiting the provider from the last 24 hours (`409 RECORD_MERGE_BUSY`, retryable).
