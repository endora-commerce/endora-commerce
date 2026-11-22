---
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-comparisons': patch
---

Six admin list screens are the kit `ListPage` now (issue #1749): Sales channels, Credentials, Online customers, Invoice ledger deliveries, Dictionary audit and Comparisons. Each has the kit's loading skeleton, a load error with **Retry**, the result count announced at the end of the toolbar row, and its filters in a toolbar row instead of a card.

- **Credentials:** *Preview*, *Edit* and *Delete* are in the row's menu, and the name opens the configuration. *Delete* runs inside the confirmation, so a configuration a setting still uses is refused there, with the settings to detach.
- **Online customers:** the customer's name opens the customer; the *Open* button is gone. A refresh, by hand or on the timer, keeps the rows on screen.
- **Invoice ledger deliveries** and **Comparisons:** the *Load more* button is replaced by the kit pager (*Previous* / *Next* and rows per page), as on the invoices list. Comparisons puts the date range behind *More filters*, and the owner opens the comparison.
- **Dictionary audit:** *Copied* and *Cache invalidated* are said beside the buttons, not in a banner.
- `@endora-commerce/mod-invoice-ledger` no longer ships `mergeLedgerDeliveryPages`, the *Load more* helper; it was internal to the screen.
- New `en` / `pl` keys: `sales_channels` `list.toolbar.label`, `list.count`; `credentials` `page.count`, `action.menu`; `customers` `online.count`; `invoice_ledger` `deliveries.toolbar.label`; `comparisons` `list.toolbar.label`.
