# Contract: the upgrade migration and its acceptance replay (FR-070–FR-074)

**Normative for**: WP-00 (oracle), WP-01 (M1), WP-02a (M2), WP-02b (M3), WP-13a (replay, table,
ledger), WP-03/WP-04/WP-06 (ledger entries), WP-12 (M4, M5, their replay lists), WP-13 (replay
close-out). Decisions: research R-17, R-18, R-19, R-27, R-34, R-36, R-38; owner rulings PR-3 to PR-7
(`plan.md`). Rules: `specs/conventions/module-migrations.md`.

## 1. Scaffolding — no numbers

```bash
pnpm --filter backend run migration:new -- --module core --name audit_actor_customer_account          # M1
pnpm --filter backend run migration:new -- --module organizations --name organization_roles           # M2
pnpm --filter backend run migration:new -- --module customer_accounts --name organization_role_assignment  # M3
pnpm --filter backend run migration:new -- --module organizations --name drop_legacy_role_columns     # M4
pnpm --filter backend run migration:new -- --module customer_accounts --name drop_legacy_role_column  # M5
pnpm --filter backend run composer:generate   # commit migrations-registry.generated.ts + entities-registry.generated.ts
```

The order between modules is the manifest graph (`organizations` before `customer_accounts`); the
timestamps order each module's own pair (M2 before M4, M3 before M5) and nothing else.

## 2. M2 — `organizations`, `organization_roles` (statements in substance)

```sql
create table if not exists organization_roles ( … per data-model.md §1 … );

-- FR-001 / FR-070: both predefined roles for every Organization, idempotent (FR-074)
insert into organization_roles (id, organization_id, kind, permissions, member_defaults_offered, …)
select gen_random_uuid(), o.id, k.kind, '{}', '{}', …
  from organizations o cross join (values ('administrator'), ('member')) as k(kind)
 where not exists (select 1 from organization_roles r where r.organization_id = o.id and r.kind = k.kind);

-- FR-071 / R-18: an approval-requiring Organization's Member has already been "offered" the two codes
update organization_roles r
   set member_defaults_offered = array['carts.order_without_approval', 'quick_order.one_click']
  from organizations o
 where r.organization_id = o.id and r.kind = 'member'
   and o.requires_cart_approval = true
   and r.member_defaults_offered = '{}';

-- invitations: role reference
alter table organization_invitations add column if not exists organization_role_id uuid;
update organization_invitations i
   set organization_role_id = r.id
  from organization_roles r
 where r.organization_id = i.organization_id
   and r.kind = case when i.role = 'organization_admin' then 'administrator' else 'member' end
   and i.organization_role_id is null;
alter table organization_invitations alter column organization_role_id set not null;
-- composite FK → organization_roles (organization_id, id)
```

```sql
-- R-28: every future Organization gets both rows in its own insert
create or replace function organizations_seed_predefined_roles() returns trigger language plpgsql as $$
begin
  insert into organization_roles (id, organization_id, kind, permissions, member_defaults_offered, version, created_at, updated_at)
  values (gen_random_uuid(), new.id, 'administrator', '{}', '{}', 1, now(), now()),
         (gen_random_uuid(), new.id, 'member',        '{}', '{}', 1, now(), now())
  on conflict do nothing;
  return new;
end $$;
create trigger organizations_seed_predefined_roles after insert on organizations
  for each row execute function organizations_seed_predefined_roles();
```

`member` rows are created with **empty** `permissions`: by R-17 *Member* holds every member-default
code it has not been offered, so it holds all of them except, in an approval-requiring Organization,
the two the marker withheld — from the first request on. `down()`: drop the trigger and its function,
the FK, the column, the table.

## 3. M3 — `customer_accounts`, `organization_role_assignment`

```sql
alter table customer_accounts add column if not exists organization_role_id uuid;
update customer_accounts a
   set organization_role_id = r.id
  from organization_roles r, organizations o      -- R1 reads, declared dependency
 where o.id = a.organization_id
   and r.organization_id = a.organization_id
   -- PR-3: a personal Organization's account holds Administrator whatever its legacy role
   and r.kind = case when o.is_personal or a.role = 'organization_admin' then 'administrator' else 'member' end
   and a.organization_role_id is null;            -- every row: deleted and blocked included (FR-070)
alter table customer_accounts alter column organization_role_id set not null;
-- composite FK (organization_id, organization_role_id) → organization_roles (organization_id, id) on delete restrict
create index if not exists customer_accounts_org_role_idx on customer_accounts (organization_id, organization_role_id);

-- R-28: an account inserted without a role holds Administrator in a personal Organization (PR-3),
-- else the role its legacy enum names, else Member
create or replace function customer_accounts_default_organization_role() returns trigger language plpgsql as $$
begin
  select r.id into new.organization_role_id
    from organization_roles r
    join organizations o on o.id = r.organization_id
   where r.organization_id = new.organization_id
     and r.kind = case when o.is_personal or new.role = 'organization_admin' then 'administrator' else 'member' end;
  return new;
end $$;
create trigger customer_accounts_default_organization_role before insert on customer_accounts
  for each row when (new.organization_role_id is null)
  execute function customer_accounts_default_organization_role();
```

M3 maps the reference only; it does **not** rewrite the legacy `role` of a personal Organization's
account (it stays `regular_user` until M5 drops it). Every legacy reader is converted in Wave 2, and a
data rewrite would make M3's `down()` lossy for the rare personal account an operator promoted by
hand.

`check:module-boundary` R1 holds by declaration (`customer_accounts` depends on `organizations`, whose
`organizations` and `organization_roles` tables M3 reads); R2 holds because only `customer_accounts`
is written. `test/unit/db/fk-dependency-drift.test.ts`
needs no ledger entry. `down()`: drop the index, FK and column.

## 4. M4 and M5 — WP-12

M4: `alter table organizations drop column if exists requires_cart_approval; alter table
organization_invitations drop column if exists role;`. M5: `drop index if exists …role…; alter table
customer_accounts drop column if exists role;` and `create or replace` the default function without
the `new.role` branch (*Administrator* in a personal Organization, PR-3, else *Member*). Each `down()`
re-adds the column with its old type and default and **re-derives** it from the role reference
(`administrator` → `organization_admin`, else `regular_user`; `requires_cart_approval` = *Member*
lacks `carts.order_without_approval`), so the replay's down-then-up round trip (§6) is exact for the
schema. A personal Organization's account re-derives as `organization_admin`, not the `regular_user`
it held before the upgrade; the replay inserts its population **after** the downs (§6 step 3), so no
oracle row passes through that re-derivation.

*Owner ruling, 2026-11-04 (#729):* WP-12 guards M2's and M3's legacy-reading backfills by the column's presence, so a second `up()` of M2–M5 after M4/M5 (§6 step 7, FR-074) changes nothing. That edit to the two already-merged migrations is accepted.

## 5. WP-00 — the oracle (on `master`, before any 170 code)

`backend/test/integration/organizations/roles-upgrade-oracle.test.ts` plus
`backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts`, exporting:

```ts
export const ORACLE_POPULATION: OraclePopulation;      // orgs, members, invitations, carts — plain data
export const ORACLE_REQUESTS: readonly OracleRequest[]; // { id, actor: memberKey, method, path, body? }
export const PRE_UPGRADE_OUTCOMES: Readonly<Record<OracleRequest['id'], { status: number; code?: string }>>;
```

Population (minimum): two company Organizations, **A** without and **B** with cart approval, plus
one personal Organization **P**; in each company Organization an administrator, a regular user and
two more regular users (one blocked and one deleted — their sessions resolve to nobody, so they are
anonymous visitors), and one pending, one expired and one accepted invitation of each kind; carts in
`not_required`, `pending`, `approved`, `rejected` for B's regular user.

Requests (one per gated action per member, FR-072): list/invite/revoke/change-role/remove members;
set MFA policy; list/read/approve/reject org carts; read cart (`primaryCta`); add to cart; submit for
approval; place an order from each cart state; one-click eligibility and placement; create RFQ from
scratch, from cart, from list; resubmit RFQ; list RFQs (own vs colleagues'); create/convert shopping
lists; quick-order build (cart and quote); list orders (own vs colleagues'); reorder and clone a
colleague's order; create/update/delete an Organization address; set Organization one-click
defaults.

The test asserts the live outcomes equal `PRE_UPGRADE_OUTCOMES`; the table is written by running
the requests once and reviewed by a human before commit.

**As recorded (PR #689, branch `wp/170-00-oracle`).** 35 request families, 9 actors each, plus two
extra channels for B's regular user on `cart.read` and `order.place`: **319 rows**. What the
recording showed, and the owner's ruling on each (`plan.md` *Oracle rulings*):

- `P.owner` is a `regular_user` today — neither `createStandalone` nor the federated sign-in names a
  role — so every reserved route refuses it. **PR-3**: after the upgrade it holds *Administrator*;
  its rows are expected differences (§6, family F1).
- The blocked and deleted members are anonymous, so `cart.read` and `cart.addItem` answer `200` with
  a guest basket. **PR-4**: unchanged after the upgrade; they are **not** expected differences.
- `orgCarts.*` refusals are `403 FORBIDDEN` and `cart.submitForApproval:B.admin` is
  `422 CART_APPROVAL_SELF_SUBMIT`. **PR-5**: the new codes are listed per row (§6, F2 and F3).
- The tag `oneClickInApprovalOrg` sits on exactly two rows, `oneClick.eligibility:B.regular` and
  `oneClick.place:B.regular`. **PR-6**: those two, and only those, are the #653 differences — B's
  administrator holds every permission, and B's blocked and deleted members are refused before any
  permission is read (§6, F4).
- `invitations.list` shows expired invitations beside pending ones. **PR-7**: FR-010a removes them
  (§6, F5).

The oracle fixture is **frozen** once #689 merges: it records today's code, and no later package
edits it. What the design changes is stated beside it, in §6's table.

**On the integration branch (R-38).** The oracle test runs *live* there: it creates its
Organizations on the migrated schema, so B's *Member* comes from M2's insert trigger and holds every
member default — FR-071's mapping runs only in M2's `up()`. From WP-04 on that moves four rows no
ruling covers (`cart.read:B.regular@pl_b2b_vip`, `order.place:B.regular@pl_retail`,
`order.place:B.regular@pl_b2b_vip`, `cart.submitForApproval:B.regular`) and keeps rows 23–24 from
moving at all; it sends the legacy `role` bodies, which WP-03's strict schemas refuse with `400`
(#710: the invitation-create and change-role rows of `A.admin`, `B.admin` and `P.owner`, nine in
all), because `roleToRoleId` is the replay's; and the first merge that lands any §6.1 row turns it red by design. It is therefore
**not** the instrument on the integration branch: the replay of §6 is, from WP-13a on. WP-13a
retires the oracle **test** (`git rm`, its content never edited) once both have been shown green on
one tree; the **fixture** stays, frozen, as the replay's input. `master` keeps the oracle test until
the integration pull request (T116).

## 6. The replay — WP-13a (Wave 2, before WP-03, WP-04, WP-06), completed by WP-12 and WP-13

`backend/test/integration/organizations/roles-upgrade-replay.test.ts`:

1. Clone a migrated database (`backend/test/helpers/migrated-database.ts`) and boot the test server
   against it (`DATABASE_URL` set to the clone before the dynamic `import()` of the harness). The
   boot comes **first** because `setupBackendServer` truncates and reseeds the tables the population
   lives in and needs (channels, product, delivery and payment methods); steps 2–4 then run on the
   booted clone, before the first request.
2. Execute the `down()` statements of M5, M4, M3, M2 in that order (statement-level, the pattern
   of `backend/test/integration/orders/new-to-paid-edge-migration.test.ts`). **Until WP-12 merges
   the lists hold M3 and M2 only**; WP-12 adds M5 and M4 in the merge request that adds them, since
   the step-3 insert names the columns they drop.
3. Insert `ORACLE_POPULATION` with raw SQL in the pre-170 shape (`role` enums,
   `requires_cart_approval`; `P.owner` as the `regular_user` it is today).
4. Execute the `up()` statements of M2, M3, M4, M5.
5. Replay `ORACLE_REQUESTS` in order (the request bodies' `role` fields become `roleId` through the
   fixture's `roleToRoleId` — the API shape changed, the outcome must not; **until WP-03 has
   landed** the bodies are sent unconverted, because the API still takes `role`) and assert, **per
   row**: a row named in `EXPECTED_DIFFERENCES` equals its `after` **if its `landedBy` package has
   landed, else its `before`**; every other row equals `PRE_UPGRADE_OUTCOMES[id]`. The comparison is
   the oracle's whole `{ status, code }` — code and observation included — never the status alone
   (PR-5).
6. Assert the data: both predefined roles per Organization; every account and invitation mapped;
   `P.owner` holds P's *Administrator* (PR-3); B's *Member* lacks the two codes and holds every other
   member-default; A's holds all; every cart's `approval_status` unchanged (FR-071).
7. Execute the `up()` statements of M2–M5 again; assert no row changed (FR-074).

It is a **complete-suite** file (integration), so — D-198 — it does not run on a merge request.
**From WP-13a's merge on it is in every work package's targeted run** (standing obligation 2 in
`tasks.md`): each author runs it locally with `pnpm --filter backend exec vitest run <path>` against
`pnpm run dev:infra:test` and pastes the output in the MR, including which rows moved.

### 6.1 The expected differences (PR-5)

`EXPECTED_DIFFERENCES` is exported by `backend/test/fixtures/organization-roles/expected-differences.ts`
(new, WP-13a, R-38), keyed by oracle request id, each entry `{ family, ruling, landedBy, before, after }` with
`before` and `after` in the oracle's `OracleOutcome` shape. It is the table below, verbatim. A
self-check (`backend/test/unit/organizations/roles-expected-differences.test.ts`, no services, so it
runs on every merge request) asserts: every key is an `ORACLE_REQUESTS` id; every `before` equals
`PRE_UPGRADE_OUTCOMES[id]` (the table cannot drift from the oracle); `after` differs from `before`;
and the F4 keys are **exactly** the ids tagged `oneClickInApprovalOrg` (PR-6). From WP-13a it also
asserts that every `landedBy` equals the row's *Lands in* below and, while the ledger of §6.2
exists, is one of its keys.

**26 rows in five families; the other 293 rows are expected unchanged.**

| # | Oracle request id | Before | After | Family · ruling | Why | Lands in |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `members.list:P.owner` | 403 `FORBIDDEN` | 200 `visible:P.owner` | F1 · PR-3 | an administrator lists members; P has one | WP-03 |
| 2 | `invitations.list:P.owner` | 403 `FORBIDDEN` | 200 `visible:` | F1 · PR-3 | an administrator lists invitations; P has none | WP-03 |
| 3 | `orgCarts.list:P.owner` | 403 `FORBIDDEN` | 200 `visible:P.cart.owner` | F1 · PR-3 | *Administrator* holds `carts.approve` | WP-04 |
| 4 | `orgCarts.read:P.owner` | 403 `FORBIDDEN` | 200 | F1 · PR-3 | as row 3 | WP-04 |
| 5 | `orgCarts.approve:P.owner` | 403 `FORBIDDEN` | 422 `CART_APPROVAL_NOT_PENDING` | F1 · PR-3 | the target is P's own cart, already placed; the state is checked before self-approval (R-36), as `orgCarts.approve:A.admin` today | WP-04 |
| 6 | `orgCarts.reject:P.owner` | 403 `FORBIDDEN` | 422 `CART_APPROVAL_NOT_PENDING` | F1 · PR-3 | as row 5 | WP-04 |
| 7 | `oneClick.setOrganizationDefaults:P.owner` | 403 `FORBIDDEN` | 200 | F1 · PR-3 | FR-012 is reserved to *Administrator*; same values as seeded, so no later row moves | WP-06 |
| 8 | `mfa.setPolicy:P.owner` | 403 `FORBIDDEN` | 200 | F1 · PR-3 | FR-011, reserved to *Administrator*; `enforceTotp: false` changes nothing later | WP-03 |
| 9 | `invitation.createMember:P.owner` | 403 `FORBIDDEN` | 422 `VALIDATION_FAILED` | F1 · PR-3 | the personal-Organization refusal (feature 051), checked before the role is resolved | WP-03 |
| 10 | `invitation.createAdministrator:P.owner` | 403 `FORBIDDEN` | 422 `VALIDATION_FAILED` | F1 · PR-3 | as row 9 | WP-03 |
| 11 | `invitation.revoke:P.owner` | 403 `FORBIDDEN` | 404 `NOT_FOUND` | F1 · PR-3 | the target is A's invitation; the lookup is scoped to P | WP-03 |
| 12 | `member.remove:P.owner` | 403 `FORBIDDEN` | 409 `CANNOT_REMOVE_LAST_ADMIN` | F1 · PR-3 | the target is P.owner, P's only administrator | WP-03 |
| 13 | `member.changeRole:P.owner` | 403 `FORBIDDEN` | 200 | F1 · PR-3 | *Administrator* → *Administrator*: no change, nothing audited (FR-065) | WP-03 |
| 14 | `orgCarts.list:A.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | the route is `P(carts.approve)`, no longer administrator-only | WP-04 |
| 15 | `orgCarts.list:B.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 16 | `orgCarts.read:A.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 17 | `orgCarts.read:B.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 18 | `orgCarts.approve:A.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 19 | `orgCarts.approve:B.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 20 | `orgCarts.reject:A.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 21 | `orgCarts.reject:B.regular` | 403 `FORBIDDEN` | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F2 · PR-5 | as row 14 | WP-04 |
| 22 | `cart.submitForApproval:B.admin` | 422 `CART_APPROVAL_SELF_SUBMIT` | 422 `CART_APPROVAL_NOT_REQUIRED` | F3 · PR-5 | a holder of `carts.order_without_approval` is refused as not required (`storefront-api.md` §5) | WP-04 |
| 23 | `oneClick.eligibility:B.regular` | 200 `eligibility:enabled` | 200 `eligibility:permission_required` | F4 · PR-6 | B's *Member* lacks both codes (FR-071); `quick_order.one_click` is judged first (FR-050, R-6) | WP-06 |
| 24 | `oneClick.place:B.regular` | 201 | 403 `ORGANIZATION_PERMISSION_REQUIRED` | F4 · PR-6 | #653 closed; refused before any basket write, naming `quick_order.one_click` | WP-06 |
| 25 | `invitations.list:A.admin` | 200 `visible:A.invitation.admin.expired,A.invitation.admin.pending,A.invitation.regular.expired,A.invitation.regular.pending` | 200 `visible:A.invitation.admin.pending,A.invitation.regular.pending` | F5 · PR-7 | FR-010a: expired invitations are not listed | WP-03 |
| 26 | `invitations.list:B.admin` | 200 `visible:B.invitation.admin.expired,B.invitation.admin.pending,B.invitation.regular.expired,B.invitation.regular.pending` | 200 `visible:B.invitation.admin.pending,B.invitation.regular.pending` | F5 · PR-7 | as row 25 | WP-03 |

Families: **F1** personal Organization's member is *Administrator* (13 rows); **F2**
organization-cart refusals carry the permission code (8); **F3** self-submit code (1); **F4** one-click
in an approval-requiring Organization, #653 (2); **F5** expired invitations unlisted (2).

**Rows deliberately not in the table**: the guest-basket rows of the blocked and deleted members
(`cart.read:*`, `cart.addItem:*`, PR-4) and every `401` row — a guard declared after
`requireCustomer` never reaches an anonymous visitor. Nor are the four B.regular rows the live
oracle moved from WP-04 on (`cart.read:B.regular@pl_b2b_vip`, `order.place:B.regular@pl_retail`,
`order.place:B.regular@pl_b2b_vip`, `cart.submitForApproval:B.regular`): they move only because a
live seed bypasses FR-071 (§5, R-38), and the replay must show them unchanged.

**How the table is used.** It is the design's statement, written before the replay runs, and it moves
only with an owner ruling — like the oracle (T004, T113). A replay row outside the table that
differs is a defect fixed in its owning module; a row in the table whose `after` does not match is a
question for the owner, not an edit. One case is foreseeable and is raised, not absorbed, if it
occurs: row 24 no longer places an order, so a later B.regular row that depended on that placement
(none is known to) would differ.

### 6.2 The landing ledger (WP-13a until WP-13)

`backend/test/fixtures/organization-roles/landed-work-packages.ts` (new, WP-13a) exports
`LANDED: Readonly<Record<'WP-03' | 'WP-04' | 'WP-06', boolean>>`, all `false` when WP-13a merges,
one entry per line with a comment line between entries (so the three packages' edits never touch
adjacent lines). **The package named flips its own entry to `true` in its own merge request**, and
in no other; the replay then requires exactly that package's rows (§6.1's *Lands in* column) to
reach their `after`, and every other package's rows to stay at `before`. `WP-03`'s entry also
switches the request bodies to `roleToRoleId` (step 5).

The strictness is the frozen oracle's: no row may drift, in or out of the table, at any merge. A row
that moves in a package other than the one named is reported in that merge request: if the move is
the design's, the architect corrects `landedBy` there (an allocation, not behaviour); if not, it is
a defect in the package that moved it. `before` and `after` still move only with an owner ruling.

WP-13 deletes the ledger and the interim branch of the comparison; from then on every §6.1 row must
equal its `after`, and `landedBy` remains in the table as provenance.

**Retiring the live oracle (WP-13a).** In WP-13a's merge request, on one tree and before the
`git rm`: the live oracle passes against `PRE_UPGRADE_OUTCOMES`, and the replay with every `LANDED`
entry `false` passes against the same table, all 319 rows. That equality is what proves the replay's
copies of the oracle's `send` and `observe` observe exactly what the oracle did; both outputs go in
the merge request.

### 6.3 Deliberate changes the oracle does not observe (OR-9 to OR-11, 2026-11-04)

The owner's rulings of 2026-11-04 change behaviour on routes the frozen oracle never calls: it has no
returns family, no quick-order import family and no role-creation family (§5's 35 families,
`backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts`). **They therefore move no row**:
§6.1 keeps its 26 rows, `EXPECTED_DIFFERENCES` and its self-check are not edited, and the landing
ledger of §6.2 gains no entry. The oracle cannot gain rows either — it is frozen — so the changes are
stated here, as PR-12's sign-in merge is in `plan.md`, and each is asserted by its own package's tests
instead.

| Ruling | Route | Before 170 | After | Who is affected on upgrade | Asserted by |
| --- | --- | --- | --- | --- | --- |
| OR-11 (FR-053) | `GET /api/v1/returns` | the caller's own cases | an administrator (and any holder of `returns.view_organization`): every case of the Organization | every administrator of a company Organization whose colleagues have cases | T144 |
| OR-11 (FR-053) | `GET /api/v1/returns/:id` of a colleague's case | `404 NOT_FOUND` | `200` for an administrator | as above | T144 |
| OR-11 (FR-054, Q-R1 = A) | `GET /api/v1/orders/:orderId/returnable`, `POST /api/v1/returns` for a colleague's order | `404 NOT_FOUND` | `200` / `201` for an administrator (and any holder of `orders.view_organization` with `returns.create`) | every administrator of a company Organization | T145 (and WP-07's `colleague-orders-permission.test.ts` row, flipped there) |
| OR-11 (FR-052) | `POST /api/v1/returns` by a role lacking `returns.create` | — (no such role existed) | `403 ORGANIZATION_PERMISSION_REQUIRED` | nobody: *Member* holds the code as an unoffered member default (R-17), *Administrator* holds every code | T143 |
| OR-10 (FR-030b) | `POST /api/v1/quick-order/import` | open to every signed-in member | `carts.create` or `quote_requests.create` | nobody: *Member* holds both in every Organization (FR-071 withholds neither) | T139 |
| OR-9 (FR-004a) | role creation | — (no roles) | a new custom role holds exactly what was ticked | nobody: no custom role exists before the upgrade | R-39's existing tests, T140 |

**What the implementing merge requests flip**: nothing in `landed-work-packages.ts` or
`expected-differences.ts`. WP-14 and WP-15 run the replay as every package does (standing obligation
2) and must show every row exactly where the ledger at that moment puts it; a moved row is a defect in
their own package, not an allocation. The *Member* data assertion of §6 step 6 already derives the
member defaults from the composed catalogue, so `returns.create` joins it without an edit.
