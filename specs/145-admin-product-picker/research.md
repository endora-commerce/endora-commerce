# Research: Admin product picker (orders, quote requests, price lists)

**Feature**: `specs/145-admin-product-picker/` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

Every decision below is stated as *decision → rationale → alternatives rejected*. The spec's
Clarifications and Assumptions are binding and are not reopened here; where the code forced a
reading the spec does not state, the decision says so and the item is repeated under
*Open items* at the end. Paths are measured on `origin/master` at `8c2be9fba` (0.106.0).

---

## R-1 — Where the shared picker lives

**Decision**: a new composite in `@endora-commerce/admin-kit`,
`packages/admin-kit/src/components/product-browser/`, published from the `./components` barrel
(`packages/admin-kit/src/components/index.ts`, explicit named exports — the barrel holds no
`export *`). Public names: `ProductBrowserDialog` (the overlay), `ProductBrowserTrigger` (the
**Browse products** button, carrying the `catalog:read` gate of FR-013), the pure helpers
`productSelectability` and `ProductBrowserRules` (type), and `PRODUCT_BROWSER_*` labels types.
The three hosts import it from `@endora-commerce/admin-kit/components`.

**Rationale**:

- It is the precedent the existing combobox set. `ProductPicker.tsx`'s own doc block records
  that it was *moved out of* `catalog`'s admin directory into the kit by feature 091 batch 8
  because four other modules' screens imported it and each import was a ledgered boundary
  reach (`backend/scripts/ledgers/cross-module-imports/`). The new picker has the same shape:
  it builds its requests from the published `apiClient` against
  `GET /api/v1/admin/catalog/products`, needs no `catalog` service, no zone and no mechanism.
- Principle I: `orders`, `quote_requests` and `price_lists` all reach the product list over
  HTTP, which is a published API (Principle II), not a module internal. A kit component is
  design-system code no module owns, so no module names another module's file.
- Principle IX: one implementation for three hosts, identical look and behaviour by
  construction (FR-001, SC-002).

**Alternatives rejected**:

| Alternative | Why rejected |
| --- | --- |
| A `catalog`-owned admin export (`@endora-commerce/mod-catalog/admin` subpath) imported by the three hosts | `check:module-boundary` counts a specifier into another module package's runtime subpath as a reach (D-171: only a subpath exporting no runtime binding is contract surface). Three new ledgered reaches, exactly what batch 8 drained for `ProductPicker`. |
| A zone contributed by `catalog` and rendered by each host | Zones are for a module contributing UI into a host's place; the picker must hand a typed selection back to the host and its confirm must await the host's write (FR-010 confirm-failure). That is a component contract, not a contribution. `catalog` is `nonDeactivatable` (`packages/modules/catalog/src/manifest.ts`, `activation`), so the presence indirection a zone buys has nothing to answer. |
| Copy the table into each host | Principle IX violation; three copies drift (SC-002 would be verified against three implementations). |
| Grow the existing `ProductPicker` combobox into a table | Different pattern (filters, status tabs with counts, pagination, multi-page selection); its five consumers (`seo`, `orders`, `quote_requests` ×2, `catalog` `ProductEditor`) keep the combobox. |

## R-2 — Which i18n bundle owns the strings

**Decision**: the picker's strings live in `_i18n`'s bundle under the synthetic `core` scope,
prefix `productBrowser.*` (`packages/modules/_i18n/i18n/en.json` and `pl.json`, flat keys),
including translated status labels (`productBrowser.status.active|draft|inactive`) and type
labels (`productBrowser.type.simple|configurable|grouped|bundle|virtual`) — FR-014. Each host's
new strings go into the namespace its screen already renders from, which is `core` for all
three: `OrderCreatePage.tsx`, `RfqCreatePage.tsx` and `PriceListDetailPage.tsx` call
`useTranslation('core')` 3, 2 and 6 times respectively and nothing else; prefixes
`orderCreate.*`, `rfqCreate.*`, `priceLists.detail.*` as today.

**Rationale**: a kit component may only read `core` — rule R-1 of the kit surface, asserted for
every `useTranslation` in the package by `admin/test/kit/kit-core-namespace.test.tsx`. The
existing combobox's strings are `productPicker.*` in `core` for that reason. For the host strings,
one screen rendering out of two namespaces is the drift; moving these three screens' strings into
their module bundles is a separate drain this feature does not start.

**Alternatives rejected**: the picker in the `catalog` namespace (forbidden for kit code, and the
exact defect `CategoryTreePicker` shipped with — see that test's header); host strings in the
module's own bundle (`orders`, `quote_requests`, `price_lists` i18n) — correct for a
registry-installed module and right in the long run, but it splits each screen across two
scopes in this change. Recorded as a follow-up candidate, not done here.

**Consequence**: `mod-i18n` gets a changeset; `check:bundle-pairing` and
`test/unit/_i18n/registered-bundles-shape.test.ts` cover the pair; `i18n:hardcoded` must report
no new literal in the touched `.tsx` files.

## R-3 — The overlay and the table (Principle IX composition)

**Decision**: compose from existing kit primitives — the wide side drawer of the design system
(`b2b-scrim` + `b2b-drawer b2b-drawer--wide`, `b2b-drawer__head/__body/__foot` in
`packages/admin-kit/theme.css`), `useFocusTrap` (`components/hooks/useFocusTrap.ts`: focuses
the first focusable on open and restores the previously focused element on close — FR-011),
`ResponsiveTable` with `mode="table-scroll"` (horizontal scroll inside the table only, the
narrow-viewport edge case; `header: ReactNode` carries the header checkbox), `Checkbox`,
`Badge`, `PaginationFooter`, `usePageSizePreference`, the `b2b-tabs` / `b2b-filterbar` classes
the Products list uses for its status tabs and filter bar. `role="dialog"`, `aria-modal`,
`aria-labelledby`, Esc cancels.

**Rationale**: the only thing that does not exist is the composite itself (a filterable,
paginated product table with persistent multi-page selection inside an overlay). Every part of
it does. The Products list's look (FR-001/FR-002) is reproduced from the same CSS classes, not
by importing `catalog`'s private `Tab` component (`ProductsList.tsx`), which would be a reach.

**Alternatives rejected**: a centred modal — `crm`'s `ModalDialog` is module-private and the
price-list screen already uses the side drawer for this exact action; a new Radix `Dialog`
primitive — no existing kit primitive needs it and it adds surface for no UX gain; full-page
route — loses the host form's state and its unsaved-changes prompt.

**UX justification for the one net-new component** (Principle IX requirement): see plan.md
§ Complexity Tracking.

## R-4 — Selection model, the 200 cap and selectability rules

**Decision**:

- Selection is client-only state of one picker session: an insertion-ordered `Map<productId,
  ProductBrowserItem>`. It survives page, page-size and filter changes (deliberately unlike the
  Products list, which clears on filter change — spec Edge Cases) and is discarded on Cancel /
  Esc / scrim click (FR-005, FR-007). Confirm hands the host the items **in selection order**
  (Assumption: added lines appear in the order selected).
- The cap is one constant, `ADMIN_PRODUCT_SELECTION_MAX = 200`, exported from
  `packages/contracts/src/catalog.ts`; the kit reads it for FR-008 and the bulk-add request
  schema uses it for `.max()` (FR-045). One home for "200".
- Header checkbox adds/removes the **selectable** rows of the current page only, never replaces
  the selection, and stops adding at the cap.
- "Show selected only" renders from the selection map itself (every selected row was seen on
  some page, so no fetch is needed); "Clear selection" empties the map.
- Row selectability is a pure function in the kit,
  `productSelectability(row, rules, ctx) → { selectable: true } | { selectable: false, reason }`,
  with reasons evaluated in this order: `alreadyAdded` (FR-009) → `typeBlocked` (grouped/bundle
  parents) → `statusBlocked` (draft/inactive) → `limitReached` (FR-008; only for rows not
  already selected). A row already selected stays de-selectable even at the cap.
- The host passes a `ProductBrowserRules` object; the kit knows no host:

  | Host | `initialStatus` | `blockedTypes` | `blockedStatuses` | already-added label key |
  | --- | --- | --- | --- | --- |
  | Create order | `active` | `grouped`, `bundle` | `draft`, `inactive` | `productBrowser.reason.alreadyAdded` |
  | Create quote request | `active` | `grouped`, `bundle` | — | `productBrowser.reason.alreadyAdded` |
  | Price list | `all` | — | — | `priceLists.detail.picker.alreadyOnList` (host label) |

- The picker always requests `includeArchived=1` (as the Products list does) so the Inactive
  tab is reachable on every host; status tabs send `status`, the type chip sends `type`, the
  250 ms debounced search sends `q`; counts come from the response's `counts`.
- Default page size: read from `usePageSizePreference('catalog-products')`, the Products list's own
  key (Assumption: the picker follows the user's Products-list preference), **read-only** — the
  picker never calls `setPageSize`; a page-size change inside it lives in session state only.
  Rejected: writing back (a picker session would silently change the Products list's page size);
  a picker-owned key (a second preference the operator never set, for no FR).

**Rationale**: FR-005…FR-009, FR-012 and the edge cases are one state machine; keeping the rule
evaluation pure makes it unit-testable without a DOM (Constitution III: non-trivial frontend
logic is test-first) and lets the quick search (R-5) apply the identical predicate (FR-020).

**Alternatives rejected**: host presets inside the kit (`ORDER_RULES`…) — the kit would encode
which module wants what; selection persisted to the URL or storage — the selection is "never
stored" (spec Key Entities); a "select all N matching" banner — out of scope (FR-008).

## R-5 — The quick single-product search beside **Browse products**

**Decision**: extend the existing kit `ProductPicker` (`mode="select"`) with three **optional,
additive** props: `rules?: ProductBrowserRules` and `alreadyAddedIds?: readonly string[]`
(evaluated through the same `productSelectability`; a non-selectable option is rendered
`disabled` with the translated reason in its description — `ComboboxOption.disabled` already
exists in `packages/admin-kit/src/ui/combobox.tsx`), and `onPickProduct?: (item) => void`, which
hands the host the full summary (id, SKU, name, status, type) so a line can show name and SKU
(FR-022) without a second fetch. The order and quote-request hosts mount it with `value={null}`
so it clears after each pick, and pass `includeArchived` so inactive products are shown (and,
on orders, shown disabled). Its local `AdminProductSummary` gains `type`. The `catalog:read` gate
(FR-013) is **opt-in**: `ProductPicker` applies it only when `rules` is passed, so the consumers
that pass none — `seo` `SeoPage.tsx`, `quote_requests` `RfqDetail.tsx`, `catalog`
`ProductEditor.tsx` — are unchanged (rejected: gating every consumer, which would alter three
screens outside this feature's scope).

**Rationale**: FR-020 requires the same selectability rules; one predicate, two entry points.
The per-row combobox on each line is removed (FR-020), so lines only come from these two.

**Alternatives rejected**: a second, new combobox (duplicate of an existing primitive); hiding
already-added products through the existing `excludeIds` — FR-009 says *shown as already added*,
so they are rendered disabled instead. `excludeIds` stays for `seo`.

## R-6 — Order preview: two new message codes, precedence, one message per line

**Decision**:

- Codes: **`PRODUCT_NOT_VISIBLE_TO_CUSTOMER`** (the customer's organization may not see the
  product — `isProductVisibleTo(product, { organizationId: customer.organizationId,
  authenticated: true })` is `false`) and **`PRODUCT_NOT_IN_SALES_CHANNEL`** (the product is not
  in the assortment of the order's chosen channel). They are preview **message codes**, not
  `ERROR_CODES` members: they never appear in an error envelope.
- Precedence, exactly one message per line, confirmed against the route's control flow in
  `packages/modules/orders/src/backend/routes.ts` (`POST /api/v1/admin/orders/preview`):
  `PRODUCT_NOT_FOUND` > `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` > `PRODUCT_NOT_IN_SALES_CHANNEL` >
  `QUOTE_ONLY`. A missing product cannot be checked further (the loop already `continue`s);
  visibility and assortment are decided before pricing, so a product that fails either is never
  priced and never reported quote-only; `QUOTE_ONLY` needs the resolved price, so it is last by
  construction. An unavailable line carries `unitPrice: '0'`, `lineTotal: 0`,
  `unavailable: true` and adds nothing to the subtotal or VAT — the existing pattern.
- The decision is a pure function `previewLineAvailability({ product, organizationId,
  inChannel })` in `packages/modules/orders/src/backend/services/preview-line-availability.ts`,
  unit-tested beside it; the route calls it.
- Contract (Principle II, additive): `packages/contracts/src/orders.ts` gains
  `adminOrderPreviewMessageCodeSchema = z.enum([...four codes...])`, the exported
  `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` tuple, and the doc comment on
  `adminOrderPreviewResponseSchema.messages` naming the four codes and the one-per-line rule.
  **`messages[].code` stays `z.string()`**: narrowing it to the enum would retype an existing
  field, which FR-027 forbids, and an older client must keep parsing a newer server.
- The admin screen maps codes to line reasons: `PRODUCT_NOT_FOUND` and `QUOTE_ONLY` keep
  **No price** (`orderCreate.line.unavailable`); the two new codes get
  `orderCreate.line.notVisible` and `orderCreate.line.notInChannel`; an unknown code falls back
  to **No price** and still blocks submit (forward compatible).

**Rationale**: the PO ruled two codes and visibility-over-assortment (Clarifications); the rest
of the order is what the loop already implies, so no behaviour of the two existing codes moves.

**Why the distinct codes do not breach `isProductVisibleTo`'s single-answer rule** (FR-027
requires this recorded where the rule is documented — task T006 writes it into the JSDoc of
`isProductVisibleTo` in `packages/contracts/src/catalog.ts`, beside the paragraph that already
lists the exempt operator surfaces):

1. The rule exists to stop a **buyer** (or an anonymous caller) from learning, by comparing
   answers, which products exist, are restricted to other organisations, or are sold on other
   channels — the oracle issue #174 found in the storefront type-ahead. Its subject is a caller
   who must not learn the operator's private assortment.
2. The preview is an **admin-only** route gated `orders:write` and, before any product is read,
   `assertCustomerInScope` (same file) refuses a scoped admin acting for a customer outside
   their assignment. Its caller *is* the operator, acting for a customer they are entitled to
   act for.
3. The facts the codes disclose are already the operator's to read: `visibility` and
   `allowedOrganizationIds` are on every row of `GET /api/v1/admin/catalog/products`
   (`serializeAdminProduct`), and channel assortment is the operator's own configuration. The
   codes add **diagnosis**, not **information**: they tell the operator which of two settings to
   change for this customer.
4. The buyer-facing seams are untouched: `CartService.addItem` (`packages/modules/carts/src/
   backend/services/cart-service.ts`) keeps its single `404 PRODUCT_NOT_FOUND` for all three
   causes, and so does order creation, which goes through it.

**Alternatives rejected**: one combined code (PO ruled two); reusing `PRODUCT_NOT_FOUND` (would
render **No price** for a priced product, and the operator could not tell what to fix);
narrowing `code` to the enum (retype); returning every failing cause (PO ruled one per line);
folding the channel into `isProductVisibleTo` (refused by the owner ruling of 2026-08-21 recorded
on that function and in `packages/platform/src/kernel/sales-channels/request-channel-assortment.ts`).

## R-7 — Which channel the preview's assortment check reads, and how

**Decision**: the assortment check reads the **request body's `salesChannelId`** directly, through
the sanctioned bridge accessor, in **one** batched call per preview:
`salesChannelMembership.filterEntityIdsInChannel(body.salesChannelId, 'product', ids)` over the
ids of the lines that exist and are visible. It does **not** use `outOfRequestChannel` /
`productIdsInRequestChannel`, which read the channel the admin *request* was resolved on — the
create-path defect the spec puts out of scope. `SalesChannelMembershipPort` reaches the route
by threading the `salesChannelMembership` option `plugin.ts` already receives (a `lazyPort` over
`salesChannelMembershipPort` in `packages/modules/orders/src/backend/index.ts`) into
`OrdersDeps`, where it is **required** for the preview: the route fails closed (500 `INTERNAL`
naming the missing port) rather than treating "not wired" as "in assortment" — the reason
`CartService` gives for making the same port required.

**The stale-channel case — refused (product-owner ruling, 2026-10-13)**: today the preview
resolves the channel it prices on as
`findOne(SalesChannel, { id: body.salesChannelId }) ?? findOne(SalesChannel, { status: 'active' })`.
The active-channel fallback is **removed**: a `salesChannelId` naming no channel answers **404
`NOT_FOUND` "Sales channel not found."** — the route's existing error for the no-channel case,
already thrown on the line below the lookup — before any line is evaluated. The screen shows its
existing preview error (`orderCreate.preview.error`, *Could not calculate prices*). This means the
pricing channel and the assortment channel are always the same one. The create path does **not**
match it today: `POST /api/v1/admin/orders` with a `salesChannelId` naming no channel answers `201`
(observed at T025). Closing that gap belongs to the separate create-path fix, out of scope here. Rejected: keeping the fallback and marking every line
`PRODUCT_NOT_IN_SALES_CHANNEL` (the earlier proposal — priced on one channel, checked against
another, and a per-line message for what is a whole-request problem; the PO chose the refusal).

**Product loading** *(amended 2026-11-06, issue #820; supersedes the PO ruling of 2026-10-13)*:
the loop's per-line `catalogProductRead.findById` becomes one `findByIds(uniqueIds, { liveOnly:
true })`. A soft-deleted product has no live row, so it is step 1, `PRODUCT_NOT_FOUND`, on every
channel, and no membership or availability read is made for it. Since feature 163
(`specs/163-product-data-scopes/` FR-001, FR-002, FR-004) a deleted product is unavailable
everywhere, and `POST /api/v1/admin/orders` refuses it with `404 PRODUCT_NOT_FOUND`; the preview
follows create. An archived or draft product still resolves here and is judged by steps 2–3 and the
feature-163 availability filter.

*Provenance, superseded 2026-11-06 (issue #820) by feature 163 FR-001:* the read was first
written with **default lookup options, deliberately not `liveOnly`** — a soft-deleted product still
resolved and was priced like a live one, as then on the create path (product-owner ruling,
2026-10-13: keep today's behaviour). That ruling assumed the create path accepted a soft-deleted
product, which it no longer does.

R-8 and the preview now read the same way: the price-list bulk add keeps `liveOnly` and
`failed: product_not_found` for soft-deleted products. So
a 200-line preview issues one product read and one membership read instead of 200 + 0. Pricing
stays per line (`pricingService.resolveLinePrice`), unchanged.

**Rationale**: FR-027 names the body's channel; Principle XII names the accessor and fail-closed;
SC-008 needs the preview to agree with what the create path will refuse once the separate fix lands
(today the create path accepts a stale channel; see above).

**Alternatives rejected**: `outOfRequestChannel` (wrong channel — the out-of-scope defect);
keeping the active-channel fallback for pricing or assortment (prices or checks against a channel nobody chose — superseded by the PO's refusal ruling above);
a direct query on `sales_channel_products` (forbidden — `check:module-boundary` `sql` predicate);
per-line membership reads (200 round trips).

## R-8 — Price-list bulk-add endpoint

**Decision**: `POST /api/v1/admin/price-lists-engine/:id/products/bulk-add`, gated by the
module's existing `writeGate` (`requireAdmin(PRICE_LIST_PERMISSIONS.WRITE)`, i.e.
`price_lists:write`), body `{ productIds: uuid[1..200] }`, answer `200 { data: { added, unchanged,
failed } }`. Implemented as `PriceListService.addProducts(priceListId, productIds, auditCtx)`
through the service's existing `#runAudited` helper, i.e. **one** `CommandBus.run` with action
**`price_list.products_add`**, object `price_list` / the list id (Principle XIII). Full contract:
[contracts/price-list-bulk-add.md](./contracts/price-list-bulk-add.md).

Inside the command, in this order (each refusal throws, the command rolls back, no audit entry):

1. `getById` → **404 `NOT_FOUND`** for an unknown or deleted list (FR-043, US4 sc. 11).
2. `row.isSystem` → **403 `FORBIDDEN`**, sentence in the style of the three existing Default-list
   guards in `price-list-service.ts` (FR-044/FR-045, US4 sc. 10).
3. De-duplicate the ids, preserving first occurrence; read the roster rows for them →
   `unchanged` (US4 sc. 8 — checked before existence, so a product already on the list but since
   soft-deleted is `unchanged`, never `failed`).
4. For the rest, `targets().catalogProductRead.findByIds(rest, { liveOnly: true })`; an id not
   returned → `failed` with reason **`product_not_found`** (US4 sc. 4). `liveOnly` because
   catalogue deletion is a soft delete (`deletedAt`, `packages/modules/catalog/src/backend/
   entities/product.entity.ts`) and a soft-deleted row would still satisfy the
   `price_list_products.product_id` foreign key; inactive/archived products are live and are
   added (FR-012: every status selectable on price lists).
5. Create one `PriceListProduct` per remaining id, bump `modifiedAt`; result `added`.
6. If `added` is empty → `skipAudit: true` (no entry, no cache flush — the single add's
   behaviour). Otherwise one audit entry whose after-state carries **counts only**
   (`{ name, added, unchanged, failed }`), mirroring `replaceProducts`' feature-024 FR-013 rule
   ("never the full product-id list").

Request-level validation (Fastify + Zod, before the handler): more than 200 ids, zero ids, a
non-uuid id or a non-array body → **400 `VALIDATION_FAILED`** (the platform's envelope,
`packages/platform/src/http/error-envelope.ts`); a non-uuid `:id` path parameter → 400 likewise
(params schema). The permission gate runs before validation
(`guards-before-validation.ts`), so a caller without `price_lists:write` gets 403 first.

Cache: `#runAudited` calls `invalidatePricingCache()` on a committed write — the same in-process
LRU invalidation (`pricing-cache.ts`, 60 s TTL) every price-list write uses. No Redis key is
introduced, so no lifecycle pub/sub invalidation is owed.

**Rationale**: Clarifications fixed one request, one audited command, `added/unchanged/failed`,
the Default refusal and whole-request refusals; the statuses and codes are chosen to match the
existing price-list errors (FR-045 leaves them to the plan). 200 not 201: a bulk append that may
add nothing is not a creation of one resource.

**Alternatives rejected**: N calls to the single `POST …/products` (N audit entries, no
`failed` report — rejected in Clarifications); `PUT …/products` (delta replace: removes absent
products and their brackets — violates FR-042); `409` for the Default list (the existing guards
answer 403 and the spec asks for that shape); recording the product ids in the audit entry
(contradicts the feature-024 precedent; up to 200 ids per entry); refusing duplicate ids as
malformed (harmless, and "every requested product in exactly one bucket" holds after de-dup);
`INSERT … ON CONFLICT DO NOTHING` to absorb a concurrent identical add (see plan.md § Risks — the retry
path already covers it and MikroORM's unit of work would need bypassing).

**Concurrent identical add → 409** (decided, no new code): when two requests add the same new id
at once, the loser's flush raises MikroORM's `UniqueConstraintViolationException` on the
`price_list_products` composite primary key; the command rolls back (nothing written, no audit
entry) and the platform's error envelope already maps that exception to **409
`VERSION_CONFLICT`** (`packages/platform/src/http/error-envelope.ts`). That is the genuine-race
case the envelope's D-260 comment keeps the mapping for — `price_list_products` is not
tenant-keyed, so it is not a missing scope gate. The screen treats it like any non-2xx (confirm
failure + **Retry**, which then reports the id `unchanged`). No catch-and-remap in the service.
The race cannot be made deterministic, so the loser *may* answer 409 or — had it read the roster
after the winner committed — 200 with the id `unchanged`; the contract test fires two concurrent
requests and accepts either loser outcome while pinning what is deterministic: exactly one `added`,
one roster row, one audit entry, and a retry reporting `unchanged`. Rejected: remapping to 500 (it is a retryable conflict, not a
fault); a new error code (FR-045 adds none).

## R-9 — The roster beyond the newest 20, and the picker's confirm-failure state

**Decision**:

- Roster names come from `POST /api/v1/admin/catalog/products/batch-by-id` (gated
  `catalog:read`, `batchByIdProductsRequestSchema`: ≤ 500 ids, paginated) over the roster's ids,
  **chunked at 500 ids per request** (`pageSize: 500`, `page: 0`), requests issued at most two at
  a time. The unparameterised `GET /api/v1/admin/catalog/products` call in `refresh()` is
  removed. A roster id the lookup does not return keeps today's id-prefix label.
- The bracket editor renders for **any selected roster entry**, decoupled from whether its name
  resolved (today it renders only when the product is in the 20-row map — the *Loading product…*
  defect). Its header shows the name and SKU when known, the id prefix otherwise.
- **Add** opens `ProductBrowserDialog` with the price-list rules (R-4) and
  `alreadyAddedIds` = roster ids. Its `onConfirm` returns the bulk-add promise:
  - **accepted** (2xx) → the picker closes, the roster reloads, the first `added` product (in
    selection order) is selected and its editor opens; if `failed` is non-empty, a message inside
    the panel names each failed product (name and SKU from the picker's selection) with the
    translated reason (`priceLists.detail.bulkAdd.failed.product_not_found`); `unchanged` is
    silent; no `added` → roster reloads, selection left as it was (Assumption).
  - **refused or lost** (non-2xx, network error, no response) → the promise rejects; the picker
    stays open with the selection intact and shows an error message with **Retry** inside the
    drawer; Retry re-invokes `onConfirm` with the same items (FR-010, US4 sc. 13). Confirm and
    Retry are disabled while the request is in flight.
- `onConfirm` in the kit is `(items) => void | Promise<void>`; a returned promise is what turns
  on the confirm-failure state, so the order and quote-request hosts (synchronous append) have
  none (FR-010).
- **Add** is disabled for the system list (unchanged) and, new, when
  `useAuth().hasPermission('price_lists:write')` is false, with a hint (FR-044).
- The old `ProductPickerDialog` and `handleAddProduct` in `PriceListDetailPage.tsx` are deleted.

**Rationale**: SC-003 (> 500 products) needs chunking because `batch-by-id` caps at 500; the
spec's Assumptions already name `batch-by-id` for roster names. The promise-shaped confirm keeps
the kit ignorant of which host writes.

**Alternatives rejected**: raising `batch-by-id`'s cap (a contract change to another module for
a client-side need); a new roster endpoint returning names (a `price_lists` read of `catalog`
data the existing read already serves); keeping the drawer and adding pagination to it (FR-040
asks for the shared picker).

## R-10 — Create-order screen: gating and the line model

**Decision**:

- **Items** and **Order summary** render only when `customerAccountId && salesChannelId`
  (FR-021). Otherwise one hint card in their place names the missing field(s):
  `orderCreate.gate.missingCustomer`, `…missingChannel`, `…missingBoth`. Lines live in page
  state and survive hiding (FR-025); the unsaved-changes prompt counts them (`items.length > 0`).
- The page opened with `customerAccountId` and `salesChannelId` (feature 143 hand-over) shows
  **Items** at once — falls out of the same predicate (US2 sc. 5).
- A line is `{ productId, sku, name, quantityInput }` keyed by `productId` (unique by FR-009);
  the initial empty row is gone; lines are appended by **Browse products** (in selection order)
  and by the quick search. The `quantityInput` string is validated as an integer ≥ 1; an invalid
  value marks the line (`orderCreate.line.quantityInvalid`), excludes it from the preview and
  blocks submit — never silently dropped (spec Edge Cases).
- The per-line price cell reads the preview line for the product; the reason for an unavailable
  line comes from the preview `messages` entry for that product (R-6 mapping).
- Submit additionally requires every line to have a valid quantity; the create payload shape is
  unchanged (FR-026, SC-006).

**Rationale**: the gate is exactly the preview's own precondition (customer + channel), so a
visible Items section can always be priced (SC-004).

**Alternatives rejected**: gating on all of *Customer & methods* (PO ruled customer + channel);
discarding lines on hide (FR-025).

## R-11 — Create-quote-request screen: prefill without clobbering

**Decision**:

- A line is `{ productId, sku, name, quantityInput, agreedUnitPrice, priceSource }` with
  `priceSource ∈ 'resolved' | 'manual' | 'none'`. Typing in the price field sets `manual`
  (FR-033); a resolution writes the price only while the line is not `manual`.
- Resolution uses the existing `GET /api/v1/admin/products/:id/resolved-price` (gated
  `price_lists:read`) with organization, customer and quantity, through a small queue with **at
  most 4 requests in flight**; each response is applied only if the line still exists and its
  `(productId, quantity, customerId)` key is the one requested (stale responses discarded). On
  add, on quantity change and on customer change, non-manual lines are re-resolved; on a customer
  change their price is first cleared, so a price resolved for the previous customer never
  survives as if it were the new customer's (FR-031: "or left empty when none resolves").
- No customer, or a customer without an organization → lines are added with empty prices and
  resolved once such a customer is chosen (FR-032); the existing no-organization warning stays
  (FR-036).
- An empty agreed price or an invalid quantity marks the line (`rfqCreate.line.priceMissing`,
  `rfqCreate.line.quantityInvalid`) and blocks submit (FR-034); nothing is silently dropped.
  Running total = Σ quantity × agreed price over lines with both valid (FR-035).
- **Line items** stays visible before a customer is chosen (Assumption).
- Picker rules R-4 (Draft/Inactive selectable, grouped/bundle not).

**Rationale**: today's index-keyed `resolveAndFill` races when lines are removed and overwrites
hand-typed prices on a quantity change — both contradict FR-033. The concurrency cap keeps a
200-line add from firing 200 simultaneous requests.

**Alternatives rejected**: a new batch resolved-price endpoint in `price_lists` (a server change
the spec does not ask for; the Assumptions say the existing read endpoints suffice); keeping the
previous customer's price on a failed re-resolution (stale terms presented as current).

## R-12 — Permissions, palette, settings, auditing, tenancy, cache

**Decision**, per cross-cutting concern:

- **Permission codes**: none new (Assumption). The new route reuses `price_lists:write` through
  the module's `writeGate` constant, which the permission-inventory scanner resolves.
  Client-side gates added: `catalog:read` on the picker trigger and, opt-in through `rules`, the quick search (FR-013,
  `ProductBrowserTrigger` reads `useAuth().hasPermission`), `price_lists:write` on **Add**
  (FR-044). Gate by permission only — never `useSurfaceVisibility()({ module: 'catalog' })` in the
  kit, which `check:admin-zones` reports as `foreign-module-id`, and which would be moot anyway.
- **Command palette (XVI)**: no new admin route or surface, so no palette entry is owed; the
  three host screens keep their existing entries.
- **Settings**: none. No configuration knob is introduced (Principle IV); 200 is a product rule.
- **Auditing (XIII)**: the one new write runs as one Command (R-8). The preview writes nothing.
- **Tenancy (XI)**: `PriceListProduct` is `@GlobalEntity()` and price lists are platform-wide,
  as today; the preview keeps `assertCustomerInScope` before any read and evaluates visibility
  against the customer's own organization. No new tenant-scoped entity.
- **Channel scoping (XII)**: R-7.
- **Cache**: R-8 (in-process pricing cache, existing invalidation). No Redis cache is added, so
  the lifecycle pub/sub invalidation pattern has nothing to carry.

## R-13 — Activation and off-state (Principle XVII)

**Decision**: no new gating seam and no new off-state test.

| Module | Activation (manifest) | Consequence for this feature |
| --- | --- | --- |
| `catalog` | `nonDeactivatable` ("Products, variants and categories…") | The picker's data source has no off state. If its platform availability were withdrawn, every host below declares `catalog` in `dependencies`, so dependencies-fail-closed takes the host away first. A `503 MODULE_DISABLED` from the list endpoint would render the picker's load-error state with Retry (FR-010) — fail closed, no special case. |
| `orders` | `nonDeactivatable` | Unchanged. |
| `price_lists` | `nonDeactivatable` | The new route is registered inside the module's existing `registerPricingRoutes`, i.e. behind the same route-registration gate as its siblings (Principle XVII's seam), so the structural gating check covers it with no new code. |
| `quote_requests` | `quote_requests.enabled`, default `true` | When off, its whole admin surface (including `/quote-requests/new`) is absent through the existing mechanism; the picker is a component on that screen and leaves with it. The existing off-state tests cover it. |

**Rationale**: the kit component is not a module surface; it is present exactly when a host that
renders it is present.

## R-14 — Release intent, OpenAPI baseline and documentation

**Decision**:

- **Changesets** (`.changeset/`, one file per meaning; lockstep group, `major` refused in 0.x):
  `@endora-commerce/contracts` **minor** (new exports: `ADMIN_PRODUCT_SELECTION_MAX`, the preview
  message-code enum and precedence, bulk-add schemas; JSDoc on `isProductVisibleTo`);
  `@endora-commerce/mod-price-lists` **minor** (new endpoint; screen fix);
  `@endora-commerce/mod-orders` **minor** (preview reports two new message codes; screen);
  `@endora-commerce/admin-kit` **minor** (new `ProductBrowserDialog` / `ProductBrowserTrigger` /
  `productSelectability`; additive `ProductPicker` props);
  `@endora-commerce/mod-quote-requests` **patch** (screen only);
  `@endora-commerce/mod-i18n` **patch** (new `core` strings). Each names the exported symbol or
  route for the consumer (`specs/conventions/release-intent.md`).
- **OpenAPI frozen baseline**: the new route changes the served document, so
  `backend/test/fixtures/openapi-baseline.json` is re-recorded with
  `UPDATE_OPENAPI_BASELINE=1 pnpm --filter backend exec vitest run test/contract/kernel/openapi-baseline.test.ts`
  in the same merge request (precedent: commit `cb71d74d8`), then the test is run without the
  variable and must be green. Postgres-backed.
- **Documentation**: the module pages `packages/modules/{orders,quote_requests,price_lists}/docs/*.md`
  gain the new behaviour (picker, gating, preview reasons; bulk add and its errors); each English
  edit is paired in the same merge request with its Polish cache entry
  (`docs/translation-cache/pl/<sourceKey>.json`, `sourceHash` of the normalised body) and the
  materialised file under `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/`, then
  `check:docs-translations`. The generated module-reference pages do not change (no manifest
  change).
- **Read sizes**: new files move recorded read sizes inside their bands; leave them — only an
  entry a band refuses is re-recorded, after reading `specs/conventions/check-estate.md`.
- **AGENTS.md appendix**: regenerated by `update-agent-context.sh` during `/speckit.plan`.

## R-15 — Test strategy (Constitution III)

| Layer | Where | What |
| --- | --- | --- |
| Contract schemas | `packages/contracts/src/price-lists.test.ts` (new), `packages/contracts/src/orders.test.ts` | bulk-add schema bounds (0, 1, 200, 201, non-uuid); message-code enum and precedence tuple; response schema still accepts an unknown code |
| Pure domain | `packages/modules/price_lists/src/backend/services/bulk-add-partition.test.ts`; `packages/modules/orders/src/backend/services/preview-line-availability.test.ts` | partition into added/unchanged/failed incl. de-dup and unchanged-before-failed; availability precedence over the visibility truth table × in/out of channel |
| HTTP + Postgres | `backend/test/contract/price_lists/price-list-products-bulk-add.test.ts`; `backend/test/contract/orders/admin-order-preview-availability.test.ts` | every acceptance scenario of US4 sc. 4, 5, 8–12 and SC-007 (audit row count, brackets unchanged byte-for-byte); US1 sc. 6, 11–13 and SC-008 against a restricted product and a second channel |
| OpenAPI | `backend/test/contract/kernel/openapi-baseline.test.ts` | re-recorded |
| Kit logic + component | `admin/test/kit/kit-product-browser-selectability.test.ts`, `admin/test/kit/kit-product-browser.test.tsx`, `admin/test/kit/kit-pickers.test.tsx` (extended) | selection across pages/filters, header checkbox, cap, already-added, rules per host, show-selected, clear, Esc/focus, load/empty/error states, confirm-failure + Retry, quick-search disabled options; strings read from `_i18n`'s shipped bundle in en and pl |
| Host screens | `admin/test/modules/orders/OrderCreatePage.test.tsx` (updated), `…/OrderCreatePage.gating.test.tsx`, `…/OrderCreatePage.product-browser.test.tsx`, `admin/test/modules/quote_requests/RfqCreatePage.product-browser.test.tsx`, `RfqCreatePage.origin.test.tsx` (updated), `admin/test/modules/price_lists/PriceListProducts.bulk-add.test.tsx` | one interaction test per user story at minimum, plus every FR row of the traceability table in tasks.md |

Existing tests that break by design (they drive the per-row `product-${i}` combobox, which FR-020
removes): `admin/test/modules/orders/OrderCreatePage.test.tsx`,
`admin/test/modules/quote_requests/RfqCreatePage.origin.test.tsx`. Their updates are tasks, not
afterthoughts. `admin/test/modules/orders/OrderCreatePage.methods-by-channel.test.ts` tests the
pure `methodsOfferedInChannel` export only and must keep passing unchanged (the export stays).

---

## Open items (raised for the product owner — all resolved)

1. ~~**Stale `salesChannelId` on the preview**~~ — **resolved** by the product owner
   (2026-10-13): the preview refuses with 404 `NOT_FOUND` (the create path still accepts it); the
   active-channel fallback is removed (R-7). Also resolved: a **soft-deleted** product on the
   order preview keeps today's behaviour — priced like a live product, no `liveOnly` on the
   preview read (R-7 § Product loading); spec.md's edge case is amended by the PO.
   *Superseded 2026-11-06 (issue #820) by feature 163 FR-001:* the preview reads with `liveOnly`
   and reports a soft-deleted product as `PRODUCT_NOT_FOUND` on every channel, together with
   create's `404 PRODUCT_NOT_FOUND` (R-7 § Product loading, as amended).
2. ~~**"Deleted from the catalog"**~~ (R-8) — **resolved** (default accepted at analyze,
   2026-10-13; spec.md *Assumptions*): *soft-deleted* (`deletedAt` set) → `failed /
   product_not_found`; an archived (inactive) or draft product is live and is added.
3. ~~**Customer change on the quote-request screen**~~ (R-11) — **resolved** (default accepted at
   analyze, 2026-10-13; spec.md *Assumptions*): non-hand-edited prices are cleared before
   re-resolution, so a line may go from a price to empty when the new customer resolves none;
   hand-typed prices are kept.
