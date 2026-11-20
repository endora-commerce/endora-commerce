# Contract: storefront (customer) API

Zod schemas in `packages/contracts/src/related-payers.ts`. Every route is `requireCustomer`, mounted
through `ctx.routes` (gated on the module's effective presence, `503 MODULE_DISABLED` when off) and
additionally refuses with `404 NOT_FOUND` when `related_payers.enabled` is false on the request's
channel (the capability is absent, FR-002). Permission refusals that would reveal a record answer
404; refusals of an action the caller can see answer `403 ORGANIZATION_PERMISSION_REQUIRED`
(`specs/170-organization-roles/` precedent).

## Owned by `related_payers`

| Method and path | Permission (organization) | Notes |
| --- | --- | --- |
| `GET /api/v1/account/related-payers` | `manage` or `order_with_payer` | X's links: payer name, tax ID, state, scope, window, terms |
| `GET /api/v1/account/related-payers/requests` | `manage` | X's requests; sender view (FR-041): `id`, entered tax ID, contact e-mail, comment, `state`, `rejectionReason`, dates. No counterparty, routing or operator reason |
| `POST /api/v1/account/related-payers/requests` | `manage` | body `{ taxId, contactEmail, comment? }` → **always** `202 { data: { id, state: 'pending' } }`; `429 RELATED_PAYER_REQUEST_LIMIT` checked first (R-8) |
| `POST /api/v1/account/related-payers/requests/:id/withdraw` | `manage` | pending only |
| `POST /api/v1/account/related-payers/:linkId/revoke` | `manage` | X side |
| `GET /api/v1/account/related-payers/incoming` | `approve` (requests to pay) / `manage` (payer invitations) | requests where we are counterparty: sender name and tax ID, comment; each direction listed to the permission that decides it |
| `POST /api/v1/account/related-payers/incoming/:id/accept` | as above | 409 `RELATED_PAYER_REQUEST_DECIDED` on a lost race |
| `POST /api/v1/account/related-payers/incoming/:id/reject` | as above | body `{ reason? }` |
| `GET /api/v1/account/payees` | `approve` | links where we are payer, each with the buyer's tax ID (RP-20 d) |
| `POST /api/v1/account/payees/:linkId/revoke` | `approve` | Y side |
| `POST /api/v1/account/payees/invitations` | `approve`, and `payer_may_invite_buyers` on | same reply contract as the request route |
| `GET /api/v1/account/payees/invitations` | `approve`, and `payer_may_invite_buyers` on | the payer's sent invitations, sender view (Phase 6) |
| `POST /api/v1/account/payees/invitations/:id/withdraw` | `approve` | pending only; not behind the setting (Phase 6) |
| `GET /api/v1/related-payers/availability` | any signed-in customer | `{ data: { enabled } }` — `related_payers.enabled` on the request's channel, `200` either way, `no-store`; the account offers *Payers* and *Orders we pay for* only when `true` (FR-002, owner's manual test 2026-11-20) |
| `GET /api/v1/related-payers/invitations/:token` | anonymous | `{ taxId }` of a live invitation to register, else `404` — the registration form's prefill (FR-044, Phase 6) |
| `GET /api/v1/account/paid-orders` | `view_paid_orders` | over `paidOrderReadPort.list` |
| `GET /api/v1/account/paid-orders/:id` | `view_paid_orders` | 404 when not ours |
| `GET /api/v1/account/paid-orders/:id/invoices/:invoiceId/pdf` | `view_paid_orders` | invoice of that order only |
| `GET /api/v1/checkout/payers` | `order_with_payer` | `usablePayers` + allowed billing addresses + per-payer allowed payment-method ids, for the checkout and cart selectors |

No customer route accepts `commercialTerms` (RP-11, FR-119).

## Owned by `carts`

| Method and path | Notes |
| --- | --- |
| `PUT /api/v1/cart/buying-for` | body `{ payerOrganizationId: uuid \| null }`; validated by `relatedPayerPolicyPort`; reprices; answers the cart plus `repricing: { lines: [{ lineId, before, after, unpriced }], promotionsAdded, promotionsRemoved }` (FR-113). With `related_payers` off: 503 from the port gate is translated to `404` (the capability is absent) |
| `GET /api/v1/cart` | gains `buyingFor`; when the context no longer holds, the read clears it, reprices and adds `buyingForReset: { reason }` (FR-116) |

## Owned by `orders`

| Change | Notes |
| --- | --- |
| `POST /api/v1/orders` | `payerOrganizationId?`; with a payer's-terms cart the value must equal the cart's `buyingFor` |
| `POST /api/v1/orders/preview` (existing preview) | same field; tax from Y's VAT status and Y's billing country (FR-064) |
| `GET /api/v1/orders/:id` | gains `payer` |
| `GET /api/v1/checkout/payment-methods` (existing catalogue) | `?payerOrganizationId=` lists Y's allowed methods after `assertUsable` |

## Owned by `catalog`, `search`, `comparisons`, `price_lists`

No route shape changes. Each priced read switches to `pricedAudienceOf(request)` (contracts/ports.md
§4); responses stay `private, no-store` exactly as an authenticated buyer's do today.
