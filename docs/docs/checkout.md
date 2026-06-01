---
sidebar_position: 20
title: Checkout
---

# Checkout (Kasa)

Checkout is the storefront flow that turns a non-empty **Cart** into an
**Order**. A signed-in Customer confirms a shipping and a billing address,
chooses a shipping method and a payment method, optionally applies a coupon and
adds a comment, and places the order. On success the cart becomes `completed`,
an Order is created at the payment method's pending status (shown to the buyer
as *New*), and the buyer lands on the **Success Page**; on failure the cart is
left untouched and the buyer lands on the **Failure Page** with a retry button.

This page documents the two operator-facing aspects most likely to need
configuration: the **business Order ID** and the **eligible method lists**.

## Business Order ID

Every order carries two identifiers:

- `id` — the internal database UUID. Used for foreign keys, admin tooling, and
  logs. **Never shown to the Customer.**
- `businessId` — the **customer-facing business Order ID**, shown on the Success
  Page, in the order-confirmation e-mail, and in the storefront order list and
  detail views.

The business Order ID is generated at placement as:

```
<prefix><sequence><suffix>
```

- `<sequence>` is drawn from a dedicated, monotonic Postgres sequence
  (`orders_business_id_seq`). It never resets, so the ID is globally unique
  regardless of any later prefix/suffix change.
- `<prefix>` and `<suffix>` are **admin-configurable** and resolved per Sales
  Channel.

### Configuring the prefix / suffix

In the Admin Settings UI, open the **Orders** group and edit:

| Setting | Default | Example |
|---------|---------|---------|
| `orders.business_id.prefix` | `` (empty) | `ORD-` |
| `orders.business_id.suffix` | `` (empty) | `-2026` |

With the defaults, a business Order ID is just the bare number (e.g. `1042`).
With the example values it becomes `ORD-1042-2026`. Both settings are
Sales-Channel-scopable, so different channels can use different formats.

Changing a value affects **only orders placed afterward** — existing business
Order IDs are immutable.

## Eligible shipping & payment methods

The checkout shipping- and payment-method sections list exactly the methods
that are:

1. **active** (status `Active` in the Admin UI),
2. assigned to the buyer's current **Sales Channel**,
3. allowed for the buyer's **Organization**, and
4. accepted by the adapter's `validateUseOnStorefront` validator.

These rules are owned by the Payment Method and Shipping Method modules; checkout
only renders and submits the buyer's choice. A method's surcharge
(`additionalPrice` for payment, `cost` for shipping) is reflected in the order
total and the confirmation e-mail.

## Coupons

The coupon entered at checkout is applied to the **cart**, which is the source
of truth the order-placement transaction reads. The discount is reflected in the
checkout summary before the order is placed and is stamped onto the Order
(`promotionCode` + `discountTotal`) and the confirmation e-mail. At most one
coupon is active at a time; entering a new code replaces the previous one.

## Failure handling

Order placement runs in a single database transaction. If it fails — empty cart,
out-of-stock line, an ineligible/inactive method, an address that is no longer
owned, an organization that cannot transact, or a payment-gateway initiation
error — the transaction rolls back, **the cart is left unchanged**, and no Order
is created. The buyer is routed to the Failure Page with a reason-appropriate
message and a *Try again* button. A payment that is declined **after** the order
is created (e.g. a failed gateway callback) is handled on the Order via the
payment lifecycle, not by re-running checkout.
