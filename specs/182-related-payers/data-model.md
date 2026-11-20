# Data model: Related payers

**Feature**: `specs/182-related-payers/` | **Date**: 2026-11-18 | Decisions: [research.md](./research.md)

Column types follow the module's existing entities. Migrations are scaffolded per owning module with
`pnpm --filter backend run migration:new -- --module <id> --name <slug>` and registered by
`composer:generate` (`specs/conventions/module-migrations.md`); no number is assigned here.

## 1. `related_payer_links` — owner `related_payers`, `@OrgScoped()` on the buyer

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid, not null, idx | **buyer X**; the tenant anchor |
| `payer_organization_id` | uuid, not null, idx | **payer Y**; payer-side reads go through R-5 |
| `state` | varchar(16) | `active` \| `inactive` \| `revoked` |
| `address_scope` | varchar(8) | `all` \| `one` |
| `billing_address_id` | uuid null | required iff `address_scope = 'one'`; an address of Y |
| `valid_from`, `valid_to` | timestamptz null | inclusive instants (RP-15); the Admin UI sends start / end of the chosen days in the operator's time zone |
| `commercial_terms` | varchar(8) | `buyer` (default) \| `payer` — set only by operator or port (RP-11) |
| `notify_payer_on_orders` | boolean, default false | spec A-4 |
| `origin` | varchar(16) | `operator` \| `automation` \| `request` \| `invitation` |
| `origin_source` | varchar(64) null | automation source code, `^[a-z0-9_.-]+$` (audit-safe code shape) |
| `origin_request_id` | uuid null | the request it was created from |
| `revoked_at` | timestamptz null | |
| `revoked_by_kind` | varchar(16) null | `operator` \| `automation` \| `buyer` \| `payer` |
| `revoked_by_id` | uuid null | admin user / customer account; null for automation |
| `version` | int | optimistic lock |
| `created_at`, `updated_at` | timestamptz | |

Constraints: check `organization_id <> payer_organization_id`; check scope/address pairing; **partial
unique** `(organization_id, payer_organization_id) where state <> 'revoked'` (FR-010). No foreign key
to `organizations` / `addresses` tables (`related_payers` declares both in `dependencies`, so an FK
would be legal; it is omitted so a hard-deleted address cannot block anything — usability is
re-checked at read, FR-012).

**State machine.** `active ⇄ inactive` (operator, port); `active | inactive → revoked` (buyer,
payer, operator, port); `revoked` is terminal (FR-013).

**Usable for a new order** (FR-012): module present ∧ `related_payers.enabled` on the channel ∧
`state = active` ∧ now ∈ [valid_from, valid_to] ∧ Y `approved` and not blocked ∧ Y not personal ∧
≥ 1 allowed live billing address of Y.

## 2. `related_payer_requests` — owner `related_payers`, `@OrgScoped()` on the sender

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | returned to the sender (leaks nothing) |
| `organization_id` | uuid, idx | **sender** (X for `buyer_request`, Y for `payer_invitation`) |
| `direction` | varchar(24) | `buyer_request` \| `payer_invitation` |
| `sender_customer_account_id` | uuid | |
| `tax_id_normalized` | varchar(32), idx | normalised with the Organization tax-ID normaliser |
| `contact_email` | varchar(320) | never contacted when a counterparty matched (spec A-10) |
| `comment` | text null | |
| `counterparty_organization_id` | uuid null, idx | **never serialised to the sender** |
| `routing` | varchar(24) | `counterparty` \| `operator` \| `awaiting_registration` |
| `operator_reason` | varchar(32) null | `approval_mode_admin` \| `second_step` \| `no_eligible_approver` \| `no_account` \| `ambiguous_tax_id` \| `ineligible` |
| `approval_mode` | varchar(24) | captured at creation |
| `unregistered_mode` | varchar(8) | captured at creation |
| `state` | varchar(16) | `pending` \| `active` \| `rejected` \| `expired` \| `withdrawn` |
| `counterparty_accepted_at` | timestamptz null | first step of `payer_then_admin` |
| `decided_at`, `decided_by_kind`, `decided_by_id` | | |
| `rejection_reason` | text null | shown to the sender |
| `link_id` | uuid null | set when `state = active` |
| `sales_channel_id` | uuid | channel whose settings applied |
| `language` | varchar(8) | for the invitation e-mail |
| `invitation_token_hash` | varchar(128) null | registration invitation; sha-256 of a random token |
| `expires_at` | timestamptz, idx | `created_at + request_ttl_days` |
| `version`, `created_at`, `updated_at` | | |

Indexes: `(organization_id, created_at)` for the daily count (R-8); `(state, expires_at)` for the
sweep; `(counterparty_organization_id, state)`; `(tax_id_normalized, routing, state)` to attach on
registration approval.

**State machine** (FR-045): `pending → active | rejected | expired | withdrawn`; terminal otherwise.
Exactly one decision wins through `version` (FR-045, spec edge case *Concurrent decisions*).

## 3. `orders` — owner `orders` (research R-2)

| New column | Type | Notes |
| --- | --- | --- |
| `payer_organization_id` | uuid null, idx | read by `paidOrderReadPort`, the admin filter, invoice copy host, return context |
| `payer_link_id` | uuid null | provenance |
| `payer_terms` | varchar(8) null | `buyer` \| `payer` (FR-117) |
| `payer_snapshot` | jsonb null | `{ organizationId, name, taxId, vatStatus, billingAddress }` frozen at placement |

`billing_address` (existing snapshot) is Y's address with Y's company name and tax ID when a payer is
set; `organization_id` stays X (RP-3). The admin custom-field and audit snapshot of an order treats
the new columns per `audit-state.md`: ids and codes may be recorded, `payer_snapshot` may not.

## 4. `carts` — owner `carts` (research R-3)

| New column | Type | Notes |
| --- | --- | --- |
| `buying_for_organization_id` | uuid null | the payer, or null for the buyer itself |
| `buying_for_terms` | varchar(8) null | `buyer` \| `payer`, copied from the link when set |

Cleared on cart completion; cleared and repriced when the policy port no longer vouches (FR-116).

## 5. Unchanged tables, changed readers

- `invoices` — no schema change. Buyer snapshot comes from the order's billing snapshot (Y);
  `invoice-copy-host.service.ts` returns `payerOrganizationId ?? organizationId` as the ledger key;
  admin reach and filter use the same expression (research R-11).
- `invoice_ledger_*` — no schema change; the delivery row's `organizationId` is Y for a paid order.
- `credit_limit_reservations` — no change; reserved with `organizationId = Y` (it is
  `@GlobalEntity`, keyed by who consumed credit).
- `return_*` — no change; settlement reads `payerOrganizationId` from the order's return context.

## 6. Settings (manifest, global + channel override)

| Code | Type | Default |
| --- | --- | --- |
| `related_payers.enabled` | boolean | `false` |
| `related_payers.approval_mode` | enum `payer` \| `admin` \| `payer_then_admin` | `payer` |
| `related_payers.unregistered_payer_mode` | enum `invite` \| `admin` | `admin` |
| `related_payers.payer_may_invite_buyers` | boolean | `true` |
| `related_payers.request_ttl_days` | number (1–365) | `30` |
| `related_payers.daily_request_limit` | number (1–1000) | `10` |
| `related_payers.time_zone` | string, IANA zone | `Europe/Warsaw` — read for the system-default channel only (RP-20 a) |

Plus the module activation setting declared by the manifest (default off, RP-1).

## 7. Permissions

Organization permissions (customer side, `specs/170-organization-roles/` FR-020; none member-default):

| Code | Label (en) |
| --- | --- |
| `related_payers.manage` | Manage payers |
| `related_payers.approve` | Approve payer requests |
| `related_payers.order_with_payer` | Place orders with a related payer |
| `related_payers.view_paid_orders` | View orders we pay for |

Operator permissions: `related_payers:read` (view links, queue), `related_payers:manage` (every
operator write, including commercial terms).

## 8. Tenancy classification

| Entity | Classification | Cross-tenant reads |
| --- | --- | --- |
| `RelatedPayerLink` | `@OrgScoped()` (buyer) | payer side: `listAsPayer`, `findAsPayer` under `withSystemScope`, constrained by `payer_organization_id` |
| `RelatedPayerRequest` | `@OrgScoped()` (sender) | counterparty side: `listIncoming` under `withSystemScope`, constrained by `counterparty_organization_id`; operator queue: admin scope |
| `Order` (extended) | unchanged `@OrgScoped()` | `paidOrderReadPort` under `withSystemScope`, constrained by `payer_organization_id` |
| `Cart` (extended) | unchanged `@CustomerScoped()` | none |
