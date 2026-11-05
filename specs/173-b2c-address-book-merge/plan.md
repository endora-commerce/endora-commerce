# Implementation Plan: One address book for B2C customers

**Branch**: `spec/762-address-book-merge` (design) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/173-b2c-address-book-merge/spec.md`; issue #762; owner ruling of 2026-11-05.
**Status**: design. Seven owner decisions are open (OD-1 – OD-7). This plan is written against the
recommended answer to each and says what changes if the owner rules otherwise.

## Summary

For a customer whose Organization is personal, **the personal Organization's book is the one
book**. Checkout already reads it and already writes a typed address into it. "Moje adresy" stops
editing the `customers` personal book for that customer and edits the Organization book through
the endpoint checkout already uses (`/api/v1/organizations/mine/addresses`). Existing personal-book
rows of B2C customers are moved once, by a `customers`-owned background job that writes through
`addresses`' published `addressServicePort`, de-duplicates, and keeps the source rows soft-deleted
with provenance. After the move, the personal-book API refuses writes for a personal Organization's
member, so the book cannot split again. Company members are not changed.

No new module, no new runtime dependency, no new permission, no schema change outside
`customers`' own table.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17 (backend), Next.js 15 / React 19
(storefront), React 19 + Vite (admin)
**Primary Dependencies**: existing only — MikroORM, Zod, BullMQ, Fastify
**Storage**: PostgreSQL. One `customers` migration on `customer_addresses`; no other table altered
**Testing**: Vitest — backend unit, contract and integration; storefront component tests
**Target Platform**: the platform as shipped; every deployment
**Project Type**: web (backend modules + storefront + admin)
**Performance Goals**: the merge processes accounts in batches of 100 with one transaction per
account; the expected volume is small (see *Counting*)
**Constraints**: Principle I (no foreign-table access in a migration — `check:module-boundary`
R1/R2), XI (tenant scope on every write), XIII (audited writes), XVII (off-state)
**Scale/Scope**: 3 backend modules touched (`customers` substantially; `organizations` only if
OD-7 is ruled in; `addresses` only in docs), `contracts`, 2 storefront pages + 1 shared component,
1 admin panel

## Grounding (files read)

- `packages/modules/customers/src/backend/entities/customer-address.entity.ts`,
  `services/customer-address-service.ts`, `services/customer-address-read-port.ts`,
  `services/customer-defaults-service.ts`, `services/customer-deletion-service.ts`,
  `routes.self.ts`, `routes.admin.ts`, `serializers.ts`, `manifest.ts`,
  `src/migrations/20260611T140404_customers_customer_addresses_init.ts`,
  `src/admin/panels/ManagementPanels.tsx` (`AddressesPanel`)
- `packages/modules/addresses/src/manifest.ts` (`addresses.manage`, `memberDefault: true`,
  `nonDeactivatable`), `src/backend/index.ts`, `services/address-service.ts`,
  `services/address-ports.ts`
- `packages/modules/organizations/src/backend/routes.customer.ts` (the `mine/addresses` routes and
  the `addresses.manage` gate), `services/personal-organization-service.ts`
  (`anonymizeIfOrphaned`), `src/migrations/20260717T151403_organizations_personal_organizations.ts`,
  `manifest.ts` (`nonDeactivatable`)
- `packages/modules/orders/src/backend/services/order-service.ts` (`ADDRESS_NOT_OWNED` on any
  address not in the caller Organization's book)
- `packages/modules/quick_order/src/backend/services/default-preference-service.ts`
  (`isAddressEligible`), `src/migrations/20260611T140359_quick_order_default_preferences.ts`
  (`qodp_*_address_fk` reference `addresses`)
- `packages/contracts/src/customers.ts`, `addresses.ts`, `organizations.ts`
  (`OrganizationDetailsPort`, `OrganizationRecord.isPersonal`)
- `packages/platform/src/tenancy/escape-hatch.ts` (`withOrgScope`)
- `storefront/app/(account)/addresses/page.tsx`, `app/(account)/organization/addresses/page.tsx`,
  `app/(account)/layout.tsx`, `app/(account)/preferences/page.tsx`,
  `app/(commerce)/checkout/page.tsx`, `lib/api/customers.ts`, `lib/api/organization.ts`,
  `lib/account/organization-area.ts`, `lib/account/organization-addresses.ts`,
  `lib/i18n/messages/account.ts`
- `specs/170-organization-roles/spec.md` (FR-014a, FR-057, FR-070a: "Administrator (everything,
  cannot be changed)")
- `specs/conventions/module-migrations.md` (items 4, 4a), `module-composition.md` (items 9, 9a),
  `module-activation.md`, `module-i18n.md`, `check-inventory.md` (`check:command-coverage`)
- Pre-migration, cited and not present in this tree: `specs/040-*` (personal address book),
  `specs/051-*` (personal Organizations), `specs/097-migration-sql-boundary/` (normative contract
  behind `check:module-boundary`).

### Findings that shape the design

1. **The personal book is unusable for ordering by anyone**, not only B2C:
   `OrderService` resolves both ids through `addressReadPort.findById(ctx.organizationId, …)` and
   answers `403 ADDRESS_NOT_OWNED` for anything else.
2. **A latent defect in `quick_order`**: `isAddressEligible` accepts a personal-book id as a
   one-click default, but `quick_order_default_preferences.default_*_address_id` has a foreign key
   to `addresses`, so storing that id fails at the database. For B2C this disappears with the merge
   (the storefront `/preferences` page already lists only Organization addresses). For company
   members it stays; it goes with OD-3's follow-up. Recorded, not fixed here.
3. **The `/addresses` navigation link is unconditional** in `storefront/app/(account)/layout.tsx`
   although `customers` (which serves that page today) can be switched off — a Principle XVII gap.
   This feature fixes it (FR-018), because it changes who serves the page.
4. **The retention sweep scrubs no saved address** of an anonymised B2C customer: neither the
   personal book (`customer_addresses` is cascade-deleted only on a hard delete of the account,
   which anonymisation is not) nor the personal Organization's book (`anonymizeIfOrphaned` renames
   the Organization and blanks `registeredAddress` only). The merge moves personal data into the
   second of these. See OD-7.
5. **The personal book never had country validation**; `AddressService.createAddress` validates the
   country against the dictionary (`create-or-change` mode). A personal-book row with a country
   that is no longer active is refused by the owner. The merge must survive that (see *Data
   migration*, step 5).
6. **The admin has no write surface for Organization addresses at all** —
   `organizations/src/backend/routes.admin.ts` mounts a read-only
   `/api/v1/admin/organizations/:id/addresses`. What an operator added on a B2C customer's card
   went into the personal book, which checkout ignored.

## Decisions

Each decision: decision → rationale → alternatives rejected. OD-n are the owner decisions listed
in `spec.md`; R-n are design decisions of this plan.

### OD-1 — The canonical book of a personal Organization

**Decision (recommended)**: the personal Organization's book (`addresses`, served at
`/api/v1/organizations/mine/addresses`).

**Rationale**: checkout reads and writes it already; orders snapshot from it and refuse anything
else; the Organization is the one tenant concept (Principle XI), and the table is `@OrgScoped`
where `customer_addresses` has no organisation column and needs a `withSystemScope` widening on
every statement (`CustomerAddressService.#forAuthorisedCustomer`). It is owned by
`nonDeactivatable` modules, so the B2C customer's book cannot disappear with an operator switch.
The `addresses.manage` gate is already there and is always satisfied (OD-4).

**Alternatives rejected**:
- *The personal book is canonical, checkout reads it for B2C.* Every order-placing path
  (`orders`, `quick_order`, `quote_requests` conversions) resolves addresses through
  `addressReadPort` by Organization; teaching all of them a second table means a cross-module edge
  from `nonDeactivatable` `orders` to switchable `customers`, which `module-composition.md` item 4a
  forbids as a binding dependency (a dead switch) and which as a `degrades-without` edge would make
  B2C checkout fail when `customers` is off. It also reverses the direction of Principle XI.
- *Keep two books and show both on both pages.* The owner ruled one list.

**If ruled otherwise**: the rest of this plan does not survive; re-plan.

### OD-2 — Existing personal-book addresses of B2C customers

**Decision (recommended)**: merge them automatically, once, de-duplicated; an existing
Organization default wins; source rows are soft-deleted and keep a reference to the row they became.

**Rationale**: the customer typed them and expects to see them; leaving them would silently lose
them from the one list. Automatic, because a B2C customer will not look for an "import" button.
De-duplication, because many B2C customers typed the same address at checkout that they also saved
in "Moje adresy". The Organization default wins, because it is what checkout pre-selects today —
the merge must not change an order-time default under anybody's feet. Soft-delete with provenance
makes the move auditable and revertible with a statement on `customers`' own table.

**Alternatives rejected**:
- *Show both lists until the customer merges them herself* (an "Import into my addresses"
  action). Two lists is what the ruling removes; most customers would never press it, so the old
  rows would live on indefinitely, along with the second read path.
- *Leave them as they are.* Data the customer entered disappears from every screen she uses.
- *Hard-delete after copy.* Not revertible; the audit trail would point at nothing.

**If ruled "show both until merged"**: drop the worker (WP-2's job) and add a per-row
`POST /api/v1/me/customer/addresses/:id/move` that runs step 4 of the algorithm for one row;
`/addresses` shows the leftovers under a hint. FR-005 changes accordingly.

### OD-3 — The personal book for company (B2B) members

**Decision (recommended)**: **no change in this feature.** For the follow-up, **retire** the
personal book for company members — do not make it usable at checkout.

**Rationale for scoping it out**: the issue's defect and the owner's ruling are about B2C. Company
members' outcome is not worse after this feature than before it, so the B2C fix need not wait for a
B2B ruling.

**Rationale for "retire" in the follow-up**: for a company, a delivery or billing address is the
company's — the invoice is the company's, and VAT is computed on the company's tax profile. A
private address that a company order can be sent to is a request the company member already
satisfies by adding it to the company book (`addresses.manage` is a *Member* default,
`packages/modules/addresses/src/manifest.ts`). Making the personal book usable costs: an `orders` →
`customers` edge that cannot be binding (item 4a) and would degrade checkout when `customers` is
off; a second snapshot source in `orders`; a widening of `quick_order`'s address FKs (finding 2);
and a "whose address is this" question on every order-placing surface.

**Alternatives rejected**:
- *Make it usable at checkout for company members* — the cost above, for a use the company book
  already serves.
- *Merge company members' personal addresses into the company book automatically* — would publish
  a person's private addresses to every colleague. Never automatic.

**What retirement would mean** (the follow-up, not here): hide "Moje adresy" for company members
(their addresses link is "Adresy organizacji"); refuse personal-book writes for them as FR-012 does
for B2C; keep existing rows read-only with a per-row "copy to company addresses" action; once no
live rows remain anywhere, drop the table, the read port and `quick_order`'s personal branch in
`isAddressEligible`.

### OD-4 — Permissions

**Decision (recommended)**: confirm; no new permission and no change to any gate.

**Rationale**: `organizations` enforces `addresses.manage` at the `mine/addresses` route seam
(`routes.customer.ts`, `organizationPermissionPreHandler`). A personal Organization's member holds
*Administrator* on upgrade and on every creation path (`specs/170-organization-roles/` FR-070a,
owner ruling PR-3), and *Administrator* holds every permission and cannot be edited (same spec,
§ *Background*); a personal Organization is offered no Roles screen (PR-10), so nothing can withdraw
it. Independently, `addresses.manage` is `memberDefault: true`. Reading the list is not gated. The
existing `backend/test/contract/organizations/personal-organization-administrator.contract.test.ts`
covers the role; WP-3 adds a direct create/update/delete assertion (T-C4) so the confirmation is a
test and not a reading.

**Alternative rejected**: a B2C-specific bypass of the gate — redundant today and a second rule to
keep in step with roles tomorrow.

### OD-5 — A personal-book write by a B2C customer after the merge

**Decision (recommended)**: refuse with **`409 CUSTOMER_ADDRESS_BOOK_MERGED`** (owned by
`customers`, sentence in `customers/i18n/{en,pl}.json`) on `POST`, `PATCH`, `DELETE` and
`PUT …/default` of `/api/v1/me/customer/addresses`, and on an address id in
`PUT /api/v1/me/customer/defaults`, when the caller's Organization is personal. `GET` keeps its
shape (FR-013).

**Rationale**: the storefront stops calling these for B2C (WP-4), so the refusal only meets a
third-party client — and that client must learn that the address it wrote is not offered at
checkout. A 409 tells it; a silent redirect would hand back an id from another table under a
schema field (`customerAccountId`) that would then be false.

**Alternatives rejected**:
- *Delegate the write into the Organization book* (a `customers` facade over
  `addressServicePort`). Two write paths into one book, the second bypassing
  `organizations`' `addresses.manage` seam unless it re-implements it; the B2C book would again
  depend on switchable `customers`; and the response would misstate which record was written.
- *Keep accepting writes into the personal book.* Splits the book again on the first write.

**Consequence**: a `breaking change` for API clients — label the merge request, and the changeset
for `@endora-commerce/module-customers` carries an upgrade note (`specs/conventions/release-intent.md`).

### OD-6 — The admin customer-detail card for a B2C customer

**Decision (recommended)**: for a B2C customer the card lists the personal Organization's book,
read-only; `POST /api/v1/admin/customers/:id/addresses` for such a customer answers the same 409.
An admin write to Organization addresses is a follow-up issue for every Organization (finding 6).

**Rationale**: what an operator added there before never reached checkout (finding 6), so nothing
that worked is lost; an admin write path for Organization addresses is an `organizations`/`addresses`
feature with its own admin permission and Command, and deserves to be designed once for companies
and individuals alike rather than as a B2C special case inside `customers`.

**Alternative rejected**: *`customers`' admin route writes the Organization book through
`addressServicePort` for B2C customers.* Workable (admin gate `customers:manage`, audited by
`AddressService`), but it creates the only admin write into Organization addresses in a module
that does not own them, and only for one kind of Organization. Acceptable as the owner's choice if
operators need it now; it adds one route branch and one contract test.

### OD-7 — Anonymisation of a deleted B2C customer's saved addresses

**Decision (recommended)**: in this feature, extend `PersonalOrganizationService.anonymizeIfOrphaned`
(`organizations`) to soft-delete and blank the recipient, street, postal code and phone of every
address of the orphaned personal Organization through `addressServicePort`, inside the same cascade
and audit. Orders keep their own snapshots, as today.

**Rationale**: the merge moves personal data into a book the sweep does not scrub (finding 4). The
gap exists today for addresses typed at checkout; this feature widens it, so it closes it.

**Alternative rejected**: a separate issue — acceptable if the owner prefers a smaller merge
request, but then the release that ships the merge widens a known data-protection gap.
`addressServicePort` has no "blank" method; the owner may prefer soft-delete only, which needs no
port change. **[NEEDS CLARIFICATION: soft-delete only, or soft-delete and blank?]**

### R-1 — How the existing rows are moved (the data migration)

**Decision**: a `customers`-owned **BullMQ job** (Principle X), run by the worker process, gated on
`customers`' effective presence (`defineModuleWorker`), enqueued at boot with a fixed job id so the
two processes produce one run. It reads `customers`' own table and writes through `addresses`'
**published port** `addressServicePort`, inside `withOrgScope(personalOrganizationId, …)`. A
`customers` migration adds the provenance columns on its own table only.

**Rationale**: `specs/conventions/module-migrations.md` item 4a names three seams for a write into
another module's table — the owner's own migration, the writing module's `installHook`, the owner's
port at boot — and forbids the rest:

| Option | Verdict |
| --- | --- |
| `customers` migration `insert into "addresses" … select from "customer_addresses"` | **Refused**: R2, a migration owned by `customers` writing a table owned by `addresses`. |
| `addresses` migration reading `customer_addresses` | **Refused**: R1 needs `addresses` → `customers` in `dependencies`, which closes a cycle (`customers` depends on `addresses`) and makes `nonDeactivatable` `addresses` bind switchable `customers` — the dead switch item 4a names. It would also have to read `organizations.is_personal` and `customer_accounts.organization_id`. |
| `customers` `installHook` through `addresses`' `./install` surface (item 9a) | **Does not reach the data**: an installed module's hook does not run on upgrade (item 9), and every installation that has these rows has `customers` installed. |
| `ctx.onBoot` reconciler (the `WarehouseChannelReconciler` precedent) | **Rejected**: runs in both `start` and `worker`, holds no lock, and a failure becomes a platform that will not start (item 9's reasoning). Fine for a one-row invariant, wrong for a data move over N accounts. |
| **BullMQ job through `addressServicePort`** | **Chosen**: the owner's published write surface, so validation, default demotion and audit are the owner's; one runner; retries; resumable by construction (below); gated, so `customers` off means not run (FR-017). |

The cross-module **reads** go through ports too: `customerAccountReadPort.findById` (organisation
of the account) and `organizationDetailsPort.findById` (`isPersonal`). Both edges are already in
`customers`' `dependencies` (`customer_accounts`, `organizations`, `addresses`); no manifest edge
is added.

### R-2 — Who serves "Moje adresy" for a B2C customer

**Decision**: the storefront `/addresses` page decides by `me.organization.isPersonal`: personal →
it lists and edits the Organization book through `lib/api/organization.ts` (`listAddresses`,
`createAddress`, `deleteAddress`, and the existing `updateAddress` with `isDefault: true` for
*Make default*); otherwise → today's personal book through `lib/api/customers.ts`.
The table and form markup the two pages and `/organization/addresses` repeat is extracted once into
`storefront/components/account/AddressBook.tsx` (Principle IX), parameterised by the list, the
permission (`mayManageOrganizationAddresses`) and the actions.

**Rationale**: one book, one API, the API checkout uses. The page then depends on
`nonDeactivatable` modules only for B2C, which is what FR-017 needs.

**Alternatives rejected**: *a new storefront route for B2C* (two URLs for one page, and the nav
already says "Moje adresy" → `/addresses`); *keep `/addresses` on the `customers` API and let the
backend merge* (OD-5's rejected facade).

### R-3 — Navigation and off-state

**Decision**: in `storefront/app/(account)/layout.tsx`, "Moje adresy" is always shown for a
personal Organization's member; for everybody else it is shown only while
`modules.isPresent('customers')`. `/organization/addresses` keeps redirecting a personal
Organization's member to `/addresses` (#757). The `/addresses` page, for a non-personal caller with
`customers` absent, redirects to `/account`.

**Rationale**: Principle XVII item 5 as `module-activation.md` states it — a link to a module's page
exists only while the module is present (finding 3).

### R-4 — What "equal" means for de-duplication

**Decision**: same `kind`, and equal after normalisation of `recipientName`, `street`, `city`
(trim, collapse inner whitespace, Unicode NFC, case-fold), `postalCode` (remove whitespace,
upper-case), `country` (upper-case) and `phone` (digits and a leading `+` only; absent equals
absent). One pure function, `addressFingerprint`, in `customers`.

**Rationale**: catches the realistic duplicate (the same address typed twice) without fuzzy
matching that could merge two different flats.

**Alternative rejected**: diacritic folding (`foldDiacritics`) — "Łódź" and "Lodz" are probably
the same city, but a false merge loses an address while a false non-merge shows one twice; the
second is the safer error.

### R-5 — Provenance columns rather than a mapping table

**Decision**: `customer_addresses.merged_into_address_id uuid null` (no foreign key),
`merged_at timestamptz null`, `merge_refusal varchar(64) null`, plus a partial index
`on ("customer_account_id") where "merged_at" is null and "deleted_at" is null and "merge_refusal" is null`.

**Rationale**: the facts belong to the source row; one row, one outcome. No foreign key to
`addresses`, because the column is provenance that is never joined, and a DDL reference would be a
cross-module coupling for no reader (item 4 would allow it — `customers` depends on `addresses` —
but allowed is not needed).

**Alternative rejected**: a `customer_address_merges` table — a second table for a one-to-one fact.

## Data migration

### Schema (`customers`, its own table only)

Scaffold with `pnpm --filter backend run migration:new` in `packages/modules/customers`, then
`composer:generate`. `up`: add the three columns of R-5 and the partial index. `down`: drop them.
The migration touches `customer_addresses` only — `check:module-boundary` has nothing to judge.

### The job (`customers`)

`packages/modules/customers/src/backend/workers/address-book-merge-worker.ts` (thin class, the
`AnonymizationSweepWorker` shape) over
`packages/modules/customers/src/backend/services/address-book-merge-service.ts`:

1. **Select** a batch of up to 100 distinct `customer_account_id` from `customer_addresses` where
   `merged_at is null and deleted_at is null and merge_refusal is null`, keyset-ordered by id
   (own table; the existing `withSystemScope` reason style, since there is no request tenant).
2. **Classify** each account: `customerAccountReadPort.findById` → `organizationId`;
   `organizationDetailsPort.findById(organizationId)` → `isPersonal`. Not found, org-less or
   company → skip (and remember the id in the job's run so the keyset moves past it; it is
   re-examined on the next boot, which is what catches an account later detached into a personal
   Organization).
3. **Lock** the account's rows: one transaction per account, `select … for update` on its live,
   unmerged rows.
4. **Merge** inside `withOrgScope(organizationId, 'customers: merging the personal address book of
   account <id> into its personal organization (#762)', …)`:
   - read the Organization book once with `addressServicePort.list(organizationId)`, fingerprint it
     (R-4);
   - for each personal row, oldest first: if its fingerprint is present → target is that row; else
     `addressServicePort.createAddress(organizationId, { …fields, isDefault })` where `isDefault` is
     `row.isDefault && the Organization book has no default of row.kind` (re-evaluated after each
     create), and add its fingerprint;
   - set `merged_into_address_id`, `merged_at = now()`, `deleted_at = now()`, `is_default = false`
     on the source row;
   - record `customer_address.merge` in the audit log (`actorAdminUserId: null`, `stateBefore`
     `{ customerAccountId, kind }`, `stateAfter` `{ organizationId, addressId, deduplicated }`) —
     the `anonymizeIfOrphaned` precedent for a system write, which satisfies
     `check:command-coverage` ("records an audit row"). The Organization row's own
     `address.create` audit is `AddressService`'s.
5. **Refusal by the owner** (`createAddress` throws an `HttpError`, e.g. the country is no longer
   active — finding 5): store its code in `merge_refusal`, leave the row live, continue with the next
   row. Refused rows are listed on the admin card (OD-6) and counted in the run summary; the merge
   does not retry them. **[NEEDS CLARIFICATION: is "listed for the operator, invisible to the
   customer" acceptable for such rows? They could not have been used at checkout anyway.]**
6. **Crash safety**: the Organization-book write and the source-row update are in two modules and
   cannot share a transaction through a port. If the process dies between them, the next run finds
   the source row unmerged, fingerprints the Organization book, finds the row it already created,
   and links it — de-duplication makes the step idempotent. FR-008 holds by construction, and T-I3
   tests exactly this interleaving.
7. **Summary**: log `{ accounts, merged, deduplicated, refused, skipped }` at `info`.

**Enqueue**: `customers`' boot hook enqueues one job with job id `customers:address-book-merge`
(BullMQ de-duplicates a waiting job by id, so `start` and `worker` produce one). The job is not
repeatable: new B2C rows cannot appear (FR-012), and the next boot re-runs it cheaply for anything
skipped.

**Rollback**: the merged Organization rows are valid addresses and stay. To restore the personal
book of a set of accounts: `update customer_addresses set deleted_at = null, merged_at = null,
merged_into_address_id = null where merged_at is not null and customer_account_id in (…)` — on
`customers`' own table — after rolling back WP-3/WP-4.

## Counting

**Local development database** (`backend/.env` → `localhost:5432/b2b`), measured 2026-11-05:
`customer_addresses` holds **0 rows** (live or deleted); the database holds 1 company Organization,
0 personal Organizations, 0 Organization addresses and 0 org-less accounts — it is near-fresh and
says nothing about real volume. The demo instance seeds no personal-book rows
(`packages/demo-composition/src/demo-usage.ts` only deletes them on reset), so demo counts are
whatever reviewers typed.

**Production / any real installation** — read-only, run by an operator against the instance's
database (or a replica); this is an operational query, not a migration, so it may join across
modules:

```sql
select
  count(*)                                                       as all_rows,
  count(*) filter (where ca.deleted_at is null)                  as live,
  count(*) filter (where ca.deleted_at is null and o.is_personal) as live_personal,      -- the merge's input
  count(*) filter (where ca.deleted_at is null and o.is_personal = false) as live_company, -- OD-3's population
  count(*) filter (where ca.deleted_at is null and o.id is null)  as live_no_org,
  count(distinct ca.customer_account_id)
    filter (where ca.deleted_at is null and o.is_personal)        as b2c_accounts_with_rows
from customer_addresses ca
join customer_accounts acc on acc.id = ca.customer_account_id
left join organizations o on o.id = acc.organization_id;
```

After the feature ships, add
`count(*) filter (where ca.deleted_at is null and ca.merged_at is null and o.is_personal) as live_unmerged_personal`
(SC-002 expects 0, plus `merge_refusal` rows) and a duplicate estimate (rows whose fingerprint
matches an Organization row) if the owner wants it before ruling OD-2. Run it before ruling OD-2
and OD-3: the `live_company` number is what decides whether OD-3's follow-up needs a migration UX.

## API and contract changes

| Surface | Change | Breaking? |
| --- | --- | --- |
| `packages/contracts/src/errors.ts` (`ERROR_CODES`) | add `CUSTOMER_ADDRESS_BOOK_MERGED` | no |
| `customers` manifest `errorCodes` | declare it; sentence in `customers/i18n/{en,pl}.json` (`module-i18n.md`: the backend translates the envelope) | no |
| `POST/PATCH/DELETE /api/v1/me/customer/addresses[/:id]`, `PUT …/:id/default` | personal-Organization caller → `409 CUSTOMER_ADDRESS_BOOK_MERGED` | **yes** (OD-5) |
| `PUT /api/v1/me/customer/defaults` | an address id from a personal-Organization caller → same 409; method fields unchanged | **yes** |
| `GET /api/v1/me/customer/defaults` | personal-Organization caller → address defaults from `addressReadPort.findDefault` | no (shape kept) |
| `GET /api/v1/me/customer/addresses` | personal-Organization caller → `personal` holds only unmerged leftovers (empty once merged), `organization` is the one book | no (shape kept) |
| `POST /api/v1/admin/customers/:id/addresses` | B2C customer → same 409 (OD-6) | **yes** |
| `GET /api/v1/admin/customers/:id/addresses` | unchanged shape; `personal` additionally reports `mergeRefusal` on refused rows (optional field) | no |
| `customerAddressSchema` | optional `mergeRefusal: string \| null` | no |
| `CustomerAddressReadPort` | unchanged; doc comment updated: for a personal Organization it returns nothing once merged | no |
| `/api/v1/organizations/mine/addresses` | unchanged | no |

No new endpoint. The "is personal" test in `customers` is one private helper over
`customerAccountReadPort` + `organizationDetailsPort`, used by the routes, the defaults service and
the job.

## Storefront changes

- `storefront/components/account/AddressBook.tsx` *(new, shared)*: the table, *Make default*,
  *Remove*, the add form; props: addresses, `canManage`, server actions, heading key.
- `storefront/app/(account)/addresses/page.tsx`: `getMe`; personal → Organization book through
  `lib/api/organization.ts` with heading `account.addresses.heading` ("My addresses" / "Moje
  adresy"), no shared section; otherwise today's behaviour; non-personal with `customers` absent →
  redirect `/account`.
- `storefront/app/(account)/organization/addresses/page.tsx`: renders through `AddressBook`; the
  #757 redirect stays.
- `storefront/app/(account)/layout.tsx`: R-3.
- `storefront/lib/api/organization.ts`: no change — `listAddresses`, `createAddress`,
  `updateAddress` and `deleteAddress` exist.
- `storefront/app/(commerce)/checkout/page.tsx`: **no change** — it already lists and creates in the
  Organization book; tests prove the round trip (T-S3).
- i18n (`storefront/lib/i18n/messages/account.ts`, en + pl): no new key is expected — the B2C page
  reuses `account.addresses.*`; `account.addresses.shared.*` stays for company members. If the
  extraction needs a key, it ships in both languages (FR-019). The refusal sentence is the backend's.

## Admin changes

`packages/modules/customers/src/admin/panels/ManagementPanels.tsx` `AddressesPanel`: when the
response's customer is B2C (the panel reads `organization` and an `isPersonal` flag the detail
endpoint already exposes or gains), list `organization` as the customer's addresses, hide the add
form, and show a one-line hint (new admin keys in `customers/i18n/{en,pl}.json`, e.g.
`detail.addresses.personalOrganizationHint`). Refused leftovers (`mergeRefusal`) are listed with
their reason. No permission or palette change: the card is inside an existing screen, already
reachable from the existing `open-customers` action (Principle XVI satisfied unchanged).

## Off-state of each module

| Module | Can be off? | With it off |
| --- | --- | --- |
| `addresses` | no (`nonDeactivatable`) | — |
| `organizations` | no (`nonDeactivatable`) | — |
| `customers` | yes | B2C: "Moje adresy" works (served by `organizations`), checkout unchanged, the merge job is not registered and does not run; it runs at the first boot with the module on. Company / org-less: "Moje adresy" link hidden, page redirects, API absent (as any off module). Admin customer screens absent (as today). |
| `quick_order` | yes | unaffected; B2C defaults page already uses Organization addresses |
| `customer_accounts` | no | — |

Off-state tests: T-O1, T-O2 below, written per `specs/conventions/module-activation.md`.

## Test plan

Failing test first for each (Principle III). Every FR maps to at least one test.

**Backend — unit** (co-located `*.test.ts` in `packages/modules/customers/src/backend/…`)
- T-U1 `addressFingerprint`: equal under whitespace/case/postal-space/phone-format variants; unequal
  across kind, flat number, diacritics (R-4; FR-006).
- T-U2 default rule: Organization default kept; personal default carried only into an empty kind;
  two personal defaults of one kind impossible by the partial index, asserted anyway (FR-007).

**Backend — integration** (`backend/test/integration/customers/address-book-merge.test.ts`, real
Postgres)
- T-I1 B2C account with three personal rows (one duplicate of an Organization row): after the job,
  two Organization rows created, three source rows soft-deleted with `merged_into_address_id` and
  `merged_at`, three `customer_address.merge` audit rows (FR-005, 006, 009, 010).
- T-I2 second run changes nothing (FR-008).
- T-I3 crash between the Organization write and the source update (inject a throw after
  `createAddress`): next run links, does not duplicate (FR-008).
- T-I4 company-member and org-less accounts untouched; soft-deleted rows not copied (FR-011).
- T-I5 owner refusal (deactivate the row's country): `merge_refusal` set, row live, other rows of
  the same account merged.
- T-I6 tenant scope: the created rows carry the account's personal Organization and are invisible
  to another Organization's `mine/addresses` (Principle XI).
- T-I7 (if OD-7 is ruled in) retention cascade soft-deletes (and blanks) the orphaned personal
  Organization's addresses; orders' snapshots untouched.

**Backend — contract** (`backend/test/contract/customers/`, `…/organizations/`)
- T-C1 `GET /api/v1/me/customer/addresses` as a merged B2C customer: `personal` empty, `organization`
  the one book (FR-013).
- T-C2 B2C `POST/PATCH/DELETE/PUT default` and `PUT /me/customer/defaults` with an address id →
  `409 CUSTOMER_ADDRESS_BOOK_MERGED`, message in `pl` and `en` by `Accept-Language` (FR-012, 019).
- T-C3 company member: the same calls succeed as today (FR-020); extend
  `addresses-defaults.contract.test.ts`.
- T-C4 personal Organization's member `POST/PATCH/DELETE /api/v1/organizations/mine/addresses` →
  201/200/204 (FR-015, OD-4).
- T-C5 `GET /api/v1/me/customer/defaults` for B2C returns the Organization defaults (FR-014).
- T-C6 admin `GET /api/v1/admin/customers/:id/addresses` for a B2C customer lists the Organization
  book; `POST` → 409 (FR-016).
- T-C7 `check:error-translations` and the error-code ledgers
  (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`) accept the new code.

**Off-state**
- T-O1 `customers` off: the merge worker is not registered; `mine/addresses` works for a B2C
  customer; turning `customers` on and booting runs the merge (FR-017).
- T-O2 storefront nav with `customers` absent: link shown for a personal Organization's member,
  hidden for a company member; `/addresses` redirects the latter (FR-018) — extend
  `storefront/test/account/module-presence-nav.test.tsx`.

**Storefront** (`storefront/test/account/`, both locales)
- T-S1 `/addresses` for a personal Organization's member, EN and PL: one list from
  `listAddresses` (organization API), heading "My addresses" / "Moje adresy", no
  "Organization addresses" / "Adresy organizacji" section; add, remove, make-default call the
  organization API (FR-001, 002, 004, 019).
- T-S2 `/addresses` for a company member: unchanged — personal list plus shared section (FR-020);
  extend `storefront/test/account/i18n/account-pages.test.tsx`.
- T-S3 round trip, EN and PL: one in-memory fake of `/organizations/mine/addresses` shared by the
  checkout action (`buildPlaceOrderPayload` with typed fields) and the `/addresses` page — the
  address typed at checkout is listed on `/addresses`; an address added on `/addresses` is offered
  by checkout's `AddressSection` (FR-002, FR-003; the issue's *Expected*).
- T-S4 `/organization/addresses` still redirects a personal Organization's member to `/addresses`
  and renders unchanged for a company member through the shared component.

**Admin**
- T-A1 `AddressesPanel` for a B2C customer: lists the Organization book, no add form, hint shown,
  EN and PL keys present.

**Manual, on demo** (after merge): register a B2C account, add an address on "Moje adresy",
check checkout; place an order with a typed address, check "Moje adresy"; repeat in the other
language; open the customer in the admin.

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I. Modular architecture (NN) | **Pass.** `customers` reaches `addresses`, `organizations`, `customer_accounts` only through published ports already in its `dependencies`; no migration reads or writes a foreign table; no new manifest edge. |
| II. API-first | **Pass.** Contract changes (error code, optional `mergeRefusal`) land in `packages/contracts` first (WP-1). Breaking behaviour flagged and released as such. |
| III. TDD (NN) | **Pass.** Test plan above; every FR traced. |
| IV. YAGNI & minimal dependencies | **Pass.** No new dependency, module, table or permission. |
| V / VI / VIII | **Pass.** English artefacts; names follow existing patterns (`*-worker.ts`, `*-service.ts`). |
| VII. SEO/performance | **Pass.** Account pages stay server components, `noindex` unchanged. |
| IX. UI reuse | **Pass.** One shared `AddressBook` component replaces two copies. |
| X. Scalable queue consumers | **Pass.** The merge is a BullMQ job in the worker process. |
| XI. Multi-tenant isolation (NN) | **Pass.** The canonical book is the Organization's; every write runs in `withOrgScope` of the account's own personal Organization; no org-less path is added. |
| XII. Channel scoping (NN) | **N/A.** Addresses are not channel-scoped. |
| XIII. Command Bus auditing (NN) | **Pass.** Customer and checkout writes are unchanged paths; the system merge records an audit row per address (the `anonymizeIfOrphaned` precedent for system writes), and `AddressService` audits each create. |
| XIV. Custom fields | **N/A.** |
| XV. Untouched core / overlay | **N/A.** Core change by design; no deployment-specific behaviour. |
| XVI. Command palette | **Pass**, unchanged: no new admin screen. |
| XVII. Operator-toggleable modules (NN) | **Pass, and improved**: the B2C book depends only on `nonDeactivatable` modules; the merge is gated; the unconditional `/addresses` link is fixed (finding 3). |

**Verdict: PASS**, conditional on OD-1 being ruled as recommended (the design rests on it).

## Complexity Tracking

No new runtime dependency, module, permission or table. Nothing to justify.

## Project Structure

```text
specs/173-b2c-address-book-merge/
├── spec.md
└── plan.md            # this file; research/data-model/contracts folded in (small feature)

packages/contracts/src/                         # WP-1: error code, optional mergeRefusal
packages/modules/customers/
├── src/migrations/<scaffolded>_customers_address_book_merge.ts       # WP-2
├── src/backend/services/address-book-merge-service.ts (+ .test.ts)   # WP-2
├── src/backend/workers/address-book-merge-worker.ts                  # WP-2
├── src/backend/services/customer-address-service.ts                  # WP-3 refusals
├── src/backend/services/customer-defaults-service.ts                 # WP-3
├── src/backend/routes.self.ts, routes.admin.ts, index.ts, manifest.ts # WP-2/3
├── src/admin/panels/ManagementPanels.tsx                             # WP-5
├── i18n/{en,pl}.json, docs/customers.md                              # WP-3/5/7
packages/modules/organizations/src/backend/services/personal-organization-service.ts  # WP-6 (OD-7)
storefront/components/account/AddressBook.tsx                         # WP-4
storefront/app/(account)/{addresses,organization/addresses}/page.tsx, layout.tsx  # WP-4
backend/test/{integration,contract}/customers/…, storefront/test/account/…        # with each WP
```

## Work packages and order

1. **WP-1 contracts** — error code, optional field. First.
2. **WP-2 merge** — migration (+ `composer:generate`), fingerprint, service, worker, boot enqueue,
   gating. Needs WP-1.
3. **WP-3 refusals and defaults** — self and admin routes, defaults service, i18n sentence. Needs WP-1.
4. **WP-4 storefront** — shared component, `/addresses` branch, nav. Needs WP-3's contract only for
   tests; **must ship in the same release as WP-2**, or B2C customers lose sight of their old
   addresses until the merge exists.
5. **WP-5 admin card.** Needs WP-3.
6. **WP-6 anonymisation** — only if OD-7 is ruled in.
7. **WP-7 docs and release** — `packages/modules/customers/docs/customers.md` and the Docusaurus
   user page in English and Polish (`specs/conventions/module-documentation.md`,
   `docs/docs/contributing/documentation-i18n.md`); changesets for contracts, customers,
   organizations (if WP-6), storefront; `breaking change` label; upgrade note on the merge window
   and the 409.

One merge request is reasonable (WP-1 – WP-5 + WP-7, WP-6 if ruled); split WP-4/WP-5 into a second
one only if review size demands it, keeping the same-release constraint.

Follow-ups to file when implementing: OD-3 (retire the B2B personal book), OD-6 (admin write to
Organization addresses), checkout duplicate addresses (spec *Edge Cases*), `quick_order`
personal-address eligibility vs FK (finding 2).

## Handoff summary for `endora-commerce-dev`

Implement only after the owner rules OD-1 – OD-7. With the recommended rulings:
the B2C "Moje adresy" page edits the personal Organization's book through
`/api/v1/organizations/mine/addresses`; a `customers` BullMQ job moves existing B2C personal-book
rows into it through `addressServicePort` (never SQL into `addresses`), de-duplicated by
`addressFingerprint`, Organization default wins, sources soft-deleted with
`merged_into_address_id`/`merged_at`/`merge_refusal` (new columns, `customers`' own migration,
scaffolded with `migration:new`); the personal-book API refuses writes for B2C with
`409 CUSTOMER_ADDRESS_BOOK_MERGED`; the admin card lists the Organization book read-only; the
`/addresses` nav link is gated on `customers` except for B2C. Start with WP-1, write T-U1/T-I1
before the service, and keep WP-2 and WP-4 in one release. Run `build:packages`, `composer:generate`,
`check:module-boundary`, `check:error-translations`, `check:command-coverage`, the targeted backend
tests and `pnpm --filter storefront run test` before reporting done.
