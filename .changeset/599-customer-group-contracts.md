---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-customer-accounts': patch
---

Customer-group admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `customerGroupListResponseSchema` / `CustomerGroupListResponse` for `GET /api/v1/admin/customer-groups`, a `data` array of `customerGroupSchema` rows. The rows were already described, but the list envelope was not.
- `mod-customer-accounts` builds every customer-group reply as the contract's `CustomerGroup` instead of `Record<string, unknown>`. The list handler returns `CustomerGroupListResponse` and the upsert handler returns `{ data: CustomerGroup }`. The admin customer-groups client's `AdminCustomerGroup` is now an alias of the contract's `CustomerGroup` instead of a hand-written interface of the same shape. Nothing on the wire changes.
