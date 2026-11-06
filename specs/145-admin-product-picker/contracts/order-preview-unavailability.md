# Contract: order-preview unavailability codes

**Owner**: `orders` · **Zod source of truth**: `packages/contracts/src/orders.ts` (written
first — Constitution II) · **FRs**: FR-024, FR-027 · **Decisions**: research.md R-6, R-7

## Route (unchanged request, additive response)

```text
POST /api/v1/admin/orders/preview
preHandler: requireAdmin('orders:write')
body:       adminOrderPreviewRequestSchema      // unchanged
response:   adminOrderPreviewResponseSchema     // unchanged shape; two more codes may appear
```

## Schema additions (`packages/contracts/src/orders.ts`)

```ts
/**
 * Why a preview line is unavailable. Exactly one per unavailable line, the first of
 * ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE that applies. Admin-only diagnostics: see
 * `isProductVisibleTo` (catalog.ts) for why the two visibility/assortment codes are distinct here
 * and one answer on every buyer-facing seam.
 */
export const ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE = [
  'PRODUCT_NOT_FOUND',
  'PRODUCT_NOT_VISIBLE_TO_CUSTOMER',
  'PRODUCT_NOT_IN_SALES_CHANNEL',
  'QUOTE_ONLY',
] as const;
export const adminOrderPreviewMessageCodeSchema = z.enum(ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE);
export type AdminOrderPreviewMessageCode = z.infer<typeof adminOrderPreviewMessageCodeSchema>;
```

`adminOrderPreviewResponseSchema.messages` keeps `z.array(z.object({ productId: uuidSchema,
code: z.string() }))` — **not** narrowed to the enum (that would retype an existing field; an
older client must still parse a newer server). Its doc comment names the four codes and the
one-per-line rule.

## Per-line decision

For each request item, in this order (first match wins, the line is then
`{ unitPrice: '0', lineTotal: 0, unavailable: true }`, contributes nothing to subtotal or VAT,
and one `messages` entry `{ productId, code }` is emitted):

| # | Condition | Code |
| --- | --- | --- |
| 1 | `catalogProductRead.findByIds` returned no row for the id | `PRODUCT_NOT_FOUND` (existing) |
| 2 | `!isProductVisibleTo(product, { organizationId: customer.organizationId, authenticated: true })` | `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` (new) |
| 3 | id ∉ `salesChannelMembership.filterEntityIdsInChannel(body.salesChannelId, 'product', ids)` | `PRODUCT_NOT_IN_SALES_CHANNEL` (new) |
| 4 | resolved price `displayMode === 'none'` | `QUOTE_ONLY` (existing) |

Steps 1–3 are `previewLineAvailability({ product, organizationId, inChannel })` in
`packages/modules/orders/src/backend/services/preview-line-availability.ts`; step 4 stays in the
route because it needs the resolved price. The membership read is **one** call per preview over
the ids that passed steps 1–2, against `body.salesChannelId` — never the request-resolved channel
(`outOfRequestChannel`). The route fails closed with `500 INTERNAL` when the membership port is not
wired.

**Channel resolution (changed)**: the preview prices on, and checks assortment against, exactly
`findOne(SalesChannel, { id: body.salesChannelId })`. The former fallback to any active channel is
removed: a `salesChannelId` naming no channel is refused **404 `NOT_FOUND`** ("Sales channel not
found.", the route's existing envelope) before any line is evaluated. The admin screen renders its
existing preview error (*Could not calculate prices*). The create path does **not** refuse it
today: `POST /api/v1/admin/orders` with a `salesChannelId` naming no channel answers `201`. Closing
that gap belongs to the separate create-path fix, out of scope for this feature.

**Product read** *(amended 2026-11-06, issue #820; supersedes the PO ruling of 2026-10-13)*:
`findByIds(ids, { liveOnly: true })`. A soft-deleted product has no live row, so it is step 1,
`PRODUCT_NOT_FOUND`, on every channel, and no membership or availability read is made for it. The
2026-10-13 ruling ("priced as today, consistent with the create path") assumed the create path
accepted a soft-deleted product. Since feature 163 (`specs/163-product-data-scopes/` FR-001,
FR-002, FR-004) a deleted product is unavailable everywhere, and `POST /api/v1/admin/orders`
refuses it with `404 PRODUCT_NOT_FOUND`. The preview follows create, as `spec.md`'s
*Out of Scope* note required ("the preview and the create path together"). An archived or draft
product still resolves here and is judged by steps 2–3 and the feature-163 availability filter.

Unchanged: `assertCustomerInScope` runs first; a customer without an organization is still `422`;
method gates unchanged; a product with no applicable price list is still priced from its
catalogue default (possibly 0.00) and is not unavailable.

## Consumer mapping (admin `OrderCreatePage`)

| Code | Line reason (core key) | EN / PL |
| --- | --- | --- |
| `PRODUCT_NOT_FOUND`, `QUOTE_ONLY`, any unknown code | `orderCreate.line.unavailable` (existing) | No price / Brak ceny |
| `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` | `orderCreate.line.notVisible` (new) | The customer cannot see this product / Klient nie widzi tego produktu |
| `PRODUCT_NOT_IN_SALES_CHANNEL` | `orderCreate.line.notInChannel` (new) | Not in this sales channel's assortment / Poza asortymentem tego kanału sprzedaży |

Any message blocks submit (existing rule).

## The single-answer rule — what is recorded where

The justification (research.md R-6, four points: the rule's subject is a buyer; this route is
admin-only, `orders:write`, scope-checked; the facts are already the operator's to read; the
buyer seams keep one answer) is written into the JSDoc of `isProductVisibleTo` in
`packages/contracts/src/catalog.ts`, as a third exemption ground beside the two paragraphs that
already list exempt seams, naming `POST /api/v1/admin/orders/preview` and the two codes.

## Tests that pin this contract

- `packages/contracts/src/orders.test.ts` — the enum's members and order; the response schema
  still accepts an unknown `code` string.
- `packages/modules/orders/src/backend/services/preview-line-availability.test.ts` — the
  precedence over the visibility truth table (`visibility` × allow-list empty / own org / other
  org) × in / out of channel; derive the visibility expectation from `isProductVisibleTo`, never a
  hand table.
- `backend/test/contract/orders/admin-order-preview-availability.test.ts` (**Postgres**) — US1
  sc. 11 (allow-list excluding the org → visibility code, other lines priced), sc. 12 (visible,
  not in channel A → assortment code; channel B containing it → priced), sc. 13 (both → visibility
  only; channel switch keeps visibility; customer switch to a permitted org → assortment), one
  message per line, `PRODUCT_NOT_FOUND` before visibility, `QUOTE_ONLY` after assortment; an
  unknown `salesChannelId` → 404 `NOT_FOUND` with no preview body; a soft-deleted product is
  `PRODUCT_NOT_FOUND` only, on any channel, and the other lines stay priced; the
  existing `backend/test/contract/orders/admin-order-preview.test.ts` stays green.
