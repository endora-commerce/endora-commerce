---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-currencies': patch
---

Currency admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `currencyListResponseSchema` / `CurrencyListResponse` for `GET /api/v1/admin/currencies`, a `data` array of `currencySchema` rows. The rows were already described, but the list envelope was not.
- `mod-currencies` builds every currency reply as the contract's `Currency` instead of `Record<string, unknown>`. The list handler returns `CurrencyListResponse`, and the upsert and set-default handlers return `{ data: Currency }`. Nothing on the wire changes.
