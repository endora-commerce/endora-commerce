# Quickstart: Related payers

A walk-through to verify the feature by hand on a local stack, and the commands that prove it in
tests. Assumes `pnpm run build:packages` has run and the dev stack is up (`pnpm run dev`).

## 1. Turn it on

1. Admin → **Platform → Modules**: activate *Related payers* (default off).
2. Admin → **Settings → Related payers**: on the channel you test, set *Enabled* = on. Leave the
   other settings at their defaults (`payer`, `admin`, invite buyers on, 30 days, 10 per day).
3. Admin → **Organization roles** of the buyer's Organization: grant *Place orders with a related
   payer* and *Manage payers* to the role you sign in with (the Administrator role has them already).

## 2. Operator link (US1)

1. Open buyer X's Organization card → **Payers** section → *Add payer* → pick Y, all addresses.
2. Expect the link listed *active*, with *buyer's* terms; audit log shows
   `related_payers.link.create` by your admin user.

## 3. Order with a payer (US2, US3)

1. Sign in on the storefront as an X user; add products; go to checkout.
2. *Paid by* → Y; choose one of Y's billing addresses. Company name and tax ID become read-only.
3. If Y is VAT-exempt, totals change. Place the order (with a credit-limit payment method, Y's
   available credit drops; X's does not).
4. Sign in as a Y user holding *View orders we pay for* → **Account → Orders we pay for**: the order
   is there, read-only, with its invoice once issued.
5. Admin → order detail shows *Paid by Y*; the invoice lists Y as buyer.

## 4. Payer's commercial terms (US9)

1. On X's card set the link's terms to *payer's*. Give Y a buyer price book on the channel.
2. As the X user, on a cart with products choose *Paid by: Y* (RP-22). Expect a change summary;
   browse the listing and a product page — Y's prices; search the same. Checkout shows Y fixed as
   payer.
3. Revoke the link on X's card; reload the cart: it is back on X's prices with a notice.

## 5. Requests (US4–US7)

1. As an X payer manager: **Account → Payers → Request a payer** with Y's exact NIP and an e-mail.
   Repeat with an unknown NIP. Both answers are identical; both show *pending*.
2. As a Y approver: accept the first in **Account → Payers → Requests to pay**. X is notified.
3. The unknown one is in Admin → **Payer requests** (mode `admin`); choose *Send invitation* or
   *Reject* with a reason and see X's view change.

## 6. Switch it off

Deactivate the module: checkout and cart show no payer, a cart that was in Y's context is priced for
X again, the card section, queue, settings group and palette action disappear. Reactivate: all links
and requests are back.

## Tests

```bash
pnpm run build:packages
pnpm --filter backend exec vitest run packages/modules/related_payers   # fast, co-located
pnpm --filter backend exec vitest run test/integration/related_payers   # needs dev:infra:test
pnpm --filter backend exec vitest run test/integration/carts/cart-read-equals-placement.test.ts \
  test/integration/price_lists/price-surface-identity.test.ts \
  test/integration/price_lists/pricing-surfaces-agree.test.ts
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts
```
