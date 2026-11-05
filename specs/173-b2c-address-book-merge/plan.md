# Implementation Plan: One address book — the Organization's, for every customer

**Branch**: `spec/762-address-book-merge` (design) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/173-b2c-address-book-merge/spec.md`; issue #762; owner rulings of 2026-11-05 (the
merge ruling on the issue, then two rounds on PR #768).
**Status**: design. Every decision is ruled except OD-13, a single confirmation that also settles
OD-2.

## Summary

Every customer has **one** address book: their Organization's (`addresses`, served at
`/api/v1/organizations/mine/addresses`). Checkout already reads and writes that book. The
`customers` personal book is **removed in this release**: its table, entity, services, routes, read
port, schemas, storefront client and admin form.

- **B2C**: "Moje adresy" (`/addresses`) renders the personal Organization's book.
- **Company members**: one "Adresy organizacji" entry; `/addresses` redirects there.
- **The table**: a `customers` migration drops `customer_addresses`, but **refuses to run while it
  holds a live row**. It checks only its own table. The upgrade note says what to do if it refuses.
- **Former endpoints**: they answer `410 CUSTOMER_ADDRESS_BOOK_RETIRED`.
- **Anonymisation**: blanks and soft-deletes the personal Organization's addresses.

No job, no new column, no new module, no new dependency, no new permission.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17; Next.js 15 / React 19; React 19 + Vite
**Primary Dependencies**: existing only
**Storage**: PostgreSQL. One `customers` migration that drops `customer_addresses`
**Testing**: Vitest — backend unit, contract and integration; storefront; admin
**Project Type**: web (backend modules + storefront + admin)
**Constraints**: Principle I (a migration touches only its own module's tables —
`check:module-boundary` R1/R2), XI, XIII, XVII
**Scale/Scope**: `customers` (deletion-heavy), `addresses` (one port method), `quick_order` (edge
removal, after #769), `contracts`, two storefront pages, one admin panel, docs

## Grounding (files read)

- `packages/modules/customers/src/backend/`: `entities/customer-address.entity.ts`,
  `services/customer-address-service.ts`, `services/customer-address-read-port.ts`,
  `services/customer-defaults-service.ts`, `services/customer-deletion-service.ts`,
  `routes.self.ts`, `routes.admin.ts`, `serializers.ts`, `index.ts`, `plugin.ts`, `../manifest.ts`,
  `../migrations/20260611T140404_customers_customer_addresses_init.ts`,
  `../admin/panels/ManagementPanels.tsx`
- `packages/modules/addresses/src/manifest.ts`, `src/backend/index.ts`,
  `services/address-service.ts`, `services/address-ports.ts`
- `packages/modules/organizations/src/backend/routes.customer.ts`,
  `services/personal-organization-service.ts` (`anonymizeIfOrphaned`)
- `packages/modules/orders/src/backend/services/order-service.ts` (`ADDRESS_NOT_OWNED`)
- `packages/modules/quick_order/src/manifest.ts`, `src/backend/index.ts`
  (`customerAddressesOrAbsent`), `services/default-preference-service.ts`
- `packages/contracts/src/customers.ts`, `errors.ts`, `addresses.ts`, `organizations.ts`
- `storefront/app/(account)/addresses/page.tsx`, `organization/addresses/page.tsx`, `layout.tsx`,
  `app/(commerce)/checkout/page.tsx`, `lib/api/customers.ts`, `lib/api/organization.ts`,
  `lib/account/organization-area.ts`
- `specs/170-organization-roles/spec.md`, `specs/conventions/module-migrations.md` (items 4, 4a,
  5), `module-composition.md` (item 9), `module-activation.md`, `module-i18n.md`,
  `release-intent.md`
- Pre-migration, cited: `specs/040-*`, `specs/051-*`, `specs/097-migration-sql-boundary/`.

**Everything outside `packages/modules/customers` that names the personal book** (from
`rg "customer_addresses|CustomerAddress\b|customerAddressReadPort|CUSTOMER_ADDRESS_NOT_FOUND|me/customer/addresses|customerAddressInputSchema|customerAddressBookSchema"`).
Every hit must be changed in the same merge request. This is the AGENTS.md trap about deleting
files and ignoring what is derived from them:

| Path | Change |
| --- | --- |
| `packages/contracts/src/customers.ts`, `errors.ts` | delete the schemas, the read-port types and `CUSTOMER_ADDRESS_NOT_FOUND`; add `CUSTOMER_ADDRESS_BOOK_RETIRED` |
| `packages/modules/quick_order/src/manifest.ts`, `src/backend/index.ts`, `services/default-preference-service.ts` | delete the `customerAddressReadPort` edge, `customerAddressesOrAbsent` and the personal branch (whatever #769 has not removed already) |
| `packages/modules/customer_accounts/src/manifest.ts` | comment only |
| `packages/demo-composition/src/demo-usage.ts` | delete the `delete from customer_addresses` reset statement; demo reset would fail on a missing table |
| `backend/scripts/check-error-translations.ts` | drop `CUSTOMER_ADDRESS_NOT_FOUND` from the untranslated list |
| `backend/test/fixtures/error-code-routing/{reference-ledgers,chain-answers}.ts` | re-derive |
| `backend/test/fixtures/openapi-baseline.json` | regenerate |
| `backend/test/helpers/package-entities.ts` | drop the entity |
| `backend/test/integration/customers/customer-address-service.test.ts` | delete |
| `backend/test/contract/customers/{addresses-defaults,customer-response-schema}.contract.test.ts` | rewrite (T-C1, T-C2) |
| `backend/test/integration/demo/demo-reset-after-use.test.ts` | drop the seeded row |
| `backend/test/integration/tenancy/customer-scoped-allowed-set.test.ts` | it uses `CustomerAddress` as its `@CustomerScoped` example; re-point it to another `@CustomerScoped` entity, or delete the case if none remains |
| `backend/test/unit/quick_order/default-preference-eligibility.test.ts` | personal cases go (#769 may already have done this) |
| `storefront/lib/api/customers.ts` | delete the address functions |
| `docs/docs/module-reference/quick-order.md`, `docs/docs/upgrading-an-instance.md`, `packages/modules/customers/docs/customers.md` and their Polish counterparts under `docs/i18n/pl/…` (`module-reference/quick-order.md`, `modules/customers.md`, `upgrading-an-instance.md`) | update, and add the upgrade note (EN + PL) |

Also derived, so re-run and commit:

- `composer:generate`, for the entity and migration registries;
- `manifests:generate` with `pnpm install --lockfile-only`, if the manifest edge change alters a
  rendered peer;
- `test/unit/db/module-graph.test.ts` and `test/unit/kernel/module-removal.test.ts` (the residue
  ledger);
- the tenant-classification check's ledger, if it counts `customer_addresses`.

## Decisions

### OD-1 — Canonical book — **resolved 2026-11-05, as recommended**

**Ruling**: the personal Organization's book.

**Rationale**: checkout and orders use only this book. The Organization is the tenant
(Principle XI), and the owners are `nonDeactivatable`.

**Rejected**: making the personal book canonical, which would need `orders` → `customers`, the
dead switch `module-composition.md` item 4a forbids. Also rejected: two books.

### OD-2 — Existing B2C rows — **ruled 2026-11-05 (automatic one-time move); superseded, pending OD-13**

The first ruling chose a one-time move by a `customers` BullMQ job writing through
`addressServicePort`. The later rulings (OD-9: delete at once; OD-12: remove the table in this
release) make that job unbuildable as specified. Migrations run before the platform composes, so a
job cannot move rows out of a table that a migration of the same release has already dropped. The
options:

| Option | Verdict |
| --- | --- |
| **A. Guarded drop**: the `customers` migration drops the table, but refuses while any live row exists | **Recommended.** It is one migration and no job. It cannot lose data silently. It matches the owner's facts (no company-member rows; 0 rows locally; demo seeds none). It reads only its own table, so classifying B2C against company rows is not needed: any live row stops it. |
| B. Keep the move job and drop the table in a later release | Contradicts OD-12 (this release). It costs a job, three columns, a fingerprint, crash-safety logic and their tests, for rows that probably do not exist. |
| C. Move job that drops the table itself when done | Rejected: it is DDL outside a migration, so the schema drifts from the migration registry, and the job would run in a process that holds no migration lock. |
| D. Unguarded drop | Rejected: silent data loss wherever the owner's facts do not hold. |

The plan is written for **A**. This is recorded as superseded, not overridden: OD-13 asks the owner
to confirm.

### OD-3 — Personal book for company members — **resolved 2026-11-05, changed: retired for everyone**

### OD-4 — Permissions — **resolved 2026-11-05, as recommended**

**Ruling**: no new permission. A personal Organization's member holds *Administrator*
(`specs/170-organization-roles/` FR-070a), which holds everything and cannot be edited.
`addresses.manage` is also a *Member* default. T-C4 asserts this.

### OD-5 / OD-8 — Refusal — **resolved 2026-11-05: `410 Gone`, `CUSTOMER_ADDRESS_BOOK_RETIRED`, for everyone**

**Decision on scope**: thin tombstone routes in `customers` answer every former endpoint with this
code:

- `GET` and `POST /api/v1/me/customer/addresses`
- `PATCH` and `DELETE …/:addressId`
- `PUT …/:addressId/default`
- `POST /api/v1/admin/customers/:id/addresses`

The sentence goes in `customers/i18n/{en,pl}.json`. The tombstones are a few lines and are
gated like every `customers` route. Removing them later is routine cleanup, not a decision for this
feature.

`PUT /api/v1/me/customer/defaults` with `billingAddressId` or `shippingAddressId` answers the same
code. Address defaults are now set in the Organization book. The method fields are unchanged.

**Rejected**: dropping the routes outright (an unexplained 404), or silently ignoring the address
fields on `PUT`.

### OD-6 — Admin card — **resolved 2026-11-05, as recommended: read-only**

`GET /api/v1/admin/customers/:id/addresses` stays in `customers` (gate `customers:read`). It
answers `{ organization: OrganizationAddressRef[] }` from `addressReadPort`; the `personal` array
goes. The panel lists that array and has no form.

**Rejected**: calling `organizations`' `/api/v1/admin/organizations/:id/addresses` from the
`customers` panel, because it asks for a different admin permission than the screen it sits on.
Admin editing of Organization addresses is a separate follow-up.

### OD-7 — Anonymisation — **resolved 2026-11-05, as recommended: cleared and blanked**

`addresses` gains `anonymizeForOrganization(organizationId): Promise<number>` on
`AddressServicePort`. It works on every live address of the Organization:

- it sets `recipientName`, `street`, `city` and `postalCode` to `'-'`, `phone` to `null` and
  `isDefault` to `false`;
- it keeps `country`;
- it sets `deletedAt`;
- it audits `address.anonymized` with a null actor (the `anonymizeIfOrphaned` precedent).

`CustomerDeletionService.sweep` (`customers`) calls it when
`personalOrganizations.anonymizeIfOrphaned(customer.id)` returns an Organization. `customers`
already depends on `addresses`, and `organizations` decides whether the scrub applies, so no new
edge is needed.

**Rejected**: two port calls per address (`updateAddress` then `deleteAddress`), which give two
audit rows and a gap between them. Also rejected: calling it from `organizations`, which does not
declare `addresses`.

### OD-9, OD-10, OD-12 — **resolved 2026-11-05**

- OD-9: delete at once.
- OD-10: not needed.
- OD-12: removal in this release.

### OD-11 — Company member navigation — **resolved 2026-11-05, as recommended**

One "Adresy organizacji" entry; `/addresses` redirects there.

### OD-13 — **open**: confirm that no live B2C rows exist either, and accept the guarded drop

**Recommendation**: confirm, and accept option A. Before ruling, the owner can run the count query
(§ Counting) on production.

**Contingency if an installation's migration refuses** (written into the upgrade note):

1. Run the count query and look at the populations.
2. If the rows may go, run `delete from customer_addresses;` (the module's own table; the
   upgrade note gives the statement) and re-run the migration.
3. If they must be kept, stay on the previous release and report it. The move job from OD-2's first
   ruling is then shipped as a patch release that runs before the drop.

Nothing is lost while the operator decides, because the refusal happens before any DDL.

## Data migration

A single `customers` migration, scaffolded with `pnpm --filter backend run migration:new`, then
`composer:generate`. The applied init migration stays, because history is never edited
(`module-migrations.md` item 5).

```ts
override async up(): Promise<void> {
  const [{ live }] = await this.execute(
    `select count(*)::int as live from "customer_addresses" where "deleted_at" is null`,
  );
  if (live > 0) {
    throw new Error(
      `customers: refusing to drop "customer_addresses" — ${live} live personal-book address(es) ` +
      `remain. The personal address book was retired in feature 173; see the upgrade note ` +
      `"Personal address book removed" in docs/docs/upgrading-an-instance.md before re-running.`,
    );
  }
  this.addSql('drop table "customer_addresses";');
}
override async down(): Promise<void> {
  // Re-creates the empty table exactly as 20260611T140404 did; rows are not recoverable.
}
```

The migration touches only `customer_addresses`, so `check:module-boundary` has nothing to judge.
Soft-deleted rows go with the table. They were already invisible, and their personal data goes
with them.

## Counting

**Local development database** (`localhost:5432/b2b`, 2026-11-05): `customer_addresses` holds
**0 rows**, live or deleted. The database is nearly fresh: 1 company Organization, no personal
Organizations. Demo seeding creates no personal-book rows. The owner states that company members
have none on demo or production.

**Production / any installation**: a read-only operational query, run before upgrading. It is also
the query the upgrade note gives:

```sql
select
  count(*) filter (where ca.deleted_at is null)                           as live,            -- the migration refuses if > 0
  count(*) filter (where ca.deleted_at is null and o.is_personal)         as live_b2c,        -- OD-13
  count(*) filter (where ca.deleted_at is null and o.is_personal = false) as live_company,    -- owner: 0
  count(*) filter (where ca.deleted_at is null and o.id is null)          as live_no_org
from customer_addresses ca
join customer_accounts acc on acc.id = ca.customer_account_id
left join organizations o on o.id = acc.organization_id;
```

## API and contract changes

The release is labelled `breaking change`. The changesets for `@endora-commerce/contracts`,
`customers`, `addresses` and `quick_order` carry the upgrade note (`release-intent.md`).

| Surface | Change |
| --- | --- |
| `ERROR_CODES` | add `CUSTOMER_ADDRESS_BOOK_RETIRED`; delete `CUSTOMER_ADDRESS_NOT_FOUND` (no raise site remains); update the `customers` manifest `errorCodes` and i18n accordingly |
| Every former `/api/v1/me/customer/addresses*` route and admin `POST …/:id/addresses` | `410 CUSTOMER_ADDRESS_BOOK_RETIRED` |
| `GET /api/v1/me/customer/defaults` | address fields from `addressReadPort.findDefault` on the caller's Organization |
| `PUT /api/v1/me/customer/defaults` | an address field → `410`; method fields unchanged |
| `GET /api/v1/admin/customers/:id/addresses` | `{ organization: OrganizationAddressRef[] }` |
| `customerAddressSchema`, `customerAddressInputSchema`, `customerAddressBookSchema`, `CustomerAddressRecord`, `CustomerAddressReadPort` | deleted |
| `AddressServicePort` | `anonymizeForOrganization` added |
| `/api/v1/organizations/mine/addresses` | unchanged |

## Storefront changes

- `storefront/components/account/AddressBook.tsx` *(new)*: the table, *Make default*, *Remove* and
  the add form, extracted from `organization/addresses/page.tsx`. Props: the addresses, `canManage`,
  the actions and the heading key (Principle IX).
- `app/(account)/addresses/page.tsx`:
  - personal Organization → `AddressBook` over `lib/api/organization.ts`, heading
    `account.addresses.heading` ("My addresses" / "Moje adresy");
  - company → redirect to `/organization/addresses`;
  - no Organization → redirect to `/account`.
- `app/(account)/organization/addresses/page.tsx`: renders through `AddressBook`. The #757 redirect
  stays.
- `app/(account)/layout.tsx`: B2C sees "Moje adresy" → `/addresses`. A company member sees only
  "Adresy organizacji". An org-less customer sees no address entry. This closes the old gap where
  the link to a `customers` page was unconditional, because no `customers` page is linked any more.
- `lib/api/customers.ts`: delete the address functions and types.
- Checkout and `lib/api/organization.ts`: no change.
- i18n: no new storefront key. Delete `account.addresses.shared.*` and any `account.addresses.*`
  key left unused, after a usage check, in both languages.

## Admin changes

`AddressesPanel` (`packages/modules/customers/src/admin/panels/ManagementPanels.tsx`) lists
`organization` read-only and drops the form and its unsaved-changes guard. Keys unused afterwards
are deleted from `customers/i18n/{en,pl}.json`. There is no permission or palette change.

## Off-state

| Module | Can be off? | With it off |
| --- | --- | --- |
| `addresses`, `organizations` | no | — |
| `customers` | yes | Address pages and checkout are unchanged (served by `organizations`). The admin card, the `410` tombstones and the anonymisation sweep are absent, as they are today for an absent module. |
| `quick_order` | yes | unaffected; it no longer refers to `customers` for addresses |

## Test plan

Write the failing test first (Principle III).

- **T-M1** (integration, migration): with a live row, `up` throws the message and the table still
  exists. With only soft-deleted rows, or none, the table is dropped. `down` re-creates it empty
  (FR-006).
- **T-C1** (contract): every former endpoint → `410 CUSTOMER_ADDRESS_BOOK_RETIRED`, message in `pl`
  and `en` by `Accept-Language` (FR-007, FR-013; SC-003).
- **T-C2** (contract): `GET /me/customer/defaults` returns the Organization defaults. `PUT` with an
  address field → `410`. `PUT` with method fields only still works (FR-008).
- **T-C3** (contract): admin `GET /admin/customers/:id/addresses` returns the Organization book
  (FR-010).
- **T-C4** (contract): a personal Organization's member `POST/PATCH/DELETE
  /organizations/mine/addresses` → 201/200/204 (FR-009).
- **T-U1** (unit, `addresses`): `anonymizeForOrganization` blanks, soft-deletes, keeps the country
  and audits each row.
- **T-I1** (integration): the retention sweep for an anonymised B2C customer blanks and soft-deletes
  the personal Organization's addresses. Order snapshots are unchanged, and company Organizations
  are untouched (FR-011).
- **T-K1**: `check:error-translations`, the error-code ledgers, the OpenAPI baseline, the module-graph
  and residue-ledger tests, and `quick_order`'s composition without `customerAddressReadPort` all
  pass after re-derivation (FR-012).
- **T-S1** (storefront, EN and PL): B2C `/addresses` is one list from the Organization API under
  "My addresses" / "Moje adresy", with no shared section. Add, remove and make-default hit the
  Organization API (FR-001, FR-002).
- **T-S2** (storefront): a company member's navigation shows one address entry, and `/addresses`
  redirects. An org-less customer's `/addresses` redirects to `/account` (FR-004). Extend
  `storefront/test/account/module-presence-nav.test.tsx` and
  `storefront/test/account/i18n/account-pages.test.tsx`.
- **T-S3** (storefront, EN and PL): round trip with one in-memory fake of
  `/organizations/mine/addresses`. A B2C address typed at checkout is listed on `/addresses`, and
  one added there is offered at checkout (FR-003; SC-001).
- **T-A1** (admin): the panel lists the Organization book with no form, in EN and PL.
- **Manual, on demo**: as a B2C customer, add on "Moje adresy" and check checkout; type at checkout
  and check "Moje adresy"; switch language. As a company member, check the navigation and the
  redirect. Open the customer in the admin.

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I. Modular architecture (NN) | **Pass.** The migration touches only its own table. The edges used already exist, and one (`quick_order` → `customers`) is removed. |
| II. API-first | **Pass.** Contracts change first; the breaking changes are released as such. |
| III. TDD (NN) | **Pass.** Every FR is traced above. |
| IV. YAGNI | **Pass.** A table, a port and a set of routes leave; nothing is added but one port method and one error code. |
| V / VI / VIII | **Pass.** |
| VII | **Pass.** Account pages stay `noindex` server components. |
| IX. UI reuse | **Pass.** One `AddressBook` component for both pages. |
| X | **N/A.** No job any more. |
| XI. Tenancy (NN) | **Pass.** The Organization book is the only book; the `withSystemScope` widenings of `CustomerAddressService` disappear with it. |
| XII, XIV, XV | **N/A.** |
| XIII. Auditing (NN) | **Pass.** The writes that remain are `AddressService`'s, which audit themselves; anonymisation audits each row. |
| XVI | **Pass**, unchanged. |
| XVII (NN) | **Pass, improved.** No address surface depends on a switchable module. |

**Verdict: PASS.** OD-13 changes no verdict.

## Complexity Tracking

No new runtime dependency, module, permission, table, column or job.

## Work packages and order

Prerequisite: **#769 merged**.

1. **WP-1 contracts**: add the error code; delete the schemas, the read-port types and
   `CUSTOMER_ADDRESS_NOT_FOUND`; add `anonymizeForOrganization` to the port type.
2. **WP-2 `customers` backend**: the guarded drop migration; delete the entity, the services, the
   read-port provider, the serializers and the address routes; add the tombstones; defaults from the
   Organization book; admin `GET`; the i18n sentence; `composer:generate`.
3. **WP-3 `addresses` + anonymisation**: the port method, and the sweep call in `customers`.
4. **WP-4 `quick_order`**: remove whatever of the edge #769 left.
5. **WP-5 storefront**: `AddressBook`, both pages, the navigation, and the client deletions.
6. **WP-6 admin panel.**
7. **WP-7 tests, derived artefacts and docs**: everything in the grounding table above, the upgrade
   note in English and Polish, the changesets, and the `breaking change` label.

One merge request. Before reporting done, run:

- `build:packages`, `composer:generate` and `manifests:generate` (with
  `pnpm install --lockfile-only`);
- `pnpm -r run typecheck` and `lint`;
- `check:module-boundary`, `check:error-translations` and `check:command-coverage`;
- the targeted backend tests, **including the contract and integration trees** (`test:unit:fast`
  does not see deleted-file breakage);
- `pnpm --filter storefront run test` and `pnpm --filter '!backend' run test`;
- a `rg` for every deleted path over `backend/test/**`.

**Follow-ups**: admin editing of Organization addresses (OD-6); duplicate addresses created by
checkout.

## Handoff summary for `endora-commerce-dev`

Implement after #769 is merged and OD-13 is confirmed.

- Delete the `customers` personal address book end to end.
- Drop `customer_addresses` through a `customers` migration that refuses while live rows exist.
- Answer every former endpoint with `410 CUSTOMER_ADDRESS_BOOK_RETIRED` (en+pl). Serve
  `/me/customer/defaults` address fields and the admin card from the Organization book.
- Add `addresses`' `anonymizeForOrganization` and call it from the retention sweep.
- Make B2C `/addresses` render the Organization book through a shared `AddressBook`. Redirect
  company members to `/organization/addresses`, with one address entry in their navigation.
- Re-derive every artefact in the grounding table in the same merge request.
