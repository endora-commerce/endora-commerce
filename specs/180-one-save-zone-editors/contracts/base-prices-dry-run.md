# Contract: base-price pre-check (`price_lists`)

Owner: `price_lists` (`packages/modules/price_lists/src/backend/routes.price-books.ts`,
`services/price-book-service.ts`). Decision: `research.md` R6. Requirement: FR-021.

## Request

`PUT /api/v1/admin/price-books/base-prices/:productId?dryRun=true`

- Same gate (`writeGate`), same scope rule (a caller whose price-book scope is not `all` →
  `403 FORBIDDEN`), same body (`basePricesWriteSchema` in `@endora-commerce/contracts`).
- `dryRun` accepts `true` / `1`, as the rows endpoint (`routes.price-books.ts:520`).

## Response

| Case | Status | Body |
| --- | --- | --- |
| Every rule passes | `200` | `{ "data": { "valid": true } }` |
| Body or rule refusal | `422` | the same envelope and `details` the real write returns (`VALIDATION_ERROR`, issues by path) |
| Product not found | `404` | as the real write |
| Module off | `503 MODULE_DISABLED` | as every route of an off module |

Nothing is written; no Command runs; no audit entry; no version bump; no cache invalidation.

## Implementation note

`PriceBookService.setBasePrices` gains `options.dryRun`; it returns after the planning and the
`validation(issues, …)` refusal, before `#command(...)`. The Zod response schema
`basePricesDryRunResponseSchema` is added to `packages/contracts` (Principle II).
