---
title: Organizations
description: Customer Organizations, registration, invitations
---

# Organizations (`organizations`)

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
| `POST /api/v1/organizations/register` | anon | Register Org + first member, email verification dispatched; carries the custom fields open at registration (see *Custom fields at registration* below) |
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
| `GET /api/v1/admin/organizations` | admin | List with `filter[status]` / `filter[vatStatus]` / `q` (name or tax ID, see *Tax IDs* below). Personal Organizations are left out unless `includePersonal=true`; with it, `filter[isPersonal]=true\|false` keeps one kind. A sales representative sees only the Organizations they reach (see below the table) |
| `POST /api/v1/admin/organizations` | admin (`customers:manage`) | Create an Organization with its sales channels (see *Sales channels* below) and its custom-field values (`customFieldValues`). An optional `parentId` creates it as a branch (platform administrators only, see *Tax IDs* below) |
| `GET /api/v1/admin/organizations/tax-id-scope` | admin (`organizations:manage-tax-id-scope`, platform administrator) | The tax-ID scope in force, when and by whom it was set, how many tax IDs are shared, and whether the database enforces it (see *Tax-ID scope* below) |
| `PUT /api/v1/admin/organizations/tax-id-scope` | admin (`organizations:manage-tax-id-scope`, platform administrator) | Change the tax-ID scope (`{ scope: 'global' \| 'per-tree-root' }`) |
| `POST /api/v1/admin/organizations/:id/convert-to-company` | admin (`organizations:convert-to-company`; `customers:manage` too with `validateTaxId: true`) | Convert a personal Organization into a company (see *Converting a personal organization to a company* below) |
| `POST /api/v1/admin/organizations/:id/change-tax-id` | admin (`organizations:change-tax-id`; `customers:manage` too with `validateTaxId: true`) | Correct a company Organization's tax ID (`{ taxId, validateTaxId? }` → `{ data, changed, vatValidation }`; see *Correcting a tax ID* below) |
| `GET /api/v1/admin/organizations/sales-channel-options` | admin (`customers:manage`) | The channels the create form offers |
| `GET /api/v1/admin/organizations/:id/sales-channels` | admin (`customers:read` or `customers:manage`) | The channels assigned to the Organization, and the channels it could be assigned. `404 NOT_FOUND` for an Organization outside a sales representative's reach (see below the table), as for one that does not exist |
| `PUT /api/v1/admin/organizations/:id/sales-channels` | admin (`customers:manage`) | Replace the assigned channels (`{ salesChannelIds }`, at least one); `404 NOT_FOUND` outside a sales representative's reach, as for the read |
| `GET /api/v1/admin/organizations/:id` | admin | Org + member roster (`updatedAt`, members include `lastLoginAt` and `organizationRole`; `predefinedRoles` names the Administrator and Member roles) |
| `PATCH /api/v1/admin/organizations/:id` | admin | Update name / `status` / `vatStatus` and merge custom-field values (`customFieldValues`); optional `expectedUpdatedAt` → `409 VERSION_CONFLICT` when stale. One audit entry, `organization.admin_patch`, written with the change: the status, VAT and fulfilment-strategy codes before and after, and the names of the changed fields (`changedFields`) and custom fields (`changedCustomFields`) — never the name, the order-confirmation e-mails or a custom-field value |
| `POST /api/v1/admin/organizations/:id/members/invite` | admin | Invite by email (`{ email, roleId? }`, Member by default; platform-scope) |
| `POST /api/v1/admin/organizations/:id/members` | admin | Direct-create member with password (`roleId?`, Member by default) and the account's custom-field values (`customFieldValues`) |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | admin | Assign a role (`{ roleId, expectedUpdatedAt? }`) |
| `DELETE /api/v1/admin/organizations/:id/members/:customerAccountId` | admin | Soft-remove member (last-administrator guard) |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | admin | Break-glass — give an existing member the Administrator role |

**Which Organizations a sales representative reaches.** There is one rule, and every admin surface applies it: a sales representative reaches every Organization that is **not governed by another representative**. An Organization is governed by its own assignments; with `organizations:rollup`, by the nearest Organization on its ancestor-or-self chain that carries any assignment. So a representative reaches the Organizations assigned to them (with roll-up, the subtree below them, minus any branch assigned to somebody else), and every Organization no representative is assigned to — a registration awaiting approval, and every personal (B2C) Organization, which can never be assigned.

The same rule decides every surface: every `/api/v1/admin/organizations/:id` route (reads and writes, the nested ones included), the Organizations list and pickers, admin search, and every tenant-scoped read and write — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings. An Organization outside the reach answers `404 NOT_FOUND`, exactly as one that does not exist, and is absent from every list; an unknown id answers the same for every admin. Any other admin role reaches every Organization. Until issue #305 the tenant-scoped reads followed only the assignments, so an unassigned Organization opened on its screen and showed no members or requests, while the list showed Organizations whose screen then answered `404`.

Configure **`SMTP_URL`** in the backend environment so outbound mail uses SMTP instead of the console logger.

## Entities

`Organization`, `OrganizationInvitation`, `EmailVerificationToken`, and the
single-row `OrganizationTaxIdPolicy` (table `organization_tax_id_policy`) that
holds the installation's tax-ID scope. A company Organization always has a tax
ID and a personal one never does; where a tax ID may repeat is decided by the
tax-ID scope and enforced by the database (see *Tax IDs* below).

## Events emitted

`organization.registered.v1`, `organization.verified.v1`,
`organization.suspended.v1`, `organization.member_invited.v1`,
`organization.member_role_changed.v1`, `organization.converted_to_company.v1`
(`OrganizationConvertedToCompanyEvent`: `{ eventId, occurredAt, organizationId,
convertedAt }` — no name and no tax ID; dispatched once, after the conversion
commits), `organization.tax_id_changed.v1` (`OrganizationTaxIdChangedEvent`:
`{ eventId, occurredAt, organizationId, changedAt }` — neither the old nor the
new tax ID; dispatched once, after a tax-ID correction commits, and not for a
correction to the value already stored).

## Extension points

- **Verification dispatch** — `email-verification-service.ts` exposes a
  pluggable mailer interface; swap the dev-mode console mailer for a real
  SMTP/SendGrid driver in production composition.
- **Last-admin guard** — codified in `role-service.ts#changeRole` and
  `invitation-service.ts#revoke`; add new "must keep at least one admin"
  call sites here.
- **Custom-field values from server-side code** — the published
  `organizationCustomFieldWritePort` (see *Setting custom-field values from
  server-side code* below).
- **Declared extension columns** — `organizations` is an extensible table: an
  installed module package that depends on this module may declare its own
  `x_<moduleId>_*` columns on it, and the admin detail and list reads
  (`GET /api/v1/admin/organizations/:id`, `GET /api/v1/admin/organizations`)
  accept `?extensions=<moduleId>[,…]` and attach those values as `extensions`.
  Without the parameter the responses are unchanged. See *Declared extension
  columns* in the architecture guide.
- **Command hooks** — four Organization writes are declared hookable, so another
  module can take part in them inside their transaction (see *Hookable actions*
  below).

### Hookable actions

Another module — a deployment's overlay module or an installed package — may run
a `beforeCommit` command hook inside these writes, register it against the ref in
`ORGANIZATION_HOOKABLE_ACTIONS` (`@endora-commerce/contracts`), and must list
`organizations` in its manifest `dependencies`. The hook sees the uncommitted
Organization, may write its own tables or run a Command through `ctx.run`, and
may refuse the write with a code of its own, which rolls the whole write back.
How hooks run, are ordered and are refused is on the *Command Bus* architecture
page.

| Action | Ref | Written by | Hook data |
| --- | --- | --- | --- |
| `organization.create` | `ORGANIZATION_HOOKABLE_ACTIONS.create` | `POST /api/v1/admin/organizations` | `organization`, `salesChannelIds` |
| `organization.register` | `ORGANIZATION_HOOKABLE_ACTIONS.register` | `POST /api/v1/organizations/register` | `organization`, `customerAccountId`, `salesChannelId`, `registryLookupOutcome` |
| `organization.admin_patch` | `ORGANIZATION_HOOKABLE_ACTIONS.adminPatch` | `PATCH /api/v1/admin/organizations/:id` | `organization`, `changedFields`, `changedCustomFields` |
| `organization.set_custom_field_values` | `ORGANIZATION_HOOKABLE_ACTIONS.setCustomFieldValues` | `organizationCustomFieldWritePort` | `organization`, `changedFields`, `changedCustomFields` |

All four offer both phases. An `afterCommit` handler is delivered through the
platform's outbox after the write commits, at least once and in a context pinned
to the Organization; its `data` carries ids and codes only — `organizationId`,
plus `customerAccountId` and `status` on registration, `status` on create, and
`changedFields` / `changedCustomFields` on the two updates. A
hook's noted changes appear in the Organization's single audit entry as names,
under `extensions.<moduleId>.changedFields`. The registration hook never sees
the e-mail verification token. Extension input (`extensions`) can be passed by
server-side callers only — `organizationCustomFieldWritePort.setCustomFieldValues`
takes it as `{ extensions }` — and no HTTP body carries it yet. The later Organization
Commands — converting a personal organization, correcting a tax ID, moving in
the hierarchy — are not declared hookable.

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
- **New organization** — a button on the Organizations list and an action in the command palette (⌘K / Ctrl+K), both shown with `customers:manage`. The form asks for the name, tax ID, registered address, status (*Active* or *Pending verification*) and the sales channels, with the system-default channel pre-selected. A platform administrator (not a sales representative) also gets an optional *parent organization*, which creates the Organization as a branch of it; once a parent is chosen, the tax-ID field notes that a branch may use its head office's tax ID when the tax-ID scope is *One tree per tax ID*. The creation is one audited command; the new Organization's page opens when it is saved. Members are invited from that page once the Organization exists.

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
caller's admin role is `sales_representative`, every admin surface is
confined to the Organizations the rep reaches (see *Which Organizations
a sales representative reaches*): the tenant scope of every admin request
is "every Organization except those governed by another representative",
computed once per request from this table and from
`organization_reach_governor`, which holds each Organization's nearest
assigned ancestor-or-self and is kept current inside the transaction of
every write that can change it. Nothing is cached. Platform admins see
everything.

Three endpoints maintain the relation, and this module owns and
registers all three:

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/organizations/:id/sales-reps` | List the reps assigned to an organization. `404 NOT_FOUND` for an organization outside a sales representative's reach (see *Which Organizations a sales representative reaches*), as for one that does not exist. |
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

### Self-registration is all or nothing

A business registering on the storefront creates five things at once: the
Organization (in `pending_verification`), its sales-channel binding, its first
user — the Organization's *Administrator* — the registry-lookup snapshot when
the buyer used the lookup, and the e-mail verification token. They are written
in **one transaction**: either all of them exist afterwards, or none does. A
registration that fails at any step — an e-mail address another registration
took a moment earlier, a database error, a crash — leaves no Organization
without an administrator behind, so the buyer can simply try again with the
same tax ID.

The checks that write nothing run first, before anything is written: the
country, whether the tax ID or the e-mail address is already registered, the
registry ticket and the custom-field values. The password is hashed before the
transaction too. `organization.registered.v1` and
`customer_account.created.v1` are dispatched once each, after the registration
committed.

For a developer: the write is the `organization.register` Command
(`commands/register-organization.command.ts`), run through the Command Bus.
The first account is `customer_accounts`' `customer_account.create`, prepared
through `customerAccountMemberCommandPort` and run as a **child** Command
through `ctx.run`. The public endpoint, its body, its answers and its error
codes are unchanged.

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

### Custom fields at registration

An administrator can ask a registering business for more than the platform's
own fields — how they heard about the shop, their industry, a phone number —
without a code change: they define the field on **Custom Fields** for
*Organizations* or *Customers* and tick **Collect from the buyer at
registration**. The registration form then shows it, labelled in the shop's
language and marked when required: Organization fields in the company section,
Customer fields in the personal section. What is filled in is stored on the new
Organization and on the account of the person registering, with the
registration itself; a moderator reads it in the *Custom fields* panels of the
Organization and of the customer.

- **Only the fields ticked for registration are accepted.** A value for any
  other field — an internal one, one of the other record type, one that does not
  exist — is refused, never ignored, and so is a value of the wrong type or
  shape. Text is at most 1 000 characters, and at most 50 fields of each record
  type may be sent.
- **A refused registration creates nothing**: no Organization, no account, no
  sales-channel binding. Every refusal is said beside its field, in the buyer's
  language, and the form comes back with everything typed except the password.
- **A required field ticked for registration must be filled in**; a required
  field that is not ticked is not asked for at registration.
- The registration's audit entry records **which** fields were filled in,
  never their values.

The *New organization* form and the member direct-create form show the same
fields, every one an administrator may edit, and send them with the create; a
required field must be filled in there too, and a refusal is shown at the field.
The admin creates validate with the administrator's rules — any field of the
record type may be filled in, not only the ones open at registration.

**The request.** `POST /api/v1/organizations/register` takes two optional
groups, each a map of field key to value, and a request without them behaves
exactly as before:

```json
{
  "organization": {
    "name": "Acme Sp. z o.o.",
    "taxId": "PL5260250274",
    "registeredAddress": { "street": "ul. Prosta 1", "city": "Warszawa", "postalCode": "00-001", "country": "PL" },
    "customFieldValues": { "acquisition_source": "trade_fair" }
  },
  "firstUser": {
    "email": "anna@acme.example",
    "password": "…",
    "firstName": "Anna",
    "lastName": "Nowak",
    "customFieldValues": { "phone": "+48 600 000 000" }
  },
  "acceptedTermsVersion": "2025-01"
}
```

`organization.customFieldValues` holds the Organization's fields,
`firstUser.customFieldValues` the person's. A *Yes / No* field is `true` or
`false`, a number a JSON number, a date `YYYY-MM-DD`, a choice the option's
stored value, a multiple choice an array of them.

**The refusal.** `422` `CUSTOM_FIELD_VALUE_INVALID`, one `details` entry per
refused field. `field` names the group and the key (`organization.<key>`,
`firstUser.<key>`; the group alone when it carried more than 50 fields),
`code` is the reason and `message` is a sentence for the buyer in the request's
language that names neither the key nor the value:

```json
{ "error": { "code": "CUSTOM_FIELD_VALUE_INVALID", "message": "Some fields are missing or invalid. Correct them and try again.", "details": [
  { "field": "organization.acquisition_source", "code": "missing_required", "message": "This field is required.", "path": "organization.acquisition_source", "issue": "This field is required." },
  { "field": "firstUser.credit_tier", "code": "not_open_for_input", "message": "This field cannot be filled in here.", "path": "firstUser.credit_tier", "issue": "This field cannot be filled in here." }
] } }
```

The codes are `not_open_for_input`, `too_many_keys`, `missing_required`,
`wrong_type`, `out_of_range`, `unknown_option` and `duplicate_option`. Show the
`message`; branch on the `code` if you need to.

#### Adding the fields to a storefront scaffolded before this release

The reference storefront renders the open fields itself. A storefront created
from an earlier release keeps its own copy of the registration page and needs
three changes, all against the API above.

1. **Read the open fields** on the registration page, server-side:
   `GET /api/v1/custom-fields/input-surfaces/organization.register`, with the
   page's language in `Accept-Language`. It needs no session and answers on a
   store closed to anonymous visitors. `data.entities.organization` and
   `data.entities.customer` are the fields of the two sections, each
   `{ key, valueType, required, label, options: [{ value, label }], sortOrder }`
   in display order; a type with no open field is absent or `[]`, and an
   unknown surface answers `200` with `entities: {}`. Cache it (five minutes is
   what the reference storefront uses) and treat **any** failure as "no extra
   fields", so the page never fails because of them.
2. **Render one control per field** in its section, with its `label`, marked
   when `required`: text and number inputs, a date input, a checkbox for
   *Yes / No* (send `false` when it is not ticked), a select or radio group for a
   single choice, a checkbox group for a multiple choice.
3. **Send and show back.** Put the values in `organization.customFieldValues`
   and `firstUser.customFieldValues`, leaving out a field left empty. On `422`
   `CUSTOM_FIELD_VALUE_INVALID`, place each `details` entry's `message` beside
   the field its `field` names, and show the form again with what was typed —
   never in the page address.

A minimal Server Component for step 1 and the first section of step 2 (Next.js
App Router; `API_URL` is the backend's address):

```tsx
type OpenField = {
  key: string;
  valueType: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect';
  required: boolean;
  label: string;
  options: { value: string; label: string }[];
};

async function openRegistrationFields(language: string): Promise<{ organization: OpenField[]; customer: OpenField[] }> {
  try {
    const response = await fetch(`${process.env.API_URL}/api/v1/custom-fields/input-surfaces/organization.register`, {
      headers: { 'Accept-Language': language },
      next: { revalidate: 300 },
    });
    if (!response.ok) return { organization: [], customer: [] };
    const { data } = (await response.json()) as { data: { entities: Record<string, OpenField[]> } };
    return { organization: data.entities.organization ?? [], customer: data.entities.customer ?? [] };
  } catch {
    return { organization: [], customer: [] };
  }
}

export async function CompanyExtraFields({ language }: { language: string }) {
  const { organization } = await openRegistrationFields(language);
  return organization.map((field) => (
    <label key={field.key}>
      {field.label}
      {field.required ? ' *' : null}
      {field.valueType === 'select' ? (
        <select name={`cf.organization.${field.key}`} required={field.required}>
          <option value="" />
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          name={`cf.organization.${field.key}`}
          type={field.valueType === 'date' ? 'date' : 'text'}
          required={field.required}
        />
      )}
    </label>
  ));
}
```

The server action then reads every `cf.organization.<key>` form value into
`organization.customFieldValues` (and `cf.customer.<key>` into
`firstUser.customFieldValues`), converting a number field with `Number(...)`.
The example leaves out the boolean and multiple-choice controls and the error
placement of step 3.

### Setting custom-field values from server-side code

Some values are not typed by anyone: an acquisition source an integration
derives after a business registers, a segment an overlay module computes, an
identifier a worker brings back from an external system. Such a field is
usually *internal*, so registration cannot accept it from the buyer, and the
code that knows the value has no administrator's request to send it with.

That code writes through the port this module publishes,
`organizationCustomFieldWritePort` (contract `OrganizationCustomFieldWritePort`
in `@endora-commerce/contracts`), resolved with
`lazyPort<OrganizationCustomFieldWritePort>(ctx, 'organizationCustomFieldWritePort')`
and with `organizations` in the calling module's manifest `dependencies`. It
has one method:

```ts
setCustomFieldValues(
  organizationId: string,
  merge: (current: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<OrganizationRecord>;
```

- **You merge, and you validate.** The port loads the Organization, hands
  `merge` its current values and stores what `merge` returns — read, merge and
  write in one transaction, so a concurrent change is not lost. It does not
  validate: call `CustomFieldValuePort.validateAndMerge` inside `merge`. That
  applies the administrator's rules, so an internal field is accepted, unknown
  keys are dropped and every required field is checked:

  ```ts
  ctx.subscribe('organization.registered.v1', async (payload) => {
    const { organizationId } = payload as unknown as { organizationId: string };
    await organizationWrites.setCustomFieldValues(organizationId, (current) =>
      customFieldValues.validateAndMerge('organization', current, { acquisition_source: 'trade_fair' }),
    );
  });
  ```

- **A failure changes nothing.** If `merge` throws — a validation failure
  included — nothing is stored or recorded, and the error reaches you as it was
  thrown. An unknown or deleted Organization answers `404 NOT_FOUND` before
  `merge` is called.
- **One audit entry**, `organization.set_custom_field_values`, naming the
  keys whose value changed (`changedCustomFields`), never the values
  themselves: the platform audit log is global, so a tenant's values stay out
  of it. The actor is the one the call runs as: none (the system)
  in a subscriber or a worker, the administrator inside an admin request. A
  subscriber on `organization.registered.v1` runs as the system, because
  registration is anonymous. Code that runs outside any request or job, such as
  a bare timer, opens a scope first with `enterSystemScope`.
- **After registration, not with it.** A subscriber on
  `organization.registered.v1` runs once the registration has been committed.
  If its write fails, the Organization stays registered without the value; the
  failure is logged and never reaches the buyer.

Never write the `organizations.custom_field_values` column directly. A direct
write bypasses the validation, the audit entry and the module boundary.

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
- `20261109T144721_organizations_reach_governor.ts` — creates `organization_sales_rep_assignments`
  if it does not exist yet, then creates `organization_reach_governor`
  (each Organization's nearest ancestor-or-self carrying a sales-rep assignment), backfills it,
  and adds the triggers on `organizations` and `organization_sales_rep_assignments` that keep it
  current in the writing transaction (see "Sales-rep ownership" above).

  **Who creates the assignment table.** This module owns `organization_sales_rep_assignments`,
  and this is the first of its migrations that needs it, so it creates it here. Before
  issue #1033 only the `quote_requests` module's `20260503T141344_quote_requests_workflow.ts`
  created it, so a platform that composed this module without `quote_requests` stopped at this
  migration. Both migrations now create the table with `if not exists`, with the same columns
  and constraint names, and only this migration creates its two indexes, `orgsa_admin_user_idx`
  and `orgsa_organization_idx`. Whichever migration runs first creates the table, and the other
  one does not change it. On a database that has already applied both migrations nothing runs again and
  nothing changes. Installing `quote_requests` after this module leaves the table and its
  rows as they are. This migration's `down()` never drops the table.

  **Restoring data with triggers disabled.** A data-only restore run with
  `pg_restore --disable-triggers` (or anything else that writes these two tables with
  their triggers off) leaves `organization_reach_governor` stale, and a stale row
  widens a sales representative's reach. Run
  `select organizations_reach_governor_rebuild(null);` afterwards.
- `20261110T135922_organizations_personal_tax_id_removal.ts` — clears the tax ID of every
  personal organization, records its account in `personal_account_id` (taken from the old
  placeholder; a personal row whose tax ID was not the placeholder is cleared and left
  unlinked, and the count is reported as a notice) and adds `organizations_tax_id_presence`.
  **It refuses to run, and changes nothing, on a database that has organizations but has
  not applied `customer_accounts`' `20260825T141659_customer_accounts_organization_required`
  (0.100.0)**: upgrade to a 0.100.x–0.110.x release first.
- `20261110T135941_organizations_tax_id_scope.ts` — adds the stored generated column
  `organizations.root_id` (the first segment of `path`; adding it rewrites the table under an
  exclusive lock), the `btree_gist` extension and the single-row `organization_tax_id_policy`,
  seeded `global` (see "Tax IDs" below).
- `20261110T173752_organizations_tax_id_write_lock.ts` — the row trigger
  `organizations_tax_id_write_lock` on inserts and on updates of `tax_id` or `path`: two
  transactions writing one tax ID take turns, so the second is refused with a 409 instead of
  deadlocking.
- `20261110T183238_organizations_tax_id_normalise.ts` — rewrites every tax ID into the
  normalised form and adds `organizations_tax_id_normalised`. **It refuses to run, and
  changes nothing, when two organizations would hold one tax ID once normalised** where the
  scope forbids it, listing up to 50 such groups; find them before upgrading with
  `select upper(regexp_replace(tax_id, '[[:space:]-]', '', 'g')), array_agg(id) from organizations where tax_id is not null group by 1 having count(*) > 1;`
  and give each organization its own tax ID.

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
  and **no tax ID** (`tax_id` is `NULL`; every API answers `taxId: null`).
  The account the organization was provisioned for is recorded in
  `personal_account_id`, which is what makes provisioning idempotent and what
  finds "the customer's own personal organization".
- **Invisible in B2B admin.** Personal orgs are excluded by default from
  the admin org list/pickers, cannot receive a sales rep, and never enter
  the moderation queue (they are created `active`). The admin org list
  accepts `?includePersonal=true` to surface them when needed. Because no
  rep can be assigned to one, every sales representative reaches every
  personal org and its orders, invoices, carts and returns.
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
- **No VAT validation.** Validating the tax ID of a personal organization is
  refused `422 VALIDATION_FAILED` (*"This organization has no tax ID."*)
  before any registry is asked, and the organization page shows no VAT
  validation panel for it.

Until this release a personal organization carried a synthetic 32-character
hexadecimal tax ID derived from its account id. The upgrade migration clears it
and moves the link into `personal_account_id`. **Documents written before the
upgrade are not rewritten**: an order, invoice, quote document or audit entry
made for a personal organization earlier still shows the placeholder where it
showed it then. Orders that carry one can be listed with
`select id from orders where billing_address->>'taxId' ~ '^[0-9a-f]{32}$'`.

Company (B2B) organizations are unaffected — the single-member invariant
(`assertMembershipAllowed`) only rejects adding a second member to a
personal org.

### Converting a personal organization to a company

A customer who shopped as an individual and then starts a business can keep
their history: an operator converts their personal organization into a company
organization **in place**. Customers cannot do this themselves — no storefront,
customer or public route reaches the conversion.

**Who and where.** An operator holding `organizations:convert-to-company`
(*Convert personal organizations to companies*) sees **Convert to company** on a
personal organization's page; it is not shown on a company organization. The
same form is reachable from the command palette (⌘K / Ctrl+K, *Convert personal
organization*) and from the Organizations list's header menu, at
`/organizations/convert-to-company`: pick the personal organization (searched by
the customer's name), then fill in the company details.

**The form** asks for the company name, an optional legal name, the tax ID
(spaces and dashes are removed when the field is left; 8 to 32 characters), the
registered address, the VAT status (*VAT payer* by default) and *Validate the tax
ID after converting* (ticked by default). Validating needs `customers:manage`
as well, the permission of the VAT validation itself, so the box is shown only
to an operator holding it; without it the form converts without a validation.
Through the API, `validateTaxId: true` without `customers:manage` refuses the
whole request `403`.

**What changes**, in one audited transaction (`organization.convert_to_company`):

- The organization becomes a company with the name, legal name, tax ID,
  registered address and VAT status entered. **Its id does not change**, and
  its orders, carts, addresses, prices and sales channels stay attached.
- Its member keeps the *Administrator* role, so they can now invite colleagues
  and manage roles; the organization page shows the Members and Roles tabs, and
  the storefront offers the company screens on the member's next page.
- **Its status is kept** (an active customer stays active; conversion does not
  put it into the moderation queue). If the organization was never approved, it
  is stamped approved by the operator who converted it.
- The link to the customer account is cleared and the conversion time is
  recorded. If that member is later detached from the company, they get a
  **new** personal organization; the converted company keeps its id. Because the
  converted company's only member is its last Administrator, detaching them
  needs a second Administrator first, as for any company.
- A return of an order placed **before** the conversion is still treated as a
  consumer's withdrawal; orders placed afterwards are the company's.
- The audit entry records which fields changed, whether the approval was
  stamped and the tax-ID scope — never the name, tax ID or address.
- After the commit, `organization.converted_to_company.v1` is emitted once.

**Validating the tax ID.** When the box is ticked, a VAT validation runs
**after** the conversion has committed, through the same flow as *Validate now*
(the Ministry of Finance White List for a Polish NIP, VIES for another EU
prefix, a format check otherwise). Its outcome is shown in the confirmation; a
registry outage or a failed check never undoes the conversion — retry from the
VAT validation panel.

**Refusals.** Nothing changes when the conversion is refused:

| Answer | When |
| --- | --- |
| `409 ORGANIZATION_TAX_ID_EXISTS` | The tax ID already belongs to another organization where the tax-ID scope forbids sharing it (see *Tax-ID scope*) |
| `409 ORGANIZATION_CONVERSION_REFUSED` `not_personal` | The organization is already a company |
| `409 ORGANIZATION_CONVERSION_REFUSED` `deleted` | The organization is deleted, or its customer was erased by the retention sweep |
| `409 ORGANIZATION_CONVERSION_REFUSED` `owner_not_administrator` | The member does not hold *Administrator* — a data fault to report, not an operator's error |
| `409 ORGANIZATION_WRITE_CONTENDED` | A concurrent change to organizations (for example a tax-ID scope switch) held the lock; try again |
| `404 NOT_FOUND` | Unknown, or outside a sales representative's reach |

**The conversion cannot be undone**; there is no operation that turns a company
back into a personal organization.

**For server code.** The `organizationCommandPort` container entry
(`OrganizationCommandPort.convertToCompany(organizationId, input)` in
`@endora-commerce/contracts`) runs the same Command with the ambient actor — an
ERP import, an overlay module. **It checks no permission and runs no VAT
validation**: the caller is the gate, so never resolve it from a
customer-facing route.

## Tax IDs

### How a tax ID is stored

A tax ID is stored in one canonical form: **spaces and dashes removed and
letters upper-cased** (`normalizeTaxId` in `@endora-commerce/contracts`), so
`pl 526-025-09-95` is stored as `PL5260250995`. Registration, the admin create
and the conversion normalise what is typed and then require **8 to 32
characters**; a shorter or longer value is refused `400` (so `--------` is
refused rather than stored empty). Dots and other punctuation are **not**
removed — that is the registry lookup's own, wider clean-up, which does not
change what is stored. The database check `organizations_tax_id_normalised`
refuses any other form from any writer, fixtures, seeds and overlay code
included.

A company organization always has a tax ID and a personal one never does; the
check `organizations_tax_id_presence` refuses a row breaking either half.

The tax ID is entered when the organization is created (or converted).
`PATCH /api/v1/admin/organizations/:id` does not accept it; a wrong one is
corrected with **Change tax ID** (see *Correcting a tax ID* below), an audited
operation of its own.

### Correcting a tax ID

A tax ID typed wrongly at creation, or a branch given its head office's tax ID
although it is in fact a separate taxpayer, is corrected **in place**: the
organization keeps its id, members, roles, orders and history. Customers cannot
do this themselves — no storefront, customer or public route reaches it.

**Who and where.** An operator holding `organizations:change-tax-id` (*Change a
company organization's tax ID*) sees **Change tax ID** on a company
organization's page; it is not shown on a personal organization, which has no
tax ID (convert it to a company instead). The same form is reachable from the
command palette (⌘K / Ctrl+K, *Change an organization's tax ID*), at
`/organizations/change-tax-id`: pick the company organization, then correct the
tax ID.

**The form** starts on the stored tax ID. Spaces and dashes are removed when the
field is left, and 8 to 32 characters are required, as on creation. *Validate
the new tax ID after the change* is offered, ticked, to an operator who also
holds `customers:manage`, the permission of the VAT validation itself.

**What changes**, in one audited transaction (`organization.tax_id.change`):

- The tax ID is normalised and checked against the **tax-ID scope in force**,
  exactly as on creation: in *Global* no other organization may hold it,
  soft-deleted ones included; in *One tree per tax ID* no organization of
  another tree may hold it (one of the same tree may).
- The organization's VAT validation starts again as **unverified** — the last
  validation's date, provider and outcome are cleared, because they were about
  the old tax ID. Its VAT status (*VAT payer*, *VAT exempt*, *Reverse charge*)
  is kept.
- **Documents already issued are not rewritten.** An order keeps the billing tax
  ID it was placed with; invoices, quote documents and earlier audit entries
  keep what they hold. Documents issued afterwards carry the new tax ID.
- Entering the tax ID already stored (after normalisation) changes nothing,
  writes no audit entry and emits no event; the answer says `changed: false`.
- The audit entry records `changedFields: ['taxId']`, that the VAT validation
  was reset (`vatStatusReset: true`) and the tax-ID scope — never the old or the
  new tax ID.
- After the commit, `organization.tax_id_changed.v1` is emitted once.

**Validating the new tax ID.** When the box is ticked, a VAT validation runs
**after** the change has committed, through the same flow as *Validate now*. Its
outcome is shown in the confirmation; a registry outage or a failed check never
undoes the change — retry from the VAT validation panel.

**Refusals.** Nothing changes when the correction is refused:

| Answer | When |
| --- | --- |
| `409 ORGANIZATION_TAX_ID_EXISTS` | The tax ID already belongs to an organization where the tax-ID scope forbids sharing it — a soft-deleted one included |
| `409 ORGANIZATION_TAX_ID_CHANGE_REFUSED` `not_company` | The organization is personal (server code only; the admin does not offer it) |
| `409 ORGANIZATION_TAX_ID_CHANGE_REFUSED` `deleted` | The organization is soft-deleted (server code only; the admin route answers `404`) |
| `409 ORGANIZATION_WRITE_CONTENDED` | A concurrent change to organizations (for example a tax-ID scope switch) held the lock; try again |
| `404 NOT_FOUND` | Unknown, deleted, or outside a sales representative's reach |

Two operators correcting two organizations to one tax ID at the same moment are
decided by the database: one succeeds, the other receives
`409 ORGANIZATION_TAX_ID_EXISTS`, never a 500.

**For server code.** `OrganizationCommandPort.changeTaxId(organizationId, {
taxId })` on the `organizationCommandPort` container entry runs the same Command
with the ambient actor. Like `convertToCompany`, **it checks no permission and
runs no VAT validation**: never resolve it from a customer-facing route.

### Tax-ID scope

Some businesses register each branch as its own organization under the head
office, and the branches legally share the head office's tax ID. The **tax-ID
scope** decides where one tax ID may appear more than once:

| Scope | Shown as | Rule | Enforced by |
| --- | --- | --- | --- |
| `global` (default) | *Global* — every tax ID belongs to one organization | A tax ID is on at most one organization, soft-deleted ones included | the unique constraint `organizations_tax_id_unique` |
| `per-tree-root` | *One tree per tax ID* — head offices and their branches may share a tax ID; unrelated organizations may not | Organizations may share a tax ID only when they have the same root (the head office at the top of their tree, see *Organization hierarchy*) | the deferred exclusion constraint `organizations_tax_id_one_tree` over the stored column `organizations.root_id` |

Every fresh and upgraded installation starts in `global`, which is the rule the
platform always had. The scope is **not a setting**: it lives in the
`organization_tax_id_policy` row and is changed only by the audited Command
`organization.tax_id_scope.set`, which changes the row and the database
constraint together, in one transaction. Every write reads the scope from the
database inside its own transaction, so no server acts on a stale scope.

**Switching the scope.** *Organizations → Tax-ID scope*
(`/organizations/tax-id-scope`; also *Tax-ID scope* in the command palette, ⌘K /
Ctrl+K, and in the Organizations list's header menu) shows the scope in force,
when it last changed, what each scope means and how many tax IDs are currently
shared. Choose the other scope, **Apply**, and confirm.

- **Who.** The permission `organizations:manage-tax-id-scope` (*Manage the
  tax-ID scope*), held by an administrator whose reach is the whole platform. A
  sales representative is refused `403` even with the permission, because the
  scope applies to every organization.
- **The switch pauses organization writes for a few seconds.** It takes an
  exclusive lock on `organizations` while the new constraint is built, waiting
  at most 5 seconds for it. A change to organizations that meets the switch —
  or any other write it loses a lock to — is answered
  `409 ORGANIZATION_WRITE_CONTENDED` (*"Another change to organizations was in
  progress. Try again in a moment."*); retrying succeeds.
- **To *One tree per tax ID*** is always allowed. Once a tax ID is shared, the
  way back is open only after every shared tax ID is gone: a live organization's
  tax ID can be corrected with **Change tax ID**, but a soft-deleted
  organization keeps its own, so a tax ID shared with one cannot be released
  from the admin. The confirmation says so before you confirm.
- **Back to *Global*** is refused `409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES`
  while any tax ID is on more than one organization (`details: { code:
  'shared_tax_ids', sharedTaxIdCount, examples }`, at most 20 examples, each a
  tax ID with its organization ids). The screen says how many are shared and
  links the organizations, and nothing changes. An organization that holds a
  shared tax ID **by mistake** — it is in fact a separate taxpayer — is given
  its own with **Change tax ID** (see *Correcting a tax ID*); once no tax ID is
  shared, the switch back succeeds. **Soft-deleted organizations count**, so a
  branch that shares its head office's tax ID **by right**, a deleted one
  included, keeps the installation on *One tree per tax ID*.
- **Applying the scope already in force** changes nothing and writes no audit
  entry; it re-creates the scope's constraint if it was dropped by hand. The
  screen offers **Apply again** when it detects that the database does not
  enforce the scope in force, and the server logs one error at boot naming the
  scope and the constraints it found.
- The audit entry records the two scope codes, before and after.

**What the scope changes.**

- **Creating.** Registration and the admin create are refused
  `409 ORGANIZATION_TAX_ID_EXISTS` when the tax ID exists where the scope
  forbids it. In `per-tree-root` that means a new **root** organization — any
  self-registration, and an admin create without a parent — may not use a tax ID
  any tree holds, while an admin create **under** a head office (or any of its
  descendants) may use the tree's tax ID. Registration with a tax ID a branch
  holds is refused too; joining an existing company at registration is not
  offered.
- **Moving.** In `per-tree-root`, attaching, detaching or moving an
  organization so that one tax ID would end up in two trees is refused (see
  *Organization hierarchy*).
- **Concurrent writes** that would together break the rule are decided by the
  database: one succeeds and the other receives the same 409 the check would
  have given, never a 500.

### Searching by tax ID

The admin Organizations list's search box (`q`) and the global search (⌘K)
match the tax ID as well as the name. The query is normalised the same way as
the stored value, so `pl 526-025` finds `PL526025…`. A personal organization
has no tax ID and is never found by one — nor by its former placeholder.

### Looking up an organization by tax ID (server code)

`organizationDetailsPort` (`OrganizationDetailsPort` in
`@endora-commerce/contracts`) answers "which organization has this tax ID?"
correctly in both scopes. Both functions normalise the input first.

- `findByTaxId(taxId, { includeDeleted? })` — every organization holding the
  tax ID, the tree's **root first**, then by depth, creation time and id.
  Soft-deleted organizations only with `includeDeleted: true`. No match is `[]`.
- `resolveByTaxId(taxId)` — `{ kind: 'none' }`, or `{ kind: 'one',
  organization }` naming the root (or, when the root is deleted, the oldest live
  match), or `{ kind: 'ambiguous', organizations }`, which neither scope's
  constraint lets happen and which exists for scopes still to come.

Registration, the admin create and the demo seed and reset use these two
functions rather than querying the column, and so should an integration.

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
id, kind and sorted permission list before and after and, for an update, the
names of what changed (`changedFields`: `name`, `description`, `permissions`).
A custom role's name and description are never recorded. Saving a role without
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
  tax-id field starts empty, as the personal Organization has no tax ID.
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
- **The account page** shows the member their role in the profile summary.
  Beside it, *What your role allows* opens a dialog with a plain-language list
  of what the role allows, translated by the API; a role that allows nothing
  says so. A personal Organization's member sees neither.

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

## Audit entries

The platform audit log is one table read by every operator with
`audit_log:read`, whatever organizations they may reach, so every entry this
module writes records **names and structure, never values**: ids, status and other codes, booleans,
counts, dates, and the sorted names of the fields that changed
(`changedFields`, `changedCustomFields`). Never an organization's name, legal
name, tax ID, address, order-confirmation e-mails, block or rejection reason or
custom-field values; never a member's or invitee's e-mail address or names;
never a custom role's name or description.

- **`organization.create`** — the status and VAT status, the sales channels and
  parent by id, and the names of the fields it was created with
  (`changedFields`, e.g. `name`, `taxId`, `registeredAddress`) and of the
  custom fields stored.
- **`organization.register`** — one entry for the whole self-registration: the
  status, the names of the fields the Organization was created with
  (`changedFields`), the keys of the custom fields the buyer filled in for the
  Organization and for its first user (`changedCustomFields`, as
  `organization.<key>` and `firstUser.<key>`), and the registry lookup's
  provider and outcome codes when one was used. The first user's account has its
  own `customer_account.create` entry (see the `customer_accounts` module).
  Both are written in the registration's transaction and carry the same
  request id.
- **`organization.admin_patch`**, **`organization.set_custom_field_values`**,
  **`organization.convert_to_company`** — the codes before and after and the
  names of what changed.
- **`organization.delete`** — the status, VAT status, whether it is personal,
  its parent by id and its version.
- **`organization.approved`**, **`.rejected`**, **`.blocked`**, **`.unblocked`**
  — the status, the moderation dates, the approving operator by id, the version,
  and whether a block or rejection reason is set (`hasBlockedReason`,
  `hasRejectedReason`); the reason itself is on the organization's page.
- **`customer_account.admin_create`**, **`.admin_profile_update`**,
  **`.admin_rollup_change`**, **`.admin_remove`** — the member's role by id, its
  roll-up, e-mail-confirmed and two-factor flags and, after a change, the names
  of what changed (`email`, `firstName`, `lastName`, …).
- **`organization_invitation.create`**, **`.revoke`** — the invitation's id and
  its role by id and kind. **`organization.invite_accept`** — the new account
  and its role by id.
- **`organization_role.create`**, **`.update`**, **`.delete`** — as described
  under the roles above.

Entries written before an instance was upgraded to the release that made this
change are kept as they were stored.

## Global search

The admin's global search (the command palette, ⌘K / Ctrl+K) finds organizations. This module offers the fields below; which of them are used is chosen on the Global search configuration screen.

| Field | Searched by default |
| --- | --- |
| Name | yes |
| Tax ID | yes |
| Legal name | no |

Names are matched without regard to Polish diacritics, so `lodz` finds *Łódź*; a tax ID is matched in its normalised form (spaces and dashes removed, upper-cased), so `pl 526-025` finds `PL526025…`. Results are the organizations the Organizations list shows the admin — business organizations that are not deleted — for a role holding `customers:read` or `customers:manage`. For a sales representative that is the Organizations they reach; the ones assigned to them are listed first, then the others.
