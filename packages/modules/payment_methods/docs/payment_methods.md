---
title: payment_methods
description: Configured payment methods
---

# `payment_methods`

CRUD over the configured payment methods that Customers can pick at
checkout. Each `PaymentMethod` row is backed by a registered **adapter**
(feature 034) and a per-Sales-Channel visibility list.

## Public surface

Admin routes are gated by `payment_methods:read` (reads) and
`payment_methods:write` (mutations) — the module's own codes since 2026-08-28.
They were `catalog:read` / `catalog:write` until then, which meant whoever could
edit a product could also decide how the shop takes money. A role that was
relying on the catalogue codes for this screen has to be granted the new ones on
`/admin-roles`; nothing grants them automatically, deliberately.

`GET /api/v1/admin/order-statuses` is the one exception, and it is an any-of
rather than a widening: the route is registered here but read by two editors —
this module's screen and the `delivery_methods` one — so it accepts either
module's read code. The second member was `catalog:read` while
`delivery_methods` still borrowed the catalogue's authority; it became
`delivery_methods:read` when that module minted its own pair, so no catalogue
holder reaches the shared list any more.

| Verb + Path | Audience | Gate | Purpose |
| --- | --- | --- | --- |
| `GET /api/v1/payment-methods` | anon | — | Eligible methods for the storefront checkout (active ∩ org allow-list ∩ registered adapter ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/payment-methods` | admin | `payment_methods:read` | Full config (active + inactive) incl. `adapter`, `additionalPrice`, `statusOn*`, sales channels |
| `GET /api/v1/admin/payment-methods/adapters` | admin | `payment_methods:read` | Registered adapter keys, for the admin adapter picker |
| `GET /api/v1/admin/order-statuses` | admin | `payment_methods:read` **or** `delivery_methods:read` | Order-status options for the `statusOn*` selectors, here and on the delivery-method screen |
| `PUT /api/v1/admin/payment-methods/:code` | admin | `payment_methods:write` | Upsert by code; `adapter` defaults to `kind`, `statusOn*` validated against the order-status registry |
| `PATCH /api/v1/admin/payment-methods/:id/status` | admin | `payment_methods:write` | Availability alone (feature 076, D-82) — the one write the four gateway screens link to |
| `DELETE /api/v1/admin/payment-methods/:id` | admin | `payment_methods:write` | Delete — blocked (409) when a `Payment` references the method; set it `inactive` instead |

## Entities

`PaymentMethod` — `code`, `kind`, **`adapter`** (registry key), default +
per-language `name`, `status`, **`additionalPrice`** (flat surcharge in the
order currency), and the three Order-status references
**`statusOnPending` / `statusOnSuccess` / `statusOnFailure`**. Sales-channel
scoping via `sales_channel_payment_methods`; per-Organization availability via
`organization_payment_methods` (feature 026).

## Adapter framework (feature 034)

A payment method's behaviour is supplied by a **`PaymentAdapter`** registered
in the `PaymentAdapterRegistry`. The platform recognises a module as a
payment-method provider **iff it registers an adapter** — there is no other
condition. The bundled `bank_transfer`, `pickup`, `credit_limit`, and
`gateway` adapters are the reference implementations
(`packages/modules/payments/src/backend/adapters/built-in-adapters.ts`).

### The contract

`PaymentAdapter` (from `@endora-commerce/contracts`) carries:

- `adapterKey` — stable id; matches `payment_methods.adapter`.
- `type` — one of `bank_transfer | pickup | credit_limit | gateway`.
- `validateUseOnStorefront` / `validateUseOnAdmin` / `validateUseInApi` —
  extra eligibility conditions per surface; return a constant `true` when
  there are none.
- `onStorefrontOrderCreated` — runs on **`storefront_order_created`**; returns
  a `StartPaymentResult` (`awaiting_transfer | redirect | none`).
- `onReceivePayment` — interprets a **`receive_payment`** callback into a
  success/failure `PaymentOutcome`.
- `renderers?` — optional `{ storefront?, admin?, email? }` renderer keys;
  absent ⇒ the platform default renderer is used.

### Lifecycle

1. **`storefront_order_created`** — `order-service.placeOrder` creates the
   Order at the method's `statusOnPending`, adds `additionalPrice` to the
   total, opens a pending `Payment`, and invokes
   `adapter.onStorefrontOrderCreated`.
2. **`receive_payment`** — `POST /api/v1/payments/receive` resolves the
   `Payment` (by `paymentId` or `orderId + externalReference`), applies the
   outcome, and maps the Order status through `statusOnSuccess` /
   `statusOnFailure`. Idempotent: a re-success is a no-op; a failure after a
   terminal `paid` is rejected. A failed payment is retried via
   `POST /api/v1/admin/orders/:id/payments/retry`, opening a new `Payment`
   (`attemptNo + 1`) while keeping the prior attempts.

`Payment.status` (the payment-process status: `awaiting_payment → paid |
failed`, plus `deferred` for credit limit) is **separate** from the
order-status mapping. `statusOn*` reference *Order Statuses* resolved through
the `OrderStatusRegistry` port — enum-backed today, swappable for the Orders
module's configurable registry later with no change here.

### Build your own payment-method module

1. Create a module package (`packages/modules/<your_module>/`) with a
   `src/manifest.ts` declaring `dependencies: ['payment_methods']`, then run
   `pnpm --filter backend run composer:generate` so the generated manifest
   registry picks it up.
2. Implement `PaymentAdapter`: set `adapterKey`, `type`, the three
   `validateUse*` (return `true` if unconstrained), `onStorefrontOrderCreated`
   (return a `redirect` / `awaiting_transfer` / `none`), and
   `onReceivePayment` (map your PSP callback to `success` / `failure`).
3. Contribute the adapter from the module's **boot hook**, naming the module as
   its owner:

   ```ts
   import { paymentAdapterRegistry } from '.../payment_methods/services/registry-singleton.js';

   ctx.onBoot(() => {
     paymentAdapterRegistry.register(myAdapter, 'my_module');
   });
   ```

   The owner id is not decoration: the registry skips an adapter whose module is
   not effectively present, so a gateway an operator switches off stops being
   offered at checkout without anything unregistering it (issue #96). Boot hooks
   run whatever the module's state is — the *enumeration* answers presence, not
   the registration.
4. Ship the method rows as a **migration** owned by your module. The codes,
   kinds and default names are compile-time constants, so they are static
   reference data, not a per-boot reconcile: `insert … on conflict (code) do
   nothing`, seeded `inactive` so an operator opts in. The four bundled gateways
   do exactly this (`stripe/migrations/…_stripe_seed_payment_methods.ts`).
   `PaymentMethodReconciler.ensureMethodForAdapter` remains available from an
   `installHook` for a module that must create a row from code; it is idempotent,
   never clobbers admin edits, and never touches sales-channel membership.
5. (Optional) register storefront / admin / email renderers under the keys the
   adapter declares; otherwise the defaults render it.
6. Enable the module → a configurable Payment Method appears at
   `/payment-methods`. No core change required.

The `paymentAdapterRegistry` is a **process-wide singleton**
(`registry-singleton.ts`): one table of adapters per process, however many times
the platform is composed, wired into the live eligibility, admin and
order-placement paths. Every entry records the module that contributed it, and
every buyer-facing read (`get`, `resolve`, `list`) skips an entry whose owner is
absent. The admin-facing reads (`entry`, `ownerOf`, `isRegistered`, `listAll`)
deliberately do not: switching a module off is not uninstalling it, so the
`/payment-methods` screen keeps the row and shows why it is unavailable.

## Per-Organization availability

`organization_payment_methods` (feature 026) is an **allow-list**: empty ⇒ all
active methods are offered; non-empty ⇒ only the listed methods. Use it to
filter the methods a given Organization may use. Managed through the
organizations restriction service / admin restrictions UI.
