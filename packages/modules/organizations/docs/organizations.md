---
title: organizations
description: Customer Organizations, registration, invitations
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
| `POST /api/v1/auth/password-reset/confirm` | anon | Redeem the emailed reset token. A redeemed token signs the account out of **every** session, retires its other outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `GET /api/v1/me` | customer | Current customer + their organization, plus `impersonation: { impersonatorAdminUserId }` when an admin is acting as the buyer |
| `POST /api/v1/me/password` | customer | Change password (rejects wrong `currentPassword`). A successful change signs the account out of every other session (the one the request was made from is kept), retires its outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `GET /api/v1/organizations/mine/members` | org admin | List members |
| `DELETE /api/v1/organizations/mine/members/:id` | org admin | Remove member (last-admin guard) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | org admin | Promote / demote (last-admin guard) |
| `GET /api/v1/organizations/mine/invitations` | org admin | List pending invitations |
| `POST /api/v1/organizations/mine/invitations` | org admin | Invite a new user; emails the redemption link via the injected Mailer |
| `DELETE /api/v1/organizations/mine/invitations/:id` | org admin | Revoke a pending invitation |
| `POST /api/v1/organizations/invitations/:token/accept` | anon | Redeem invitation, mint Customer Account |
| `GET /api/v1/organizations/mine/addresses` | customer | List delivery / billing addresses |
| `POST /api/v1/organizations/mine/addresses` | customer | Create address |
| `PATCH /api/v1/organizations/mine/addresses/:id` | customer | Update |
| `DELETE /api/v1/organizations/mine/addresses/:id` | customer | Remove |
| `GET /api/v1/admin/organizations` | admin | List with `filter[status]` / `filter[vatStatus]` / `q` |
| `POST /api/v1/admin/organizations` | admin (`customers:manage`) | Create an Organization with its sales channels (see *Sales channels* below) |
| `GET /api/v1/admin/organizations/sales-channel-options` | admin (`customers:manage`) | The channels the create form offers |
| `GET /api/v1/admin/organizations/:id/sales-channels` | admin (`customers:read` or `customers:manage`) | The channels assigned to the Organization, and the channels it could be assigned |
| `PUT /api/v1/admin/organizations/:id/sales-channels` | admin (`customers:manage`) | Replace the assigned channels (`{ salesChannelIds }`, at least one) |
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

## Sales channels

An Organization's members may sign in to and shop in exactly the stores whose sales channels are assigned to the Organization. No assignment means no access; an Organization always keeps at least one.

- **Sign-in.** A member whose Organization is not assigned to the store they sign in on is refused with `403 SALES_CHANNEL_NOT_PERMITTED` — *"This account does not have access to this store."* — after the password is checked and before a second factor is asked for or a session is created. Signing in with an external identity provider is refused the same way and lands back on the store's sign-in page with that message. A wrong password is still answered `401` first, so the refusal says nothing about assignments to someone without the password.
- **Signed in when access is removed.** The member's next page on that store shows a *No access to this store* screen listing the stores they can use, with a sign-out button.

### Who gets which channel

| How the Organization is created | Channels assigned |
| --- | --- |
| Business registration on a storefront (`POST /api/v1/organizations/register`) | exactly the channel of the store it registered on — also on a store closed to anonymous visitors, where moderation decides whether the business gets in |
| Individual (B2C) self-registration (personal organization) | exactly the channel of the store it registered on; refused on a store closed to anonymous visitors |
| *New organization* in the admin | the channels chosen on the form |
| Anything else — sign-in with an external identity provider that provisions a new account, imports, demo data | the system-default channel |

Accepting an invitation adds a member to an existing Organization and changes none of its channels.

When this rule was introduced, every existing Organization was assigned the system-default channel and every channel it already had orders on.

### In the admin

- **Sales channels panel** — on an Organization's page. With `customers:manage` it is a multi-select with **Save sales channels**; without it, a read-only list. Inactive channels are marked *(inactive)* and the system-default channel is badged. Saving an empty selection is refused: *"An organization must be assigned at least one sales channel."* Each added or removed channel writes one audit row. A change applies at once on the server that saved it and on every other server within 30 seconds.
- **New organization** — a button on the Organizations list and an action in the command palette (⌘K / Ctrl+K), both shown with `customers:manage`. The form asks for the name, tax ID, registered address, status (*Active* or *Pending verification*) and the sales channels, with the system-default channel pre-selected. The creation is one audited command; the new Organization's page opens when it is saved. Members are invited from that page once the Organization exists.

## Commercial party and moderation

Organization is a first-class commercial party. This section describes
the runtime surface.

### Lifecycle status (`pending_verification` → `active` → `blocked` / `rejected`)

Every newly-registered Organization starts in `pending_verification`. The
platform-wide setting `organizations.moderation.mode` (`manual` /
`auto`) controls whether an admin must approve manually before the
Organization can transact. While the status is anything other than
`active`, the platform refuses Order placement, RFQ submission, and
cart-line addition with HTTP 423.

The legacy `suspended` status was renamed to `blocked` by migration
`20260611T140349_organizations_consolidation.ts`, which writes an explanatory
`blocked_reason` on every remapped row (it writes no audit-log entry).

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

### Per-organization commercial scoping

Three allow-list bridges control what an Organization may use at
checkout:

- `organization_payment_methods` (pivot: `(organization_id, payment_method_id)`)
- `organization_delivery_methods` (pivot: `(organization_id, delivery_method_id)`)
- `organization_warehouses` (pivot: `(organization_id, warehouse_id)`)

**Empty list ⇒ platform defaults apply.** A non-empty list filters the
storefront `GET /api/v1/payment-methods`, `GET /api/v1/delivery-methods`,
and inventory stock-figure endpoints intersected with the caller's
Organization assignment.

The payment and delivery lists also bind **order placement**: an order for the
Organization that names a method outside a non-empty list is refused with
`400 VALIDATION_FAILED` on every surface that places or previews one —
storefront checkout, admin create on a customer's behalf, the API-key intake —
and one-click buy is not offered while a default method is excluded. The
refusal codes are in the `orders` module, *Method allow-lists at placement*.

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

### Effective price books + promotion targeting

The admin Organization detail page lists, read-only, the **price books that
apply to the Organization** right now: books whose audience names the
Organization itself, books naming one of its parent organizations (inherited
along the hierarchy), and books for its customer group. Each is tagged with how
it reaches the Organization — `direct_organization_match`,
`ancestor_organization_match` or `customer_group_match` — and books for everyone
are not listed. Which of them wins for a given product is the price precedence
of the `price_lists` module; the **Explain a price for this organization** link
on the same page opens the price explainer for it.

For developers: `OrganizationEffectivePriceListsService.listApplicable(orgId)`
asks `price_lists` through `PriceListReadPort.listForOrganization({
organizationChain, customerGroupId })` (container `priceListReadPort`), passing
the Organization's chain nearest first and its own customer group. The answer
is surfaced at `GET /api/v1/admin/organizations/:id/applicable-price-lists`.
With `price_lists` absent the call refuses rather than answering with an empty
list. The reasons `sales_channel_inheritance` and `segment_rule_match` are no
longer produced.

Promotions: when a promotion targets a specific Organization
(`promotions.organization_id` is set), the platform applies the rule
only when the cart's Organization is `active`. The check is wired
through `PromotionService`'s required `resolveOrganizationStatus`
constructor argument, which the `promotions` module wires to
`organizationReadPort.loadEffectiveOrganization`.

### Sales-rep ownership

`organization_sales_rep_assignments` (pivot: `(organization_id,
admin_user_id)`) binds sales reps to organizations. When the
caller's admin role is `sales_representative`, the admin Orders list
and RFQ list are filtered to the orgs the rep owns. Platform admins
see everything.

Three endpoints maintain the relation, and this module owns and
registers all three:

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/sales-reps` | List the reps assigned to an organization. |
| `POST /api/v1/admin/organizations/:id/sales-reps` | Assign a rep. |
| `DELETE /api/v1/admin/organizations/:id/sales-reps/:adminUserId` | Remove an assignment. |

They are gated by `organizations:assign-sales-rep`. Until 2026-08 they
were registered by the quote-requests module and gated by
`rfqs:handle`, which meant switching quote requests off also removed
the ability to assign a sales representative — and the code gating
the screen disappeared from the roles matrix with it. Assigning a rep
qualifies an organization, so it belongs here, with a code this
module declares. The one endpoint that stayed behind is the reverse
listing, `GET /api/v1/admin/sales-reps/:adminUserId/organizations`:
it reports how many quote requests are open per organization, which
is that module's fact.

Other modules read the relation through this module's
`organizationSalesRepScopePort`, never by querying the pivot.

### VAT-ID / NIP validation

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

### Picker primitive + diacritic-insensitive search

The admin app ships a reusable `<OrganizationPicker>` (single-select)
and `<OrganizationPickerMulti>` (multi-select) on top of the existing
`<Combobox>`. They consume `GET /api/v1/admin/organizations?q=` whose
`q` parameter is diacritic-insensitive: a query of `lodz` finds
"Bauhaus Łódź" via the denormalized `name_search` column populated
by the Organization entity's `@BeforeCreate` / `@BeforeUpdate` hooks.
`normalizeOrganizationName` is that fold plus the whitespace policy the
column needs. The fold itself is `foldDiacritics`
(`packages/contracts/src/text-normalization.ts`), shared with the admin
panel: NFD decomposition, a strip of the combining
marks, then an explicit table for the precomposed Latin letters NFD
doesn't split (`ł`/`Ł`, `ø`/`Ø`, `đ`/`Đ`, `ð`/`Ð`, `þ`/`Þ`, `ß`, `æ`,
`œ`). Changing that table re-folds new rows differently from old ones,
so it is a migration of `name_search`, not an edit.

### New settings (declared on the manifest)

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `organizations.moderation.mode` | `string` enum | `'manual'` | `manual` ⇒ pending_verification; `auto` ⇒ active on registration |
| `organizations.notifications.new_registration_recipients` | `json` array | `[]` | E-mail recipients for new-Organization notifications |

### Migrations

- `20260611T140349_organizations_consolidation.ts` — adds `legal_name`, VAT-validation
  columns, blocked / rejected / approved audit columns, `version`
  optimistic-lock, `name_search` denormalized column, three allow-list
  bridges, the validation-history table, the `organizations_name_search_idx`
  B-Tree index, and remaps every `suspended` row to `blocked`.
- `20260611T140350_admin_notifications_init.ts` (owned by `admin_notifications`) — adds the `admin_notifications`
  table + the per-admin `admin_notification_reads` bridge.
- `20260611T140351_customer_accounts_organization_optional.ts` (owned by
  `customer_accounts`) — relaxed
  `customer_accounts.organization_id` to nullable so guest-style
  Customer accounts were representable. **That design is
  dead**: personal organizations replaced it and the column was re-tightened — see
  `customer_accounts`' `20260825T141659_customer_accounts_organization_required`.
- `20260717T151403_organizations_personal_organizations.ts` — adds `organizations.is_personal`
  and backfills a personal organization for every pre-existing no-org
  customer account (see "Personal organizations" below).

### Personal organizations (B2C)

The Organization is the platform's single tenant concept. A B2C /
individual customer is **not** a null-org special case: every standalone
customer registration provisions a single-member **personal
organization** (`is_personal = true`). The organization and the
account are written **in one transaction**, by the module that owns the account
row, on both paths that create one — self-registration and federated sign-in.
This means:

- **Transacting works unchanged.** `organization_id` is `NOT NULL`,
  so ordering, RFQs, credit, invoices and addresses need no null-org path — and
  the column, not a guard, is what refuses one: MikroORM applies its tenant
  filter to `SELECT` / `UPDATE` / `DELETE` and not to `INSERT`.
- **Isolation is structural.** The tenant guard isolates each
  personal org as its own tenant — two B2C customers can never see each
  other's data, with zero null-org special-casing.
- **Individual defaults.** `status = active`, `vat_status = vat_exempt`,
  `name` from the customer's name (falling back to the email local-part),
  and a synthetic 32-hex `tax_id` derived from the account id (the column
  is globally `UNIQUE`; an individual has no company tax id).
- **Invisible in B2B admin.** Personal orgs are excluded by default from
  the admin org list/pickers, cannot receive a sales rep, and never enter
  the moderation queue (they are created `active`). The admin org list
  accepts `?includePersonal=true` to surface them when needed.
- **Per-channel gate.** Standalone (B2C) registration is controlled per
  sales channel by the `customers.allow_registration_without_organization`
  setting; a B2B-only channel refuses the registration and provisions
  nothing. The setting's name is a leftover from an earlier design — what it
  gates is registration outside a *company* organization, not registration
  without one.
- **Detaching a member from a company moves them here.** The admin
  `DELETE /api/v1/admin/customers/:id/organization` used to write
  `organization_id = NULL`; it now provisions (or re-finds) the
  customer's own personal organization and moves them into it, keeping the
  `customer_account.organization_unassigned` audit verb.

Company (B2B) organizations are unaffected — the single-member invariant
(`assertMembershipAllowed`) only rejects adding a second member to a
personal org.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds organizations. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| Name | yes |
| Tax ID | yes |
| Legal name | no |

Names are matched without regard to Polish diacritics, so `lodz` finds *Łódź*. Results are the organizations the Organizations list shows the admin — business organizations that are not deleted — for a role holding `customers:read` or `customers:manage`. For a sales representative the organizations assigned to them are listed first, then the others.
