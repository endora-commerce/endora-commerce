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
from its boot hook (FR-001). No core change is required.

1. **Implement the `ShippingAdapter` contract** (`@endora-commerce/contracts`):

   ```ts
   import type { ShippingAdapter } from '@endora-commerce/contracts';

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

2. **Contribute the adapter from the boot hook**, naming the owning module, and
   ship the method row as a migration:

   ```ts
   import { shippingAdapterRegistry } from '.../delivery_methods/services/registry-singleton.js';

   ctx.onBoot(() => {
     shippingAdapterRegistry.register(myCarrierAdapter, 'my_carrier_module');
   });
   ```

   The owner id is what lets the registry skip the adapter while its module is
   absent, so a carrier an operator switches off stops being offered instead of
   being offered and failing (issue #96 — the payment twin's defect, fixed on
   both sides). The `delivery_methods` row itself is static reference data and
   belongs in your module's migration; `DeliveryMethodReconciler` remains
   available from an `installHook` for a row that must be created from code. No
   uninstall hook is needed to withdraw the adapter — a module that is not
   present is not enumerated.

   The skip does not answer for an order **already placed** on your method: a
   shipment can still be generated for it, and since issue #250 that shipment
   opens `pending_manual` naming your module rather than reading like one you
   accepted. You write no code for it — see *When the registry is read* below.

   **Your hook pushes and returns.** It does not check what is already in the
   table, does not check whether `delivery_methods` is present, and treats no
   absence as an error — because nothing reads the registry while modules are
   being composed. Boot hooks run whatever a module's effective state is; the
   *enumeration* answers presence, not the registration. A throw in a boot hook
   is not one adapter dropping out: `runBootHooks` re-throws it as
   `ModuleCompositionError` and `index.ts` turns that into `process.exit(1)`, so
   the operator's next start dies over a switch they were entitled to use. Nor
   may a contributing hook probe `effectiveState` (D-67/D-68) — the host already
   filters at enumeration, and a probe at the push would make switching your
   carrier back on require a restart. If your hook also *does work* (a
   reconcile, a Redis or Postgres write), split it in two first: the working
   half probes, the contributing half never does.

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

## When the registry is read

The `shippingAdapterRegistry` is a **process-wide singleton**
(`delivery_methods/services/registry-singleton.ts`): one table of adapters per
process, however many times the platform is composed. Contributions are pushed
into it **once, during composition**. Every read of it happens **later, inside a
request**:

| Read | Where | What an absent adapter means there |
| --- | --- | --- |
| Storefront eligibility | `GET /api/v1/delivery-methods` → `ShippingMethodEligibilityService.filter` | the method is not offered (FR-003) |
| Admin upsert guard | `PUT /api/v1/admin/delivery-methods/:code` → `isRegistered` | an explicitly supplied key nobody contributed is rejected (400); a contributed one whose owner is off is accepted, because the read is presence-blind on purpose |
| Order placement | `orders` re-validates the chosen method, then fires `onOrderCreated` | a method whose owner is off answers 503 `MODULE_DISABLED`; an unregistered one skips the hook |
| Shipment generation | `ShipmentService.create` → `onShipmentCreated` | the adapter hook is skipped and the `Shipment` opens **`pending_manual`** naming the absent module (issue #250) — never plain `pending`, which would read as a shipment the carrier had accepted |
| Order-confirmation e-mail | the method's `renderers.email` key | the platform default renderer is used |

Two things follow, and they are the reason this section exists rather than being
left to be inferred. First, there is **no order to get right** between
contributors: your adapter is visible to the first read whether it landed before
or after anybody else's, so a boot hook has nothing to wait for and nothing to
verify. Second, an absent or switched-off contributor is answered **at the
read**, by the entry's recorded owner — never at the push. That is what makes
this a contribution point rather than a gated port (D-39): the push is ungated
on purpose, because gating it would turn one operator flip into a boot failure
naming a module nobody touched.

The presence filter splits the surface by who is asking. `get`, `resolve`,
`list` and `isAvailable` skip an entry whose owning module is not effectively
present — a buyer is never offered a carrier that cannot take the parcel, and
`resolve` raises the ordinary `ModuleDisabledError`. `entry`, `ownerOf`,
`isRegistered` and `listAll` deliberately do not, because `/delivery-methods`
has to keep showing the method *and* the reason it is unavailable: switching a
module off is not uninstalling it.

`absentOwnerFor(adapterKey)` is the fifth reader and the only one that answers
the *question* instead of exposing the table: it names the module that
contributed the key and is not present, and `null` in every other case. It
exists because `get()` collapses two situations an operator cannot act on
identically — a key nobody ever contributed, and a key whose carrier module is
switched off — and only the second one names something they can switch back on.
`shipments` asks it to decide which state to open a `Shipment` in; the payment
twin, `GatewayRefundRegistry.absentOwnerFor`, is the same reader for the same
reason (D-71).

## Lifecycle

See [`shipments`](./shipments.md) for the `order_created` → `shipment_created`
→ `receive_shipment` lifecycle, the `Shipment` entity, retries, and the
order-status mapping.
