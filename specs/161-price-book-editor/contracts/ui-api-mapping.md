# Contract — Screen ↔ API mapping (every FR of spec 161)

Base path `/api/v1/admin/price-books` (`B`). "P1" = implemented by feature 160; "G1x" = a gap built in
this feature (`backend-gaps.md`). No FR is served by anything outside this table.

| FR | Screen behaviour | API | Source |
| --- | --- | --- | --- |
| FR-001 | List, filters, columns, base books marked | `GET B?type&status&currency&channelId&audienceKind&memberId&search&page&pageSize` (`priceBookSummarySchema`: counts, `appliesToNoOne`, `appliesNowhere`, `isSystem`) | P1 |
| FR-002 | Create flow: type → currency → channels → audience → schedule | `GET B/targets/currencies`, `GET B/targets/sales-channels?currency=`, `GET B/targets/customer-groups`, `GET B/targets/organizations?search=`, `POST B`; kinds offered: `meta.creatableAudienceKinds` | P1 + G11 |
| FR-003 | Header editor; dormant bindings; member labels | `GET B/:id` (`channels[].dormant`, `everActivated`, `version`), `PATCH B/:id` with `expectedVersion`; labels: `GET B/targets/organizations?ids=`, `GET B/targets/customer-groups`, `GET B/targets/sales-channels` | P1 + G12 |
| FR-004 | Activate / draftify, refusal mapped to steps | `POST B/:id/activate`, `POST B/:id/draftify`; `409 PRICE_BOOK_NOT_APPLICABLE` details (`path`) | P1 |
| FR-005 | Delete with row count; no actions on base books; base grid saves | `DELETE B/:id` (`403` on system); `rowCount`, `isSystem`; base-book batches uncapped | P1 + G18 |
| FR-006, FR-037 | Lines general → specific, tier columns, inherited display | `GET B/:id/lines?page&pageSize` (whole lines, variants nested, server order general → specific), `tierStarts` on `GET B/:id` | G15 |
| FR-007 | Cell entry and kinds | client parser → `priceBookRowPriceSchema` | client |
| FR-008 | Bulk add | product picker (feature 145, `AK/components/product-picker`), `GET B/targets/categories`, `GET B/targets/attributes` | P1 |
| FR-009 | Variant sub-lines | catalogue admin product read (variants) — existing `GET /api/v1/admin/catalog/products/:id` | existing |
| FR-010 | Cell detail (custom window) | edits → `PUT B/:id/rows` | P1 |
| FR-011, FR-012 | Keyboard, paste, fill, undo, bulk actions | client (admin-kit grid) | client |
| FR-013, FR-014 | One batch; every error per cell; stale refusal | `PUT B/:id/rows` (`expectedVersion`; `errors[]`; `409 PRICE_BOOK_STALE`), validation scoped to touched selections | P1 + G18 |
| FR-015 | Paging by line, search, kind filter | `GET B/:id/lines?page&pageSize&kind&search` (`totalLines`), ordered by the catalogue's stored admin name key | G15 (R14) |
| FR-016 | Inactive lines | `inactiveReason`, `targetDeleted` | P1 |
| FR-017 | Browser-side rule checks | `priceBookRowShapeIssues` (contracts) | P1 |
| FR-018, FR-038–FR-042 | CSV export (numbered files ≤ 5 000 rows), import with preview | export: `GET B/:id/rows?page&pageSize=1000` page by page; import: `PUT B/:id/rows?dryRun=true` (`priceBookRowsDryRunSchema`), then `PUT B/:id/rows` with `expectedVersion` | P1 (G10) + G18 |
| FR-019, FR-020 | Base-price panel with its own *Save prices* (OQ-1 = B) | `GET B/targets/currencies`, `GET B/base-prices?productId=`, `PUT B/base-prices/:productId`; `writable`; previews with contracts decimal helpers | P1 + G11 + G17 |
| FR-021 | Books pricing the product | `GET B?productId=&variantId=` (`matches`) | P1 (G1) |
| FR-022 | Duplicate | `POST B/:id/duplicate` (`priceBookDuplicateSchema`) | P1 |
| FR-023, FR-024 | Explanation, pre-fill | `POST B/resolve` (`priceBookResolvedLineSchema`); runner-up names | P1 + G16 |
| FR-025 | Precedence read-only | `GET B/precedence` (`precedenceViewSchema`) | P1 |
| FR-026 | List-price switch; storefront pair (catalogue and search listings, PDP) | `GET`/`PUT B/settings/show-list-price`; storefront reads `resolvedPrice.listPrice` | P1 (G8, G9) + G14 + G19 |
| FR-027 | Representative scope | server visibility (P1) + `writable`, `creatableAudienceKinds`, scope-filtered targets | P1 + G11 |
| FR-028 | Permission gates, absent controls | route `requiredPermission`; `useAuth().hasPermission`; `writable` | P1 + G11 |
| FR-029 | Palette, nav, off-state | `manifest.ts` `actions`, `admin/index.ts` routes/nav | 161 |
| FR-030 | Writes only through the API; labelled previews | all of the above; G17 for identical rounding | G17 |
| FR-031–FR-036 | Accessibility, states, primary action, reuse (filters in the URL, OQ-2 = B), i18n, grid performance | client | client |
| (spec *Assumptions*) | Book history link | `/audit-log?objectType=price_list&objectId=` | G13 |
