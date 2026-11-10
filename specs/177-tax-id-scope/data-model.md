# Data model: 177 tax-ID scope

All tables below are owned by `organizations`. No other module's table is written by any migration of
this feature (`specs/conventions/module-migrations.md` item 4a). Migrations are scaffolded with
`pnpm --filter backend run migration:new -- --module organizations --name <slug>` and registered by
`composer:generate`; no number is assigned here.

## 1. `organizations` — changed

| Column | Before | After | Notes |
| --- | --- | --- | --- |
| `tax_id` | `varchar(32) not null`, `organizations_tax_id_unique` | `varchar(32) null`; uniqueness by the **active scope's** constraint (§3) | `null` iff `is_personal` (check below) |
| `personal_account_id` | — | `uuid null` | The customer account a personal organization was provisioned for. Not a foreign key (R-3). Cleared on conversion |
| `root_id` | — | `uuid generated always as (nullif(split_part(path, '/', 2), '')::uuid) stored` | Not mapped by the entity (R-2) |
| `converted_to_company_at` | — | `timestamptz null` | Set once by `organization.convert_to_company`; never cleared |

New constraints and indexes:

| Name | Definition | Present |
| --- | --- | --- |
| `organizations_tax_id_presence` | `check (is_personal = (tax_id is null))` | always |
| `organizations_personal_account_link` | `check (personal_account_id is null or is_personal)` | always |
| `organizations_personal_account_id_unique` | `unique index (personal_account_id) where personal_account_id is not null` | always |
| `organizations_root_id_idx` | `index (root_id)` | always |
| `organizations_tax_id_unique` | `unique (tax_id)` — **unchanged name and definition**; NULLs are distinct | scope `global` only |
| `organizations_tax_id_one_tree` | `exclude using gist (tax_id with =, root_id with <>) deferrable initially deferred` | scope `per-tree-root` only |

Exactly one of the last two exists. `btree_gist` is created by the migration
(`create extension if not exists btree_gist`).

**Entity** (`organization.entity.ts`): `taxId?: string | null` (`nullable: true`, the `@Unique()`
decorator removed — the constraint is the migration's and the scope command's, and an entity
declaration of it would be wrong in `per-tree-root`); `personalAccountId?: string | null`;
`convertedToCompanyAt?: Date | null`; all three in `[OptionalProps]`. The class comment's "taxId is
globally unique" is rewritten to name both scopes.

## 2. `organization_tax_id_policy` — new

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `boolean primary key default true check (id)` | single row |
| `scope` | `text not null check (scope in ('global', 'per-tree-root'))` | |
| `updated_at` | `timestamptz not null default now()` | |
| `updated_by_admin_user_id` | `uuid null` | the actor of the last change; `null` from the migration |

Seeded `insert … values (true, 'global', now(), null) on conflict do nothing`. Entity
`OrganizationTaxIdPolicy`, `@GlobalEntity()`, in `backend/entities/organization-tax-id-policy.entity.ts`.

## 3. Migration plan (organizations, ordered by timestamp within the module)

**M1 `personal_tax_id_removal`** — idempotent, one migration:

1. `alter table organizations add column if not exists personal_account_id uuid null;`
   `… add column if not exists converted_to_company_at timestamptz null;`
2. Backfill the link:
   `update organizations set personal_account_id = (substr(tax_id,1,8)||'-'||substr(tax_id,9,4)||'-'||substr(tax_id,13,4)||'-'||substr(tax_id,17,4)||'-'||substr(tax_id,21,12))::uuid where is_personal and personal_account_id is null and tax_id ~ '^[0-9a-f]{32}$';`
3. `alter table organizations alter column tax_id drop not null;`
   `update organizations set tax_id = null where is_personal and tax_id is not null;`
4. Add `organizations_tax_id_presence`, `organizations_personal_account_link` (guarded `do` blocks:
   added only when absent), `organizations_personal_account_id_unique` (`if not exists`).
5. `raise notice` the count of personal rows left without a link (hand-made data).

**M2 `tax_id_scope`** — idempotent:

1. `create extension if not exists btree_gist;`
2. `alter table organizations add column if not exists root_id uuid generated always as (…) stored;`
   `create index if not exists organizations_root_id_idx on organizations (root_id);`
3. `create table if not exists organization_tax_id_policy (…)`; seed `global`.

M2 does **not** add the exclusion constraint: a fresh and an upgraded database both start in `global`,
and only the scope command adds it. Migrations therefore never depend on the scope.

**`down()`** — M2: refuses (`raise exception`) while the policy row says `per-tree-root`; otherwise
drops the table, index and column (the extension stays — `catalog` uses it). M1: restores the
placeholder from `personal_account_id` (`replace(personal_account_id::text, '-', '')`), falling back to
`replace(id::text, '-', '')` for unlinked personal rows, then drops the checks, the index and the
columns and restores `not null`. Data-preserving for every row M1 could link.

**M3 `tax_id_write_lock`** (added during WP-3, D-290 / OD-10) — function
`organizations_tax_id_write_lock()` and a `before insert or update of tax_id, path` row trigger taking
`pg_advisory_xact_lock(hashtextextended('organizations.tax_id:' || tax_id, 0))` for a non-null tax ID.
Lock order: tax-ID locks (ascending, pre-taken by the tree Command for a subtree) before the reach
governor's lock. `down()` drops both.

**M4 `tax_id_normalise`** (D-290 / OD-11) — refuses while normalised-equal tax IDs with different
stored values exist across roots (`per-tree-root`) or anywhere (`global`), listing ≤ 50 groups;
otherwise `update organizations set tax_id = upper(regexp_replace(tax_id, '[[:space:]-]', '', 'g'))`
where it differs, then adds `organizations_tax_id_normalised check (tax_id is null or tax_id = upper(regexp_replace(tax_id, '[[:space:]-]', '', 'g')))`.
`down()` drops the check only (the original spellings are not kept).

**Lock cost.** M2's stored generated column rewrites `organizations` under `ACCESS EXCLUSIVE`; the
header says so and the upgrade note repeats it.

**Future migrations.** Any later migration that names `organizations_tax_id_unique` or
`organizations_tax_id_one_tree` MUST branch on `organization_tax_id_policy.scope`. A unit test
(`tax-id-scope-migration-guard.test.ts`) scans this module's migrations after M2 and fails on a bare
reference — the instrument the owner's working doc asked for ("migrations do not depend on the mode").

## 4. State transitions

### Tax-ID scope

```
global ──set(per-tree-root)──► per-tree-root      always allowed
per-tree-root ──set(global)──► global             refused while any tax_id is on ≥2 rows
X ──set(X)──► X                                   no-op, no audit, enforcement re-asserted
```

### Organization kind

```
personal (tax_id null, personal_account_id set)
   └─convert_to_company──► company (tax_id set, personal_account_id null, converted_to_company_at set)
company ──► personal                               no transition (FR-041)
```

## 5. Records crossing the boundary (`@endora-commerce/contracts`)

- `OrganizationRecord` (`organizations.ts` l. 487): `taxId: string | null`; new
  `convertedToCompanyAt: Date | null`. `personalAccountId` is **not** published (an internal
  correlation id).
- `organizationSchema` (l. 83): `taxId: z.string().nullable()`.
- `organizationCompanyTaxId` (l. 575): parameter `taxId: string | null`; body unchanged in meaning
  (personal or empty → `null`). Kept as the one display rule.
- New: `TaxIdScope = 'global' | 'per-tree-root'`, `taxIdScopeSchema`, `TaxIdResolution`,
  `OrganizationCommandPort`, `OrganizationConvertToCompanyInput` /
  `adminOrganizationConvertToCompanyBodySchema`, `adminTaxIdScopeResponseSchema`,
  `adminTaxIdScopeSetBodySchema`, `OrganizationConvertedToCompanyEvent`.
- `AdminOrganizationCreateBodySchema` (l. 1075): `parentId: uuidSchema.optional()`.

## 6. Events

| Event | Payload | Emitted | Subscribers in core |
| --- | --- | --- | --- |
| `organization.converted_to_company.v1` | `{ eventId, occurredAt, organizationId, convertedAt }` | once, on commit of `organization.convert_to_company` (Command `event`) | none (R-12); documented for overlays/connectors |

Declared on `OrganizationEvents` (`registration-service.ts` l. 43) and exported from contracts as
`OrganizationConvertedToCompanyEvent`. No payload carries the tax ID or a name (an event is not an
audit row, but the subscriber has the id and the read port).

## 7. Audit entries

| Action | objectType / objectId | before | after |
| --- | --- | --- | --- |
| `organization.tax_id_scope.set` | `organization_tax_id_policy` / `installation` | `{ scope }` | `{ scope }` |
| `organization.convert_to_company` | `organization` / id | `{ isPersonal: true }` | `{ isPersonal: false, changedFields: ['isPersonal','legalName','name','registeredAddress','taxId','vatStatus'] (sorted, only those that changed), approvalStamped: boolean, taxIdScope }` |
| `organization.create` (changed) | unchanged | unchanged | gains `parentId` when given |
