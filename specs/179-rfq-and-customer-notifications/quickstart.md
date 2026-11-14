# Quickstart: verifying quote request notifications by hand

Prerequisites: `pnpm run build:packages`, `pnpm run setup`,
`pnpm --filter backend run cli demo seed`, `pnpm run dev`; Mailpit (or the SMTP sink of `dev:infra`)
reachable. The demo seed assigns **no** sales representative, so assign `sales-rep@demo.local` to the
demo Organization first (its *Sales representatives* tab, or
`POST /api/v1/admin/organizations/:id/sales-reps`); without one, every administrator holding
`rfqs:handle` is told instead. The customer e-mails carry a link only while the channel's *Storefront
URL* setting (`sales_channels.storefront_url`) is set: `quote_requests` does not fall back to
`STOREFRONT_BASE_URL`.

1. **Operator side.** Sign in to the storefront as a buyer and submit a quote request. Within a
   minute: the representative's admin bell shows *Quote request {number} was submitted*; the sink holds
   one operator e-mail for them and one confirmation e-mail for the buyer.
2. **Customer side.** In the admin, revise the request (save an offer). The buyer receives an
   e-mail with a link to the request; the storefront account pill shows `1`; *Account →
   Notifications* lists the entry; opening it lands on the request and the count drops to 0.
3. **Approval.** Approve the request. The e-mail has a link and no attachment.
4. **History.** Open the request's *History* in the admin: each entry lists its deliveries with
   status.
5. **Switches.** Turn off the *Quote request approved* e-mail on the e-mail templates screen and
   approve another request: History shows *Skipped — switched off* for the customer e-mail. Turn
   `customer_notifications` off on `/platform/modules`: the account pill shows no count, the page is
   gone, the next customer change records *Skipped — module off* for the centre.
6. **Push** (with push configured and a subscribed device, *Quote updates* on): an operator
   revision produces one push that opens the request.
7. **Completion.** Convert an approved quote to an order: no quote e-mail is sent.
