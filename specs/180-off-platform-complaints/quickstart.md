# Quickstart: verifying feature 180

**Feature**: `specs/180-off-platform-complaints/` | **Plan**: [plan.md](./plan.md)

Prerequisites: `pnpm run build:packages`, services up (`pnpm run dev:infra`), a database prepared
with `pnpm run setup` (or `migrate` + `module:install --all` after pulling the MR), and the dev
stack running (`pnpm run dev`). A mail catcher is the dev mail transport. The demo seed's customer
account and one administrator with `returns:write` are enough.

## phase A — notifications and the authorizer

1. **Recipients.** Admin → Settings → Returns → *New-case recipients*: add `shop@example.test` and
   `not-an-address`. Save.
2. **New case.** Storefront, signed in as the demo customer → *Account → Returns → New* → pick a
   completed order → file a complaint.
   - Mail catcher: one *new case* e-mail to `shop@example.test`, one confirmation to the customer,
     in the channel's language. The backend log names `invalid_recipient` for `not-an-address`.
   - Admin bell: one entry per admin holding `returns:read`, linking to the case, naming no
     customer.
   - Switch `admin_notifications` off on `/platform/modules`, file another case: e-mails arrive, no
     bell entry, no error.
3. **Comment.** Admin → the case → add a customer-visible comment with *Notify customer* → one
   e-mail with the comment text. Tick *Internal*: the checkbox is disabled; a direct API call with
   both flags answers 422 `notify_requires_customer_visible`.
4. **Status e-mail.** Admin → Returns → Statuses → mark *Received* as *notify the customer on entry*
   (the toggle is disabled on *Authorized* and *Rejected*). Authorize the case, then move it to
   *Received*: one *authorized* e-mail, then one *status entered* e-mail naming *Received*. No e-mail
   for cases already in *Received*.
5. **Authorizer.** The case detail shows *Authorized by <you>* and the time; the list's *Authorized
   by* column shows it; the CSV export carries it. Bulk-transition a second `new` case into
   *Authorized*: it gets an RMA number, the time, the authorizer and the *authorized* e-mail.
6. **Backfill.** On a database with cases authorized before the migration, those cases show the
   authorizer named by the audit log, or *unknown*.

Targeted tests:

```bash
pnpm --filter @endora-commerce/mod-returns run test        # the module's co-located tests
pnpm --filter backend exec vitest run test/integration/returns/notifications.test.ts test/integration/returns/authorize-rma.test.ts
pnpm --filter backend exec vitest run test/integration/returns/off-state.test.ts
```

## phase B — the complaint without a platform order

1. **Off by default.** Storefront → *Returns → New*: no *not bought here* option; a direct
   `POST /api/v1/returns` with `orderId: null` answers 403 `RETURN_OFF_PLATFORM_DISABLED`.
2. **Enable.** Admin → Settings → Returns: *Complaints without a platform order* on, *Proof of
   purchase required* on (both for the channel). Admin → Returns → Clauses: add one clause in
   English and Polish.
3. **File one.** Storefront → *New complaint → not bought on this platform*: one catalog product
   picked, one free-text model with a serial number, purchase date, contact and ship-back address
   prefilled from the account (edit the phone), one photo and one PDF typed *proof of purchase*,
   accept the clause, submit.
   - Repeat without the proof: refused `RETURN_PROOF_OF_PURCHASE_REQUIRED`, typed answers kept.
   - With JavaScript off: the same form posts and redirects; files are re-chosen after a refusal.
   - Double-submit: one case.
4. **Admin.** Returns list → filter *Off-platform*: the case, marked; a case against an
   ERP-imported order is not listed. Detail: purchase data, contact, ship-back address,
   attachments (open the PDF), accepted clause text and time. Edit the clause text: the case still
   shows the original.
5. **Settle.** Settlement offers *Repair*, *Replacement*, *Settled outside the platform*; the last
   without a note is refused; with a note it settles, no refund row, the note on the case. A direct
   API `refund` is refused `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.
6. **Privacy.** Open an attachment URL as another customer and signed out: 404 both.
7. **Erasure.** Anonymise the customer (admin → customer → anonymise, or the retention sweep):
   the case keeps its lines and purchase data; contact, address and attachments are gone; the
   audit entry carries counts only.

Targeted tests:

```bash
pnpm --filter backend exec vitest run test/integration/returns/off-platform-*.test.ts test/integration/returns/attachments-*.test.ts
pnpm --filter backend exec vitest run test/contract/returns
pnpm --filter storefront exec vitest run test/account/returns-off-platform.test.tsx test/account/returns-submit-route.test.ts
pnpm --filter '!backend' run test   # the packages, contracts included
```
