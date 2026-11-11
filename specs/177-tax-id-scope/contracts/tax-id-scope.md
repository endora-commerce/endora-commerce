# Contract: tax-ID scope

Normative for FR-010 … FR-027. Owner: `organizations`.

## 1. Rules

| Scope | A tax ID X may be on … | Database object |
| --- | --- | --- |
| `global` (default) | at most one organization, soft-deleted included | `organizations_tax_id_unique unique (tax_id)` |
| `per-tree-root` | any number of organizations **with the same `root_id`** | `organizations_tax_id_one_tree exclude using gist (tax_id with =, root_id with <>) deferrable initially deferred` |

Personal organizations have `tax_id = null` and are outside both rules.

## 2. Command `organization.tax_id_scope.set`

- **Factory**: `makeSetTaxIdScopeCommand(deps, { scope })` in
  `organizations/src/backend/commands/set-tax-id-scope.command.ts`.
- **objectType / objectId**: `organization_tax_id_policy` / `installation`.
- **Steps** (one transaction, R-5): lock the policy row → same scope: re-assert, `skipAudit` →
  lock `organizations` in `share row exclusive` mode → to `per-tree-root`: add exclusion, drop unique
  → to `global`: duplicate report, refuse or add unique then drop exclusion → update row.
- **Idempotent DDL**: every `add` is guarded (`if not exists` on `pg_constraint` by name), every `drop`
  is `if exists`, so a re-run after a partial manual change converges.
- **Refusal**: `409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES`, `details`:
  `{ code: 'shared_tax_ids', sharedTaxIdCount: number, examples: Array<{ taxId: string, organizationIds: string[] }> }`
  (≤ 20 examples, ordered by tax ID). The admin screen renders the examples as links; the envelope's
  sentence names the count (`{sharedTaxIdCount}`).

- **Transition rules** (FR-015, FR-015a): to `per-tree-root` is always allowed; back to `global` is
  refused while any tax ID is on more than one organization, soft-deleted ones included. A tax ID
  cannot be changed from the admin and a soft-deleted organization keeps its own, so once a tax ID is
  shared the way back is not available from the admin (D-290 / OD-8). The confirmation of a switch to
  `per-tree-root` says so before it is confirmed; the refusal sentence and the screen's shared-tax-ID
  warning name no remedy the admin does not offer.

## 3. Admin HTTP API

Both routes: `preHandler: requireAdmin('organizations:manage-tax-id-scope')`, then an unscoped tenant
context (`getTenantContext()?.mode === 'all'`, else `403 FORBIDDEN`, D-260's idiom).

### `GET /api/v1/admin/organizations/tax-id-scope`

```json
{ "data": {
    "scope": "global",
    "updatedAt": "2026-11-10T12:00:00.000Z",
    "updatedByAdminUserId": null,
    "sharedTaxIdCount": 0,
    "enforcement": "consistent"
} }
```

`enforcement`: `consistent` | `mismatch` (the boot probe's finding, recomputed on read: the
constraint present is not the policy row's). Schema `adminTaxIdScopeResponseSchema`.

### `PUT /api/v1/admin/organizations/tax-id-scope`

Body `adminTaxIdScopeSetBodySchema = z.object({ scope: taxIdScopeSchema })` → `200` with the GET shape;
`409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES`; `403` scoped admin. The route is registered **before**
`/api/v1/admin/organizations/:id` routes so the static segment wins (it would anyway: `:id` is
uuid-checked and answers 404).

## 4. Lookups (published on `organizationDetailsPort`)

```ts
findByTaxId(taxId: string, options?: { includeDeleted?: boolean }): Promise<OrganizationRecord[]>;
resolveByTaxId(taxId: string): Promise<TaxIdResolution>;
```

- Input normalised: `taxId.replace(/[\s-]+/g, '').toUpperCase()`; an empty result answers `[]` /
  `none` without a query.
- Order: roots first (`root_id = id`), then `array_length(string_to_array(trim(both '/' from path), '/'), 1)`
  ascending, `created_at` ascending, `id` ascending.
- `findByTaxId` excludes `deleted_at is not null` unless `includeDeleted`; `resolveByTaxId` always
  includes deleted rows when computing the root (a deleted head office still owns its tree) but
  answers with the live root when there is one, else the oldest live match, else `none`.
- `resolveByTaxId`: `none` (no row) · `one` (all matches share one `root_id`) · `ambiguous` (more than
  one root — unreachable in both scopes; a test builds every state each scope permits and asserts it).
- Internal service methods accept `em?: EntityManager` so Commands read inside their transaction.

## 5. Write paths and their answers

| Path | Pre-check (R-7) | Database backstop | Answer |
| --- | --- | --- | --- |
| Self-registration (`POST /api/v1/organizations/register`) | `resolveByTaxId(X)` ≠ `none` → refuse (`registrationConflictPolicy` = `refuse`) | `taxIdConflictOf` at the flush (Phase A) / around the Command (Phase R) | `409 ORGANIZATION_TAX_ID_EXISTS` |
| Admin create without parent | X exists anywhere | same, around `commandBus.run` | `409 ORGANIZATION_TAX_ID_EXISTS` |
| Admin create with `parentId` P | `global`: X exists; `per-tree-root`: X exists with `root_id ≠ root(P)` | same | `409 ORGANIZATION_TAX_ID_EXISTS` |
| Set-parent / move of subtree S to new root R′ | `per-tree-root` only: a tax ID of S on a row outside S whose root after the move ≠ R′ | same | `409 ORGANIZATION_TREE_INVALID`, `details.code = 'tax_id_shared_across_trees'`, `details.taxIds` (≤ 20) |
| Convert to company | as admin create, with the organization's own root | same | `409 ORGANIZATION_TAX_ID_EXISTS` |

`taxIdConflictOf(err)` — `organizations/src/backend/services/tax-id-conflict.ts`, pure:

```ts
export type TaxIdConflict = 'tax_id_exists' | 'tax_id_shared_across_trees';
export function taxIdConflictOf(err: unknown): TaxIdConflict | null;
// code '23505' + constraint 'organizations_tax_id_unique'  → 'tax_id_exists'
// code '23P01' + constraint 'organizations_tax_id_one_tree' → 'tax_id_shared_across_trees'
// read from err, err.cause, err.previous; anything else → null
```

Each path turns the conflict into **its own** 409 from the table above (a creation that trips
`23P01` is still `ORGANIZATION_TAX_ID_EXISTS`).

`runOrganizationWrite(bus, command, onConflict)` wraps `commandBus.run` and applies the same mapping
to an error thrown at commit.

## 6. Admin create `parentId`

`AdminOrganizationCreateBodySchema.parentId?: uuid`. When present: unscoped tenant context required
(`403` otherwise); parent must exist and be live (`404`); depth checked by
`OrganizationTreeService.assertMaxDepth` (`409 ORGANIZATION_TREE_INVALID` / `max_depth_exceeded`);
the row is inserted with `parentId` and `path = parent.path + id + '/'`.

## 7. Boot probe

At composition the module runs, outside any request,
`select conname from pg_constraint where conrelid = 'organizations'::regclass and conname in (…)` and
the policy row; on disagreement it logs at `error`:
`organizations: tax-ID scope mismatch — policy says <scope>, database has <constraints>; re-apply the scope from Organizations → Tax-ID scope`.
No boot failure (R-4).

## 8. Test matrix

`ORGANIZATIONS_TAX_ID_SCOPE` (`global` default | `per-tree-root`) selects the template's scope
(R-16). Every test in §5's rows runs in both; the scope-specific expectations branch on the scope read
from the database. Concurrency: 50 paired writes per path with `Promise.all` on two connections, every
loser a 409 (SC-003).
