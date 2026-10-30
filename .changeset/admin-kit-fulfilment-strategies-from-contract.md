---
'@endora-commerce/admin-kit': patch
---

`FulfilmentStrategyPicker` derives its options from `fulfilmentStrategySchema.options` in `@endora-commerce/contracts` instead of a hand-copied list, so a strategy added to the contract is offered without a kit change. Its label is read from the `core` key `fulfilment.strategy.<id>`, which a new strategy must ship in every admin language. No prop changes; the five current strategies render as before.
