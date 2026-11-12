# Quickstart: verifying quote request notifications by hand

Prerequisites: `pnpm run build:packages`, `pnpm run setup`, `pnpm run dev`; Mailpit (or the SMTP
sink of `dev:infra`) reachable; the demo seed's Organization with an assigned sales representative.

1. **Operator side.** Sign in to the storefront as a buyer and submit a quote request. Within a
   minute: the representative's admin bell shows *Quote request QR-… was submitted*; the sink holds
   one operator e-mail for them and one confirmation e-mail for the buyer.
2. **Customer side.** In the admin, revise the request (save an offer). The buyer receives an
   e-mail with a link to the request; the storefront account pill shows `1`; *Account →
   Notifications* lists the entry; opening it lands on the request and the count drops to 0.
3. **Approval.** Approve the request. The e-mail has a link and no attachment.
4. **History.** Open the request's *History* in the admin: each entry lists its deliveries with
   status.
5. **Switches.** Turn off the *Quote request approved* e-mail on the e-mail templates screen and
   approve another request: History shows *Skipped — e-mail switched off*. Turn
   `customer_notifications` off on `/platform/modules`: the account pill shows no count, the page is
   gone, the next customer change records *Skipped — module off* for the centre.
6. **Push** (with push configured and a subscribed device, *Quote updates* on): an operator
   revision produces one push that opens the request.
7. **Completion.** Convert an approved quote to an order: no quote e-mail is sent.
