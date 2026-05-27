---
title: delivery_methods
---

# `delivery_methods`

The platform's **shipping-method framework** (feature 035 — _Metoda Dostawy_).
The module hosts a pluggable adapter registry over the delivery-method catalog,
the delivery-side twin of `payment_methods`. The first-class `Shipment` record
and its lifecycle live in the sibling [`shipments`](./shipments.md) module.

A delivery method is never hard-coded: the platform discovers methods from
whichever **adapter modules** are installed and enabled. Enabling a recognised
shipping-method adapter module auto-creates a configurable `delivery_methods`
row visible at `/delivery-methods`.

## Public surface

Admin routes are gated by `catalog:read` (list) / `catalog:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/delivery-methods` | anon | Eligible methods for the storefront checkout (active ∩ sales-channel ∩ Organization allow-list ∩ adapter registered ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/delivery-methods` | admin | Full list with adapter, status mappings, sales channels, renderer key |
| `PUT /api/v1/admin/delivery-methods/:code` | admin | Upsert by code (name, cost/`price`, status, `statusOnSuccess`/`statusOnFailure`, sales channels) |
| `DELETE /api/v1/admin/delivery-methods/:id` | admin | Hard delete (guarded: rejected with 409 when a `Shipment` references the method — set status `inactive` instead) |

The admin status selectors read their options from `GET /api/v1/admin/order-statuses`
(owned by the payment-methods admin routes; shared `OrderStatusRegistry`).

## Entry fields

A `delivery_methods` row carries: `code` (unique), `adapter` (registry key),
per-language `name` (default + overrides), `cost` + `currency` (the `price`
surcharge added to the order total), `status` (`active`/`inactive`),
`statusOnSuccess` / `statusOnFailure` (Order-status references applied when
shipment generation succeeds/fails). There is **no** `statusOnPending` and no
`kind` column — a shipping method is identified by its `adapter` alone.

`statusOnSuccess` / `statusOnFailure` reference Order statuses resolved through
the `OrderStatusRegistry` port (enum-backed by the order `status` enum until the
Orders module ships a configurable registry). Seed defaults: `shipped` /
`in_fulfilment`.

Sales-channel scoping reuses the generic `SalesChannelMembershipService`
(`'delivery-method'`); per-Organization availability reuses
`OrganizationRestrictionService` (`'delivery_method'`, opt-out blocklist).

## How to build a shipping-method module

A platform module is recognised as a shipping-method adapter **iff** it
registers a `ShippingAdapter` in the process-wide `shippingAdapterRegistry`
during its lifecycle install hook (FR-001). No core change is required.

1. **Implement the `ShippingAdapter` contract** (`@b2b/contracts`):

   ```ts
   import type { ShippingAdapter } from '@b2b/contracts';

   export const myCarrierAdapter: ShippingAdapter = {
     adapterKey: 'my_carrier',
     // Extra conditions per surface; return a constant true when none apply.
     validateUseOnStorefront: async () => true,
     validateUseOnAdmin: async () => true,
     validateUseInApi: async () => true,
     // order_created: may start generation; safe to leave as a no-op.
     onOrderCreated: async () => {},
     // shipment_created: begin generation, return the next action.
     onShipmentCreated: async () => ({ kind: 'pending' }),
     // receive_shipment: map the ingress to a success/failure outcome.
     onReceiveShipment: async (ctx) => ({
       result: 'success',
       externalReference: ctx.externalReference ?? null,
     }),
     // Optional renderer keys; absent ⇒ the platform default is used.
     renderers: { storefront: 'my_carrier', email: 'my_carrier.email' },
   };
   ```

2. **Register the adapter and reconcile a row** from the install hook:

   ```ts
   import { shippingAdapterRegistry } from '.../delivery_methods/services/registry-singleton.js';
   import { DeliveryMethodReconciler } from '.../delivery_methods/services/delivery-method-reconciler.js';
   import type { ModuleInstallHook, ModuleUninstallHook } from '@b2b/contracts';

   export const installHook: ModuleInstallHook = async (ctx) => {
     shippingAdapterRegistry.register(myCarrierAdapter);
     await new DeliveryMethodReconciler(() => ctx.em).ensureMethodForAdapter(
       'my_carrier',
       { code: 'my_carrier', name: { default: 'My Carrier' } },
     );
   };

   export const uninstallHook: ModuleUninstallHook = async () => {
     shippingAdapterRegistry.unregister('my_carrier');
     // The delivery_methods row and its Shipments are preserved (FR-003);
     // the method is simply excluded from new selections.
   };
   ```

3. **Optional renderers** — register custom renderers under the keys you
   declared:
   - Storefront: `registerShippingMethodRenderer(key, fn)` in
     `storefront/lib/shipping-renderers/registry.tsx`.
   - E-mail: `registerShippingEmailRenderer(key, fn)` in
     `shipments/services/shipping-email-renderer.ts`.
   When a renderer is missing for a surface, the platform default is used so the
   method always renders (FR-016/FR-017).

4. **Enable the module** from the admin module-lifecycle screen → a configurable
   Delivery Method appears at `/delivery-methods`.

The two bundled offline reference adapters — `manual_courier` (_Wysyłka własna_)
and `personal_pickup` (_Odbiór osobisty_) — need no external carrier and are the
worked example of the full lifecycle.

## Lifecycle

See [`shipments`](./shipments.md) for the `order_created` → `shipment_created`
→ `receive_shipment` lifecycle, the `Shipment` entity, retries, and the
order-status mapping.
