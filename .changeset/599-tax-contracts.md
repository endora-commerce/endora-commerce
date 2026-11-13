---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-taxes': patch
---

Tax admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `taxListResponseSchema` / `TaxListResponse` for `GET /api/v1/admin/taxes`, a `data` array of `taxSchema` rows. The rows were already described, but the list envelope was not.
- `mod-taxes` builds every tax rule reply as the contract's `Tax` instead of `Record<string, unknown>`. The list handler returns `TaxListResponse`, the upsert handler returns `{ data: Tax }`, and the preview handler returns `{ data: ResolvedTax }`. Nothing on the wire changes.
