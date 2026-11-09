---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-quote-requests': minor
---

**Behaviour change: a line quantity has an upper bound, and so do the quote request and return line arrays** (issue #351). A quantity past the integer column it is stored in used to pass validation and answer `500`; it is now a validation failure.

New in `@endora-commerce/contracts`: `LINE_QUANTITY_MAX` (`1 000 000`, the same value as `ORDER_MINIMUM_MAX`, so the largest minimum stays orderable), `lineQuantitySchema` (a whole number in 1…`LINE_QUANTITY_MAX`) and `REQUEST_LINE_ITEMS_MAX` (`200`). `ADMIN_ORDER_MAX_ITEMS` and `QUICK_ORDER_BUILD_MAX_ITEMS` are now that constant under their own names; their value does not change.

Every request schema carrying a line quantity now uses `lineQuantitySchema`: `addCartItemRequestSchema`, `updateCartItemRequestStrictSchema`, `createQuoteRequestSchema` / `patchQuoteRequestSchema` lines, `adminCreateQuoteRequestSchema` / `adminPatchQuoteRequestSchema` lines, `adminCreateOrderRequestSchema` / `adminOrderPreviewRequestSchema` items, `apiPlaceOrderRequestSchema` lines, `quickOrderBuildRequestSchema` items, `quickOrderOneClickRequestSchema`, `addShoppingListItemRequestSchema`, `updateShoppingListItemRequestSchema`, `createReturnCaseRequestSchema` lines, `catalogBulkPriceRequestSchema` lines and `cartSnapshotSchema` lines. `updateCartItemRequestSchema` keeps its tighter `max(999)`. A quantity past the bound answers `400 VALIDATION_FAILED` with a `details` entry naming the field, and `422 VALIDATION_FAILED` on `POST /api/v1/external/orders` and `POST /api/v1/external/catalog/prices`, whose handlers already answer every shape error that way.

The line arrays of `adminCreateQuoteRequestSchema`, `adminPatchQuoteRequestSchema` and `createReturnCaseRequestSchema` are bounded at `REQUEST_LINE_ITEMS_MAX`, as the customer's quote request create and edit already were: one line more is `400 VALIDATION_FAILED`. A client sending more than 200 lines to `POST /api/v1/admin/quote-requests`, `PATCH /api/v1/admin/quote-requests/:id` or `POST /api/v1/returns` must split the request.

`@endora-commerce/admin-kit`: `parsePositiveInt` returns `null` past `LINE_QUANTITY_MAX`, so the admin order and quote request create screens mark such a line invalid before sending it. `@endora-commerce/mod-quick-order`: an imported row whose quantity is past the bound is rejected as `quantity_invalid` instead of being recognised into a build that would be refused. `@endora-commerce/mod-quote-requests`: the Modify tab's quantity input carries the bound as its `max`.
