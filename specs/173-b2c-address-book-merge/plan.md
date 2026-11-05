# Implementation Plan: One address book — merge for B2C customers, retire the personal book

**Branch**: `spec/762-address-book-merge` (design) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/173-b2c-address-book-merge/spec.md`; issue #762; owner rulings of 2026-11-05
(the merge ruling on the issue; OD-1 – OD-7 on this plan's first draft, PR #768).
**Status**: design. OD-1 – OD-7 are resolved (2026-11-05). OD-3 was changed from the
recommendation: the personal book is retired now, for everyone. OD-8 – OD-12, raised by that
change, are open. The plan is written against the recommended answer to each, and says what
changes if the owner rules otherwise.

## Summary

There is one address book per customer: their **Organization's book** (`addresses`). The
`customers` personal book is **retired in this feature for everyone**.

- **B2C** (personal Organization): "Moje adresy" lists and edits the personal Organization's book
  through `/api/v1/organizations/mine/addresses`, the endpoint checkout already uses. Existing
  personal-book rows are moved into it once by a `customers`-owned BullMQ job. The job writes
  through `addresses`' published `addressServicePort`, removes duplicates, keeps the Organization
  default, and soft-deletes each source row with a link to the row it became.
- **Company members**: one address entry, "Adresy organizacji". Their existing personal-book rows
  are **not** copied into the company book, because they are private. On the company addresses
  page each member sees his own former rows, and nobody else sees them. They are read-only for a
  **90-day notice period** (OD-9, OD-10). In that period he can *Copy to company addresses* (with
  `addresses.manage`) or *Remove* them. After it, the same job erases what is left.
- **Every personal-book write** (create, edit, set default; self-service and admin) is refused with
  one code for everyone (OD-5 as ruled; name and status in OD-8). The published
  `CustomerAddressReadPort` is removed once #769 has taken `quick_order` off it.
- **Anonymisation** (OD-7, as ruled) now soft-deletes **and** blanks the personal Organization's
  addresses, and the account's own personal-book rows.
- The table and the last personal-book code go in a **later release**, behind a migration that
  refuses to run while the retirement is unfinished (OD-12).

No new module, no new runtime dependency, no new permission. The only schema change is on
`customers`' own table. One port method is added to `addresses`.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17 (backend), Next.js 15 / React 19
(storefront), React 19 + Vite (admin)
**Primary Dependencies**: existing only — MikroORM, Zod, BullMQ, Fastify
**Storage**: PostgreSQL. One `customers` migration on `customer_addresses`. No other table is altered
**Testing**: Vitest — backend unit, contract and integration; storefront component tests; admin component test
**Target Platform**: the platform as shipped; every deployment
**Project Type**: web (backend modules + storefront + admin)
**Performance Goals**: the job works in batches of 100 accounts, with one transaction per account.
The expected volume is small (see *Counting*)
**Constraints**: Principle I (no foreign-table access in a migration — `check:module-boundary`
R1/R2), XI (tenant scope on every write), XIII (audited writes), XVII (off-state)
**Scale/Scope**: `customers` (substantial), `addresses` (one port method), `quick_order` (edge
removal after #769), `contracts`, three storefront pages + one shared component, one admin panel

## Grounding (files read)

- `packages/modules/customers/src/backend/entities/customer-address.entity.ts`,
  `services/customer-address-service.ts`, `services/customer-address-read-port.ts`,
  `services/customer-defaults-service.ts`, `services/customer-deletion-service.ts`,
  `workers/anonymization-sweep-worker.ts`, `routes.self.ts` (address and defaults routes),
  `routes.admin.ts` (`GET`/`POST /api/v1/admin/customers/:id/addresses`), `serializers.ts`,
  `manifest.ts`, `src/migrations/20260611T140404_customers_customer_addresses_init.ts`,
  `src/admin/panels/ManagementPanels.tsx` (`AddressesPanel`)
- `packages/modules/addresses/src/manifest.ts` (`addresses.manage`, `memberDefault: true`,
  `nonDeactivatable`), `src/backend/index.ts`, `services/address-service.ts`,
  `services/address-ports.ts`
- `packages/modules/organizations/src/backend/routes.customer.ts` (`mine/addresses` and its
  `addresses.manage` gate), `services/personal-organization-service.ts` (`anonymizeIfOrphaned`),
  `src/migrations/20260717T151403_organizations_personal_organizations.ts`, `manifest.ts`
- `packages/modules/orders/src/backend/services/order-service.ts` (`ADDRESS_NOT_OWNED`)
- `packages/modules/quick_order/src/manifest.ts` (`degrades-without` edge on
  `customerAddressReadPort`), `src/backend/index.ts` (`customerAddressesOrAbsent`),
  `services/default-preference-service.ts` (`isAddressEligible`),
  `src/migrations/20260611T140359_quick_order_default_preferences.ts` (`qodp_*_address_fk`)
- `packages/modules/quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts` (repeatable job
  pattern, Principle X)
- `packages/contracts/src/customers.ts`, `addresses.ts`, `organizations.ts`
  (`OrganizationDetailsPort`, `OrganizationRecord.isPersonal`), `organization-roles.ts`
  (`organizationPermissionPreHandler`), `errors.ts`
- `packages/platform/src/tenancy/escape-hatch.ts` (`withOrgScope`)
- `storefront/app/(account)/addresses/page.tsx`, `app/(account)/organization/addresses/page.tsx`,
  `app/(account)/layout.tsx`, `app/(account)/preferences/page.tsx`,
  `app/(commerce)/checkout/page.tsx`, `lib/api/customers.ts`, `lib/api/organization.ts`,
  `lib/account/organization-area.ts`, `lib/account/organization-addresses.ts`,
  `lib/i18n/messages/account.ts`
- `specs/170-organization-roles/spec.md` (FR-014a, FR-057, FR-070a; "Administrator (everything,
  cannot be changed)")
- `specs/conventions/module-migrations.md` (items 4, 4a), `module-composition.md` (items 9, 9a),
  `module-activation.md`, `module-i18n.md`, `check-inventory.md` (`check:command-coverage`),
  `release-intent.md`
- Pre-migration, cited and not present in this tree: `specs/040-*`, `specs/051-*`,
  `specs/097-migration-sql-boundary/` (the normative contract behind `check:module-boundary`).

### Findings that shape the design

1. **The personal book is unusable for ordering by anyone.** `OrderService` resolves both ids
   through `addressReadPort.findById(ctx.organizationId, …)` and answers `403 ADDRESS_NOT_OWNED`
   otherwise. Retiring it removes no working capability.
2. **`quick_order` accepts personal-book ids that its foreign keys reject.** This is issue #769,
   being fixed in parallel. After #769 the only consumer of `customerAddressReadPort` is gone.
3. **The `/addresses` navigation link is unconditional** in `storefront/app/(account)/layout.tsx`,
   although `customers` serves that page today and can be switched off. This feature fixes it.
4. **The retention sweep scrubs no saved address** of an anonymised customer. It erases neither the
   personal book nor the personal Organization's book. OD-7, ruled in.
5. **The personal book never had country validation**, while `AddressService.createAddress`
   validates against the dictionary. A row whose country is no longer active is refused by the
   owner. The move records the refusal (ruled: operator-visible only).
6. **The admin has no write surface for Organization addresses at all.** Organization addresses
   are read-only in the admin. OD-6 keeps it so; that is a separate follow-up.

## Decisions

Each decision is set out as decision → rationale → alternatives rejected. OD-n are owner
decisions; R-n are design decisions of this plan.

### OD-1 — The canonical book of a personal Organization — **resolved 2026-11-05, as recommended**

**Ruling**: the personal Organization's book (`addresses`), served at
`/api/v1/organizations/mine/addresses`.

**Rationale (as proposed)**: checkout reads and writes this book, and orders refuse any other. The
Organization is the one tenant (Principle XI). The table is `@OrgScoped`, whereas
`customer_addresses` needs a `withSystemScope` widening on every statement. Its owners are
`nonDeactivatable`.

**Rejected**: making the personal book canonical. Every order-placing path would need a second
table, and `orders` (`nonDeactivatable`) would need an edge to `customers` (switchable), which
`module-composition.md` item 4a forbids. Also rejected: two books on both pages.

### OD-2 — Existing B2C personal-book rows — **resolved 2026-11-05, as recommended**

**Ruling**: an automatic one-time move, with no duplicates. The Organization default is kept.
Source rows are soft-deleted with a link to the new row. The mechanism is R-1, and the algorithm is
under *Data migration*.

**Rejected**: showing both lists until the customer merges them; leaving the rows; hard-deleting
them after the copy.

### OD-3 — The personal book for company members — **resolved 2026-11-05, changed: retire now, for everyone**

**Ruling**: the personal address book is retired in this feature, for every customer.

**Design of the retirement**:

| Population | Existing rows | Afterwards |
| --- | --- | --- |
| B2C (personal Organization) | moved into the Organization book (OD-2) | "Moje adresy" is the Organization book |
| Company member | read-only for the notice period, own eyes only, *Copy to company addresses* / *Remove*; erased after it (OD-9, OD-10) | one entry, "Adresy organizacji" (OD-11) |
| Org-less account (legacy, Principle XI-invalid) | read-only for the notice period, *Remove* only; erased after it | no address book; nothing to order with, as today |

Writes are refused for everyone at once (OD-5/OD-8). Reads stay only for the notice period. The
code and table go in a later release (OD-12).

**Rejected for company members' rows** — the options, restated:

- *Auto-copy into the company book*: publishes a person's private addresses to every colleague.
  Rejected in the first draft and still rejected.
- *Immediate deletion with notice*: simplest, but erases typed data before anyone can act on the
  notice. The notice is only useful if there is time to act on it.
- *An export file* (download as CSV/JSON): a new surface, a format and an i18n header set, all for
  data the member can read on screen and copy with one click (R-6).
- *Read-only forever*: keeps the table, the read path and the `withSystemScope` widening alive with
  no end date. That is not a retirement.
- **Read-only for a notice period, with copy and remove, then erase** — chosen. The data stays
  under its owner's control, a deliberate copy moves it to the company, and the end is dated.

**Consequence for `quick_order`**: #769 makes eligibility Organization-book only. This feature then
deletes `customerAddressReadPort` (the contract interface, the `customers` provider, the
`quick_order` `nonBindingDependencies` entry and `customerAddressesOrAbsent`). WP-8 depends on #769
being merged.

### OD-4 — Permissions — **resolved 2026-11-05, as recommended**

**Ruling**: no new permission and no changed gate. The member of a personal Organization holds
*Administrator* (`specs/170-organization-roles/` FR-070a, PR-3), which holds every permission and
cannot be edited, and no Roles screen is offered (PR-10). `addresses.manage` is also a *Member*
default. T-C4 asserts create, update and delete directly. The company copy action (R-6) is gated on
the same `addresses.manage`.

### OD-5 — Personal-book writes after the merge — **resolved 2026-11-05, as recommended; extended by OD-3**

**Ruling**: refuse, with `409 CUSTOMER_ADDRESS_BOOK_MERGED`. The owner noted that probably no
external client uses the API today.

**Decision under OD-3**: the refusal becomes the answer of **every retired write, for every
customer**: `POST /api/v1/me/customer/addresses`, `PATCH …/:addressId`, `PUT …/:addressId/default`,
an address id in `PUT /api/v1/me/customer/defaults`, and `POST /api/v1/admin/customers/:id/addresses`.
A per-population answer (refused for B2C, allowed for company members) would keep the book alive for
half the customers, which OD-3 rules out. `DELETE …/:addressId` stays open for the customer's own
rows during the notice period (FR-014): removing your own data never splits a book. The name and
status of the code are OD-8.

### OD-6 — The admin card — **resolved 2026-11-05, as recommended**

**Ruling**: read-only. Under OD-3 the card shows, for **every** customer, the Organization book they
order from. Below it, it lists personal-book rows still in their notice period (with the date) and
rows the move refused (with the reason). The add form goes. Admin editing of Organization addresses
is a separate follow-up issue, for every Organization.

### OD-7 — Anonymisation — **resolved 2026-11-05, as recommended, sub-question included: soft-delete and blank**

**Ruling**: in this feature, when the retention sweep anonymises a B2C customer and
`anonymizeIfOrphaned` scrubs the personal Organization, every address of that Organization is
soft-deleted **and** its fields blanked. The mechanism is R-7. The account's own personal-book rows
are blanked as well. Order snapshots are untouched.

### Refused rows during the move — **resolved 2026-11-05**

**Ruling**: visible to the operator only (the admin card), with the reason. The customer does not
see them. They could not have been used at checkout anyway. Under OD-3 they are also erased when
their `retire_after` passes, like any remaining row.

### OD-8 — The refusal's code and status — **open**

**Recommendation**: `410 Gone`, **`CUSTOMER_ADDRESS_BOOK_RETIRED`**, for everyone. The sentence
(`customers/i18n/{en,pl}.json`) says that addresses are managed in the Organization's addresses.

**Rationale**: once the book is retired for company members too, "merged" is false for half the
callers. `410` is HTTP's "deliberately and permanently gone". A code name is a stable identifier
that clients branch on, so it should be right before the first release that ships it. The owner's
note that no external client probably uses the API makes the rename free today.

**Alternative**: keep the ruled `409 CUSTOMER_ADDRESS_BOOK_MERGED` for everyone. This works; the
cost is a misleading name, permanently. If ruled, swap the code and status in WP-3. Nothing else
changes.

**After OD-12's release** the routes are gone, and a call answers the platform's ordinary `404`.

### OD-9 — Company-member and org-less rows — **open**

**Recommendation**: read-only for a notice period, with *Copy to company addresses* (company
members holding `addresses.manage`) and *Remove*. After it, the rows are soft-deleted and their
fields erased (the retirement step of the job). The options and why the others were rejected are
under OD-3 above.

### OD-10 — Notice length and announcement — **open**

**Recommendation**: **90 days**, written per row by the `customers` migration
(`retire_after = now() + interval '90 days'` on every live row). The clock therefore starts when
each installation upgrades, not on a calendar date. It is a constant, not a Setting: it applies
once, and a Setting would outlive the rows it governs (Principle IV). The notice is a line on the
member's addresses page and on the admin card, giving the date, plus the operator upgrade note.
**No e-mail**.

**Rationale for no e-mail**: these addresses were never usable at checkout, so their loss changes
no order. A bulk mail needs a new transactional template in two languages and a sending run, for
low value. Erasing data the platform holds needs no notice under data-protection law; the notice
here is a courtesy.

**Alternatives**: 30 days (short, if most members rarely log in); 180 days (keeps the read path
twice as long); an e-mail through `transactional_emails` (add a WP: template en+pl, a one-off job,
an opt-out check).

### OD-11 — "Moje adresy" for a company member — **open**

**Recommendation**: no separate entry. A company member has **one** address entry in the account
navigation, "Adresy organizacji" (`/organization/addresses`). `/addresses` redirects a company
member there. His former personal addresses render on that page, in their own section, to him
only, while `customers` is present and he has rows in their notice period.

**Rationale**: "Moje adresy" next to "Adresy organizacji", both pointing at the company book, is two
names for one list. That is the confusion the issue is about, moved to B2B. The company book is not
"mine" for a member; the label should say whose it is.

**Alternative**: keep "Moje adresy" for company members, rendering the company book (and the former
rows), and drop the "Adresy organizacji" entry. Less change for members used to the old entry,
but a page called "my addresses" whose rows colleagues can edit misleads.

### OD-12 — Final removal of the table and code — **open**

**Recommendation**: in a **later release**, in a separate feature. A `customers` migration drops
`customer_addresses`, and the same change deletes the entity, the service, the routes, the job, the
contract schemas (`customerAddressSchema`, `customerAddressInputSchema`, `customerAddressBookSchema`)
and the error code's raise sites. The migration first checks its **own** table. If any row is
`deleted_at is null` (unmoved, refused or still in its notice period), it **refuses** with a message
naming the release to upgrade through. An installation that skips this feature's release cannot
lose rows silently.

**Rationale**: the move needs the job and ports, which a migration cannot use (R-1). So the drop
must not run before the job has had its chance, and the guard is the only thing a migration can
check without reading another module's table.

**Alternative**: drop in this release. That is impossible without dropping the notice period
(OD-9), and impossible for B2C rows before the job has moved them.

### R-1 — How rows are moved and retired (the data migration)

**Decision**: a `customers`-owned **repeatable BullMQ job** (Principle X, the
`rfq-expiry-sweep-worker.ts` pattern). It runs daily, plus once at boot under a fixed job id. It is
registered through `defineModuleWorker`, so it runs only while `customers` is present. It reads
`customers`' own table and writes the Organization book only through `addresses`' published
`addressServicePort`, inside `withOrgScope(organizationId, …)`. A `customers` migration adds the
columns on its own table.

**Rationale**: `module-migrations.md` item 4a allows three seams for writing another module's table
(the owner's migration, the writing module's `installHook`, the owner's port at boot) and forbids
the rest:

| Option | Verdict |
| --- | --- |
| `customers` migration `insert into "addresses" … select from "customer_addresses"` | **Refused**: R2, a write into a table `addresses` owns. |
| `addresses` migration reading `customer_addresses` | **Refused**: R1 needs `addresses` → `customers`, which closes a cycle and makes `nonDeactivatable` `addresses` bind switchable `customers` (the dead switch item 4a names). |
| `customers` `installHook` through `addresses`' `./install` surface (item 9a) | **Does not reach the data**: an installed module's hook does not run on upgrade (item 9). |
| `ctx.onBoot` reconciler | **Rejected**: it runs in both `start` and `worker` with no lock, and a failure stops the platform from starting. |
| **Repeatable BullMQ job through `addressServicePort`** | **Chosen**: it uses the owner's write surface (validation, default demotion, audit), has a single runner, retries, is resumable by construction, and is gated. Daily, because the retirement has a date to act on. |

The cross-module **reads** use ports already in `customers`' `dependencies`:
`customerAccountReadPort.findById` and `organizationDetailsPort.findById` (`isPersonal`). No
manifest edge is added.

### R-2 — Who serves each address page

**Decision**:

| Caller | `/addresses` | `/organization/addresses` |
| --- | --- | --- |
| B2C | the Organization book through `lib/api/organization.ts` (`listAddresses`, `createAddress`, `updateAddress` with `isDefault`, `deleteAddress`), heading "Moje adresy" / "My addresses" | redirect to `/addresses` (#757, unchanged) |
| Company member | redirect to `/organization/addresses` | the company book as today, plus the *former personal addresses* section (R-6) when `customers` is present and he has rows |
| Org-less | former rows read-only with *Remove*, when `customers` is present; otherwise redirect to `/account` | redirect (unchanged) |

All three render through one shared `storefront/components/account/AddressBook.tsx` (Principle IX),
plus `FormerPersonalAddresses.tsx` for the section.

**Rejected**: a backend facade in `customers` over the Organization book (a second write path,
the `addresses.manage` seam duplicated, and the B2C book would depend on switchable `customers`).
Also rejected: a new storefront URL for B2C.

### R-3 — Navigation and off-state

**Decision** (`storefront/app/(account)/layout.tsx`): B2C sees "Moje adresy" → `/addresses`, always.
A company member sees "Adresy organizacji" → `/organization/addresses` only, always; the "Moje
adresy" entry is gone (OD-11). An org-less customer sees "Moje adresy" only while
`modules.isPresent('customers')`. This closes finding 3: no link points at a `customers` surface
while `customers` is absent.

### R-4 — What "equal" means for de-duplication

**Decision**: the same `kind`, and equal after normalising:

- `recipientName`, `street` and `city`: trim, collapse inner whitespace, Unicode NFC, case-fold.
- `postalCode`: remove whitespace, upper-case.
- `country`: upper-case.
- `phone`: keep digits and a leading `+`; absent equals absent.

This is one pure function, `addressFingerprint`, in `customers`. It is used by the move and by the
copy action (R-6).

**Rejected**: diacritic folding. A false merge loses an address; a false non-merge shows one twice,
which is the safer error.

### R-5 — Columns on `customer_addresses`

**Decision**:

- `merged_into_address_id uuid null` (no foreign key: it is provenance and is never joined)
- `merged_at timestamptz null`
- `merge_refusal varchar(64) null`
- `retire_after timestamptz null`, which the migration sets to `now() + 90 days` on every live row
- a partial index on `("retire_after")` where `"deleted_at" is null`, used by both steps of the job

**Rejected**: a separate merges table. It would be a second table for a one-to-one fact that is
retired anyway.

### R-6 — *Copy to company addresses*

**Decision**: a `customers` route, `POST /api/v1/me/customer/addresses/:addressId/copy-to-organization`.
It answers only for a company member's own live row inside its notice period. It is gated by
`organizationPermissionPreHandler(…, 'addresses.manage')` (the contracts helper `organizations`
uses). It runs the **same per-row step as the move**: de-duplicate, write via `addressServicePort`
inside `withOrgScope`, set `merged_into_address_id`/`merged_at`, soft-delete, and audit
`customer_address.copy`. The copy is never a default (FR-007's spirit: a member does not change the
company's default by copying). The route lives only until OD-12.

**Rationale**: one request, with the same code, provenance and de-duplication as the job.

**Rejected**: composing it in the storefront from `POST mine/addresses` followed by
`DELETE /me/customer/addresses/:id`. It is two requests that are not atomic, it leaves no
provenance, and it would put de-duplication into the UI.

### R-7 — Blanking the personal Organization's addresses (OD-7)

**Decision**: `addresses` gains `anonymizeForOrganization(organizationId): Promise<number>` on
`AddressServicePort`. The method sets `recipientName`, `street`, `city` and `postalCode` to `'-'`
and `phone` to `null`, keeps `country`, sets `isDefault = false` and `deletedAt`, and audits
`address.anonymized` per row with a null actor. `customers`' `CustomerDeletionService.sweep` calls it
when `personalOrganizations.anonymizeIfOrphaned(customer.id)` returns an Organization, and blanks the
account's own `customer_addresses` rows in the same pass.

**Rationale**: `addresses` owns the rows, so the blanking is its method. `customers` already depends
on `addresses` and already runs the sweep. `organizations` decides whether the scrub applies (its
non-null answer), so no new edge is needed. A `nonDeactivatable` `organizations` → `addresses` call
is avoided, because `addresses` depends on `organizations`.

**Rejected**: two port calls, `updateAddress` with dashes then `deleteAddress`. That is two audit
rows per address and a race window. Also rejected: calling it from inside `anonymizeIfOrphaned`
(`organizations` does not declare `addresses`).

## Data migration

### Schema (`customers`, its own table only)

Scaffold with `pnpm --filter backend run migration:new` for `customers`, then run
`composer:generate`. `up` adds R-5's columns and index, and runs
`update "customer_addresses" set "retire_after" = now() + interval '90 days' where "deleted_at" is null`.
`down` drops them. Only `customer_addresses` is touched, so `check:module-boundary` has nothing to
judge.

### The job (`customers`)

The worker is `packages/modules/customers/src/backend/workers/address-book-retirement-worker.ts`, a
thin class over `services/address-book-retirement-service.ts`. Each run has two steps.

**Step A — move B2C rows** (OD-2):

1. Select up to 100 distinct `customer_account_id` with live rows where `merged_at is null and
   merge_refusal is null`, ordered by keyset.
2. Classify each account: `customerAccountReadPort.findById` → `organizationId`, then
   `organizationDetailsPort.findById` → `isPersonal`. Company and org-less accounts are skipped by
   Step A; Step B handles them.
3. Lock the account's live rows: one transaction per account, `select … for update`.
4. Inside `withOrgScope(organizationId, 'customers: moving the personal address book of account
   <id> into its personal organization (#762)', …)`:
   - read `addressServicePort.list(organizationId)` and fingerprint it (R-4);
   - for each row, oldest first: if the fingerprint matches, link to the existing address;
     otherwise `createAddress(…, { isDefault: row.isDefault && no Organization default of that kind
     yet })`;
   - set `merged_into_address_id`, `merged_at`, `deleted_at`, and `is_default = false`;
   - audit `customer_address.merge` (null actor; the `anonymizeIfOrphaned` precedent, which
     satisfies `check:command-coverage`).
5. If the owner refuses (`HttpError`, e.g. an inactive country): store the code in
   `merge_refusal`, leave the row live, and continue. The row is operator-visible (ruled).
6. Crash safety: if the process dies between the Organization write and the source update, the next
   run fingerprints the book and links the row instead of creating a second one (FR-008; test T-I3).

**Step B — retire expired rows** (OD-9/OD-10):

7. Select live rows where `retire_after <= now()` (all populations, refused rows included), in
   batches. Set `recipient_name`, `street`, `city` and `postal_code` to `'-'`, `phone` to null,
   `is_default` to false and `deleted_at` to now. Audit `customer_address.retired` (null actor).
   This is `customers`' own table, so no port is involved.

8. Log a summary at `info`: `{ accounts, merged, deduplicated, refused, retired }`.

**Rollback** (before Step B has run for a row): `update customer_addresses set deleted_at = null,
merged_at = null, merged_into_address_id = null where merged_at is not null and customer_account_id
in (…)`, after rolling back the routes. Rows already retired by Step B are erased and cannot be
restored. The notice period is the window in which a rollback is possible.

## Counting

**Local development database** (`backend/.env` → `localhost:5432/b2b`), measured 2026-11-05:
`customer_addresses` holds **0 rows**, live or deleted. The database is nearly fresh: 1 company
Organization, 0 personal Organizations, 0 Organization addresses, 0 org-less accounts. It says
nothing about real volume. Demo seeding creates no personal-book rows.

**Production / any real installation**: a read-only operational query (not a migration), run by an
operator against the database or a replica:

```sql
select
  count(*)                                                                as all_rows,
  count(*) filter (where ca.deleted_at is null)                           as live,
  count(*) filter (where ca.deleted_at is null and o.is_personal)         as live_personal,  -- moved by Step A
  count(*) filter (where ca.deleted_at is null and o.is_personal = false) as live_company,   -- OD-9's notice population
  count(*) filter (where ca.deleted_at is null and o.id is null)          as live_no_org,
  count(distinct ca.customer_account_id)
    filter (where ca.deleted_at is null and o.is_personal = false)        as company_members_with_rows
from customer_addresses ca
join customer_accounts acc on acc.id = ca.customer_account_id
left join organizations o on o.id = acc.organization_id;
```

After the release, SC-002 adds `… and ca.merged_at is null and ca.merge_refusal is null and
o.is_personal`, which should be 0. SC-003 is `live = 0` once every `retire_after` has passed. Run
the query before ruling OD-9/OD-10: if `company_members_with_rows` is 0 everywhere, the notice
period protects nobody, and OD-9 could be ruled "erase at once".

## API and contract changes

All of the following ship in one release. The release is labelled `breaking change`, and the
changesets for `@endora-commerce/contracts`, `customers`, `addresses` and `quick_order` carry the
upgrade note (`specs/conventions/release-intent.md`).

| Surface | Change | Breaking? |
| --- | --- | --- |
| `packages/contracts/src/errors.ts` | add `CUSTOMER_ADDRESS_BOOK_RETIRED` (OD-8; or `…_MERGED`) | no |
| `customers` manifest `errorCodes`, `i18n/{en,pl}.json` | declare it, with its sentence | no |
| `POST /api/v1/me/customer/addresses`, `PATCH …/:addressId`, `PUT …/:addressId/default` | refused for everyone (OD-5/OD-8) | **yes** |
| `DELETE /api/v1/me/customer/addresses/:addressId` | still allowed for own live rows during the notice period | no |
| `POST /api/v1/me/customer/addresses/:addressId/copy-to-organization` | **new**, retirement-only (R-6) | no |
| `GET /api/v1/me/customer/addresses` | shape kept: `personal` = own live rows (company / org-less: in their notice period; B2C: empty once moved, refused rows excluded), `organization` = the customer's Organization book | no |
| `PUT /api/v1/me/customer/defaults` | method fields unchanged; an address id is refused | **yes** |
| `GET /api/v1/me/customer/defaults` | address fields = Organization book defaults (`addressReadPort.findDefault`) for everyone | semantics |
| `POST /api/v1/admin/customers/:id/addresses` | refused (OD-6) | **yes** |
| `GET /api/v1/admin/customers/:id/addresses` | shape kept; `personal` includes refused rows | no |
| `customerAddressSchema` | optional `retireAfter` and `mergeRefusal` | no |
| `CustomerAddressReadPort`, `CustomerAddressRecord` | **deleted** (after #769), with the `customers` provider and `quick_order`'s edge | **yes** (contracts) |
| `AddressServicePort` | add `anonymizeForOrganization` (R-7) | no (additive) |
| `customerAddressInputSchema`, `customerAddressBookSchema` | deprecated; deleted with OD-12 | later |
| `/api/v1/organizations/mine/addresses` | unchanged | no |

The "is this account B2C" question in `customers` is answered by one private helper over
`customerAccountReadPort` and `organizationDetailsPort`. The routes, the defaults service and the
job all use it.

## Storefront changes

- `storefront/components/account/AddressBook.tsx` *(new, shared)*: the table, *Make default*,
  *Remove* and the add form. Props: the addresses, `canManage`, the server actions and the heading
  key.
- `storefront/components/account/FormerPersonalAddresses.tsx` *(new)*: the read-only rows, the
  notice with the date, *Copy to company addresses* (when `mayManageOrganizationAddresses`),
  *Remove*, and the "ask an administrator" line otherwise.
- `app/(account)/addresses/page.tsx`, `app/(account)/organization/addresses/page.tsx`: implement
  R-2's table.
- `app/(account)/layout.tsx`: implements R-3.
- `lib/api/customers.ts`: drop `createMyAddress` and `setMyDefaultAddress`; add
  `copyMyAddressToOrganization`; keep `listMyAddresses` and `deleteMyAddress` until OD-12.
- `app/(commerce)/checkout/page.tsx` and `lib/api/organization.ts`: **no change**.
- New keys in `storefront/lib/i18n/messages/account.ts`, **en and pl** (FR-025). The names are
  indicative:
  - `account.addresses.former.heading` ("Your former personal addresses" / "Twoje dawne adresy
    prywatne")
  - `account.addresses.former.notice` (with `{date}`)
  - `account.addresses.former.copy`
  - `account.addresses.former.copied`
  - `account.addresses.former.askAdministrator`
  - `account.addresses.former.copyFailed`

  The existing keys used only by the retired add form on `/addresses`
  (`account.addresses.add.makeDefault` if unused elsewhere) and `account.addresses.shared.*`
  (B2C-only, and company members no longer see `/addresses`) are deleted after a usage check.

## Admin changes

In `packages/modules/customers/src/admin/panels/ManagementPanels.tsx`, `AddressesPanel`:

- list the `organization` book read-only for every customer;
- list `personal` rows below it with their `retireAfter` date or their `mergeRefusal` reason;
- remove the add form.

The new keys go in `customers/i18n/{en,pl}.json` (`detail.addresses.organizationBook`,
`detail.addresses.former`, `detail.addresses.retiresOn`, `detail.addresses.refused`). There is no
permission or palette change: the card sits on an existing screen that the `open-customers` action
already reaches (Principle XVI).

## Off-state of each module

| Module | Can be off? | With it off |
| --- | --- | --- |
| `addresses`, `organizations`, `customer_accounts` | no | — |
| `customers` | yes | Every customer keeps their Organization book on its page and at checkout. The former-addresses section, the org-less `/addresses` page, the admin card and the job are absent. `retire_after` does not move, and the first run with the module on catches up. |
| `quick_order` | yes | unaffected; after #769 and WP-8 it no longer refers to `customers` for addresses |

The off-state tests are T-O1 and T-O2, written per `specs/conventions/module-activation.md`.

## Test plan

Write the failing test first (Principle III). Every FR traces to a test.

**Backend — unit** (co-located `*.test.ts` in `packages/modules/customers/src/backend/…`)
- T-U1 `addressFingerprint` (R-4; FR-006).
- T-U2 the default rule (FR-007).
- T-U3 `addresses`' `anonymizeForOrganization`: blanks the fields, soft-deletes, keeps the country,
  audits each row (R-7), in `packages/modules/addresses/src/backend/services/`.

**Backend — integration** (`backend/test/integration/customers/address-book-retirement.test.ts`)
- T-I1 Step A for a B2C account with three rows, one of them a duplicate: two created, three linked
  and soft-deleted, three audit rows (FR-005, 006, 009, 010).
- T-I2 a second run changes nothing (FR-008).
- T-I3 a crash between the Organization write and the source update leaves no duplicate (FR-008).
- T-I4 company and org-less rows are untouched by Step A; soft-deleted rows are not copied.
- T-I5 an owner refusal sets `merge_refusal` and lets the account's other rows through (FR-011).
- T-I6 tenant scope: the created rows are in the account's own personal Organization and are
  invisible to another Organization (Principle XI).
- T-I7 Step B: rows past `retire_after` are blanked and soft-deleted, refused rows included; rows
  inside the period are untouched (FR-016).
- T-I8 the migration sets `retire_after` on live rows only.
- T-I9 the retention sweep for an anonymised B2C customer blanks and soft-deletes the personal
  Organization's addresses and the account's own rows; order snapshots are unchanged (FR-022).

**Backend — contract** (`backend/test/contract/customers/`, `…/organizations/`)
- T-C1 `GET /me/customer/addresses`: a B2C caller gets `personal` empty and the Organization book;
  a company member gets own rows with `retireAfter` (FR-013).
- T-C2 every retired write answers the OD-8 code and status for B2C, company and org-less callers,
  with the message in `pl` and `en` by `Accept-Language`. Rewrite `addresses-defaults.contract.test.ts`
  (FR-012, FR-025; SC-004).
- T-C3 `DELETE` works on own rows during the period and is 404 on a colleague's row (FR-014, FR-015).
- T-C4 a personal Organization's member `POST/PATCH/DELETE /organizations/mine/addresses` →
  201/200/204 (FR-020).
- T-C5 copy-to-organization: 201 with `addresses.manage`, 403 without, 404 for a colleague's row,
  B2C or org-less; a duplicate links instead of creating (R-6).
- T-C6 `GET /me/customer/defaults` reports the Organization defaults (FR-018).
- T-C7 admin `GET` lists the Organization book plus the former and refused rows; `POST` is refused
  (FR-021).
- T-C8 `check:error-translations` and `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
  accept the code.
- T-C9 (WP-8) `quick_order` composes without `customerAddressReadPort`. The manifest graph tests
  (`test/unit/db/module-graph.test.ts`) and the residue ledger
  `test/unit/kernel/module-removal.test.ts` are re-derived. These are the derived artefacts the
  AGENTS.md trap names.

**Off-state**
- T-O1 `customers` off: the worker is not registered; B2C and company members manage the
  Organization book; with the module on again, the job catches up (FR-023).
- T-O2 storefront with `customers` absent: no former-addresses section, and no org-less "Moje
  adresy" link (FR-024). Extend `storefront/test/account/module-presence-nav.test.tsx`.

**Storefront** (`storefront/test/account/`, EN and PL)
- T-S1 B2C `/addresses`: one list from the Organization API, heading "My addresses" / "Moje
  adresy", no shared section; add, remove and make-default call the Organization API (FR-001, 002,
  004).
- T-S2 company member: the navigation shows one address entry; `/addresses` redirects; the
  former-addresses section shows own rows with the date; *Copy* is shown only with
  `addresses.manage`; *Remove* is always shown (FR-013, 014, 017). Rewrite
  `storefront/test/account/i18n/account-pages.test.tsx`.
- T-S3 round trip with one in-memory fake of `/organizations/mine/addresses` shared by the checkout
  action and the address page, for a B2C customer **and** for a company member: an address typed at
  checkout is listed, and one added on the page is offered at checkout (FR-002, FR-003; SC-001).
- T-S4 org-less `/addresses`: read-only rows with *Remove*.

**Admin**
- T-A1 `AddressesPanel`: the Organization book read-only, former rows with their date, refused rows
  with their reason, no add form, EN and PL.

**Manual, on demo**: as a B2C customer, add an address on "Moje adresy" and check it at checkout;
place an order with a typed address and check "Moje adresy". As a company member with a seeded
personal row, check the section, copy the row, check checkout. Repeat in the other language. Open
both customers in the admin.

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I. Modular architecture (NN) | **Pass.** `customers` reaches `addresses`, `organizations` and `customer_accounts` through published ports already in its `dependencies`; no migration touches a foreign table; one edge is *removed* (`quick_order` → `customers`). |
| II. API-first | **Pass.** Contract changes land in `packages/contracts` first (WP-1); the breaking ones are flagged and released as such. |
| III. TDD (NN) | **Pass.** The test plan traces every FR. |
| IV. YAGNI & minimal dependencies | **Pass.** No dependency, module, table or permission is added; the notice length is a constant, not a Setting; one table is on its way out. |
| V / VI / VIII | **Pass.** English artefacts; names follow existing patterns. |
| VII. SEO/performance | **Pass.** Account pages stay server components with `noindex`. |
| IX. UI reuse | **Pass.** One shared `AddressBook` replaces three copies. |
| X. Scalable queue consumers | **Pass.** A repeatable BullMQ job in the worker process. |
| XI. Multi-tenant isolation (NN) | **Pass.** The book is the Organization's for everyone; every write is inside `withOrgScope` of the caller's own Organization; former rows are visible only to their own account; no org-less path is added (the legacy one only shrinks). |
| XII. Channel scoping (NN) | **N/A.** |
| XIII. Command Bus auditing (NN) | **Pass.** Every move, copy, retirement and anonymisation records an audit row; `AddressService` audits its own writes. |
| XIV / XV | **N/A.** |
| XVI. Command palette | **Pass**, unchanged. |
| XVII. Operator-toggleable modules (NN) | **Pass, improved.** The address book depends only on `nonDeactivatable` modules; every `customers` surface and the job are gated; finding 3 is fixed. |

**Verdict: PASS.** No decision still open changes a verdict: OD-8 – OD-12 move a name, a number or
a date, not a boundary.

## Complexity Tracking

No new runtime dependency, module, permission or table. Nothing to justify.

## Project Structure

```text
specs/173-b2c-address-book-merge/
├── spec.md
└── plan.md            # research, data model and contracts folded in (small feature)

packages/contracts/src/{errors,customers,addresses}.ts                      # WP-1, WP-8
packages/modules/addresses/src/backend/services/{address-service,address-ports}.ts  # WP-6
packages/modules/customers/
├── src/migrations/<scaffolded>_customers_address_book_retirement.ts         # WP-2
├── src/backend/services/address-book-retirement-service.ts (+ .test.ts)    # WP-2
├── src/backend/workers/address-book-retirement-worker.ts                   # WP-2
├── src/backend/services/{customer-address-service,customer-defaults-service,customer-deletion-service}.ts  # WP-3, WP-6
├── src/backend/{routes.self,routes.admin,index,manifest}.ts                # WP-2, WP-3
├── src/backend/services/customer-address-read-port.ts                       # WP-8 (deleted)
├── src/admin/panels/ManagementPanels.tsx                                   # WP-5
├── i18n/{en,pl}.json, docs/customers.md                                    # WP-3, WP-5, WP-7
packages/modules/quick_order/src/{manifest.ts,backend/index.ts}             # WP-8
storefront/components/account/{AddressBook,FormerPersonalAddresses}.tsx     # WP-4
storefront/app/(account)/{addresses,organization/addresses}/page.tsx, layout.tsx, lib/api/customers.ts  # WP-4
backend/test/{integration,contract}/customers/…, storefront/test/account/…  # with each WP
```

## Work packages and order

1. **WP-1 contracts**: the error code (OD-8), the optional fields, and `anonymizeForOrganization`
   on the port type. Do this first.
2. **WP-2 job and migration**: columns plus `retire_after`, `composer:generate`, the fingerprint,
   the service (Step A and Step B), the worker, and the gating.
3. **WP-3 routes**: refusals for everyone, copy-to-organization, defaults from the Organization
   book, the i18n sentence.
4. **WP-4 storefront**: the shared components, R-2 and R-3, and the en+pl keys.
5. **WP-5 admin card.**
6. **WP-6 anonymisation**: `addresses` port method and the `customers` sweep call (OD-7).
7. **WP-7 docs and release**: `packages/modules/customers/docs/customers.md`,
   `packages/modules/addresses/docs/addresses.md` and the Docusaurus user pages in English and
   Polish (`specs/conventions/module-documentation.md`,
   `docs/docs/contributing/documentation-i18n.md`); changesets; the `breaking change` label; the
   upgrade note (move window, notice period, the refusal, and "upgrade through this release before
   OD-12's").
8. **WP-8 read-port removal**: after #769 is merged. Delete `CustomerAddressReadPort`, its provider
   and `quick_order`'s edge, then re-derive the manifest and residue artefacts (T-C9).

WP-2, WP-3 and WP-4 **must ship in one release**. Without the job, B2C customers lose sight of their
old rows; without the refusals, the book splits again. One merge request for WP-1 – WP-7 is
reasonable, with WP-8 as a second one in the same release once #769 lands.

**Follow-ups to file when implementing**: OD-12's removal feature (scheduled at least 90 days after
this release ships); admin editing of Organization addresses (OD-6); duplicate addresses created by
checkout.

## Handoff summary for `endora-commerce-dev`

Implement after OD-8 – OD-12 are ruled. With the recommended rulings:

- Every customer's one book is their Organization's (`addresses`). B2C "Moje adresy" edits it
  through `/api/v1/organizations/mine/addresses`. A company member has one entry, "Adresy
  organizacji", and `/addresses` redirects him.
- A `customers` repeatable job does two things. Step A moves B2C rows through `addressServicePort`
  inside `withOrgScope`: de-duplicated by `addressFingerprint`, Organization default kept, sources
  soft-deleted with provenance, refusals recorded. Step B blanks and soft-deletes every row past
  `retire_after`, which the migration sets to now + 90 days. Never use SQL into `addresses`.
- Every personal-book write is refused with `410 CUSTOMER_ADDRESS_BOOK_RETIRED`. `DELETE` of own
  rows and the new `copy-to-organization` (gated by `addresses.manage`) remain during the notice
  period.
- The admin card is read-only.
- Anonymisation calls `addresses`' new `anonymizeForOrganization`.
- `CustomerAddressReadPort` goes after #769.

Start with WP-1. Write T-U1 and T-I1 before the service. Keep WP-2 – WP-4 in one release. Before
reporting done, run `build:packages`, `composer:generate`, `check:module-boundary`,
`check:error-translations`, `check:command-coverage`, the targeted backend tests,
`pnpm --filter storefront run test`, and the admin test.
