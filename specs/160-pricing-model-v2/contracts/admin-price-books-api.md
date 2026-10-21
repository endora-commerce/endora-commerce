# Contract — Admin price-book API (FR-033–FR-038)

The versioned admin resource that replaces `/api/v1/admin/price-lists-engine/…`,
`/api/v1/admin/pricing/rule-targets/…` and `/api/v1/admin/products/:id/resolved-price`, all three
**removed in the same release** (FR-037, `research.md` R11). Zod schemas live in
`@endora-commerce/contracts` (`price-books.ts`, new) before any route (Principle II); the admin
editor of P2 is this API's first client. Unchanged and out of this contract:
`/api/v1/admin/pricing/display-mode-overrides…`.

Common rules:

- Permissions: reads `price_lists:read`, writes `price_lists:write` (manifest codes unchanged).
- Every write runs through `CommandBus.run` with an audit entry on `objectType: 'price_list'`
  (before/after state), and bumps `PricingGeneration` **after** commit (FR-035, P0's seam).
- Sales-representative scope (FR-034): an organization-set book with any member outside the caller's
  scope answers exactly as a missing book on every route below (`404`, as for an unknown id), and is
  absent from lists and counts; everyone and customer-group books are read-only for a representative
  (`403`); a representative may not add an out-of-scope member.
- Errors: the platform envelope; codes below are new unless marked.

## Books

| Method + path | Body / query | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books` | `?type&status&currency&channelId&audienceKind&memberId&search&page&pageSize` | page of `PriceBookSummary` (header, channel count, member count, row count, *applies to no one / nowhere* flags) |
| `POST /api/v1/admin/price-books` | `PriceBookCreate`: name, type, currencyCode, channelIds[], audience `{kind, memberIds[]}`, priority, startsAt, endsAt | `201 PriceBook` (status `draft`); `400 PRICE_BOOK_CHANNEL_CURRENCY` naming channels (FR-003); `400 PRICE_BOOK_AUDIENCE_KIND` (mixed kinds, A4) |
| `GET /api/v1/admin/price-books/:id` | | `PriceBook` incl. channels (with `dormant` per binding) and members |
| `PATCH /api/v1/admin/price-books/:id` | name, priority, dates, channelIds, members; **not** currency; audience kind only while never activated | `PriceBook`; `409 PRICE_BOOK_IMMUTABLE_FIELD` |
| `POST /api/v1/admin/price-books/:id/activate` · `/draftify` | | `PriceBook`; `409 PRICE_BOOK_NOT_APPLICABLE` when no non-dormant channel or no member |
| `POST /api/v1/admin/price-books/:id/duplicate` | `PriceBookDuplicate`: name, channelIds, currencyCode, audience, `amountMultiplier` (decimal string, default `1`) | `201 PriceBook` (draft) — fixed and amount rows × multiplier, half-up, 4 dp; percentages verbatim (FR-036) |
| `DELETE /api/v1/admin/price-books/:id` | | `204`; system books refused `403 FORBIDDEN` as today (`price-list-service.ts` `remove`) |

## Rows

| Method + path | Body / query | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books/:id/rows` | `?selectionKind&productId&variantId&categoryId&attributeKey&page&pageSize` | page of `PriceBookRow` with `inactiveReason` (attribute not eligible, deleted target) |
| `PUT /api/v1/admin/price-books/:id/rows` | `PriceBookRowBatch`: `{ upsert: PriceBookRowInput[], delete: rowId[] }`, ≤ 5 000 per call | one audited command for the batch; `PriceBookRow[]`; `409 PRICE_BOOK_ROW_OVERLAP` naming the rows; `400 PRICE_BOOK_ROW_SHAPE` with the FR-005–FR-009 reason. **The grid of P2 saves through this.** |
| `PATCH /api/v1/admin/price-books/:id/rows/:rowId` · `DELETE …/:rowId` | | single-row conveniences over the same command |

`PriceBookRowInput`: `{ id?, selection: {variantId?, productId?, categoryId?, attribute?: {key, value}},
minQuantity, maxQuantity, price: {type:'fixed', amount} | {type:'percent', percent} | {type:'amount', amount} }`
— no currency (the book's), no organization (the header's). Limit per book: 5 000 rows (unchanged
from 148, FR-007 of 148).

## Base prices (the product editor's zone in P2)

| Method + path | Body | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books/base-prices?productId=` | | per currency: the product's tiers and each variant's row (`inherits` / fixed / percent / amount) |
| `PUT /api/v1/admin/price-books/base-prices/:productId` | `{ byCurrency: { [code]: { product: Tier[], variants: { [variantId]: VariantBaseRow \| null } } } }` | one audited command across currencies; creates a currency's base book on first use |

## Targets (pickers)

`GET /api/v1/admin/price-books/targets/{organizations|customer-groups|categories|attributes|sales-channels|currencies}`
— the old rule-target pickers, moved; `attributes` lists only eligible `isPriceRule` attributes with
their option values; `sales-channels?currency=` lists only channels offering the currency.

## Explanation (FR-020, FR-038)

`POST /api/v1/admin/price-books/resolve` — body `{ salesChannelId, currencyCode?, buyer:
{organizationId?, customerAccountId?}, lines: [{key, productId, variantId?, quantity}] }` (≤ 200
lines), scoped like the old probe. Answer per line:

```ts
{ key, price: null | { amount, currency, source: 'base'|'catalogue'|'buyer'|'sale', compareAt?: string },
  explanation: { tier, cell?: CellCode, bookId?, bookName?, rowId?, reference?: string,
                 precedenceVersion: number, candidates?: Array<{cell, bookId, rowId, amount}> } }
```

`candidates` (the ranked runner-ups, at most 10) is what P2's "why this price" panel renders.

## Precedence (FR-021–FR-023)

`GET /api/v1/admin/price-books/precedence` → the active version (cells, toggle, depth mode, preset
name if it equals one). Any `POST`/`PUT` under `…/precedence` answers
`409 PRECEDENCE_CHANGE_UNAVAILABLE` until P3.

## Removed (same release)

Every route under `/api/v1/admin/price-lists-engine/`, `/api/v1/admin/pricing/rule-targets/`, and
`/api/v1/admin/products/:id/resolved-price`. A `minor` changeset on `@endora-commerce/contracts` and
`@endora-commerce/mod-price-lists` lists each with its replacement.
