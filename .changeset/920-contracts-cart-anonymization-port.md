---
'@endora-commerce/contracts': minor
---

New port `CartAnonymizationPort` (container name `cartAnonymizationPort`, owner `carts`) with one method, `anonymizeForCustomerAccount(customerAccountId): Promise<number>`: the customer-account anonymisation sweep's step that erases the reasons operators and approvers wrote about the account's carts, answering how many carts it changed (issue #920). Additive; nothing existing changes.
