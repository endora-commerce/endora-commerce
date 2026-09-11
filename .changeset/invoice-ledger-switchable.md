---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-invoice-ledger': minor
---

Invoice ledger is operator-switchable. Switching it off also switches off present ledger adapters. An adapter cannot be switched on while the ledger is off.

`ModuleActivation` accepts optional `cascadeDependentsOnDeactivate`. `invoice_ledger` opts in and defaults on. Re-activating the ledger does not re-activate adapters.
