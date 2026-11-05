# Implementation Plan: One address book — the Organization's, for every customer

**Branch**: `spec/762-address-book-merge` (design) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/173-b2c-address-book-merge/spec.md`; issue #762; owner rulings of 2026-11-05 (the
merge ruling on the issue, then three rounds on PR #768).
**Status**: ready. Every owner decision is resolved. Two releases, with two work packages each.

## Summary

Every customer has **one** address book, their Organization's. It lives in `addresses` and is
served at `/api/v1/organizations/mine/addresses`, which checkout already uses. The `customers`
personal book is retired across two releases.

**Release 1 — retire and empty the personal book**

- B2C: "Moje adresy" (`/addresses`) shows the personal Organization's book.
- Company members: one "Adresy organizacji" entry, and `/addresses` redirects there.
- Every former personal-book endpoint answers `410 CUSTOMER_ADDRESS_BOOK_RETIRED`.
- A one-time `customers` BullMQ job processes the existing rows:
  - It **moves** live B2C rows into the personal Organization's book through `addressServicePort`.
    It removes duplicates, keeps the Organization default, soft-deletes each source row with a link
    to its new row, writes one audit entry per row, and marks refused rows for the operator.
  - It **erases** every other live row: blanks the fields, soft-deletes the row, writes an audit
    entry.
- Anonymisation blanks and soft-deletes the personal Organization's addresses (OD-7).
- `CustomerAddressReadPort` and `quick_order`'s wiring to it go (after #769).

**Release 2 — drop**

- A `customers` migration drops `customer_addresses`. It refuses while any live row exists.
- The entity, the job, the 410 stubs, the error code and the remaining schemas go.

Nothing new is added: no module, runtime dependency or permission. Release 1 adds three provenance
columns to `customers`' own table, and release 2 drops the table.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17; Next.js 15 / React 19; React 19 + Vite
**Primary Dependencies**: existing only (MikroORM, Zod, BullMQ, Fastify)
**Storage**: PostgreSQL. Release 1 runs one `customers` migration that adds columns. Release 2 runs
one `customers` migration that drops the table
**Testing**: Vitest — backend unit, contract and integration tests; storefront; admin
**Constraints**: Principle I (a migration touches only its own module's tables —
`check:module-boundary` R1/R2), X, XI, XIII, XVII
**Scale/Scope**: `customers`, `addresses` (one port method), `quick_order` (edge removal),
`contracts`, two storefront pages, one admin panel, docs

## Grounding (files read)

- `packages/modules/customers/src/`:
  - `backend/entities/customer-address.entity.ts`
  - `backend/services/customer-address-service.ts`, `customer-address-read-port.ts`,
    `customer-defaults-service.ts`, `customer-deletion-service.ts`
  - `backend/workers/anonymization-sweep-worker.ts`
  - `backend/routes.self.ts`, `routes.admin.ts`, `serializers.ts`, `index.ts`, `plugin.ts`
  - `manifest.ts`
  - `migrations/20260611T140404_customers_customer_addresses_init.ts`
  - `admin/panels/ManagementPanels.tsx`
- `packages/modules/addresses/src/manifest.ts`, `src/backend/index.ts`,
  `services/address-service.ts`, `services/address-ports.ts`
- `packages/modules/organizations/src/backend/routes.customer.ts`,
  `services/personal-organization-service.ts` (`anonymizeIfOrphaned`)
- `packages/modules/orders/src/backend/services/order-service.ts` (`ADDRESS_NOT_OWNED`)
- `packages/modules/quick_order/src/manifest.ts`, `src/backend/index.ts`,
  `services/default-preference-service.ts`
- `packages/modules/quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts` (the Principle X
  pattern)
- `packages/contracts/src/customers.ts`, `errors.ts`, `addresses.ts`, `organizations.ts`
  (`OrganizationDetailsPort`)
- `packages/platform/src/tenancy/escape-hatch.ts` (`withOrgScope`)
- `storefront/app/(account)/addresses/page.tsx`, `organization/addresses/page.tsx`, `layout.tsx`,
  `app/(commerce)/checkout/page.tsx`, `lib/api/customers.ts`, `lib/api/organization.ts`,
  `lib/account/organization-area.ts`
- `specs/170-organization-roles/spec.md`
- `specs/conventions/module-migrations.md` (items 4, 4a, 5), `module-composition.md` (items 9,
  9a), `module-activation.md`, `module-i18n.md`, `check-inventory.md`, `release-intent.md`
- Pre-migration, cited: `specs/040-*`, `specs/051-*`, `specs/097-migration-sql-boundary/`

### Findings

1. The personal book is unusable for ordering by anyone. `OrderService` answers
   `403 ADDRESS_NOT_OWNED` for any address outside the caller's Organization book.
2. `quick_order` accepts personal-book ids that its foreign keys reject. That is #769, fixed in
   parallel.
3. The `/addresses` link in `storefront/app/(account)/layout.tsx` is shown unconditionally,
   although `customers` (which serves that page today) can be switched off. Release 1 closes this
   by no longer linking to any `customers` page.
4. The retention sweep scrubs no saved address (OD-7).
5. The personal book never had country validation, but `AddressService.createAddress` validates
   the country. A row with a country that is no longer active is therefore refused during the move.

## Decisions

Each decision is set out as: decision → rationale → alternatives rejected.

### OD-1 — Canonical book — resolved 2026-11-05, as recommended

The personal Organization's book. Checkout and orders use only this book. The Organization is the
tenant (Principle XI), and the modules that own the book are `nonDeactivatable`.

Rejected: making the personal book canonical. That would need an `orders` → `customers` edge,
which is the dead switch `module-composition.md` item 4a forbids. Also rejected: keeping two books.

### OD-2 — The one-time move — resolved 2026-11-05; reinstated 2026-11-05 by OD-13

The release-1 job moves B2C rows (R-1, § Release 1 data). It was briefly superseded by the
single-release plan. OD-13 restores it.

### OD-3 — Retired for everyone — resolved 2026-11-05, changed from the recommendation

### OD-4 — Permissions — resolved 2026-11-05, as recommended

No new permission. A personal Organization's member holds *Administrator*
(`specs/170-organization-roles/` FR-070a), which holds every permission and cannot be edited.
`addresses.manage` is also a *Member* default.

### OD-5 / OD-8 — The refusal — resolved 2026-11-05: `410 Gone`, `CUSTOMER_ADDRESS_BOOK_RETIRED`, for everyone

In release 1, stub routes in `customers` answer every former endpoint with this refusal:

- `GET` and `POST /api/v1/me/customer/addresses`
- `PATCH` and `DELETE …/:addressId`
- `PUT …/:addressId/default`
- `POST /api/v1/admin/customers/:id/addresses`
- a `PUT /api/v1/me/customer/defaults` body that carries `billingAddressId` or `shippingAddressId`

`GET` and `DELETE` are refused too. They serve a book that no longer exists for its customer: B2C
rows move, the rest are erased, and no per-row removal UI remains (ruled). The sentence goes in
`customers/i18n/{en,pl}.json`.

**Release 2 (my judgement, as asked): the stub routes go, and so does the error code.** A full
release of `410` is the retirement signal. The owner notes that no external client probably uses
the API. After release 2 a call gets the platform's ordinary `404`, like any unknown route. The
address fields leave the `PUT /me/customer/defaults` schema. The `GET` keeps reporting them, read
from the Organization book.

Rejected: keeping the stubs forever. They would be code with no backing table, behind a module
toggle, answering a question nobody asks.

### OD-6 — The admin card — resolved 2026-11-05, as recommended

The card is read-only. `GET /api/v1/admin/customers/:id/addresses` (gate `customers:read`)
answers:

- in release 1, `{ organization, personal }`, where `personal` holds only the refused rows, each
  with `mergeRefusal`;
- in release 2, `{ organization }`.

The panel lists both lists and has no form. Admin editing of Organization addresses is a separate
follow-up.

### OD-7 — Anonymisation — resolved 2026-11-05: cleared and blanked

`addresses` gains `anonymizeForOrganization(organizationId): Promise<number>` on
`AddressServicePort`. It sets `recipientName`, `street`, `city` and `postalCode` to `'-'`, sets
`phone` to `null` and `isDefault` to `false`, keeps `country`, sets `deletedAt`, and audits
`address.anonymized` with a null actor. `CustomerDeletionService.sweep` calls it whenever
`anonymizeIfOrphaned` returns an Organization. `customers` already depends on `addresses`, so this
adds no edge.

Rejected:
- `updateAddress` followed by `deleteAddress`: two audit rows and a window between them.
- Calling it from `organizations`, which does not declare `addresses`.

### OD-9 / OD-10 — resolved 2026-11-05

Non-B2C rows are erased at once by the job, with no notice period.

### OD-11 — resolved 2026-11-05, as recommended

A company member has one "Adresy organizacji" entry, and `/addresses` redirects there.

### OD-12 — resolved 2026-11-05; amended 2026-11-05 by OD-13

The table and the remaining code go in **release 2**.

### OD-13 — resolved 2026-11-05: two releases

Release 1 retires the book and runs the job. Release 2 runs the guarded drop. This resolves the
ordering problem: migrations run before the platform composes, so a job cannot empty a table that a
migration of the same release has already dropped.

### R-1 — The job's mechanism

A `customers`-owned BullMQ job (Principle X), run by the worker process and registered through
`defineModuleWorker`, so it runs only while `customers` is present. It is enqueued at every boot
under the fixed id `customers:address-book-retirement`. BullMQ de-duplicates a waiting job by id,
so `start` and `worker` together produce one run. The job loops in batches until no row is left to
process. On every later boot it finds nothing and exits.

It reads `customers`' own table. It reads accounts and Organizations through ports `customers`
already depends on: `customerAccountReadPort` and `organizationDetailsPort` (`isPersonal`). It
writes the Organization book only through `addressServicePort`, inside
`withOrgScope(organizationId, …)`.

| Rejected | Why |
| --- | --- |
| A `customers` migration inserting into `addresses` | R2: a write into another module's table |
| An `addresses` migration reading `customer_addresses` | R1: would need an `addresses` → `customers` edge, which makes a cycle and a dead switch |
| A `customers` `installHook` | It does not run on upgrade (`module-composition.md` item 9) |
| An `onBoot` reconciler | Runs in two processes with no lock, and a failure would stop the platform from starting |

### R-4 — What counts as a duplicate

Two rows are equal when they have the same `kind`, and these fields match after normalisation:

- `recipientName`, `street`, `city`: trimmed, inner whitespace collapsed, NFC, case-folded
- `postalCode`: whitespace removed, upper-case
- `country`: upper-case
- `phone`: digits and a leading `+` only; absent equals absent

This is one pure function, `addressFingerprint`. Diacritics are not folded. A false merge loses an
address; a false non-merge shows one twice.

### R-5 — Columns (release 1, `customers`' own table)

- `merged_into_address_id uuid null`: provenance only, never joined, so no foreign key
- `merged_at timestamptz null`
- `merge_refusal varchar(64) null`
- a partial index on `("customer_account_id")` where `"deleted_at" is null and "merge_refusal" is null`

## Release 1

### WP-1.1 — Backend: contracts, `customers`, `addresses`, `quick_order`

**Migration** (scaffolded with `pnpm --filter backend run migration:new`, then
`composer:generate`). It adds R-5's columns and index, and `down` drops them. It touches only
`customer_addresses`.

**Job** — `customers/src/backend/workers/address-book-retirement-worker.ts` is a thin class over
`services/address-book-retirement-service.ts`. Each batch of up to 100 accounts is selected by
keyset over live rows where `merge_refusal is null`. Each account is classified through the two
ports, then handled in one transaction per account with `select … for update` on its rows:

- **B2C (move)**, inside `withOrgScope(organizationId, 'customers: moving the personal address book
  of account <id> into its personal organization (#762)', …)`:
  1. Read `addressServicePort.list(organizationId)` and fingerprint it.
  2. For each row, oldest first, do one of two things:
     - If an equal address already exists, link the row to it.
     - Otherwise call `createAddress(…, { isDefault: row.isDefault && the book has no default of
       that kind yet })`.
  3. Set `merged_into_address_id`, `merged_at`, `deleted_at`, and `is_default = false`.
  4. Audit `customer_address.merge` with a null actor (the `anonymizeIfOrphaned` precedent, which
     satisfies `check:command-coverage`).
  5. If the owner refuses the write with an `HttpError`, store its code in `merge_refusal`, leave
     the row live, and continue.

  **Crash safety.** The process may die between the Organization write and the source update. The
  next run then finds the address it already created and links it instead of creating a second one.
- **Company member or org-less account (erase)**: set `recipient_name`, `street`, `city` and
  `postal_code` to `'-'`, set `phone` to null and `is_default` to false, set `deleted_at`, and audit
  `customer_address.erased`. This touches only `customers`' own table.
- **Summary** logged at `info`: `{ accounts, moved, deduplicated, erased, refused }`.

**Routes and services**:
- add the 410 stubs (OD-8);
- replace the address part of `customer-defaults-service.ts` with `addressReadPort.findDefault`;
- admin `GET` returns `{ organization, personal: refused rows }`;
- delete `CustomerAddressService`, which is replaced by the job service and the stubs;
- delete the read-port provider and `serializeCustomerAddress`'s write uses;
- `CustomerDeletionService.sweep` calls `anonymizeForOrganization`.

**`addresses`**: add `anonymizeForOrganization` (OD-7). **`quick_order`**: remove what #769 left of
`customerAddressReadPort`, namely the `nonBindingDependencies` entry, `customerAddressesOrAbsent`
and the personal branch.

**Contracts**:
- add `CUSTOMER_ADDRESS_BOOK_RETIRED`;
- delete `CUSTOMER_ADDRESS_NOT_FOUND`, since no code raises it any more;
- delete `CustomerAddressReadPort`, `CustomerAddressRecord` and `customerAddressInputSchema`;
- add an optional `mergeRefusal` to `customerAddressSchema`;
- add `anonymizeForOrganization` to `AddressServicePort`.

### WP-1.2 — Storefront, admin, docs

**Storefront**:
- `storefront/components/account/AddressBook.tsx` (new, shared; Principle IX) holds the table,
  *Make default*, *Remove* and the add form, extracted from `organization/addresses/page.tsx`.
- `app/(account)/addresses/page.tsx`: a personal Organization gets `AddressBook` over
  `lib/api/organization.ts`, headed `account.addresses.heading` ("My addresses" / "Moje adresy"). A
  company member is redirected to `/organization/addresses`. A customer with no Organization is
  redirected to `/account`.
- `organization/addresses/page.tsx` renders through `AddressBook`, and keeps the #757 redirect.
- `layout.tsx`: B2C sees "Moje adresy". A company member sees only "Adresy organizacji". An
  org-less customer sees no address entry. This closes finding 3.
- `lib/api/customers.ts`: delete the address functions.
- Checkout is unchanged.
- No new storefront key is needed. Delete `account.addresses.shared.*` and any key left unused, in
  both languages.

**Admin**: `AddressesPanel` lists the Organization book read-only, then refused rows with their
reason. It drops the form. New keys `detail.addresses.organizationBook` and
`detail.addresses.refused` go in `customers/i18n/{en,pl}.json`, and unused keys are deleted.

**Docs and release**:
- `packages/modules/customers/docs/customers.md`, `packages/modules/addresses/docs/addresses.md`,
  `docs/docs/module-reference/quick-order.md`, and their Polish counterparts.
- A new upgrade note, "Personal address book retired (release 1 of 2)", in
  `docs/docs/upgrading-an-instance.md` and the Polish file. It covers the window before the job's
  first run, keeping `customers` on until the job finishes, the 410 answers, and the count query.
- Changesets for contracts, customers, addresses and quick_order, and the `breaking change` label.

### Release 1 — knock-on files outside `packages/modules/customers`

| Path | Change |
| --- | --- |
| `packages/contracts/src/customers.ts`, `errors.ts`, `addresses.ts` | as in WP-1.1 |
| `packages/modules/quick_order/src/{manifest.ts,backend/index.ts,backend/services/default-preference-service.ts}` | remove whatever #769 left |
| `packages/modules/customer_accounts/src/manifest.ts` | comment only |
| `backend/scripts/check-error-translations.ts` | drop `CUSTOMER_ADDRESS_NOT_FOUND` from the untranslated list |
| `backend/test/fixtures/error-code-routing/{reference-ledgers,chain-answers}.ts` | re-derive |
| `backend/test/fixtures/openapi-baseline.json` | regenerate |
| `backend/test/integration/customers/customer-address-service.test.ts` | delete; replaced by T-I1 – T-I6 |
| `backend/test/contract/customers/{addresses-defaults,customer-response-schema}.contract.test.ts` | rewrite (T-C1, T-C2) |
| `backend/test/unit/quick_order/default-preference-eligibility.test.ts` | remove the personal cases, unless #769 did |
| `storefront/lib/api/customers.ts` | delete the address functions |
| `storefront/test/account/{module-presence-nav.test.tsx,i18n/account-pages.test.tsx}` | extend or rewrite |
| docs listed in WP-1.2 | update |

These stay until release 2, because the table and the entity still exist:
`packages/demo-composition/src/demo-usage.ts` (the reset statement),
`backend/test/helpers/package-entities.ts`,
`backend/test/integration/demo/demo-reset-after-use.test.ts`, and
`backend/test/integration/tenancy/customer-scoped-allowed-set.test.ts`.

**Regenerate**:
- `composer:generate`;
- `manifests:generate` and `pnpm install --lockfile-only`, if a rendered peer changes;
- `test/unit/db/module-graph.test.ts` and `test/unit/kernel/module-removal.test.ts`, for the
  `quick_order` edge removal.

### Release 1 — tests (failing first)

- **T-U1** `addressFingerprint`; **T-U2** the default rule. Both are co-located unit tests in
  `customers`.
- **T-U3** `anonymizeForOrganization`, a unit test in `addresses`.
- **T-I1** A B2C account with three rows, one of them a duplicate: two addresses are created and
  three source rows are linked, soft-deleted and audited.
- **T-I2** A second run changes nothing.
- **T-I3** A crash between the Organization write and the source update leaves no duplicate.
- **T-I4** A company-member row and an org-less row are blanked, soft-deleted and audited, and the
  company book is untouched.
- **T-I5** An owner refusal sets `merge_refusal` and lets the account's other rows through.
- **T-I6** Tenancy: created rows are in the account's own personal Organization and invisible to
  any other Organization.
- **T-I7** The retention sweep blanks and soft-deletes the personal Organization's addresses, and
  leaves order snapshots unchanged.
- **T-C1** Every former endpoint answers `410 CUSTOMER_ADDRESS_BOOK_RETIRED`, in `pl` and `en`.
- **T-C2** `GET /me/customer/defaults` returns the Organization defaults. `PUT` with an address
  field answers 410; `PUT` with method fields still works.
- **T-C3** Admin `GET` returns the Organization book plus the refused rows.
- **T-C4** A personal Organization's member can `POST`/`PATCH`/`DELETE` on
  `/organizations/mine/addresses` (201/200/204).
- **T-K1** The ledgers, the OpenAPI baseline and the module-graph and residue tests pass, and
  `quick_order` composes without the port.
- **T-O1** With `customers` off, the worker is not registered and the address pages and checkout
  work. With `customers` on again, the job runs.
- **T-S1** B2C `/addresses`, in EN and PL, shows one list from the Organization API with no shared
  section; add, remove and make-default all go to the Organization API.
- **T-S2** A company member sees one navigation entry and is redirected from `/addresses`. An
  org-less customer is redirected to `/account`.
- **T-S3** Round trip, in EN and PL, against one shared fake of `/organizations/mine/addresses`: an
  address typed at checkout is listed on `/addresses`, and one added there is offered at checkout.
- **T-A1** The admin panel shows the Organization book and refused rows with no form, in EN and PL.
- **Manual on demo**: run the round trip in both languages, check the company navigation and
  redirect, and check the admin card.

## Release 2

The earliest release is the one after release 1. There is no minimum interval: the guard, not
time, decides.

### WP-2.1 — Backend: guarded drop and code removal

A `customers` migration, scaffolded and registered as before. The applied migrations stay
(`module-migrations.md` item 5).

```ts
override async up(): Promise<void> {
  const [row] = await this.execute(
    `select count(*) filter (where "merge_refusal" is null)::int as unprocessed,
            count(*) filter (where "merge_refusal" is not null)::int as refused
       from "customer_addresses" where "deleted_at" is null`,
  );
  if (row.unprocessed + row.refused > 0) {
    throw new Error(
      `customers: refusing to drop "customer_addresses" — ${row.unprocessed} row(s) not yet ` +
      `processed by the release-1 retirement job and ${row.refused} row(s) it refused remain. ` +
      `See "Personal address book removed (release 2 of 2)" in docs/docs/upgrading-an-instance.md.`,
    );
  }
  this.addSql('drop table "customer_addresses";');
}
override async down(): Promise<void> {
  // Re-creates the table empty, with the release-1 columns; rows are not recoverable.
}
```

The migration reads only its own table.

**Refused rows block the drop**, because the ruling says "refuses while any live row exists". The
upgrade note gives the operator two ways out:

- Clear `merge_refusal` on those rows, after fixing the cause (for example, reactivating the
  country), and let the job retry on the next boot of release 1.
- Acknowledge the loss with `delete from customer_addresses where merge_refusal is not null`. The
  customer can type the address again at checkout.

Either way, nothing is lost silently.

**Code removed**:
- the entity;
- the job, the worker, the fingerprint and their tests;
- the 410 stubs, and the address fields of `PUT /me/customer/defaults` (OD-8, release-2 judgement);
- `CUSTOMER_ADDRESS_BOOK_RETIRED`, with its manifest declaration and its sentence;
- `customerAddressSchema` and `customerAddressBookSchema`;
- the `personal` array of the admin `GET`.

### WP-2.2 — Admin, docs, derived artefacts

- The admin panel drops the refused-rows list.
- The upgrade note "Personal address book removed (release 2 of 2)", in EN and PL. Pass through
  release 1 first, with `customers` on and the job finished (FR-018). It also gives the two ways out
  above and the count query.
- Changesets, with the `breaking change` label.

### Release 2 — knock-on files

| Path | Change |
| --- | --- |
| `packages/contracts/src/customers.ts`, `errors.ts` | delete the remaining schemas and the error code |
| `packages/demo-composition/src/demo-usage.ts` | delete the `delete from customer_addresses` reset statement (demo reset would fail on the missing table) |
| `backend/test/helpers/package-entities.ts` | drop the entity |
| `backend/test/integration/demo/demo-reset-after-use.test.ts` | drop the seeded row |
| `backend/test/integration/tenancy/customer-scoped-allowed-set.test.ts` | it uses `CustomerAddress` as its `@CustomerScoped` example; re-point it to another `@CustomerScoped` entity, or delete the case if none remains |
| `backend/test/fixtures/error-code-routing/*`, `openapi-baseline.json` | re-derive |
| `backend/test/contract/customers/*` | delete the 410 tests (T-C1) and replace them with a 404 check |
| the tenant-classification check's ledger, if it lists `customer_addresses` | re-derive |
| docs (EN + PL) | the release-2 upgrade note, and remove the personal book from the module pages |

Regenerate `composer:generate`. Run a `rg` for every deleted path over `backend/test/**`.

### Release 2 — tests

- **T-M1** Migration: with an unprocessed row or a refused row, `up` throws the message with both
  counts and the table remains. With only soft-deleted rows, the table is dropped. `down`
  re-creates it.
- **T-C5** The former endpoints answer `404`, and `PUT /me/customer/defaults` with an address field
  is a validation error.
- **T-K2** The ledgers, the OpenAPI baseline, the demo reset and the tenancy suite pass after
  re-derivation.

## Counting

**Local development database** (`localhost:5432/b2b`, measured 2026-11-05): `customer_addresses`
holds **0 rows**. Demo seeding creates none, and the owner states that company members have none on
demo or production.

**Any installation** (read-only, run by an operator; also given in both upgrade notes):

```sql
select
  count(*) filter (where ca.deleted_at is null)                           as live,
  count(*) filter (where ca.deleted_at is null and o.is_personal)         as live_b2c,      -- moved by the job
  count(*) filter (where ca.deleted_at is null and o.is_personal = false) as live_company,  -- erased by the job
  count(*) filter (where ca.deleted_at is null and o.id is null)          as live_no_org    -- erased by the job
from customer_addresses ca
join customer_accounts acc on acc.id = ca.customer_account_id
left join organizations o on o.id = acc.organization_id;
```

After release 1's job has run, `live` equals the number of refused rows. Release 2 needs it to be
0.

## Off-state

| Module | Can be off? | With it off |
| --- | --- | --- |
| `addresses`, `organizations` | no | — |
| `customers` | yes | The address pages and checkout are unchanged, because `organizations` serves them. The job, the admin card and the 410 stubs are absent. The anonymisation sweep is absent, as today. Release 2's migration refuses until the job has run with `customers` on. |
| `quick_order` | yes | Unaffected. It no longer refers to `customers` for addresses. |

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I. Modular architecture (NN) | **Pass.** Both migrations touch only `customer_addresses`. Every cross-module read or write goes through ports `customers` already depends on. One edge (`quick_order` → `customers`) is removed. |
| II. API-first | **Pass.** Contracts change first in each release. Each release is labelled `breaking change`. |
| III. TDD (NN) | **Pass.** Every FR traces to a test above. |
| IV. YAGNI | **Pass.** No new dependency, module or permission. The job and the columns live for one release only. |
| V / VI / VIII | **Pass.** |
| VII | **Pass.** |
| IX. UI reuse | **Pass.** One shared `AddressBook`. |
| X. Queue consumers | **Pass.** A BullMQ job in the worker process. |
| XI. Tenancy (NN) | **Pass.** Every write lands in the account's own Organization through `withOrgScope`. The `withSystemScope` widenings of `CustomerAddressService` go away. |
| XII, XIV, XV | **N/A.** |
| XIII. Auditing (NN) | **Pass.** Every move, erasure and anonymisation is audited. `AddressService` audits its own writes. |
| XVI | **Pass**, unchanged. |
| XVII (NN) | **Pass, improved.** No address surface depends on a switchable module. The job is gated. |

**Verdict: PASS.**

## Complexity Tracking

No new runtime dependency, module, permission or table. The three columns and the job exist for one
release and are removed in release 2.

## Verification before reporting done (each release)

- `build:packages`, `composer:generate`, and `manifests:generate` with
  `pnpm install --lockfile-only`
- `pnpm -r run typecheck` and `pnpm -r run lint`
- `check:module-boundary`, `check:error-translations`, `check:command-coverage`
- the targeted backend tests, **including the contract and integration trees**
- `pnpm --filter storefront run test` and `pnpm --filter '!backend' run test`
- a `rg` for every deleted path over `backend/test/**`

**Follow-ups**: admin editing of Organization addresses (OD-6), and the duplicate addresses
checkout creates.

## Handoff summary for `endora-commerce-dev`

Nothing is left for the owner to rule. Start release 1 once #769 is merged.

**Release 1** (WP-1.1 backend, WP-1.2 storefront/admin/docs):
- B2C `/addresses` renders the Organization book through a shared `AddressBook`. Company members
  get a single "Adresy organizacji" entry, and `/addresses` redirects them.
- Every personal-book endpoint answers `410 CUSTOMER_ADDRESS_BOOK_RETIRED` (en+pl).
- A `customers` BullMQ job moves B2C rows through `addressServicePort` inside `withOrgScope`. It
  de-duplicates with `addressFingerprint`, keeps the Organization default, soft-deletes each source
  row with provenance, audits each row, and records refusals. It erases every other row.
- `addresses` gains `anonymizeForOrganization`, called from the retention sweep.
- The read port and the `quick_order` wiring go.

**Release 2** (WP-2.1 backend, WP-2.2 admin/docs):
- A guarded drop of `customer_addresses`, which refuses on any live row, refused rows included.
- The entity, the job, the 410 stubs, the error code and the remaining schemas go.
- The upgrade note says to pass through release 1 first.

Write T-U1 and T-I1 before the job service.
