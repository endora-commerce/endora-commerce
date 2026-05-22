---
title: organizations
---

# `organizations`

Customer Organizations — registration, email verification, member management,
invitations, and the suspension state. The first user of a registering
Organization becomes its `organization_admin`.

## Public surface

Org-Admin-only routes are enforced server-side via the
`assertOrganizationAdmin` helper. Admin routes (`/api/v1/admin/*`) are
gated by `customers:manage`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anon | Register Org + first member, email verification dispatched |
| `POST /api/v1/auth/email-verification/verify` | anon | Redeem verification token |
| `POST /api/v1/auth/customer/login` | anon | Customer login → sets `b2b_session` cookie; merges anonymous cart |
| `POST /api/v1/auth/customer/logout` | customer | Destroy session |
| `POST /api/v1/auth/password-reset/request` | anon | Always 202 (defends against account enumeration) |
| `POST /api/v1/auth/password-reset/confirm` | anon | Redeem the emailed reset token |
| `GET /api/v1/me` | customer | Current customer + their organization, plus `impersonation: { impersonatorAdminUserId }` when an admin is acting as the buyer (T194) |
| `POST /api/v1/me/password` | customer | Change password (rejects wrong `currentPassword`) |
| `POST /api/v1/me/two-factor/{enable,confirm,disable}` | customer | TOTP enrolment lifecycle |
| `GET /api/v1/organizations/mine/members` | org admin | List members |
| `DELETE /api/v1/organizations/mine/members/:id` | org admin | Remove member (last-admin guard) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | org admin | Promote / demote (last-admin guard) |
| `GET /api/v1/organizations/mine/invitations` | org admin | List pending invitations (T177) |
| `POST /api/v1/organizations/mine/invitations` | org admin | Invite a new user; emails the redemption link via the injected Mailer |
| `DELETE /api/v1/organizations/mine/invitations/:id` | org admin | Revoke a pending invitation (T177) |
| `POST /api/v1/organizations/invitations/:token/accept` | anon | Redeem invitation, mint Customer Account |
| `GET /api/v1/organizations/mine/addresses` | customer | List delivery / billing addresses |
| `POST /api/v1/organizations/mine/addresses` | customer | Create address |
| `PATCH /api/v1/organizations/mine/addresses/:id` | customer | Update |
| `DELETE /api/v1/organizations/mine/addresses/:id` | customer | Remove |
| `GET /api/v1/admin/organizations` | admin | List with `filter[status]` / `filter[vatStatus]` / `q` |
| `GET /api/v1/admin/organizations/:id` | admin | Org + member roster (`updatedAt`, members include `lastLoginAt`) |
| `PATCH /api/v1/admin/organizations/:id` | admin | Update name / `status` / `vatStatus`; optional `expectedUpdatedAt` → `409 VERSION_CONFLICT` when stale |
| `POST /api/v1/admin/organizations/:id/members/invite` | admin | Invite by email + role (platform-scope) |
| `POST /api/v1/admin/organizations/:id/members` | admin | Direct-create member with password |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | admin | Change role; optional `expectedUpdatedAt` per member |
| `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` | admin | Soft-remove member (last-admin guard) |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | admin | Break-glass — promote existing member to `organization_admin` |

Configure **`SMTP_URL`** in the backend environment so outbound mail uses SMTP instead of the console logger.

## Entities

`Organization`, `OrganizationInvitation`, `EmailVerificationToken`. Tax-ID
uniqueness is enforced at the DB level; duplicate registrations return
`409 ORGANIZATION_TAX_ID_EXISTS`.

## Events emitted

`organization.registered.v1`, `organization.verified.v1`,
`organization.suspended.v1`, `organization.member_invited.v1`,
`organization.member_role_changed.v1`.

## Extension points

- **Verification dispatch** — `email-verification-service.ts` exposes a
  pluggable mailer interface; swap the dev-mode console mailer for a real
  SMTP/SendGrid driver in production composition.
- **Last-admin guard** — codified in `role-service.ts#changeRole` and
  `invitation-service.ts#revoke`; add new "must keep at least one admin"
  call sites here.

## Feature 026 — Commercial party + moderation

Feature 026 promotes Organization to a first-class commercial party. The
spec lives at `specs/026-organizations/spec.md`. This section describes
the runtime surface; the migration ordering is documented in that spec's
`data-model.md`.

### Lifecycle status (`pending_verification` → `active` → `blocked` / `rejected`)

Every newly-registered Organization starts in `pending_verification`. The
platform-wide setting `organizations.moderation.mode` (`manual` /
`auto`) controls whether an admin must approve manually before the
Organization can transact. While the status is anything other than
`active`, the platform refuses Order placement, RFQ submission, and
cart-line addition with HTTP 423.

The legacy `suspended` status was renamed to `blocked` by migration 047
with an audit-log breadcrumb on every remapped row.

Admin endpoints:

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/approve` | Transition `pending_verification` → `active` |
| `POST /api/v1/admin/organizations/:id/reject` | Transition `pending_verification` → `rejected` (terminal) |
| `POST /api/v1/admin/organizations/:id/block` | Transition `active` → `blocked` (operator lever) |
| `POST /api/v1/admin/organizations/:id/unblock` | Transition `blocked` → `active` |

Every body carries `expectedVersion: number` (optimistic-lock token from
the `organizations.version` column) and is wrapped in
`em.transactional`. A stale `expectedVersion` returns `409
VERSION_CONFLICT` with the `currentVersion` in the body. A status guard
violation (e.g. approving an already-active org) returns `422
VALIDATION_FAILED`.

Customer-side gate: the storefront receives the localized
"why-you-can't-transact" message via `GET /api/v1/me`'s
`organization.canTransact` + `organization.moderationMessage` fields.
The cart and checkout pages render `<OrganizationModerationBanner>`
above the form when `canTransact === false`.

### Admin notifications

A small `admin_notifications` module owns the bell surface. On every
new Organization registration, `OrgRegistrationNotifier` writes one
broadcast notification (`audience='all_admins'`,
`kind='organization.registered'`) and dispatches one e-mail per entry
in the `organizations.notifications.new_registration_recipients`
setting. The bell polls every 30 s via
`GET /api/v1/admin/notifications`.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/notifications` | Paged feed, per-admin `isRead` resolution |
| `POST /api/v1/admin/notifications/:id/read` | Mark one entry read |
| `POST /api/v1/admin/notifications/mark-all-read` | Mark every visible entry read |

### Per-organization commercial scoping (US4)

Three allow-list bridges control what an Organization may use at
checkout:

- `organization_payment_methods` (pivot: `(organization_id, payment_method_id)`)
- `organization_delivery_methods` (pivot: `(organization_id, delivery_method_id)`)
- `organization_warehouses` (pivot: `(organization_id, warehouse_id)`)

**Empty list ⇒ platform defaults apply.** A non-empty list filters the
storefront `GET /api/v1/payment-methods`, `GET /api/v1/delivery-methods`,
and inventory stock-figure endpoints intersected with the caller's
Organization assignment.

Admin endpoints:

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/restrictions` | Read all three allow-lists + the org's `version` |
| `PUT /api/v1/admin/organizations/:id/restrictions` | Atomic replace of all three |
| `PATCH .../restrictions/payment-methods` | Surgical `{ add?, remove? }` |
| `PATCH .../restrictions/delivery-methods` | Same |
| `PATCH .../restrictions/warehouses` | Same |

Storefront preflight:

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/storefront/checkout/preflight` | Returns `{ canTransact, allowedPaymentMethodIds, allowedDeliveryMethodIds, assignedWarehouseIds }` or 423 when the org cannot transact |

### Applicable price lists + promotion targeting (US5)

`OrganizationEffectivePriceListsService.listApplicable(orgId)` reuses
the existing `application-rule-evaluator` from the `price_lists` module
to compute every Price List that currently applies to the Organization,
each tagged with a `reasons[]` array
(`direct_organization_match` / `customer_group_match` /
`sales_channel_inheritance` / `segment_rule_match`). Surfaced at
`GET /api/v1/admin/organizations/:id/applicable-price-lists` and
rendered as a read-only table in the admin Organization detail page.

Promotions: when a promotion targets a specific Organization
(`promotions.organization_id` is set), the platform applies the rule
only when the cart's Organization is `active`. The check is wired
through `PromotionService`'s optional `resolveOrganizationStatus`
constructor argument; composition.ts passes a raw SQL lookup.

### Sales-rep ownership (US6)

`organization_sales_rep_assignments` (pivot: `(organization_id,
admin_user_id)`) binds sales reps to organizations. When the
caller's admin role is `sales_representative`, the admin Orders list
and RFQ list are filtered to the orgs the rep owns. Platform admins
see everything.

### VAT-ID / NIP validation (US7)

Two production HTTP clients implement the `VatValidator` port:

- `ViesClient` → `POST` against the VIES REST endpoint
  (`/check-vat-number`). 5-second timeout; single abort on network
  error.
- `MinisterstwoFinansowClient` → `GET` against `wl-api.mf.gov.pl/api/search/nip/{nip}`.
  In-process 10-rps throttle; 7-day cache key on `(nip, today)` is
  baked into the service-side `OrganizationTaxIdValidation` history
  (one row per attempt).

`OrganizationTaxIdValidationService` auto-picks the provider per
tax-id prefix (Polish 10-digit → MF; other ISO-2 prefix → VIES;
anything else → format-only). When `applyAutoFill=true` AND the
result is `validated`, the org's `legalName` is updated and `version`
bumps so the next admin edit honors the optimistic-lock.

All adapters degrade safely on provider outage:
`outcome: 'deferred'`. The org save never fails because of a
third-party hiccup.

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/vat-validations` | Trigger one validation attempt (`providerHint`, `applyAutoFill`) |
| `GET /api/v1/admin/organizations/:id/vat-validations` | History list, newest first |

### Picker primitive + diacritic-insensitive search (US8)

The admin app ships a reusable `<OrganizationPicker>` (single-select)
and `<OrganizationPickerMulti>` (multi-select) on top of the existing
`<Combobox>`. They consume `GET /api/v1/admin/organizations?q=` whose
`q` parameter is diacritic-insensitive: a query of `lodz` finds
"Bauhaus Łódź" via the denormalized `name_search` column populated
by the Organization entity's `@BeforeCreate` / `@BeforeUpdate` hooks.
`normalizeOrganizationName` handles NFD decomposition + an explicit
table for precomposed Latin letters NFD doesn't split (ł/Ł, ø/Ø,
đ/Đ, ð/Ð, þ/Þ, ß, æ, œ).

### New settings (declared on the manifest)

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `organizations.moderation.mode` | `string` enum | `'manual'` | `manual` ⇒ pending_verification; `auto` ⇒ active on registration |
| `organizations.notifications.new_registration_recipients` | `json` array | `[]` | E-mail recipients for new-Organization notifications |

### Migrations

- `047_organizations_consolidation.ts` — adds `legal_name`, VAT-validation
  columns, blocked / rejected / approved audit columns, `version`
  optimistic-lock, `name_search` denormalized column, three allow-list
  bridges, the validation-history table, the `organizations_name_search_idx`
  B-Tree index, and remaps every `suspended` row to `blocked`.
- `048_admin_notifications_init.ts` — adds the `admin_notifications`
  table + the per-admin `admin_notification_reads` bridge.
- `049_customer_accounts_organization_optional.ts` — relaxes
  `customer_accounts.organization_id` to nullable so guest-style
  Customer accounts are representable (FR-010 / FR-012).
