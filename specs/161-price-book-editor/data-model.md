# Data model — Price-book editor (feature 161)

**No new table and no migration.** The editor edits feature 160's entities
(`specs/160-pricing-model-v2/data-model.md`) through its admin API; the eight backend gaps
(`contracts/backend-gaps.md`) add response fields and one query parameter, no column. What this
feature does model is **browser state**, below, and the CSV file (`contracts/csv-format.md`).

## 1. Loaded book (read model, from P1)

`PriceBook` (`packages/contracts/src/price-books.ts`) + `writable` (G11), and the **current page of
lines** (`PriceBookLine[]`, G15: whole lines, variants nested, `totalLines`). Pages are fetched on
demand and cached per `(page, pageSize, kind, search, version)`; edits live beside them, keyed by
selection, so they survive page changes.

## 2. Grid line

| Field | From | Rule |
| --- | --- | --- |
| `selectionKey` | row `selection` (ids) | `variant:<id>` · `product:<id>` · `category_attribute:<cat>:<key>:<value>` · `category:<id>` · `attribute:<key>:<value>` · `all` |
| `kind` | `selectionKind` | order: `all` < `attribute` < `category` < `category_attribute` < `product` < `variant` (variants under their product) — FR-006; the server already returns this order (`price-book-reads.ts` `compareRows`) |
| `label`, `identifier` | `labels`, `naturalKey` | name + SKU / category path / attribute label and value |
| `cells` | rows with this `selectionKey`, by `minQuantity` | one per column of `tierStarts`; a row whose window does not start on a column, or ends before the next start, is a *custom window* shown in the cell detail (FR-010) |
| `inactiveReason`, `targetDeleted` | row | FR-016 |

**Inherited display (FR-037)**: an empty cell at start `s` shows the line's cell with the greatest
start `< s` whose window covers `s` (`maxQuantity` null or ≥ `s`), labelled "inherits from {start}";
if none, "not priced by this line at this quantity". Display only — nothing is written.

## 3. Edit state (`packages/modules/price_lists/src/admin/lib/book-edit-state.ts`)

| Field | Meaning |
| --- | --- |
| `baseVersion` | the `version` the edits started from (G5 / FR-014) |
| `edits: Map<cellKey, CellEdit>` | `cellKey = selectionKey + '@' + minQuantity`; `CellEdit = { kind: 'set', price, maxQuantity } \| { kind: 'clear' }` |
| `addedLines` | selections added through pickers, not yet saved |
| `history`, `future` | undo / redo stacks of edit groups (a paste or bulk action is one group) |
| `errors: Map<cellKey, message>` | local parse/rule errors and server `errors[]` mapped back |
| derived `unsavedCount` | cells in `edits` plus `addedLines` |

Save: `upsert` = every `set`, `delete` = stored row ids of every `clear`, `mode: 'merge'`,
`expectedVersion = baseVersion`. Stale (`409`): reload §1, keep `edits`, offer re-apply.

## 4. Price cell value (parser, FR-007)

Input → `PriceBookRowPrice` (`priceBookRowPriceSchema`):

| Typed | Price |
| --- | --- |
| `95`, `95,50`, `1 234.5 zł` | `{ type: 'fixed', amount }` |
| `-5%`, `+20 %`, `−5%` (Unicode minus) | `{ type: 'percent', percent }` (bounds −100…1000) |
| `-3`, `+3`, `+3,50` (leading sign) | `{ type: 'amount', amount }` |
| empty / Delete | clear |

A fixed value on the `all` line is refused locally (`priceBookRowShapeIssues`).

## 5. Base-price panel state

`ProductBasePrices` (+ `writable`, G11) per currency; edits replace a currency's `product` tiers and
`variants` map; previews computed with the contracts decimal helpers (G17), labelled *preview*.

## 6. Settings

`pricing.show_list_price` (P1, G8) — read and written through `B/settings/show-list-price`.
