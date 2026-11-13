---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-shopping-lists': patch
---

`POST /api/v1/shopping-lists/:id/convert-to-rfq` declares the reply it has always sent when nothing converts (issue #1159):

- `@endora-commerce/contracts`: `convertToRfqResponseSchema` declares `rfqId` as `uuidSchema.nullable()`, so `ConvertToRfqResponse.rfqId` is now `string | null`. The key is always present. A consumer must handle `null`: it means that no quote request was created or changed, because every selected item was skipped or none was selected. Read `skipped` for the reasons, and do not link to a quote request.
- `mod-shopping-lists`: the service's `ConvertToRfqResult` is now the contract's `ConvertToRfqResponse`, and the convert-to-RFQ handler declares `{ data: ConvertToRfqResponse }`. Typing only; nothing on the wire changes.
