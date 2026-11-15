---
'@endora-commerce/mod-quick-order': minor
---

On the organization detail screen, the ordering defaults panel is part of the page's one Save (issue #407, `specs/180-one-save-zone-editors/` WP-7). Its own *Save preferences* button and its "Saved" line are not shown there. Each changed value counts as one change of the part "Ordering defaults" (`defaultPreferences.partLabel`, English and Polish), and the page's Save writes them through the same `PUT /api/v1/admin/quick-order/preferences`. The values are checked against the contracts request schema before anything is written. The customer detail screen keeps the panel's own Save until that screen adopts the page Save.
