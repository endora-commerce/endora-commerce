---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/admin-kit': patch
---

The six sales lists now have one shape (issue #1500, UX audit SALES-24). Each is the kit `ListPage` with the kit `ListToolbar`, so the toolbar is a named `search` landmark in a plain row, not a card. Below it is one results card that holds the bulk bar, the table and the pager. The kit `EmptyState` tells "nothing here yet" apart from "nothing matches these filters", and the second one offers *Clear filters*.

- **Orders**: *New order* is in the header for an operator holding `orders:write`. The toolbar, bulk-bar and results cards are now one card. Each row has a menu with *Change status…* and *Print invoice* for that one order, plus *Open organization*. The pager offers only the page sizes the endpoint serves.
- **Quote requests**: the hand-built toolbar, filter toggle and chips are replaced by the kit toolbar, so the advanced filters sit behind *More filters (n)*. Each row's menu has *Open organization*.
- **Returns**: the four configuration links (workflow, reasons, return methods, clauses) are one *Settings* menu next to *Export CSV*. The search is no longer listed as a chip. *Clear all filters* empties the search too. When a case has an order, its row menu has *Open order*.
- **Customers**, **Organizations**, **Carts**: these use the kit toolbar and the kit empty state. Each filter is named by its label, and its first option says what it is ("All statuses"). Customers and Carts rows have *Open organization*.

Removed unused translation keys: `orders.open`, `orders.loading`, `orders.empty`, `rfq.list.open`, `rfq.list.loading`, `rfq.list.filter.toggle`, `rfq.list.filter.clearAll`, `returns.loading`, `returns.empty`, `returns.action.open`, `returns.filter.clearAll`, `organizations.filter.all` (core); `list.search.chip` (returns); `list.clearFilters` and `list.filter.all` (customers); `list.clearFilters` (organizations); `carts.clearFilters` and `carts.filter.all` (carts). The admin-kit README documents how the two compose.
