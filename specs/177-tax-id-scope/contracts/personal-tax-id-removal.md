# Contract: personal organizations without a tax ID (breaking)

Normative for FR-001 … FR-007, FR-053. Owner of the change: `organizations` and
`@endora-commerce/contracts`; every other row below is a reader the owning module adapts.

## 1. Type changes (`@endora-commerce/contracts`)

| Symbol | Before | After |
| --- | --- | --- |
| `organizationSchema.taxId` (`organizations.ts` l. 86) | `z.string()` | `z.string().nullable()` |
| `OrganizationRecord.taxId` (l. 491) | `string` | `string \| null` |
| `OrganizationRecord.convertedToCompanyAt` | — | `Date \| null` |
| `organizationCompanyTaxId(o)` (l. 575) | `o.taxId: string` | `o.taxId: string \| null`; same answers |
| `PersonalOrganizationProvisionInput` / `provisionPersonalOrganization` doc (l. 749, `organizations/src/ports/index.ts` l. 32, 55) | "idempotent by `taxId`" | "idempotent by the account link" — doc only |

Changeset (`minor` — `0.x`, D-225), both `@endora-commerce/contracts` and
`@endora-commerce/organizations`, with a **Breaking:** paragraph:

> **Breaking: an organization's `taxId` is `string | null`.** A personal (B2C) organization has no tax
> ID; it used to carry a 32-character placeholder derived from its account id. Was
> `organization.taxId.trim()`; now `organization.taxId?.trim() ?? ''`, or better
> `organizationCompanyTaxId(organization)`, which already answered `null` for a personal organization.
> Orders, invoices and quote documents written before the upgrade are not rewritten.

The PR carries the GitHub label `breaking change`.

## 2. Behaviour

- Provisioning (`PersonalOrganizationService.provisionFor`, l. 181–233): find by
  `{ personalAccountId: input.customerAccountId }`, create with `taxId: null`,
  `personalAccountId: input.customerAccountId`. `personalTaxId()` (l. 458) is deleted.
- `provisionPersonalOrganizationFor` / `ensureForCustomerAccountId`: unchanged contract, new key.
- A conversion (`convert-to-company.md`) sets `personalAccountId = null`.
- VAT validation of an organization with `taxId = null` → `422 VALIDATION_FAILED`, message
  "This organization has no tax ID.", before any provider call.

## 3. Reader inventory — every reader of `Organization.taxId`, and what it does with `null`

Derived on `origin/master` 2cc56ea9b by `grep -E "\btaxId\b|tax_id\b|organizationCompanyTaxId|personalTaxId"`
over `packages/modules/*/src`, `packages/contracts/src`, `storefront/{app,components,lib}`,
`admin/src`, `packages/admin-*` and `backend/src`, excluding tests, migrations and bundles; rows that
read a different `taxId` (an order snapshot, the seller's, a tax rule's id, a submitted input) are in
§3.3. **Every §3.1 and §3.2 row has a task in `tasks.md`.**

### 3.1 Inside `organizations`

| # | Reader | File (line) | With `null` | Task |
| --- | --- | --- | --- | --- |
| O1 | Entity | `entities/organization.entity.ts` l. 79–81 | `nullable`, `@Unique()` removed | T010 |
| O2 | Personal provisioning, idempotency | `services/personal-organization-service.ts` l. 173–233, 458 | keyed by `personalAccountId` | T011, T012 |
| O3 | Registration pre-check + 409 | `services/registration-service.ts` l. 152, 185–196 | `resolveByTaxId` + `taxIdConflictOf` | T039 (Phase A), T071 (Phase R) |
| O4 | Admin create pre-check + 409 | `commands/create-organization.command.ts` l. 44, 68–79 | `resolveByTaxId` + `taxIdConflictOf`; `parentId` | T035 |
| O5 | Demo seed / reset | `demo/seed.ts` l. 38, `demo/reset.ts` l. 49, 60 | seed finds with `findByTaxId(...)[0]`; reset deletes **by the found id**, never `nativeDelete({ taxId })` (would take branches in `per-tree-root`) | T026 |
| O6 | Admin list `q` ILIKE | `routes.admin.ts` l. 281 | null never matches; unchanged | T015 (test only) |
| O7 | Admin serializer | `routes.admin.ts` l. 1182 | `null` | T016 |
| O8 | Customer `/me` serializer | `routes.customer.ts` l. 255 | `null` for personal | T016 |
| O9 | Public serializer | `routes.public.ts` l. 342, 352 | type `string \| null` | T016 |
| O10 | Details port record | `services/organization-details-port.ts` l. 70 | passes `null` | T016 |
| O11 | Admin search service + provider | `services/organization-admin-search.service.ts` l. 45–90; `admin-search-provider.ts` l. 12, 34, 74 | already `?? null`; personal excluded from the subtitle | T015 (test), T016 |
| O12 | VAT validation | `services/organization-tax-id-validation-service.ts` l. 84–104; `routes.admin.ts` l. 736 | refuse 422 | T017, T018 |
| O13 | Registration notifier / e-mail | `services/org-registration-notifier.ts` l. 138–149; `email-templates/transactional-defaults.ts` | company only (registration); type widened | T016 |
| O14 | Admin list / detail screens | `admin/pages/OrganizationsList.tsx` l. 12, 121; `OrganizationDetail.tsx` l. 42, 361 | type `string \| null`; render nothing when null; VAT panel hidden for personal | T019, T020 |
| O15 | Admin create screen | `admin/pages/OrganizationCreate.tsx` | input unchanged; gains optional parent picker (scope work) | T044 |
| O16 | Registry lookup (feature 173) | `registry-lookup/*` | reads the **submitted** tax ID; unaffected | — (verified) |

### 3.2 Outside `organizations`

| # | Reader | File (line) | With `null` | Task |
| --- | --- | --- | --- | --- |
| X1 | Order billing snapshot | `orders/src/backend/services/order-service.ts` l. 477–487 | `organizationCompanyTaxId` → `null` → no `taxId` key; unchanged behaviour, type widened | T021 |
| X2 | Admin order organization panel | `orders/src/backend/routes.ts` l. 1234; `orders/src/admin/pages/OrderDetail.tsx` l. 62, 69, 629 | already nullable | T021 |
| X3 | Quote request PDF parties | `quote_requests/src/backend/document/data-builder.ts` l. 228 | already `organizationCompanyTaxId` | T022 |
| X4 | Admin RFQ organization panel | `quote_requests/src/backend/services/rfq-admin-service.ts` l. 408; `admin/pages/RfqDetail.tsx` l. 132, 621 | already nullable | T022 |
| X5 | Price-book target pickers | `price_lists/src/backend/routes.price-books.ts` l. 259, 271; admin `MemberPicker.tsx` l. 46, `PriceBooksPage.tsx` l. 501, `PriceExplainerPage.tsx` l. 361, `DisplayModeOverridesPage.tsx` l. 30, 150, 548 | already nullable | T023 |
| X6 | Push-audience picker | `pwa/src/backend/routes.admin.ts` l. 368; `pwa/src/admin/components/PushAudienceRuleBuilder.tsx` l. 549–556 | already nullable; delete the #767 placeholder comment | T023 |
| X7 | Promotion rule targets | `backend/src/composition.ts` l. 729–736 (raw `select tax_id`), `promotions/src/backend/routes.ts` l. 26 | personal rows now `null` instead of the placeholder — a fix | T024 |
| X8 | Storefront checkout prefill | `storefront/app/(commerce)/checkout/page.tsx` l. 277 | already `organizationCompanyTaxId` | T025 |
| X9 | Storefront account organization page | `storefront/app/(account)/organization/page.tsx` l. 38–39; `storefront/lib/api/account.ts` l. 38 | type `string \| null`; row hidden when null | T025 |
| X10 | Customer-accounts standalone create (doc) | `customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts` l. 158–170 | comment: the link, not the tax ID, makes provisioning re-runnable | T012 |
| X12 | Demo composition package | `packages/demo-composition/src/composition.ts` l. 166, 1083, 1237, 1288, 1588; `sales-pipeline.ts` l. 151, 721 | `findOne({ taxId })` → `findByTaxId(...)[0]` (D-290 / OD-12) | T026a |
| X11 | Returns consumer withdrawal | `returns/src/backend/services/return-case-service.ts` l. 420–440 | not a tax-ID reader; reacts to conversion (`convert-to-company.md` §6) | T059, T060 |

### 3.3 Verified not readers of `Organization.taxId`

`invoices` (`invoice-service.ts` l. 310 reads `order.billingAddress.taxId`; `seller-settings.ts` is the
seller's), `orders` `order-list-service.ts` l. 307–330 and `order-confirmation.ts` (the snapshot),
`taxes` (`taxId` = tax-rule id), `customers/routes.admin.ts` l. 501 (a submitted NIP),
`settings/SellerCompanyDataInput.tsx`, `storefront/components/Header.tsx` l. 108 (demo constant),
`storefront` registration (`register/actions.ts`, `RegisterForm.tsx`, `register-form-state.ts` —
submitted input), `import_export` adapters, `erp_connector`, `pim_connector`, `search`, `webhooks`
(no match), `backend/src/apps/example/.../delivery-processor.ts` (an invoice copy's buyer).

## 4. Not rewritten (FR-007)

`orders.billing_address->>'taxId'`, invoice copies, quote documents and `audit_log_entries` keep
whatever they hold. The upgrade note gives the read-only query
`select id from orders where billing_address->>'taxId' ~ '^[0-9a-f]{32}$'` for an operator who wants to
review orders placed before #767.
