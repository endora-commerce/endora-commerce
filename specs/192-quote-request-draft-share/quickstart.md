# Quickstart: walking through drafts and sharing by hand

Local stack (`pnpm run dev:infra`, `pnpm run setup`, `pnpm run dev`), an admin with `rfqs:handle`,
an Organization with two members (one holds the *Administrator* role) and a roll-up head-office
login above it.

1. **Create a draft.** Admin → Quote requests → *New*. Pick the customer, add one product twice
   at two prices, leave validity as prefilled, *Save as draft*. Expect: detail shows the *Draft*
   badge, validity reads "N days, counted from sharing", no date. Mailbox (Mailpit): nothing.
2. **Customer cannot see it.** Sign in as the customer, as the Organization *Administrator*, and
   as the roll-up user: the list does not contain it; `GET /api/v1/quote-requests/<id>` → 404;
   `POST /api/v1/cart/from-quote-request/<id>` → 404.
3. **Edit while draft.** Change a price, add a group, cancel nothing. History shows each edit;
   still no e-mail. Remove a price from one line and save.
4. **Refusals.** *Share with customer* → refused, the unpriced line is named. Price it. On a second
   draft, block its customer in Customers → share → refused ("account blocked"); unblock. Move
   a customer to another Organization → refused with the not-a-member message.
5. **Share.** *Share with customer* → confirm. Expect: badge gone, validity shows the date
   (share moment + N days), History has *Shared by … at …* with three deliveries, Mailpit has
   one "quote prepared" e-mail. Customer now sees the quote with two lines at their own prices
   and can accept or reject. Its history starts at "Shared"; the admin History still shows the
   drafting edits.
6. **Twice.** Open the same quote in two tabs, press *Share* in the second after the first: the
   second tab reports it is already shared; still one e-mail.
7. **Create and share.** New quote → *Create and share*: lands on a shared quote. With a line the
   channel does not sell, nothing is shared: the draft is kept and the warnings are shown. Leave
   one price empty: *Save as draft* works, *Create and share* is disabled.
8. **Default validity.** Settings → Quote requests → *Default validity of operator quotes (days)* = 30. New quote
   shows 30 prefilled; clear the field → shared quote has no date.
9. **Expiry sweep.** Set `expiry_days` to 1, backdate a draft's events, run the sweep: the draft
   stays `Created from admin`.
10. **Module off.** Switch Quote requests off: share and create-defaults answer as never
    installed.
