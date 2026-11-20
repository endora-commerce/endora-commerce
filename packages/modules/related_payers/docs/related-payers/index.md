---
title: Related payers
sidebar_label: Related payers
sidebar_position: 1
description: A buyer organization places orders paid and invoiced by another organization of the store
---

# Related payers (`related_payers`)

A buyer Organization places an order and another Organization of the store pays for it. A
contractor delivering on a tender orders the goods; the investor running the tender receives the
invoice, carries the credit and sees the order. The module owns the **link** between the buyer and
its payer, the way such a link comes about (an operator, an integration, a request from the buyer
or an invitation from the payer), its settings, permissions and notifications. Orders, carts,
invoices and returns read the link through the module's ports and do the rest.

The module ships **switched off**. An installation that never turns it on behaves exactly as
before, and turning it on changes nothing on a sales channel until the channel's own switch is on.

- [Operator guide](./operator-guide.md) — the card's *Payers* section, the channel settings, the
  request queue and the payer's commercial terms.
- [Storefront guide](./storefront-guide.md) — what buyers and payers see in the store.

## Concepts

- **Buyer (X) and payer (Y).** Both are company Organizations of the store, and they are
  different Organizations. A personal (B2C) Organization can be neither.
- **Payer link.** One link connects one buyer to one payer. A pair has at most one link that is
  not revoked. A link carries:
  - **state** — `active`, `inactive` (reversible) or `revoked` (final; the pair can be linked
    again with a new link);
  - **billing addresses** — all of the payer's billing addresses, or one of them;
  - **validity** — an optional *from* and *to* instant, both ends inclusive; no ends means no time
    limit;
  - **commercial terms** — `buyer` (the default: the buyer's own prices, the payer only pays) or
    `payer` (the cart is priced on the payer's terms, see *Buying for a payer* below);
  - **payer e-mails** — whether the payer is told about orders placed and cancelled on it
    (default off);
  - **origin** — operator, automation, request or invitation, with the integration's `source` for
    automation.
- **Usable link.** A link can carry a new order only while all of these hold: the module is on
  and the channel's switch is on; the link is `active` and inside its validity window; the payer
  is approved and not blocked; and the payer has at least one live billing address the link
  allows.
- **Request.** A buyer asks a company, by its exact tax ID, to become its payer. A payer can also
  **invite** a buyer the same way. Either is decided by the other side, by an operator, or both,
  as the channel's approval mode says, and ends `active` (a link is created), `rejected`,
  `expired` or `withdrawn`.

## Switching it on

Two switches, both needed:

1. **Platform → Modules** — activate *Related payers*. This is the activation setting
   `related_payers.module_enabled` (default off).
2. **Settings → Related payers**, on each sales channel that should offer it —
   *Related payers enabled* (`related_payers.enabled`, default off).

Then give the buyers' and payers' roles the organization permissions below; none of them is
granted to members by default.

## Settings

Every setting except the activation switch and the time zone can be overridden per sales channel.

| Setting | Default | Meaning |
| --- | --- | --- |
| `related_payers.module_enabled` | `false` | The activation switch on **Platform → Modules**. |
| `related_payers.enabled` | `false` | Offers related payers on the channel: the payer choice at checkout and on the cart, and the account screens. |
| `related_payers.approval_mode` | `payer` | Who decides a request naming an Organization that has an account: `payer` (its users), `admin` (an operator) or `payer_then_admin` (its users, then an operator). |
| `related_payers.unregistered_payer_mode` | `admin` | What happens to a request naming a tax ID no Organization has: `admin` (an operator decides) or `invite` (an invitation to register goes to the contact e-mail). Read the residual risk in the operator guide before choosing `invite`. |
| `related_payers.payer_may_invite_buyers` | `true` | Lets a payer invite a buyer it agrees to pay for. |
| `related_payers.request_ttl_days` | `30` | Days a request or invitation waits for a decision before it expires (1–365). |
| `related_payers.daily_request_limit` | `10` | Requests plus invitations one Organization may send per day (1–1000). |
| `related_payers.time_zone` | `Europe/Warsaw` | The IANA time zone in which the daily limit's day starts at midnight. Read for the default store and applied to every channel; it stays a setting of this module until the platform has a store-wide time zone. |

## Permissions

**Operator permissions** (admin roles):

| Code | Allows |
| --- | --- |
| `related_payers:read` | See the card's *Payers* section and the *Payer requests* queue. |
| `related_payers:manage` | Add, change, deactivate and revoke links; decide queue entries. Also needs `customers:manage`, because creating a payer Organization creates an Organization. |

**Organization permissions** (the buyer's and the payer's own roles; none is a member default):

| Code | Label | Allows |
| --- | --- | --- |
| `related_payers.order_with_payer` | Place orders with a related payer | Choose a payer at checkout, and a payer on its own terms under *Paid by* on the cart. |
| `related_payers.view_paid_orders` | View orders we pay for | Read, without changing, the orders other Organizations placed with this one as payer, and download their invoices. Also decides who receives the payer e-mails. |
| `related_payers.manage` | Manage payers | Request payers, withdraw requests, revoke this Organization's payer links, and accept or reject invitations from payers. |
| `related_payers.approve` | Approve payer requests | Accept or reject requests to pay for another Organization, invite buyers, and revoke the links this Organization pays on. |

## What changes when an order has a payer

- **Billing follows the payer.** The billing address is one of the payer's addresses the link
  allows; the company name and tax ID on the order and the invoice are the payer's. The free-text
  billing company override at checkout cannot be combined with a payer: a request carrying both
  is refused.
- **Tax follows the payer.** VAT is computed from the payer's VAT status and its billing
  country, in the preview and at placement alike.
- **Payment methods follow the payer.** The checkout offers the payment methods the payer is
  allowed; the credit-limit method is offered when the payer's available credit covers the total,
  and the order reserves the payer's credit (or its credit owner's, when the payer shares a
  parent's pool). The buyer's credit is untouched.
- **Delivery stays the buyer's.** Delivery address and delivery methods are the buyer's own.
- **The order stays the buyer's.** It belongs to the buyer Organization and carries a *payer*
  block (Organization, name, tax ID, terms). The buyer's account shows *Paid by*; the operator's
  order detail shows the payer and the orders list can be filtered by payer.
- **The invoice and the ledger name the payer**, and the invoice is not listed under the buyer.
  A credit resolution on a return of such an order credits the payer.
- **The payer sees the order** read-only under *Orders we pay for*, without the delivery address,
  the customer note or the comments, and with its invoices. It cannot cancel, reorder, quote,
  return or comment on it. A link revoked later keeps past orders visible.

Every refusal — module or channel off, missing permission, link inactive, revoked or outside its
window, payer blocked, address outside the link — refuses the whole placement: nothing is written,
reserved or sent.

## Buying for a payer (the payer's commercial terms)

When a link is on the **payer's terms**, a buyer holding *Place orders with a related payer* can
choose that payer under *Paid by* on the cart. From then on the cart and the catalogue are priced as
the payer would be priced on the channel's price lists: listing, product page, search hits and
type-ahead, comparisons, cart lines, promotions and the order. Line VAT follows the payer's VAT
status and country. What the buyer may **see** stays the buyer's: product visibility and the
price display mode (for example *gross only*, or prices hidden) are evaluated for the buyer.

Switching shows a summary of the lines whose price changed, the lines that now have no price
(they must be removed before ordering) and the promotions added or removed. The checkout then
fixes the payer and cannot be changed there. If the link stops being usable or its terms are
switched back to the buyer's, the next cart read returns the cart to the buyer's prices with a
notice, and a placement racing that change is refused. The minimum order value is checked on the
subtotal at the payer's prices. A promotion's use is recorded against the payer.

A link on the **buyer's terms** changes no price: the payer only pays.

## Notifications

E-mails are templates of the *Transactional e-mails* screen (group *related_payers*), sent in the
store's default language; in-account entries appear in the storefront notification centre and, for
operators, in the admin bell, when those modules are present.

| Template | Sent to | When |
| --- | --- | --- |
| `related_payer_order_placed` | Payer members with *View orders we pay for* | An order is placed on the payer, if the link's payer e-mails are on. |
| `related_payer_order_cancelled` | The same | Such an order is cancelled, under the same condition. |
| `related_payer_request_received` | The payer's approvers | A buyer asks it to pay. Never the contact e-mail. |
| `related_payer_invitation_received` | The buyer's payer managers | A payer offers to pay. Never the contact e-mail. |
| `related_payer_request_decided` | The sender and its managers or approvers | A request or invitation is accepted or rejected. |
| `related_payer_request_expired` | The member who sent it | A request or invitation expires. A withdrawal tells nobody. |
| `related_payer_invitation_to_register` | The contact e-mail | A request names a tax ID with no account, under mode `invite` or when an operator chooses *Send invitation*. |
| `related_payer_link_revoked` | The other side (both, when an operator or an integration revoked) | A link is revoked. |

An operator bell entry is raised when a request enters the queue.

## For developers: the automation port

A deployment's overlay module can link payers without an operator — for example, adding a
project's investor as the payer of every contractor on the project. Resolve
`relatedPayerWritePort` with `lazyPort` and declare a non-binding dependency on `related_payers`:

```ts
const payers = lazyPort<RelatedPayerWritePort>(ctx, 'relatedPayerWritePort');

await payers.addPayer({
  buyerOrganizationId,
  payerOrganizationId,
  source: 'project_investors', // ^[a-z0-9_.-]{1,64}$, recorded as the link's origin source
  commercialTerms: 'buyer', // optional; addressScope, validFrom, validTo are optional too
});

await payers.revokePayer({ buyerOrganizationId, payerOrganizationId, source: 'project_investors' });
```

- `addPayer` is idempotent on an active link: it answers `{ created: false }` and changes nothing.
  A pair that cannot be linked (the same Organization, a personal Organization) is refused.
- `revokePayer` revokes the pair's non-revoked link and answers `{ revoked: false }` when there is
  none.
- Every call is one audited Command whose actor is `automation`, with the `source` you passed.
- While the module is off, a call through the port throws `ModuleDisabledError` (`503 MODULE_DISABLED`)
  and nothing is written.

The module also publishes `relatedPayerPolicyPort`, which `orders`, `carts` and `payment_methods`
read to ask whether a link is usable and on which terms; overlays do not normally need it.

**Hookable actions.** `related_payers.request.create`, `.request.accept`, `.request.reject`,
`.request.expire`, `.request.route` and `related_payers.link.revoke` are public, `afterCommit`
only. The module delivers its own notifications from them; an overlay may register further
after-commit handlers. **Events**: `related_payers.link.created.v1`, `.link.changed.v1`,
`.link.revoked.v1`, `related_payers.request.created.v1`, `.request.decided.v1` — identifiers only.

## Audit

Every link and request change is a Command recorded in the audit log with the changed field names
(commercial terms included) and the actor — an admin user, a customer, the system (expiry) or an
integration with its `source`. No tax ID, contact e-mail, comment, rejection reason, name or
address is written to the audit state.

## Switching it off

Deactivating the module on **Platform → Modules** is non-destructive. While it is off: every
module route answers `503 MODULE_DISABLED` (the integration port too); the checkout and the cart
offer no payer, and a cart that was bought for a payer is priced for the buyer on its next read;
the card's *Payers* section, the *Payer requests* queue, its palette action, the settings group and
the organization permissions disappear from the Admin UI; the account's *Payers* and *Orders we pay
for* screens are gone; the expiry sweep does not run. Orders already placed keep their payer data.
Reactivating restores links, requests, settings and role grants unchanged, and overdue requests
then expire.

## Without the optional modules

`invoices` absent — payers see paid orders but cannot download their invoices.
`credit_limits` absent — no credit-limit payment method is offered for a payer.
`customer_notifications` and `admin_notifications` absent — no notification-centre or bell
entries; e-mails still go out and the queue still lists every entry.
