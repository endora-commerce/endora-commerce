# Contract: the upgrade migration and its acceptance replay (FR-070–FR-074)

**Normative for**: WP-00 (oracle), WP-01 (M1), WP-02a (M2), WP-02b (M3), WP-12 (M4, M5), WP-13
(replay). Decisions: research R-17, R-18, R-19, R-27. Rules: `specs/conventions/module-migrations.md`.

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
  from organization_roles r                       -- R1 read, declared dependency
 where r.organization_id = a.organization_id
   and r.kind = case when a.role = 'organization_admin' then 'administrator' else 'member' end
   and a.organization_role_id is null;            -- every row: deleted and blocked included (FR-070)
alter table customer_accounts alter column organization_role_id set not null;
-- composite FK (organization_id, organization_role_id) → organization_roles (organization_id, id) on delete restrict
create index if not exists customer_accounts_org_role_idx on customer_accounts (organization_id, organization_role_id);

-- R-28: an account inserted without a role holds the role its legacy enum names, else Member
create or replace function customer_accounts_default_organization_role() returns trigger language plpgsql as $$
begin
  select r.id into new.organization_role_id
    from organization_roles r
   where r.organization_id = new.organization_id
     and r.kind = case when new.role = 'organization_admin' then 'administrator' else 'member' end;
  return new;
end $$;
create trigger customer_accounts_default_organization_role before insert on customer_accounts
  for each row when (new.organization_role_id is null)
  execute function customer_accounts_default_organization_role();
```

`check:module-boundary` R1 holds by declaration (`customer_accounts` depends on `organizations`);
R2 holds because only `customer_accounts` is written. `test/unit/db/fk-dependency-drift.test.ts`
needs no ledger entry. `down()`: drop the index, FK and column.

## 4. M4 and M5 — WP-12

M4: `alter table organizations drop column if exists requires_cart_approval; alter table
organization_invitations drop column if exists role;`. M5: `drop index if exists …role…; alter table
customer_accounts drop column if exists role;` and `create or replace` the default function without
the `new.role` branch (plain *Member*). Each `down()` re-adds the column with its old type
and default and **re-derives** it from the role reference (`administrator` → `organization_admin`,
else `regular_user`; `requires_cart_approval` = *Member* lacks `carts.order_without_approval`), so the
replay's down-then-up round trip (§6) is exact.

## 5. WP-00 — the oracle (on `master`, before any 170 code)

`backend/test/integration/organizations/roles-upgrade-oracle.test.ts` plus
`backend/test/fixtures/organization-roles/pre-upgrade-outcomes.ts`, exporting:

```ts
export const ORACLE_POPULATION: OraclePopulation;      // orgs, members, invitations, carts — plain data
export const ORACLE_REQUESTS: readonly OracleRequest[]; // { id, actor: memberKey, method, path, body? }
export const PRE_UPGRADE_OUTCOMES: Readonly<Record<OracleRequest['id'], { status: number; code?: string }>>;
```

Population (minimum): two company Organizations, **A** without and **B** with cart approval, plus
one personal Organization; in each company Organization an administrator, two regular users (one
blocked, which answers `401`, and one deleted), and one pending, one expired and one accepted
invitation of each kind; carts in `not_required`, `pending`, `approved`, `rejected` for a regular
user of B.

Requests (one per gated action per member, FR-072): list/invite/revoke/change-role/remove members;
set MFA policy; list/read/approve/reject org carts; read cart (`primaryCta`); add to cart; submit for
approval; place an order from each cart state; one-click eligibility and placement; create RFQ from
scratch, from cart, from list; resubmit RFQ; list RFQs (own vs colleagues'); create/convert shopping
lists; quick-order build (cart and quote); list orders (own vs colleagues'); reorder and clone a
colleague's order; create/update/delete an Organization address; set Organization one-click
defaults.

The test asserts the live outcomes equal `PRE_UPGRADE_OUTCOMES`; the table is written by running
the requests once and reviewed by a human before commit.

## 6. WP-13 — the replay (on the integration branch, after WP-12)

`backend/test/integration/organizations/roles-upgrade-replay.test.ts`:

1. Clone a migrated database (`backend/test/helpers/migrated-database.ts`).
2. Execute the `down()` statements of M5, M4, M3, M2 in that order (statement-level, the pattern
   of `backend/test/integration/orders/new-to-paid-edge-migration.test.ts`).
3. Insert `ORACLE_POPULATION` with raw SQL in the pre-170 shape (`role` enums,
   `requires_cart_approval`).
4. Execute the `up()` statements of M2, M3, M4, M5; boot the test server against the database.
5. Replay `ORACLE_REQUESTS` (the request bodies' `role` fields become `roleId` through a single
   mapping the fixture exports — the API shape changed, the outcome must not) and assert every
   outcome equals `PRE_UPGRADE_OUTCOMES`, **except** the rows tagged `oneClickInApprovalOrg`, which
   must now be `403 ORGANIZATION_PERMISSION_REQUIRED` / eligibility `cart_approval_required` (#653).
6. Assert the data: both predefined roles per Organization; every account and invitation mapped;
   B's *Member* lacks the two codes and holds every other member-default; A's holds all; every
   cart's `approval_status` unchanged (FR-071).
7. Execute the `up()` statements of M2–M5 again; assert no row changed (FR-074).

It is a **complete-suite** file (integration), so — D-198 — it does not run on a merge request;
WP-13's author runs it locally with `pnpm --filter backend exec vitest run <path>` against
`pnpm run dev:infra:test` and pastes the output in the MR.
