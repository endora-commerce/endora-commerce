# Quickstart: verifying feature 181

**Feature**: `specs/181-guest-complaints/` | **Plan**: [plan.md](./plan.md)

## Prerequisites

- `pnpm run build:packages` has been run.
- Services are up (`pnpm run dev:infra`) and the database is prepared with `pnpm run setup`, or
  with `migrate` + `module:install --all` after pulling the MR.
- The dev stack is running (`pnpm run dev`), with a mail catcher as the mail transport.
- You have one unrestricted administrator, one sales representative (an `excluding` scope), and one
  storefront customer account.

## Preflight: legacy null-organization cases (research R-2)

```sql
select count(*) filter (where organization_id is null) as no_org, count(*) as total from return_cases;
```

Note the number. The migration does not depend on it: guest is derived from the account, and no
existing row lacks one. A non-zero count is 180's residual, not this feature's.

## 1. Off by default

1. Signed out, open `/returns/new?origin=elsewhere`. You are redirected to `/login?next=…`, as today.
2. `GET /api/v1/returns/guest/availability` answers `{ enabled: false }`.

## 2. Enable

Admin → Settings → Returns:

1. Turn on *Complaints from guests* for the channel. The storefront is still unchanged, because 180's
   setting is off (FR-001).
2. Turn on *Complaints without a platform order* as well.
3. Optionally turn on *Proof of purchase required*.

## 3. Verify an address

1. Signed out, open `/returns/new?origin=elsewhere`. You land on `/returns/guest` with *Sign in* and
   *Continue without an account*. *Sign in* returns you to the same address with its query.
2. Enter `guest@example.test`, then repeat with the demo customer's address. Both show the same
   *link on its way* page. In the mail catcher:
   - two verification e-mails arrive;
   - only the customer's address carries the *you have an account* sentence.
3. Request four links for one address within an hour. The page looks the same each time, and the
   fourth sends nothing.
4. Open the link. A *Continue* page appears, and nothing is redeemed by the GET. Click *Continue* to
   reach the form: the e-mail is locked and nothing is prefilled.
   - Open the link again in another browser: *this link no longer works*.
   - Open it again in the same browser: you continue to the form.

## 4. File a guest complaint

1. Fill in one catalogue product and one typed model, each with a photo, plus a purchase date, a
   proof-of-purchase PDF, name, phone and address. Accept the clauses and submit.
   - The success page shows the reference and the tracking link.
   - In the mail catcher: one guest confirmation with the same link, and one *new case* e-mail
     naming *"{name} (guest)"*.
2. Deactivate `return_submitted` under Transactional e-mails and file another case. The guest
   confirmation still arrives (FR-045).
3. Double-click submit. Exactly one case is filed.
4. Without JavaScript the same flow posts and redirects.

## 5. Admin

1. As the unrestricted admin, open the Returns list and filter *Bought elsewhere – guest*. The case
   is marked *Guest*. Search the list by `guest@example.test` to find it. The bell has an entry.
2. As the sales representative, the case is absent from the list, the search and the export. Its URL
   answers not found. There is no bell entry.
3. On the case:
   - post a customer-visible comment with *Notify customer*: one guest e-mail carries the same
     tracking link;
   - authorize: the guest receives the authorized e-mail with the link;
   - *Send a new tracking link*: a new link arrives, and the old one shows the neutral page.
4. Settlement offers only *Repair*, *Replacement* and *Settled outside the platform*.

## 6. Tracking link

1. In a fresh browser, open the link. You see the status, products, contact data, customer-visible
   comments and files. No internal comment is shown, and the response carries `Referrer-Policy:
   no-referrer`.
2. Add a comment and a photo. Both appear on the admin case, labelled *Guest*.
3. Close the case (enter a terminal status). The page becomes read-only.

## 7. Erasure

1. Set *Guest data retention* to `10`. It is read as 30 (clamped).
2. Close a guest case. Set its `closed_at` back 31 days in the database and run the maintenance
   sweep. The case keeps its lines, comments and resolution; its contact data, address and files
   are gone; the erasure date is shown. The tracking link shows the neutral page. The audit entry
   has counts and field names only.
3. With an admin holding `returns:erase_personal_data`, erase an **open** guest case. After that,
   no e-mail can be sent to the guest about it.
4. Anonymise the demo customer. A guest case carrying the same e-mail address is untouched.

## 8. Off state

1. Switch `returns` off on `/platform/modules`. Every `/returns/guest/*` and `/returns/track/*` page
   is not found, the API routes answer the platform's 503 `MODULE_DISABLED`, and no verification e-mail is sent.
2. Switch it back on. The tracking links from step 6 work again.

## Targeted tests

```bash
pnpm --filter @endora-commerce/mod-returns run test
pnpm --filter backend exec vitest run test/integration/returns/guest-*.test.ts
pnpm --filter backend exec vitest run test/integration/returns/off-state.test.ts test/integration/returns/list-and-bulk.test.ts test/integration/returns/erasure.test.ts test/integration/returns/audit.test.ts
pnpm --filter backend exec vitest run test/contract/returns test/contract/admin_users/permission-inventory.test.ts
pnpm --filter storefront exec vitest run test/returns-guest
pnpm --filter '!backend' run test
```
