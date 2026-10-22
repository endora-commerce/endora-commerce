---
'@endora-commerce/contracts': minor
---

The price-book editor's API gaps (feature 161, G11–G17), additive on the wire; two are new required members for code that builds these types itself.

- **Writable for the caller (G11).** `priceBookSchema` and `priceBookSummarySchema` gain `writable: boolean`; `priceBookListResponseSchema.meta` gains `creatableAudienceKinds: PriceBookAudienceKind[]`; `productBasePricesSchema` gains `writable: boolean` (also on `PriceBookWritePort.basePrices` answers, always `true` there). A producer of `PriceBook`, `PriceBookSummary` or `ProductBasePrices` objects must now set the field. Old: `{ ...book }`. New: `{ ...book, writable }`.
- **Book lines (G15).** New `priceBookLinesQuerySchema` (`kind`, `search`, `page`, `pageSize` ≤ `PRICE_BOOK_LINES_MAX_PAGE_SIZE` = 500), `priceBookLineSchema`, `priceBookVariantLineSchema`, `priceBookLinesResponseSchema` (`meta.totalLines`) for `GET /api/v1/admin/price-books/:id/lines`.
- **`CatalogProductReadPort.pageProductsByAdminName(query)` (G15)** — new **required** method (`CatalogAdminNamePageQuery`: `membership` (`CatalogProductMembership`, a `{ sql, params }` subquery), `search?`, `language`, `offset`, `limit`, `withTotal?` → `{ ids, total: number | null }`). A hand-written implementation or test double of the port must add it. Old: an object literal with the port's previous methods. New: add `pageProductsByAdminName: async () => ({ ids: [], total: 0 })` (or a real one).
- **Admin name fold (G15).** `foldAdminName(text)`, `adminNameLanguage(tag)` and `ADMIN_NAME_LANGUAGES` (`admin-name.ts`): the case and accent fold catalog's stored admin name keys are built with, for code that orders by the same rule.
- **Named runner-ups (G16).** `priceBookExplanationCandidateSchema` gains `bookName: string` and `labels: PriceBookRowLabels`. `priceBookRowLabelsSchema` is now declared before the explanation schemas (same export).
- **List price on the catalogue DTOs (G14) and on search suggestions (G19).** `searchSuggestItemSchema` gains optional `listPrice: { amount, currency }`.
- **List price on the catalogue DTOs (G14).** `productResolvedPriceSchema` (and so `ProductSummary.resolvedPrice`) gains optional `listPrice: { amount, currency }` — the catalogue price beside a lower buyer price while `pricing.show_list_price` is on.
- **Decimal helpers (G17).** `parseUnits`, `formatUnits`, `parseSignedUnits`, `parseSignedPercentHundredths`, `applySignedPercent`, `applyAmountAdjustment`, `normaliseAmount` and `compareDecimal` are exported from the barrel (`price-book-decimal.ts`): the integer, half-up, four-place arithmetic the resolver prices with, for previews that round as the server does.
