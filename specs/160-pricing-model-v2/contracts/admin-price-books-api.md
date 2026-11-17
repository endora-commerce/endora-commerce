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
- **Versions (G5).** `PriceBook.version` moves on every write to the book — header, channel set,
  members, rows, activation. `PATCH …/:id` and `PUT …/:id/rows` name the version they were made
  against, as `expectedVersion` in the body or an `If-Match` header; without one they answer `400`,
  and against an older one `409 PRICE_BOOK_STALE` with `details.currentVersion`, writing nothing.
- **Row refusals (G6)** name every failing row: `details.errors: [{ index?, rowId?, field, code,
  message }]`, `index` being the row's position in `upsert` and `rowId` a stored row (an overlap
  partner, a delete of a row the book does not hold). Row codes: `PRICE_BOOK_ROW_SHAPE`,
  `PRICE_BOOK_ROW_OVERLAP`, `PRICE_BOOK_ROW_TARGET` (unknown product, variant, category, SKU, path or
  attribute value, or an attribute that cannot select prices), `PRICE_BOOK_ROW_LIMIT`. The envelope's
  code is `PRICE_BOOK_ROW_OVERLAP` (`409`) when every error is an overlap, else
  `PRICE_BOOK_ROW_SHAPE` (`400`).
- Paged answers are `{ data: T[], meta: { page, pageSize, totalCount } }` — except the price history,
  which is keyset-paged (*Price history (#470)* below says why).

## Books

| Method + path | Body / query | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books` | `?type&status&currency&channelId&audienceKind&memberId&search&productId&variantId&page&pageSize` | page of `PriceBookSummary` (header, `version`, `tierStarts`, channel count, member count, row count, *applies to no one / nowhere* flags). With `productId` (and `variantId`): only books with a row naming that product (or variant) directly, each with `matches: [{rowId, selectionKind, minQuantity, maxQuantity, price}]` (G1) |
| `POST /api/v1/admin/price-books` | `PriceBookCreate`: name, type, currencyCode, channelIds[], audience `{kind, memberIds[]}`, priority, startsAt, endsAt | `201 PriceBook` (status `draft`); `400 PRICE_BOOK_CHANNEL_CURRENCY` naming channels (FR-003); `400 PRICE_BOOK_AUDIENCE_KIND` (mixed kinds, A4) |
| `GET /api/v1/admin/price-books/:id` | | `PriceBook` incl. channels (with `dormant` per binding), members, `version`, `everActivated`, `rowCount` and `tierStarts` — every `minQuantity` a row uses, ascending (G4) |
| `PATCH /api/v1/admin/price-books/:id` | name, priority, dates, channelIds, members, `expectedVersion`; **not** currency or type; audience kind only while never activated; nothing on a base book | `PriceBook`; `409 PRICE_BOOK_IMMUTABLE_FIELD`; `409 PRICE_BOOK_STALE` |
| `POST /api/v1/admin/price-books/:id/activate` · `/draftify` | | `PriceBook`; `409 PRICE_BOOK_NOT_APPLICABLE` when no non-dormant channel or no member |
| `POST /api/v1/admin/price-books/:id/duplicate` | `PriceBookDuplicate`: name, channelIds, currencyCode, audience, `amountMultiplier` (decimal string, default `1`) | `201 PriceBook` (draft) — fixed and amount rows × multiplier, half-up, 4 dp; percentages verbatim (FR-036) |
| `DELETE /api/v1/admin/price-books/:id` | | `204`; system books refused `403 FORBIDDEN` as today (`price-list-service.ts` `remove`) |

## Rows

| Method + path | Body / query | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books/:id/rows` | `?selectionKind&productId&variantId&categoryId&attributeKey&search&page&pageSize` | page of `PriceBookRow`, ordered general to specific and by label: `inactiveReason` (`attribute_not_price_rule`, `attribute_deleted`, `target_deleted`), `targetDeleted`, `labels {productName, productSku, variantLabel, variantSku, categoryPath, attributeLabel, attributeValueLabel}` resolved in one read per target kind (G2), and `naturalKey`; `search` matches the labels and SKUs (G3) |
| `PUT /api/v1/admin/price-books/:id/rows` | `{ expectedVersion, mode: 'merge' \| 'replace', upsert: Row[], delete: rowId[] }`, ≤ 5 000 per call | one audited command for the batch; `{ version, rows }`; `409 PRICE_BOOK_ROW_OVERLAP` naming the rows; `400 PRICE_BOOK_ROW_SHAPE` with every failing row (G6). **The grid of P2 saves through this.** A base book accepts product rows (fixed) and variant rows (fixed, percent, amount) and refuses any other row per row (G7) |
| `PUT /api/v1/admin/price-books/:id/rows?dryRun=true` | the same body; `expectedVersion` optional | writes nothing; `{ version, resolved: (Row \| null)[], diff: { added[], changed: [{before, after}], removed[], unchangedCount }, errors[] }` — `resolved[i]` is `upsert[i]` with its selection resolved to ids, `unchangedCount` the batch rows equal to the stored row they replace, `errors` in the G6 shape (G10). Confirmation is the same body without `dryRun`, with the version the preview answered |
| `PATCH /api/v1/admin/price-books/:id/rows/:rowId` · `DELETE …/:rowId` | | single-row conveniences over the same command |

`Row`: `{ id?, selection?: {variantId?, productId?, categoryId?, attribute?: {key, value}}, key?:
{productSku?, variantSku?, categoryPath?, attribute?: {key, valueCode}}, minQuantity, maxQuantity,
price: {type:'fixed', amount} | {type:'percent', percent} | {type:'amount', amount} }` — exactly one
of `selection` (ids, the grid) and `key` (natural keys, a CSV import, G10; `categoryPath` is the
category's slugs from the root joined by `/`). No currency (the book's), no organization (the
header's). A row without an `id` whose selection and `minQuantity` equal a stored row's replaces
that row (*changed*); `merge` keeps the rows the batch does not name, `replace` removes them
(`delete` must then be empty). Amounts are stored at four places, percentages at two. Limit per book:
5 000 rows (unchanged from 148, FR-007 of 148) for every book **but a base book**, which the
catalogue bounds (FR-009; owner ruling of 2026-10-22, `specs/161-price-book-editor/` G18); the diff
and the write cost a bounded number of statements whatever the batch size, and read the rows of the
selections the batch touches rather than the whole book (G18).

## Base prices (the product editor's zone in P2)

| Method + path | Body | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books/base-prices?productId=` | | per currency: the product's tiers and each variant's row (`inherits` / fixed / percent / amount) |
| `PUT /api/v1/admin/price-books/base-prices/:productId` | `{ byCurrency: { [code]: { product: Tier[], variants: { [variantId]: VariantBaseRow \| null } } } }` | one audited command across currencies; creates a currency's base book on first use |

## Settings (G8)

`GET /api/v1/admin/price-books/settings/show-list-price` → `{ value }`;
`PUT …/settings/show-list-price` `{ value: boolean }` — the manifest setting `pricing.show_list_price`
(boolean, default `false`), written by the settings module inside **one** `CommandBus.run`
(`price_list.show_list_price_set`). While on, `ListingPriceDetail` and the storefront resolved price
carry `listPrice: { amount, currency }` — the channel's everyone price (catalogue, else base) — only
when it is above the price charged (G9; vectors D1–D4 of `worked-examples.md` §10.15).

## Targets (pickers)

`GET /api/v1/admin/price-books/targets/{organizations|customer-groups|categories|attributes|sales-channels|currencies}`
— the old rule-target pickers, moved; `attributes` lists only eligible `isPriceRule` attributes with
their option values; `sales-channels?currency=` lists only channels offering the currency.

## Explanation (FR-020, FR-038)

`POST /api/v1/admin/price-books/resolve` — body `{ salesChannelId?, currencyCode?, buyer:
{organizationId?, customerAccountId?}, lines: [{key, productId, variantId?, quantity}] }` (≤ 200
lines), scoped like the old probe; no `salesChannelId` prices on the system default channel, as the
probe did. Answer per line:

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

## Price history (#470)

A book's own record of the values its Commands changed (issue #470, D-288; owner ruling O-3), read
from `price_list_value_changes` and `price_list_row_value_changes` — not from the audit log, which
would cap a history at 500 entries and is read under another permission. It holds **value changes
only**: name, priority, audience, a duplicate's multiplier and price rows. Status, channels and
activation stay in the audit log. History starts with the release that shipped the writer (#470
stage 2); older audit entries are not served here (O-4).

| Method + path | Query | Answer |
| --- | --- | --- |
| `GET /api/v1/admin/price-books/:id/price-history` | `limit`, `cursor` | `PriceBookHistoryChange[]`, newest first `(at desc, id desc)`: `id, action, actor, at, headerBefore, headerAfter, lineCount` |
| `GET /api/v1/admin/price-books/:id/price-history/:changeId/lines` | `limit`, `cursor` | `PriceBookHistoryLine[]` of one change, `seq` ascending |
| `GET /api/v1/admin/price-books/:id/price-history/products/:productId` | `limit`, `cursor` | `PriceBookHistoryProductLine[]`: the product's own lines **and its variants'**, `(at desc, changeId desc, seq asc)`, each with `changeId, at, action, actor`. Category, attribute and all-products lines are not a product's and are not included |

- **Permission and scope:** `price_lists:read`. The book is loaded as `GET /:id` loads it, so a book
  out of the caller's reach is `404 NOT_FOUND`, identical to an unknown id. Every read filters by that
  book's id; a `changeId` that is not a UUID, or names another book's change, is `404 NOT_FOUND`. A
  `productId` that is not a UUID is `404`; a product with no lines is an empty page. No new error code.
- **Keyset paging — a deliberate exception to *Common rules*.** The envelope is the platform's
  `{ data, pagination: { cursor, hasMore, limit } }` (`packages/contracts/src/pagination.ts`):
  `limit` defaults to 50, at most 200; `cursor` is opaque (base64url), carries the stored `at` at the
  column's own precision, and pages ties on `at` by id. A history grows at its head, so an offset
  page would shift under a reader while a Command commits, and a total would be a scan of the whole
  history (R-08). There is no `totalCount`; a change's `lineCount` says how many lines it holds. A
  malformed cursor or limit is `400 VALIDATION_FAILED`.
- **Header sides** hold only the keys the Command changed (a created book: all of them):
  `{ name?, priority?, audience?: { kind, memberIds, withheldMemberCount? }, amountMultiplier? }`,
  members sorted. `null` when the side has none.
- **Organization members out of reach:** for a caller whose scope is not every organization, each
  side's `audience.memberIds` leaves out every organization id outside the scope and
  `withheldMemberCount` counts them (`0` when none, and always `0` for customer-group and everyone
  audiences, whose ids are never withheld). A platform administrator gets the ids as stored, with no
  `withheldMemberCount`. A stored audience without a kind (development databases written before
  the kind was recorded) is read as `organizations`, so it fails closed.
- **Actor:** `{ kind, id, name }`, `kind` one of `admin`, `customer`, `system`, `api_key`. `id` and
  `name` only for `admin` — `name` is "first last", else the e-mail, and `null` when the
  administrator cannot be found; other kinds carry `null` for both. One lookup per page.
- **Lines:** `{ seq, kind: added | changed | removed, selection { variantId, productId, categoryId,
  attributeKey, attributeValue }, minQuantity, maxQuantity, before, after }`. `before` / `after`
  are the row price union (`fixed | percent | amount`), `null` on an added line's before side and a
  removed line's after side. Amounts are the stored decimal strings (`0.0125`, `-1.2345`), never
  rounded.
- **Ids only.** Labels (products, variants, categories, organizations, a deleted entity's fallback)
  are the admin panel's (#470 stage 4).

## Removed (same release)

Every route under `/api/v1/admin/price-lists-engine/`, `/api/v1/admin/pricing/rule-targets/`,
`/api/v1/admin/products/:id/price-lists` (the linked-lists panel; its replacement is the book list
filtered by `productId`, G1) and `/api/v1/admin/products/:id/resolved-price`. The test-only status
sweep moved to `POST /api/v1/admin/price-books/internal/sweep`. A `minor` changeset on `@endora-commerce/contracts` and
`@endora-commerce/mod-price-lists` lists each with its replacement.
