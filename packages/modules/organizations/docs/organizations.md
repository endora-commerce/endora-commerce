---
title: organizations
description: Customer Organizations, registration, invitations
---

# `organizations`

Customer Organizations — registration, email verification, member management,
invitations, and the suspension state. The first user of a registering
Organization becomes its Administrator (see *Roles* below).

## Public surface

Routes marked *org administrator* are reserved to a member holding the
organization's Administrator role, checked server-side through
`organizationPermissionPort.isAdministrator` and refused with
`403 FORBIDDEN`; no permission grants them (see *Roles* below). Admin routes
(`/api/v1/admin/*`) are gated by `customers:manage`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/organizations/register` | anon | Register Org + first member, email verification dispatched |
| `POST /api/v1/auth/email-verification/verify` | anon | Redeem verification token |
| `POST /api/v1/auth/customer/login` | anon | Customer login → sets `b2b_session` cookie; merges anonymous cart |
| `POST /api/v1/auth/customer/logout` | customer | Destroy session |
| `POST /api/v1/auth/password-reset/request` | anon | Always 202 (defends against account enumeration) |
| `POST /api/v1/auth/password-reset/confirm` | anon | Redeem the emailed reset token. A redeemed token signs the account out of **every** session, retires its other outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `GET /api/v1/me` | customer | Current customer (with `organizationRole` and `permissions`) + their organization, plus `impersonation: { impersonatorAdminUserId }` when an admin is acting as the buyer |
| `POST /api/v1/me/password` | customer | Change password (rejects wrong `currentPassword`). A successful change signs the account out of every other session (the one the request was made from is kept), retires its outstanding reset tokens and withdraws any sign-in it had begun and not finished. |
| `GET /api/v1/organizations/mine/members` | org administrator | List members, each with its `organizationRole` |
| `DELETE /api/v1/organizations/mine/members/:id` | org administrator | Remove member (last-administrator guard) |
| `PATCH /api/v1/organizations/mine/members/:id/role` | org administrator | Assign a role (`{ roleId }`; last-administrator guard) |
| `GET /api/v1/organizations/mine/invitations` | org administrator | List pending invitations (not accepted, revoked or expired), each with its `organizationRole` |
| `POST /api/v1/organizations/mine/invitations` | org administrator | Invite a new user (`{ email, roleId? }`, Member by default); emails the redemption link via the injected Mailer |
| `DELETE /api/v1/organizations/mine/invitations/:id` | org administrator | Revoke a pending invitation |
| `POST /api/v1/organizations/invitations/:token/accept` | anon | Redeem invitation, mint Customer Account holding the invitation's role |
| `GET /api/v1/organizations/mine/addresses` | customer | List delivery / billing addresses |
| `POST /api/v1/organizations/mine/addresses` | customer (`addresses.manage`) | Create address |
| `PATCH /api/v1/organizations/mine/addresses/:id` | customer (`addresses.manage`) | Update |
| `DELETE /api/v1/organizations/mine/addresses/:id` | customer (`addresses.manage`) | Remove |
| `GET /api/v1/admin/organizations` | admin | List with `filter[status]` / `filter[vatStatus]` / `q` |
| `POST /api/v1/admin/organizations` | admin (`customers:manage`) | Create an Organization with its sales channels (see *Sales channels* below) |
| `GET /api/v1/admin/organizations/sales-channel-options` | admin (`customers:manage`) | The channels the create form offers |
| `GET /api/v1/admin/organizations/:id/sales-channels` | admin (`customers:read` or `customers:manage`) | The channels assigned to the Organization, and the channels it could be assigned. A sales representative reaches only the Organizations assigned to them; any other answers `404 NOT_FOUND`, as one that does not exist |
| `PUT /api/v1/admin/organizations/:id/sales-channels` | admin (`customers:manage`) | Replace the assigned channels (`{ salesChannelIds }`, at least one); `404 NOT_FOUND` outside a sales representative's Organizations, as for the read |
| `GET /api/v1/admin/organizations/:id` | admin | Org + member roster (`updatedAt`, members include `lastLoginAt` and `organizationRole`; `predefinedRoles` names the Administrator and Member roles) |
| `PATCH /api/v1/admin/organizations/:id` | admin | Update name / `status` / `vatStatus`; optional `expectedUpdatedAt` → `409 VERSION_CONFLICT` when stale |
| `POST /api/v1/admin/organizations/:id/members/invite` | admin | Invite by email (`{ email, roleId? }`, Member by default; platform-scope) |
| `POST /api/v1/admin/organizations/:id/members` | admin | Direct-create member with password (`roleId?`, Member by default) |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | admin | Assign a role (`{ roleId, expectedUpdatedAt? }`) |
| `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` | admin | Soft-remove member (last-administrator guard) |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | admin | Break-glass — give an existing member the Administrator role |

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
The message, like the checkout preflight's 423 `reason`, is written in
the language the response is answered in (the storefront's
`Accept-Language`, else the sales channel's default language), from
the `moderation.*` keys of this module's bundle.
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

The bell entry carries English text and the `notifications.newRegistration.*`
keys of this module's bundle, so each administrator reads it in their own
language. The e-mail goes through the `new_org_registration` template when
one is defined; otherwise the module composes it itself, in the language of
the system-default sales channel, from the same bundle.

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
- `MinisterstwoFinansowClient` → `GET` against `wykazpodatnikowvat.mf.gov.pl/api/search/nip/{nip}`.
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

Every history item says where it came from: `origin: 'admin'` for "Validate
now", `'registration'` for the snapshot a self-registration carried (see
below). A registration row also carries `registryDetails`, `submittedValues`
and `divergence`; an administrator's row has `null` in all three. The shape is
`organizationTaxIdValidationRecordSchema` in `@endora-commerce/contracts`.

### Registry lookup at registration

A business registering on the storefront can fetch its company data from the
public registry by tax ID, and the registration form is pre-filled with it.
Every pre-filled field stays editable; the data is informational only, and no
outcome of the lookup — not found, not an active VAT payer, a registry
outage — ever stops a registration. **The lookup ships switched off.**

**Providers and routing.** The tax ID is normalised first (spaces, dashes and
dots removed, an EU country prefix recognised, `GR` read as VIES's `EL`), and a
Polish NIP's checksum is verified **before** any registry is contacted: an
invalid number or a country outside the EU contacts nothing.

- **Polish NIPs** go to the registries the *Polish sources* setting selects:
  - `gus_mf` (default) — **GUS REGON** (BIR1.1) and the **Ministry of Finance
    VAT White List** in parallel. GUS supplies the legal name, the REGON and a
    structured address; the White List supplies the VAT status, and the data
    too when GUS is not configured, fails or does not know the number.
  - `gus` — GUS REGON only. The White List is never asked, so its daily limit
    stays for "Validate now"; the VAT status is shown as *not checked*.
    **Without a working GUS credential, `gus` means no lookup for Polish NIPs
    at all** — every Polish lookup answers "unavailable". Choose it only once
    the GUS credential works.
  - `mf` — the White List only. No GUS key is needed, but its address arrives
    as one line and is split into street, postal code and city as well as
    possible; what cannot be split is left for the buyer.
- **Other EU VAT numbers** always go to **VIES**, whatever the Polish setting.
  Some member states (Germany among them) do not disclose the name and
  address: the buyer is told the number is valid and types the details.

**Settings** (group *Organizations* on the Settings screen; the command
palette's *Registration company lookup settings* opens it):

| Setting | Default | Meaning |
| --- | --- | --- |
| `organizations.registration.registry_lookup_enabled` | `false` | Switches the lookup on. Off, the storefront shows the manual form and `POST /api/v1/organizations/registry-lookup` answers exactly as an unknown route. Takes effect without a restart. |
| `organizations.registration.registry_lookup_pl_sources` | `gus_mf` | `gus_mf` \| `gus` \| `mf`, as above. Read per lookup; an unreadable value counts as `gus_mf`. The Settings screen warns beside it while `gus` is chosen and no GUS credential is selected. |
| `organizations.registration.gus_credentials` | empty | The GUS REGON credential the lookup uses. Optional under `gus_mf` and `mf`. |

**The GUS credential.** Create it on the **Credentials** screen with the type
*GUS REGON registry (BIR1.1)*: the **user key** GUS issued to you (secret —
stored encrypted, shown masked, never returned in full) and the
**environment**, *Production* or *Test*. Changing the environment asks for the
key again. To try the lookup without a production key, use the *Test*
environment with GUS's public test key `abcde12345abcde12345`; the test
registry holds anonymised data. Then select the credential in
`organizations.registration.gus_credentials`. If the `credentials` module is
switched off, or the credential cannot be resolved or is refused by GUS,
Polish lookups behave as with no credential.

The GUS client uses Node's bundled certificate store, which accepts the GUS and
VIES hosts; a deployment that replaces it (`--use-openssl-ca`, a custom CA
bundle) must make sure it still trusts them.

**Limits and caching.** The lookup is not an open proxy to the registries:

- **Per client:** 10 lookups per 10 minutes per address (`429 RATE_LIMITED`
  beyond). The storefront forwards the buyer's `X-Forwarded-For`, so the
  limit counts the buyer only where the backend trusts the storefront as a
  proxy (`TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES`); without that,
  every buyer of a server-rendered storefront shares one bucket.
- **Per registry, platform-wide:** GUS and VIES 300 calls per UTC hour; the
  White List 60 per Europe/Warsaw day, which leaves the rest of its daily
  per-IP limit (100 `search` requests) to "Validate now". Over budget, that
  registry is treated as unavailable; a registry the Polish sources exclude
  spends none of its budget.
- **Cache:** answers are cached per country, Polish-sources choice and tax ID
  — found 6 hours, not found 30 minutes, unavailable 60 seconds — so a
  repeated lookup contacts no registry, and changing the Polish sources never
  serves an answer fetched under the previous choice.
- **Time:** a lookup answers within 8 seconds whatever the registries do.
- **Redis:** the cache, the budgets and the lookup references live in Redis.
  When Redis fails the lookup answers "unavailable" rather than running
  unmetered; registration is unaffected.

The answer never says whether a tax ID already belongs to an Organization on
this platform; registration refuses a duplicate with the existing 409.

**What moderators see.** A registration that carried a lookup stores one row in
the VAT validation history, marked *Registration*, holding what the registry
answered (source, legal name, address, REGON, VAT and activity status, the
Polish sources in force, the registries that failed or were not asked) and what
the customer submitted. The panel shows a *Registry data at registration* card
with the two side by side and every field that **differs** marked; differences
only in letter case, diacritics, spacing, punctuation or a common Polish
legal-form spelling (`sp. z o.o.`, `S.A.` …) do not count. A pending
Organization whose submission differs shows a notice in its moderation actions.
The Organization's own fields hold what the customer submitted — the registry's
legal name is applied only through "Validate + apply legal name".

**Without JavaScript.** The *Fetch company data* button submits the form to the
server, and the page comes back with the company fields filled and everything
else the buyer typed kept — except the password, which is never sent back —
with nothing in the address bar. Pressing Enter in a field below the tax ID then
fetches rather than registers; with JavaScript, Enter fetches only in the tax ID
field.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/organizations/registration-options` | Whether the lookup is on, and for which countries (cached by the storefront for up to 5 minutes, refreshed when the setting changes) |
| `POST /api/v1/organizations/registry-lookup` | One lookup (`{ taxId, country }`); answers `found`, `not_found`, `unavailable`, `invalid_tax_id` or `unsupported_country` with a `lookupId` |
| `POST /api/v1/organizations/register` | Accepts an optional top-level `registryLookupId`; the snapshot is read from the platform's own store, never from the request |

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
| `organizations.registration.registry_lookup_enabled` | `boolean` | `false` | The registry lookup at registration (see above) |
| `organizations.registration.registry_lookup_pl_sources` | `string` enum | `'gus_mf'` | Registries asked for a Polish NIP: `gus_mf` \| `gus` \| `mf` |
| `organizations.registration.gus_credentials` | `credential_ref` | `''` | The GUS REGON credential (type `organizations_gus_bir`) |

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
- `20261103T173304_organizations_organization_roles.ts` — creates `organization_roles`, gives
  every organization its Administrator and Member roles (and a trigger that does
  so for every new one), withholds the two cart-approval codes from Member where the
  organization required cart approval, and gives every invitation a role reference
  (see "Roles" below).
- `20261105T121034_organizations_registry_lookup_provenance.ts` — adds `origin`
  (`admin` for every existing row), `registry_details` and `submitted_values` to
  `organization_tax_id_validations`, and admits the `gus_pl` provider (see
  "Registry lookup at registration" above).

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

## Roles

Every organization has roles, and every member holds exactly one of them. A role
is a set of **organization permissions** — buyer actions such as *create carts*
or *approve carts* — each declared by the module whose action it gates, in that
module's manifest (`organizationPermissions`). Organization permissions are a
different vocabulary from the operator permissions of `/admin-roles`
(`<module>.<action>` against `<area>:<action>`), and the two never mix.

- **Administrator** — predefined. Holds every permission of every module that is
  switched on, including permissions added later, and is the only role that may
  manage members, invitations and roles. It cannot be edited or deleted.
- **Member** — predefined. The default role of a new member. Its permissions can
  be changed but it cannot be renamed or deleted. A permission a module declares
  as *member default* is held by Member from the moment that module is first
  offered to the organization; once an administrator saves Member without it, it
  is not granted again.
- **Custom roles** — up to 50 per organization, each with a name unique within
  the organization (compared without regard to case, and never one of the
  predefined names in any shipped language) and an optional description.

Both predefined roles are created together with the organization, whichever
path creates it (a database trigger). A personal (B2C) organization has the two
roles too, but no role management: its sole member is its Administrator.

A permission of a module that is switched off is not held by anybody, and is not
shown in the editor; a role that granted it keeps the grant, so switching the
module back on restores it. Role changes take effect on the next request: each
process caches an organization's roles for at most 30 seconds and drops the
entry as soon as any process announces a change.

Every role change is a Command — `organization_role.create`,
`organization_role.update`, `organization_role.delete` — audited against the
organization, naming the member or the operator who made it, with the role's
name, kind and sorted permission list before and after. Saving a role without
changing it records nothing.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/organizations/mine/roles` | org administrator | Every role with its member and pending-invitation counts (pending: not accepted, revoked or expired) |
| `GET /api/v1/organizations/mine/roles/:id` | org administrator | One role |
| `POST /api/v1/organizations/mine/roles` | org administrator | Create a custom role (`{ name, description?, permissions }`) |
| `PATCH /api/v1/organizations/mine/roles/:id` | org administrator | Edit a role (`{ expectedVersion, name?, description?, permissions? }`) |
| `DELETE /api/v1/organizations/mine/roles/:id` | org administrator | Delete a custom role (`{ expectedVersion, replacementRoleId? }`) |
| `GET /api/v1/organizations/mine/permission-catalogue` | org administrator | The permissions on offer, grouped by module, in the request language |
| `GET /api/v1/organizations/mine/role` | customer | The member's own role and what it allows |
| `GET /api/v1/admin/organizations/:id/roles` | admin (`organizations:read-roles` or `organizations:manage-roles`) | As the storefront list |
| `GET /api/v1/admin/organizations/:id/permission-catalogue` | admin (`organizations:read-roles` or `organizations:manage-roles`) | As the storefront catalogue |
| `POST /api/v1/admin/organizations/:id/roles` | admin (`organizations:manage-roles`) | Create a custom role |
| `PATCH /api/v1/admin/organizations/:id/roles/:roleId` | admin (`organizations:manage-roles`) | Edit a role |
| `DELETE /api/v1/admin/organizations/:id/roles/:roleId` | admin (`organizations:manage-roles`) | Delete a custom role |

Every request body is strict: a body that still sends the old `role` field is
refused with `400 VALIDATION_FAILED`. A role of another organization, and every
role route of a personal organization, answers `404`. The refusals are
`409 ORGANIZATION_ROLE_NAME_TAKEN`, `409 ORGANIZATION_ROLE_STALE` (the role
changed since it was read), `422 ORGANIZATION_ROLE_LIMIT_REACHED`,
`409 ORGANIZATION_ROLE_PROTECTED`, `422 ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`
and `422 ORGANIZATION_PERMISSION_UNKNOWN`. A buyer action refused for lack of a
permission answers `403 ORGANIZATION_PERMISSION_REQUIRED`, naming the permission
and its label in `details`.

Other modules ask whether a member may do something through
`organizationPermissionPort` (`can`, `assert`, `isAdministrator`, `effective`,
`rolesHolding`), and gate their routes with `organizationPermissionPreHandler`
from `@endora-commerce/contracts`. `organizationRoleReadPort.predefinedRoleId`
answers an organization's Administrator or Member role id.

### Roles on the storefront

The Organization's administrators manage roles in the account area. What each
member is offered follows their role, and the Organization's kind:

- **Account navigation.** *Members* and *Roles* are shown to members holding
  *Administrator*; *Carts to approve* to members whose role holds *Approve and
  reject colleagues' carts* (`carts.approve`), with the number of carts waiting.
  A personal (B2C) Organization's member is offered none of the three, although
  they hold *Administrator*, and those pages send them back to `/account`.
  A personal Organization is not a company, so that member is not offered
  *Organization* or *Org addresses* either: `/organization` sends them to
  `/account` and `/organization/addresses` to their own address book,
  `/addresses`, which still lists the Organization's addresses beside theirs.
  The profile has no *Organization* row for them, and the checkout's billing
  tax-id field starts empty rather than with the personal Organization's
  synthetic tax id.
  Anyone else who opens one is told who may use it — for example *"Only the
  organization's administrators can manage roles."*
- **Roles** (`/organization/roles`) lists every role with its type (*Built-in*
  or *Custom*), its members, its pending invitations and its permissions, and
  offers **New role**. A role opens on its own page (`/organization/roles/<id>`):
  *Administrator* is shown as holding every permission and cannot be changed;
  *Member* keeps its name and takes permission changes only; a custom role can be
  renamed, described, edited and deleted. Deleting a role that members or
  pending invitations hold asks which role they move to; deleting cannot be
  undone.
- **A new role starts with nothing allowed.** The create page
  (`/organization/roles/new`) opens with every permission unticked and offers no
  "copy from another role"; a role created with nothing ticked allows nothing.
  The permissions are grouped by module, with the label and description in the
  page's language, and *One-click purchase* notes that it works only together
  with *Place orders without approval*.
- **Two administrators editing one role.** The second save is refused; the page
  keeps what was typed and offers to reload the role's current state.
- **Members** (`/organization/members`) shows each member's role as a select of
  the Organization's roles, and the invite form names the role of the new
  member, *Member* preselected.
- **The account page** shows the member their role and a plain-language list of
  what it allows (*What your role allows*), translated by the API; a role that
  allows nothing says so. A personal Organization's member sees neither.

### Roles in the Admin UI

The Organization detail screen has a **Roles** tab. It is shown to an operator
holding `organizations:read-roles` or `organizations:manage-roles`, and never for
a personal Organization. With the read code it is read-only; with
`organizations:manage-roles` the operator creates, edits and deletes roles under
the storefront's rules — the create form also opens with every permission
unticked, and a held role is deleted only with a replacement. The members table
on the same screen shows each member's role and, for `customers:manage`, a role
select. The tab links to the Organization's history in the audit log, where each
role change is recorded.

### Members, invitations and the session

A member's role is named by its id everywhere a request names one, and shown as
`organizationRole: { id, name, kind }` everywhere a response shows one — the
login answer, `GET /api/v1/me`, `GET /api/v1/me/customer`, the invitation
accept, the members and invitations lists, the operator's member roster and the
impersonation answer. A predefined role's `name` is translated into the
response language; a custom role's is its own name. The session views (login,
`GET /api/v1/me`, `GET /api/v1/me/customer`, the invitation accept) also carry
`permissions`, the member's effective permission codes, so a storefront can
hide what the member cannot do. No request or response carries the old `role`
field (`organization_admin` / `regular_user`) any more.

- **Reserved to Administrator.** Managing members (listing, changing roles,
  removing), managing invitations, managing roles and setting the
  organization's two-factor policy are reserved to the Administrator role. A
  custom role holding every permission is still refused them.
- **Last administrator.** Moving the last active Administrator to another role
  is refused `409 CANNOT_DEMOTE_LAST_ADMIN`, removing them
  `409 CANNOT_REMOVE_LAST_ADMIN`, and revoking the only pending Administrator
  invitation of an organization with no active Administrator
  `409 CANNOT_REVOKE_LAST_ADMIN_INVITE`; an expired invitation is not pending.
  Blocked administrators do not count.
- **Invitations.** An invitation names a role of the organization — its Member
  role when the request names none; a role of another organization is `404`.
  The invitation e-mail shows the role's label in the e-mail's language (a
  custom role's own name). The pending list leaves out accepted, revoked and
  expired invitations.
- **Addresses.** Creating, editing and deleting the organization's shared
  addresses needs the `addresses.manage` permission (declared by `addresses`,
  held by Member by default); reading them does not.
- **Personal organizations.** The sole member of a personal organization is its
  Administrator. The member and invitation routes answer them as any
  administrator (their members list holds only themselves and their
  invitations list is empty); inviting is refused `422 VALIDATION_FAILED`,
  because the organization is personal, before the role is looked at. A
  storefront hides the organization screens there by `organization.isPersonal`,
  never by the role.
- **Login and the guest basket.** When a member whose role lacks *Create and
  edit carts* signs in, their guest basket is not merged: the login answers
  `cartMerge.outcome = 'noop'` and keeps the `b2b_cart_anon` cookie, so the
  guest basket is still there.

Assigning a role, removing a member and promoting through the break-glass route
run the `customer_account.change_role` / `customer_account.remove_member`
Commands of `customer_accounts`; creating and revoking an invitation run
`organization_invitation.create` / `organization_invitation.revoke`. Each is
audited against the organization, naming the member or the operator who acted.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds organizations. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| Name | yes |
| Tax ID | yes |
| Legal name | no |

Names are matched without regard to Polish diacritics, so `lodz` finds *Łódź*. Results are the organizations the Organizations list shows the admin — business organizations that are not deleted — for a role holding `customers:read` or `customers:manage`. For a sales representative the organizations assigned to them are listed first, then the others.
