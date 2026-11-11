# Quickstart — verifying feature 175 by hand

Prerequisites: `pnpm run build:packages`, `pnpm run dev:infra`, `pnpm run setup` (runs the new
`custom_fields` migration), `pnpm run dev`. Admin at `http://localhost:5173`, storefront at
`http://localhost:3000`.

## 1. Buyer input at registration (US1 – US3)

1. Admin → **Custom fields** (⌘K "custom fields") → entity type *Organization* → new field
   `acquisition_source`, type *Select*, options `trade_fair` / `web`, audience *Customer*, required,
   tick **Collect from the buyer at registration**. Save.
2. Entity type *Customer* → new field `phone`, *Text*, audience *Customer*, tick the same option.
3. Try `audience = Internal` on `phone` → refused with "must be visible to customers".
4. Storefront → `/register` (also with JavaScript disabled). Both fields render in the company and
   personal sections; switch the language to Polish and see Polish labels where defined.
5. Submit without `acquisition_source` → the error appears beside it, everything but the password is
   kept, the URL holds no typed value. Fill it in, register.
6. Admin → the new Organization shows `acquisition_source`; its member shows `phone`.
7. Direct API refusals (expect 422 and **no** Organization created):

   ```bash
   curl -s -X POST localhost:3001/api/v1/organizations/register -H 'content-type: application/json' \
     -d '{"organization":{"name":"X","taxId":"PL5260250274","registeredAddress":{"street":"a","city":"b","postalCode":"00-001","country":"PL"},"customFieldValues":{"internal_flag":true}},"firstUser":{"email":"x@example.com","password":"correct-horse-battery","firstName":"A","lastName":"B"},"acceptedTermsVersion":"1"}'
   ```

   → `details[0] = { field: "organization.internal_flag", code: "not_open_for_input" }`.

## 2. Admin parity (US4)

1. Define a required text field on *Category*, *Order* and *Quote request*.
2. Create a category, an order on behalf, a quote request on behalf and an Organization from their
   admin create screens: each shows the field; without it the create is refused and nothing is created;
   with it the record is created with the value and the audit entry shows it.
3. `pnpm --filter backend run check:custom-field-writes` → exit 0, read line printed, two exemptions
   listed (`product`, member invitation).
4. Red proof: delete `customFieldValues` from `adminCreateOrderRequestSchema`, `pnpm run build:packages`,
   re-run → `create-without-values` naming `POST /api/v1/admin/orders`. Revert.

## 3. Admin access (US5)

1. Mark an Organization field `erp_code` **Read-only** and `sync_checksum` **Hidden**. Try ticking
   *Required* on either → refused.
2. Write both through the API with an admin token (`PATCH /api/v1/admin/organizations/:id`) → accepted.
3. Open the Organization: `erp_code` shown without an input, `sync_checksum` absent.
4. In another tab change `erp_code` through the API; back in the first tab edit another field and save
   → `erp_code` keeps the API's value.
5. The Custom fields screen still lists both with their badges.

## 4. Anonymisation (US6)

Register with `phone`, then anonymise the account (retention sweep or the test hook) → the account's
`customFieldValues` is `{}`; the audit entry and the `customer_account.anonymized.v1` event carry no
phone.

## 5. Targeted automated runs

```bash
pnpm --filter @endora-commerce/mod-custom-fields exec vitest run   # co-located unit tests
pnpm --filter backend exec vitest run test/contract/custom_fields test/contract/organizations/register-custom-fields.contract.test.ts
pnpm --filter backend exec vitest run test/unit/scripts/check-custom-field-writes.test.ts
pnpm --filter admin exec vitest run test/kit/kit-custom-field-values.test.tsx
pnpm --filter storefront exec vitest run test/register-custom-fields.test.tsx
```
