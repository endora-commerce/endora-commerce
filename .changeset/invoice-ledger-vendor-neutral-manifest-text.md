---
'@endora-commerce/mod-invoice-ledger': patch
---

The manifest's `description` and two `nonBindingDependencies[].whenAbsent` sentences (`invoicePaidHostPort`, `invoiceKsefAssignmentPort`) no longer name a particular ledger vendor; they describe what the free ledger does with any vendor. Text only — no port, setting or behaviour changes.
