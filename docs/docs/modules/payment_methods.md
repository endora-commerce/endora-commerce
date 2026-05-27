---
title: payment_methods
---

# `payment_methods`

CRUD over the configured payment methods that Customers can pick at
checkout. Each `PaymentMethod` row is backed by a registered **adapter**
(feature 034) and a per-Sales-Channel visibility list.

## Public surface

Admin routes are gated by `catalog:read` (list) / `catalog:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/payment-methods` | anon | Eligible methods for the storefront checkout (active ∩ org allow-list ∩ registered adapter ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/payment-methods` | admin | Full config (active + inactive) incl. `adapter`, `additionalPrice`, `statusOn*`, sales channels |
| `GET /api/v1/admin/order-statuses` | admin | Order-status options for the `statusOn*` selectors |
| `PUT /api/v1/admin/payment-methods/:code` | admin | Upsert by code; `adapter` defaults to `kind`, `statusOn*` validated against the order-status registry |
| `DELETE /api/v1/admin/payment-methods/:id` | admin | Delete — blocked (409) when a `Payment` references the method; set it `inactive` instead |

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
(`backend/src/modules/payments/adapters/built-in-adapters.ts`).

### The contract

`PaymentAdapter` (from `@b2b/contracts`) carries:

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

1. Create a backend module (`backend/src/modules/<your_module>/`) with a
   `manifest.ts` declaring `dependencies: ['payment_methods']`, and register
   the manifest in `_lifecycle/registered-manifests.ts`.
2. Implement `PaymentAdapter`: set `adapterKey`, `type`, the three
   `validateUse*` (return `true` if unconstrained), `onStorefrontOrderCreated`
   (return a `redirect` / `awaiting_transfer` / `none`), and
   `onReceivePayment` (map your PSP callback to `success` / `failure`).
3. From the module's `installHook`, register the adapter and reconcile its
   entry:

   ```ts
   paymentAdapters.register(myAdapter);
   await paymentMethodReconciler.ensureMethodForAdapter(myAdapter.adapterKey, {
     code: 'p24', type: 'gateway', name: { default: 'Przelewy24' },
   });
   ```

   `ensureMethodForAdapter` is idempotent and never clobbers admin edits.
4. (Optional) register storefront / admin / email renderers under the keys the
   adapter declares; otherwise the defaults render it.
5. Enable the module → a configurable Payment Method appears at
   `/payment-methods`. No core change required.

> **Wiring note:** the bundled adapters are registered by `commerceModule`. To
> let an external module register from its `installHook`, the
> `PaymentAdapterRegistry` + `PaymentMethodReconciler` must be exposed to the
> lifecycle install context — a small composition follow-up tracked with the
> remaining feature-034 tasks.

## Per-Organization availability

`organization_payment_methods` (feature 026) is an **allow-list**: empty ⇒ all
active methods are offered; non-empty ⇒ only the listed methods. Use it to
filter the methods a given Organization may use. Managed through the
organizations restriction service / admin restrictions UI.
