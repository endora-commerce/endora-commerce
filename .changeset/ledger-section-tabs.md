---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-infakt': patch
---

Added the `ledger.section.tabs` admin zone so invoice-ledger deliveries, routing, and vendor adapter connection screens share one Sales row.

`@endora-commerce/contracts` gains the enum member and empty `LedgerSectionTabsZoneProps`. `invoice_ledger` contributes Deliveries and Routing and keeps a single sidebar entry. `infakt` drops its sidebar row and contributes the Infakt tab, hidden when the adapter is off.
