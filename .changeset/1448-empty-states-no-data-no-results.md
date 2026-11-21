---
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-dictionaries': patch
---

Empty lists now tell "nothing here yet" apart from "your filters match nothing" (issue #1448). The products, inventory, warehouses, back-in-stock and pricing-override lists used to show one sentence for both. Now a list that its filters emptied offers *Clear filters*, and a list with no records offers its create action, if the operator may use it. The sales channels, credentials, online customers, invoice ledger deliveries, dictionary audit and command hooks screens show the kit's empty state instead of a plain grey sentence.

- **`EmptyState`'s documentation** says where the block belongs. Use it for the page's or the tab's primary region. Keep a one-line sentence for pickers, inline sub-lists and side widgets.
- **Header create buttons.** While a list is empty, its header no longer repeats the create button that the empty state carries: products, warehouses, inventory import, sales channels and credentials.
- **Removed keys.** `catalog` drops `productsList.empty.prefix`, `.button`, `.suffix` and `.readOnly`. The empty catalog now uses `productsList.empty.noData.*`.
- **Peer dependencies.** `mod-sales-channels`, `mod-credentials` and `mod-invoice-ledger` gain an optional peer dependency on `lucide-react` `^1`, which their admin screens now import.
