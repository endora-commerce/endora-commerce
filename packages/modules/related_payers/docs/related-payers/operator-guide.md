---
title: Related payers — operator guide
sidebar_label: Operator guide
sidebar_position: 2
description: Linking payers on the organization card, the channel settings, the payer request queue and the payer's commercial terms
---

# Related payers — operator guide

This page is for the store's operators. What the module is and what an order with a payer looks
like are on the module's [overview page](./index.md).

## Before you start

1. **Platform → Modules** — activate *Related payers*.
2. **Settings → Related payers** — switch *Related payers enabled* on for each sales channel that
   should offer it, and review the other settings (below).
3. Give the customers' roles the organization permissions they need — *Place orders with a related
   payer* for buyers who order, *View orders we pay for* for the payer's accountants, *Manage
   payers* and *Approve payer requests* for whoever handles requests on each side. None is granted
   to members by default.
4. Your own admin role needs **View related payers** to see the section and the queue, and
   **Manage related payers** (together with the customer management permission) to change them.

## The *Payers* section of the organization card

Open an Organization's card. The *Payers* section lists two things:

- **Pay for this organization** — the links in which this Organization is the buyer;
- **This organization pays for** — the links in which it is the payer.

Each link shows the payer (and its tax ID), its state, the billing addresses it allows, its
validity, its commercial terms, how it was created and whether the payer gets order e-mails. The section saves every change **at once**
and is not part of the card's *Save* button, which its heading marks.

What you can do there, with **Manage related payers**:

- **Add payer** — pick an existing company Organization. Choose the billing address the link allows
  (all of the payer's billing addresses, or one of them), the commercial terms, optionally the
  validity dates, and whether to e-mail the payer about orders; the link is created active.
- **Create payer organization** — when the payer has no account yet. Enter its tax ID and use
  **Look up in the registry** to fill in the company data, check it, choose the sales channel, and
  optionally give an e-mail to invite its first user through the usual member invitation. The
  Organization is created **approved** and the link is active at once. A new Organization has no
  billing address yet, so its link allows all of them; limit it later with **Change billing
  address**.
- **Commercial terms** — switch a link between *Buyer's terms* and *Payer's terms*.
- **Change billing address** — limit the link to one of the payer's billing addresses, or allow all
  of them again. The list offers the payer's billing addresses only; an order with this payer can
  then be billed to that address alone.
- **E-mail the payer about orders placed and cancelled** — the switch on each link, also offered
  when adding or creating a payer: when on, the payer is told by e-mail about every order placed
  on it and every such order cancelled. It is off unless you switch it on.
- **Change validity** — set or clear the *Valid from* and *Valid to* dates. They are taken as the
  start of the first day and the end of the last day in your browser's time zone.
- **Deactivate** / **Activate** — stop or resume a link without losing it.
- **Revoke** — end a link for good. Orders already placed keep their payer; the pair can be linked
  again later with a new link.

A refused change says why: the two Organizations are the same, one of them is a personal
Organization, or the pair already has a link that is not revoked.

## Channel settings

**Settings → Related payers**, with an override per sales channel:

- **Related payers enabled** — offers the payer choice at checkout and on the cart and the account
  screens on this channel.
- **Approval of payer requests** — who decides a request naming an Organization that has an
  account:
  - *The payer's users decide* (`payer`, default) — its members holding *Approve payer requests*;
  - *An operator decides* (`admin`) — the request goes to your queue;
  - *The payer's users, then an operator* (`payer_then_admin`) — both, in that order.

  If the payer has nobody who can approve, the request comes to your queue instead.
- **Payer without an account** — what happens to a request naming a tax ID no Organization has:
  - *An operator decides* (`admin`, default) — the request comes to your queue, where you can
    create the Organization, send an invitation or reject;
  - *Invite the payer to register* (`invite`) — the contact e-mail the sender typed receives an
    invitation to register with the tax ID filled in. The request attaches to the new Organization
    once its registration is approved, and then follows the approval mode. Nothing is created from
    the invitation itself.
- **Payers may invite buyers** — lets payers offer to pay for a buyer. Switching it off hides the
  invitation form; invitations already sent can still be withdrawn.
- **Request lifetime (days)** — 1 to 365, default 30.
- **Requests per organization per day** — 1 to 1000, default 10, requests and invitations together.
- **Time zone of the daily request limit** — the day of that limit starts at midnight in this time
  zone (default `Europe/Warsaw`). It is read for the default store and applies to every channel.

### Residual risk of the `invite` mode {#residual-risk-of-the-invite-mode}

The reply a sender gets is the same whatever the tax ID matched, so a buyer cannot use requests to
find out which companies have an account in your store. The `invite` mode has one accepted
exception: a sender who types **their own** e-mail address as the contact receives the invitation
to register, and so learns that the tax ID has no account. Under the default `admin` mode nothing
is sent to the contact e-mail and the question stays unanswered. Choose `invite` only where that
disclosure is acceptable.

## The payer request queue

**Customers → Payer requests** (also under ⌘K / CTRL+K, *Payer requests*) lists the requests that
wait for an operator, oldest first, with the reason each one waits. Filter it by state (*Pending*
unless you choose another) and by reason; *Clear all filters* goes back to what waits. Long queues
are paged under the list.

| Reason | What to do |
| --- | --- |
| Operator approval required | The channel's approval mode is `admin`. Approve or reject. |
| Accepted by the payer, waits for the operator | Second step of `payer_then_admin`. Approve or reject. |
| Nobody at the payer can approve | The payer has no active member who may approve. Approve or reject. |
| No organization has this tax ID | Mode `admin` and no account. Create the Organization, send an invitation or reject. |
| Several organizations have this tax ID | Assign the right Organization, or reject. |
| The organization cannot be a payer | The match is not an approved company Organization, or already pays for the sender. Reject, or fix the Organization first. |

Actions — **Approve** is the button on the row; the others are in the row's ⋮ menu, with
**Reject** last. The result of each is shown above the list:

- **Approve** — creates the link, active, on the buyer's terms. A request without a matched
  Organization has no *Approve* until it gets one.
- **Reject** — the reason you write is shown to the buyer on its *Payers* screen.
- **Assign organization** — offered when Organizations with the request's tax ID exist (an
  ambiguous tax ID, or one that registered after the request). The request then goes to that
  Organization's approvers, or stays with you, as the approval mode it was sent under says.
- **Create organization** — creates the Organization with the request's tax ID, approved, and the
  link at once. The tax ID cannot be changed here: an Organization with another tax ID is refused.
  Needs the customer management permission as well.
- **Send invitation** — e-mails the contact an invitation to register with the tax ID filled in;
  the request waits for that registration.

You get a notification in the admin bell when a request enters the queue. Requests that nobody
decides expire after the channel's lifetime and tell their sender.

## The payer's commercial terms

A link on **Payer's terms** lets the buyer choose that payer under *Paid by* on the cart; the cart and
the catalogue are then priced as the payer is priced on the channel's price lists, and VAT follows
the payer. Use it when the payer has negotiated prices the buyer should order at — for example an
investor with its own price list ordering through its contractors. Only price lists bound to the
channel apply. What the buyer may see (products, the price display mode) stays the buyer's.

A request, an invitation or a link created from the queue always starts on the **buyer's terms**:
only an operator or an integration sets the payer's terms. Switching a link back to the buyer's
terms returns every cart bought for that payer to the buyer's prices on its next read.

## Orders, invoices and returns

- The order detail shows **Payer** with its terms in the billing card, and the orders list has a
  *Payer* filter under *More filters*.
- The invoice is issued to the payer and appears under the payer, not the buyer; the invoice list's
  *Billed organization* filter finds it under the payer.
- A credit resolution on a return of such an order credits the payer.

## Revoking

An operator, either side of the link, or an integration can revoke a link. The other side is told
by e-mail and in the account (both sides when you or an integration revoked). New orders on the
link are refused at once; orders already placed keep their payer, their invoices and the credit
they reserved.
