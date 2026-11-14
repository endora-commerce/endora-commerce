---
'@endora-commerce/mod-projects': patch
---

Projects: a Stage deadline alert whose sweep died between claiming and settling it is now marked `interrupted` (issue #462), as CRM's reminder sweep marks its own. The first pass thirty minutes after the claim (`STAGE_ALERT_CLAIM_STALE_MS`) sets the outcome and logs a warning naming the delivery rows; the alert is never retried, since a bell entry or an e-mail may already have gone out. A pass that outlives the bound still records what it delivered, over the presumption. `ProjectStageAlertOutcome` gains `interrupted`; the new type `StageAlertDeliveryOutcome` is what a delivery itself can come to. A migration widens the outcome check of `project_stage_alert_deliveries` and adds a partial index on `claimed_at` for unsettled claims; nothing else in the table changes.
