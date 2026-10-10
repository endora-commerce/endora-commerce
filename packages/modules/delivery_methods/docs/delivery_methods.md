---
title: delivery_methods
description: Configured delivery options
---

# `delivery_methods`

The platform's **shipping-method framework** (_Metoda Dostawy_).
The module hosts a pluggable adapter registry over the delivery-method catalog,
the delivery-side twin of `payment_methods`. The first-class `Shipment` record
and its lifecycle live in the sibling [`shipments`](./shipments.md) module.
Carrier integration modules register adapters into this framework. Which ones your
instance has depends on what is installed, so they are named rather than linked
here: a link to a sibling page is a broken link in every instance that does not
install that module, which is what `onBrokenLinks: 'throw'` says about it.

A delivery method is never hard-coded: the platform discovers methods from
whichever **adapter modules** are installed and enabled. Enabling a recognised
shipping-method adapter module auto-creates a configurable `delivery_methods`
row visible at `/delivery-methods`.

## Public surface

Admin routes are gated by `delivery_methods:read` (reads) and
`delivery_methods:write` (mutations) — the module's own codes since 2026-08-28.
They were `catalog:read` / `catalog:write` until then, which meant whoever could
edit a product could also decide how the shop ships, and delete a delivery
method outright. A role that was relying on the catalogue codes for this screen
has to be granted the new ones on `/admin-roles`; nothing grants them
automatically, deliberately.

**Choosing a method's sales channels needs these codes and no other.** Where a
method is offered is part of configuring the method, so `delivery_methods:write` is
sufficient to assign, replace and clear its sales channels, and `delivery_methods:read` to
see the channels there are to choose from
(`GET /api/v1/admin/delivery-methods/sales-channels`). Neither `sales_channels:read`
nor `sales_channels:write` is required — by decision, not by omission — and
holding the `delivery_methods` codes grants nothing on the sales-channel screens.

| Verb + Path | Audience | Gate | Purpose |
| --- | --- | --- | --- |
| `GET /api/v1/delivery-methods` | anon | — | Eligible methods for the storefront checkout (active ∩ sales-channel ∩ Organization allow-list ∩ adapter registered ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/delivery-methods` | admin | `delivery_methods:read` | Full list with adapter, status mappings, sales channels, renderer key, and `availability` — whether checkout can offer the method and which module decides it |
| `GET /api/v1/admin/delivery-methods/adapters` | admin | `delivery_methods:read` | The adapters a method may be bound to: `{ key, ownerModule }` for every registered adapter whose module is switched on |
| `GET /api/v1/admin/delivery-methods/sales-channels` | admin | `delivery_methods:read` | The sales channels a method may be assigned to — `{ id, code, name, active }` for every channel, inactive ones included |
| `PUT /api/v1/admin/delivery-methods/:code` | admin | `delivery_methods:write` | Upsert by code (name, cost/`price`, `adapter`, status, `statusOnSuccess`/`statusOnFailure`, sales channels) |
| `DELETE /api/v1/admin/delivery-methods/:id` | admin | `delivery_methods:write` | Hard delete (guarded: rejected with 409 when a `Shipment` references the method — set status `inactive` instead) |

The admin status selectors read their options from `GET /api/v1/admin/order-statuses`
(owned by the payment-methods admin routes; shared `OrderStatusRegistry`). That
route is gated `payment_methods:read` **or** `delivery_methods:read` — an any-of
over the two editors that read it, so the code that opens this screen also opens
its status selectors.

## Sales channels

Each delivery method is offered in the sales channels the operator chooses for
it. On `/delivery-methods` the form has a **Sales channels** field, and the list shows
every method's channels.

**An assignment is a restriction, and a method with none is offered in every
channel.** A method assigned to one or more channels is offered in exactly
those. A method assigned to no channel — *All channels* in the form — is offered
in every channel, including channels created later. This is deliberately not the
rule products follow, where a product in no channel is published nowhere:
delivery methods exist without an assignment as a matter of course, so reading
"none" as "nowhere" would empty existing checkouts. Where a method that nobody
assigned by hand stands:

- A module that ships its own method seeds it when the module is installed and
  assigns it to **no** channel, so it is offered on every channel — whenever the
  module is installed, on a new instance or on one that has run for years.
  Releases before this rule did otherwise: the seed assigned the method to the
  default channel when that channel existed at installation, which it does on
  any instance that has been started at least once. Methods seeded then keep
  that assignment.
- Demo data assigns none.
- A method created through the API without `salesChannelIds` is assigned to the
  default channel; one created in the admin form with nothing ticked is
  assigned to none.

The assignment is enforced where a buyer meets it:

- `GET /api/v1/delivery-methods` lists only the methods offered in the sales channel the request
  resolved (`X-Sales-Channel`, `?salesChannel=`, the host map, else the system
  default). A storefront therefore has to name its channel on this read: the
  reference storefront forwards `X-Sales-Channel`, and one scaffolded from an
  earlier release needs the same change in `lib/api/methods.ts`, or it is
  answered with the default channel's methods.
- Placing an order, and previewing its total, refuses a method that is not
  offered in the order's sales channel with `400 VALIDATION_FAILED` and
  `details.code = "delivery_method_not_in_sales_channel"`. That holds for a
  storefront checkout, for one-click buy, for an order an administrator creates
  on a customer's behalf (the channel chosen for the order) and for an API-key
  order (the key's channel). The admin order-creation form narrows its method
  lists to the chosen channel.

`salesChannelIds` on `PUT /api/v1/admin/delivery-methods/:code` has three meanings:

| `salesChannelIds` | Effect |
| --- | --- |
| omitted | An update leaves the assignment unchanged. A **new** method is assigned to the system-default channel only. |
| `[]` | Every assignment is removed: the method is offered in every channel. |
| one or more ids | The method is offered in exactly those channels. |

The admin form always sends the field, so a method created there with nothing
ticked is offered in every channel. If the form cannot load the list of sales
channels it says so and sends nothing, and the save leaves the assignment as it
was.

Elsewhere the at-least-one-channel rule still applies: removing a method's
**last** channel from the sales-channel side is refused, and deleting a sales
channel that is a method's only one is refused or rebinds the method to the
default channel. So an assignment is never lost as a side effect of another
operation: a method is offered everywhere only because it was saved with no
channel chosen, or was seeded without one as described above. A save that names
a sales channel which does not exist is refused with `400 VALIDATION_FAILED`
before anything is written. If assigning the channels of a **new** method still
fails, the creation is taken back: the method is removed again — without asking
`shipments`, since nothing can reference a method created in the same request, so
this works with `shipments` switched off too — and the request answers with the
failure. Should the removal itself fail, the method is left **inactive** rather
than active with no channel, so the worst outcome is a method that is not
offered.

**Upgrading an instance with more than one sales channel: review every method.**
Before this rule the storefront listed every active method on every channel and
ignored the assignment. The **Sales channels** column on `/delivery-methods` shows where
each method stands now:

- assigned to the **default channel only**, and so gone from the other channels'
  checkouts until changed — every method created in the admin so far, and every
  method a module seeded **under an earlier release** on an instance that had
  already been started. Nothing widens these automatically: such a row cannot be
  told apart from one restricted on purpose;
- assigned to **no channel**, and so offered everywhere — every method a module
  seeds from this release on, methods a module seeded under an earlier release
  during the instance's first setup, and demo-data methods.

Open each method and choose its channels, or untick all of them to offer it
everywhere. An instance with a single sales channel is unaffected.

Memberships live in `sales_channel_delivery_methods` and are read and written only through the
platform's sales-channel membership service.

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

## Choosing the adapter

The adapter is what makes a row a working delivery method: a method whose
`adapter` is not registered, or whose contributing module is switched off, is
kept in the catalog and **never offered at checkout**.

On `/delivery-methods` the operator picks the adapter from a list when creating
or editing a method. The list is the instance's own — the two bundled adapters
plus one per installed, switched-on carrier module — so it grows when a carrier
module is installed and shrinks when one is switched off. A new method cannot be
saved without a choice.

A row that cannot be offered is marked **Not offered at checkout** in the list,
with the reason: no installed module provides its adapter, or the module that
does is switched off or unavailable. Nothing repairs or removes such a row
automatically. Open it and choose a registered adapter, or switch its carrier
module back on. Until then the row can still be re-priced, renamed or set
inactive: saving it with the adapter it already has is accepted.

Three rules apply to the API as well as the screen:

- **An adapter that is chosen must be registered.** Changing a method to a key
  no module contributed answers 400.
- **A method that already has shipments keeps its adapter.** A `Shipment`
  records its delivery method, not the adapter that opened it, so the method's
  `adapter` is the only record of which carrier holds those parcels. Changing it
  answers 409; set the method `inactive` and create a new one for the other
  adapter. With the `shipments` module switched off the platform cannot count,
  so the change is refused until it is back on.
- **`adapter` may still be omitted from the body.** A creation that omits it
  takes the method's `code` as the adapter, as it did before adapters existed —
  which yields a working method only when the code happens to be a registered
  adapter key. Send `adapter` explicitly; `availability.available` in the
  response says whether the method you just saved can be offered.

## How to build a shipping-method module

A platform module is recognised as a shipping-method adapter **iff** it
registers a `ShippingAdapter` in the process-wide `shippingAdapterRegistry`
from its boot hook. No core change is required.

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
   being offered and failing — the same defect the payment twin had, fixed on
   both sides. The `delivery_methods` row itself is static reference data and
   belongs in your module's migration; `DeliveryMethodReconciler` remains
   available from an `installHook` for a row that must be created from code. No
   uninstall hook is needed to withdraw the adapter — a module that is not
   present is not enumerated.

   The skip does not answer for an order **already placed** on your method: a
   shipment can still be generated for it, and that shipment
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
   may a contributing hook probe `effectiveState` — the host already
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
   method always renders.

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
| Storefront eligibility | `GET /api/v1/delivery-methods` → `ShippingMethodEligibilityService.filter` | the method is not offered |
| Admin adapter picker | `GET /api/v1/admin/delivery-methods/adapters` → `list` | the adapter is not offered as a choice |
| Admin upsert guard | `PUT /api/v1/admin/delivery-methods/:code` → `isRegistered` | an explicitly supplied key nobody contributed is rejected (400) unless the row already carries it; a contributed one whose owner is off is accepted, because the read is presence-blind on purpose |
| Order placement | `orders` re-validates the chosen method, then fires `onOrderCreated` | a method whose owner is off answers 503 `MODULE_DISABLED`; an unregistered one skips the hook |
| Shipment generation | `ShipmentService.create` → `onShipmentCreated` | the adapter hook is skipped and the `Shipment` opens **`pending_manual`** naming the absent module — never plain `pending`, which would read as a shipment the carrier had accepted |
| Order-confirmation e-mail | the method's `renderers.email` key | the platform default renderer is used |

Two things follow, and they are the reason this section exists rather than being
left to be inferred. First, there is **no order to get right** between
contributors: your adapter is visible to the first read whether it landed before
or after anybody else's, so a boot hook has nothing to wait for and nothing to
verify. Second, an absent or switched-off contributor is answered **at the
read**, by the entry's recorded owner — never at the push. That is what makes
this a contribution point rather than a gated port: the push is ungated
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
reason.

## Lifecycle

See [`shipments`](./shipments.md) for the `order_created` → `shipment_created`
→ `receive_shipment` lifecycle, the `Shipment` entity, retries, and the
order-status mapping.
