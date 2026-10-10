---
title: payment_methods
description: Configured payment methods
---

# `payment_methods`

CRUD over the configured payment methods that Customers can pick at
checkout. Each `PaymentMethod` row is backed by a registered **adapter**
(see *Adapter framework* below) and a per-Sales-Channel visibility list.

## Public surface

Admin routes are gated by `payment_methods:read` (reads) and
`payment_methods:write` (mutations) — the module's own codes since 2026-08-28.
They were `catalog:read` / `catalog:write` until then, which meant whoever could
edit a product could also decide how the shop takes money. A role that was
relying on the catalogue codes for this screen has to be granted the new ones on
`/admin-roles`; nothing grants them automatically, deliberately.

**Choosing a method's sales channels needs these codes and no other.** Where a
method is offered is part of configuring the method, so `payment_methods:write` is
sufficient to assign, replace and clear its sales channels, and `payment_methods:read` to
see the channels there are to choose from
(`GET /api/v1/admin/payment-methods/sales-channels`). Neither `sales_channels:read`
nor `sales_channels:write` is required — by decision, not by omission — and
holding the `payment_methods` codes grants nothing on the sales-channel screens.

`GET /api/v1/admin/order-statuses` is the one exception, and it is an any-of
rather than a widening: the route is registered here but read by two editors —
this module's screen and the `delivery_methods` one — so it accepts either
module's read code. The second member was `catalog:read` while
`delivery_methods` still borrowed the catalogue's authority; it became
`delivery_methods:read` when that module minted its own pair, so no catalogue
holder reaches the shared list any more.

| Verb + Path | Audience | Gate | Purpose |
| --- | --- | --- | --- |
| `GET /api/v1/payment-methods` | anon | — | Eligible methods for the storefront checkout (active ∩ sales channel ∩ org allow-list ∩ registered adapter ∩ `validateUseOnStorefront`) |
| `GET /api/v1/admin/payment-methods` | admin | `payment_methods:read` | Full config (active + inactive) incl. `adapter`, `additionalPrice`, `statusOn*`, sales channels |
| `GET /api/v1/admin/payment-methods/adapters` | admin | `payment_methods:read` | Registered adapter keys, for the admin adapter picker |
| `GET /api/v1/admin/payment-methods/sales-channels` | admin | `payment_methods:read` | The sales channels a method may be assigned to — `{ id, code, name, active }` for every channel, inactive ones included |
| `GET /api/v1/admin/order-statuses` | admin | `payment_methods:read` **or** `delivery_methods:read` | Order-status options for the `statusOn*` selectors, here and on the delivery-method screen |
| `PUT /api/v1/admin/payment-methods/:code` | admin | `payment_methods:write` | Upsert by code; `adapter` defaults to `kind`, `statusOn*` validated against the order-status registry |
| `PATCH /api/v1/admin/payment-methods/:id/status` | admin | `payment_methods:write` | Availability alone — the one write the four gateway screens link to |
| `DELETE /api/v1/admin/payment-methods/:id` | admin | `payment_methods:write` | Delete — blocked (409) when a `Payment` references the method; set it `inactive` instead |

## Entities

`PaymentMethod` — `code`, `kind`, **`adapter`** (registry key), default +
per-language `name`, `status`, **`additionalPrice`** (flat surcharge in the
order currency), and the three Order-status references
**`statusOnPending` / `statusOnSuccess` / `statusOnFailure`**. Sales-channel
scoping via `sales_channel_payment_methods`; per-Organization availability via
`organization_payment_methods`.

## Adapter framework

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
   offered at checkout without anything unregistering it. Boot hooks
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

## Sales channels

Each payment method is offered in the sales channels the operator chooses for
it. On `/payment-methods` the form has a **Sales channels** field, and the list shows
every method's channels.

**An assignment is a restriction, and a method with none is offered in every
channel.** A method assigned to one or more channels is offered in exactly
those. A method assigned to no channel — *All channels* in the form — is offered
in every channel, including channels created later. This is deliberately not the
rule products follow, where a product in no channel is published nowhere:
payment methods exist without an assignment as a matter of course, so reading
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

- `GET /api/v1/payment-methods` lists only the methods offered in the sales channel the request
  resolved (`X-Sales-Channel`, `?salesChannel=`, the host map, else the system
  default). A storefront therefore has to name its channel on this read: the
  reference storefront forwards `X-Sales-Channel`, and one scaffolded from an
  earlier release needs the same change in `lib/api/methods.ts`, or it is
  answered with the default channel's methods.
- Placing an order, and previewing its total, refuses a method that is not
  offered in the order's sales channel with `400 VALIDATION_FAILED` and
  `details.code = "payment_method_not_in_sales_channel"`. That holds for a
  storefront checkout, for one-click buy, for an order an administrator creates
  on a customer's behalf (the channel chosen for the order) and for an API-key
  order (the key's channel). The admin order-creation form narrows its method
  lists to the chosen channel.

`salesChannelIds` on `PUT /api/v1/admin/payment-methods/:code` has three meanings:

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
before anything is written, and if assigning the channels of a **new** method
fails the method is not created.

**Upgrading an instance with more than one sales channel: review every method.**
Before this rule the storefront listed every active method on every channel and
ignored the assignment. The **Sales channels** column on `/payment-methods` shows where
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

Memberships live in `sales_channel_payment_methods` and are read and written only through the
platform's sales-channel membership service.

## Per-Organization availability

`organization_payment_methods` is an **allow-list**: empty ⇒ all
active methods are offered; non-empty ⇒ only the listed methods. Use it to
filter the methods a given Organization may use. Managed through the
organizations restriction service / admin restrictions UI.
