---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
---

Four more tab strips are the admin kit's `Tabs` (issue #1491): the products list's status tabs (All / Active / Inactive / Archived), the price book's Settings / Prices, the product feed's Overview / Runs / Delivery / Settings and the taxonomy-updates screen's provider tabs. Each is a named tab list with one tab stop, ←/→ and Home/End, and the content below it in the one panel the selected tab labels; they all look like the design system's strip. The products list's status still opens from `?status=`, the price book's tab still lives in `?tab=`, and both price-book sections stay mounted, so unsaved prices survive a look at the settings. A count of zero on a products-list tab is no longer drawn, and a count is read out with what it counts ("Active, items: 12").

On a feed's schedule, *Custom…*'s two input methods (choose a schedule / write a cron expression) are a radio group rather than a second tab strip inside the Settings tab.
