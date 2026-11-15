---
'@endora-commerce/mod-quote-requests': minor
---

On the customer detail screen, the price-negotiation panel is part of the page's one Save (issue #407, `specs/180-one-save-zone-editors/` FR-060), as it already is on the organization detail screen. Choosing "As organization", "Allowed" or "Not allowed" no longer writes at once. It stages the part "Price negotiation", and the page's Save writes it through the same `PUT /api/v1/admin/customers/:id/quote-price-negotiation`. While a change is staged, the "Effective: …" line is hidden, because it describes the stored option; the Save's answer brings it back. A holder of `customers:read` without `customers:manage` still sees the value and stages nothing. Neither panel writes on change any more, so the panel's own "Saved." status and its string `negotiation.saved` (English and Polish) are removed.
