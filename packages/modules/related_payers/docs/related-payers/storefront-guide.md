---
title: Related payers — storefront guide
sidebar_label: Storefront guide
sidebar_position: 3
description: What buyers and payers see in the store — paying with a related payer, buying on its terms, payer requests and the orders a payer pays for
---

# Related payers — storefront guide

What a company's members see in the store when the operator has switched related payers on for
the sales channel. Which of these screens a member sees depends on the permissions of their role in
their Organization; the Organization's administrator role holds them all. The module's
[overview page](./index.md) describes the rules behind them.

## For the buyer

### Choosing who pays at checkout

With *Place orders with a related payer*, the checkout shows **Paid by**: *Our organization*, or one
of the Organizations that pay for yours.

When you choose a payer:

- the billing address list shows only the payer's addresses that your link allows, and the company
  name and tax ID become read-only — the invoice is issued to the payer with its company details;
- the totals are recalculated for the payer (VAT follows the payer, so a payer abroad or exempt
  from VAT can change the gross amount) and shown as *Totals billed to the payer*;
- the payment methods are the ones the payer may use; a credit-limit method is offered when the
  payer's available credit covers the total, and it is the payer's credit that is used;
- delivery address and delivery methods stay yours.

The order is yours: it is listed in your account with *Paid by* and the payer's name.

### Ordering at a payer's prices

When your payer agreed that you order **at its prices**, a cart with products in it shows **Paid
by**: *Our organization*, or that payer. Choose the payer and apply: the cart, the product lists,
product pages and search show the payer's prices, and a summary tells you which lines changed
price, which no longer have one (remove them before ordering) and which promotions were added or
removed. The checkout then shows the payer as fixed — change it on the cart. A payer who pays at
your own prices is not listed on the cart; you choose it at checkout.

If the payer can no longer be used, or its terms change, the cart returns to your own prices and
says why.

### The *Payers* screen

**Account → Payers** shows, by permission:

- **Our payers** — the Organizations that pay for your orders, the billing addresses and validity
  of each, and whether you order at your prices or the payer's. With *Manage payers* you can
  **Revoke** a payer.
- **Ask a company to pay for our orders** (*Manage payers*) — enter the company's exact tax ID, a
  contact e-mail at that company and an optional comment. The answer is always the same: the
  request shows as *Pending* until it is accepted, rejected or expires. Your Organization can send
  a limited number of requests and invitations per day.
- **Requests we sent** — their state, the reason when one was rejected, and **Withdraw** while one
  is pending.
- **Payers offering to pay for our orders** (*Manage payers*) — invitations from payers to
  **Accept** or **Reject**.

Accepting a request or an invitation creates the link on your own prices; ordering at a payer's
prices is something the store's operator sets up.

## For the payer

### Orders we pay for

With *View orders we pay for*, **Account → Orders we pay for** lists the orders other
Organizations placed with yours as the payer: number, date, who ordered, status, payment status and
total. The
detail shows the lines, the billing data and the delivery method, and lets you download the
invoices. It does not show the buyer's delivery address, note or comments, and you cannot cancel,
reorder or return such an order — that stays with the buyer. Orders stay listed after a link is
revoked.

If the link asks for it, members with this permission also receive an e-mail when such an order is
placed or cancelled.

### Requests and invitations

**Account → Payers**, with *Approve payer requests*:

- **Requests waiting for our decision** — buyers asking your Organization to pay for their orders.
  **Accept** creates the link; **Reject** takes an optional reason the buyer sees.
- **Organizations we pay for** — your current links, each with the buyer's tax ID, and **Revoke**.
- **Invite a company we will pay for** — when the store allows it: the buyer's exact tax ID and a
  contact e-mail. The buyer's payer managers decide. **Invitations we sent** lists them, with
  **Withdraw** while pending.

You are told by e-mail and in the notification centre when a request arrives, when a request or
invitation you sent is decided or expires, and when the other side revokes a link.

## When the company has no account yet

If a request names a tax ID the store does not know, the store either decides it itself or sends
the contact e-mail an invitation to register. The invitation's link opens the registration form
with the tax ID already filled in. Once the registration is approved, the request reaches the new
company's approvers (or the store's operator) like any other request. An expired invitation fills
in nothing.
