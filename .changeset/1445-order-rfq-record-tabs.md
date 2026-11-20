---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-i18n': patch
---

The order and quote-request detail screens draw their sections with the kit's `RecordTabs` instead of hand-written tab strips (issue #1445, UX audit DS-12). The strip is named ("Order sections", "Quote request sections"). Only the selected tab is in the tab order. ←/→ move between tabs and select them, Home/End jump to the first or last tab, and every tab is linked to its panel. The ids are `order-detail-tab-*` / `order-detail-tabpanel` and `rfq-detail-tab-*` / `rfq-detail-tabpanel`. The quote request's Modify draft still stays mounted across tab switches.

`TabItem` gains `unsaved?: string`. It draws a dot after the label and adds the words to the tab's accessible name, so the colour is never the only signal. The Modify tab now uses it.

The status-graph toolbar's Connect toggle and its layout buttons, and the order-create address source buttons (saved or new), now report their state with `aria-pressed`. The layout buttons are a group named "Layout". New copy: `core` `orderStatusConfig.graph.layout`, `orders` `detail.tabs.label`, `quote_requests` `detail.tabs.label`, in English and Polish.
