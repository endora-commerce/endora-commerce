---
'@endora-commerce/mod-quick-order': minor
---

On the organization detail screen, the ordering defaults panel is part of the page's one Save (issue #407, `specs/180-one-save-zone-editors/` WP-7). Its own *Save preferences* button and its "Saved" line are not shown there. Each changed value counts as one change of the part "Ordering defaults" (`defaultPreferences.partLabel`, English and Polish), and the page's Save writes them through the same `PUT /api/v1/admin/quick-order/preferences`. The values are checked against the contracts request schema before anything is written. The customer detail's contribution forwards that screen's session in the same way, so the panel becomes part of the customer screen's one Save as soon as the screen passes a live session (#1241). Until then the screen passes the inert handle, and the panel keeps its own Save there.
