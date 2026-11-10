---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
---

**Tax-ID scope.** An installation chooses whether a tax ID belongs to one organization (`global`, the default and today's rule) or may be shared inside one organization tree (`per-tree-root`, so a head office and its branches carry the same tax ID). The database enforces both: `global` with the existing unique constraint `organizations_tax_id_unique`, `per-tree-root` with a deferred exclusion constraint `organizations_tax_id_one_tree` over the tree's root.

- **Command** `organization.tax_id_scope.set` (audit: `{ scope }` before and after) swaps the constraint and the policy row in one transaction. It briefly blocks writes to `organizations` while the new constraint is built. Setting the scope already in force records nothing and re-creates a missing constraint. Switching to `global` is refused `409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` (`details: { code: 'shared_tax_ids', sharedTaxIdCount, examples }`, at most 20 examples) while any tax ID is on more than one organization.
- **Admin API** `GET` / `PUT /api/v1/admin/organizations/tax-id-scope` (`adminTaxIdScopeResponseSchema`, `adminTaxIdScopeSetBodySchema`), under the new permission `organizations:manage-tax-id-scope` and for an unscoped administrator only.
- **Admin create** `POST /api/v1/admin/organizations` accepts `parentId` and creates the organization as a branch in the same Command (unscoped administrators only, `403` otherwise; `404` for an unknown parent; the depth bound applies). In `per-tree-root` a branch may carry a tax ID its tree already holds. A tax ID the scope forbids is `409 ORGANIZATION_TAX_ID_EXISTS`, also when two creations race.
- **Moves** in `per-tree-root` that would put a shared tax ID into a second tree are refused `409 ORGANIZATION_TREE_INVALID` with `details.code = 'tax_id_shared_across_trees'` and `details.taxIds`.
- **Registration** refuses a tax ID that already resolves to an organization in both scopes, a branch's included, and answers a database refusal from either constraint with `409 ORGANIZATION_TAX_ID_EXISTS`.
- **Migration** `Migration20261110T173752OrganizationsTaxIdWriteLock` adds the row trigger `organizations_tax_id_write_lock` (on inserts and on updates of `tax_id` or `path`): two transactions writing the same tax ID take turns, so the second meets the first's committed row and is refused with a 409 rather than deadlocking against the organization reach rebuild. The lock is keyed by one of 256 buckets of the tax ID, so a transaction holds at most 256 such locks however many rows it writes; moves lock their subtree's buckets in ascending order first.
- **Tax IDs are stored normalised** — whitespace and dashes removed, upper-cased (`normalizeTaxId`). Registration and admin create store, check and answer the normalised form; the request schemas are unchanged. `Migration20261110T183238OrganizationsTaxIdNormalise` rewrites existing rows and adds the check `organizations_tax_id_normalised`, which refuses any other form from any writer (fixtures, seeds and overlay code inserting organizations must write the normalised form). **It refuses to run, and changes nothing, when two organizations would hold one tax ID once normalised** where the scope forbids it (anywhere in `global`); its message lists up to 50 such groups. Find them before upgrading with:

  ```sql
  select upper(regexp_replace(tax_id, '[[:space:]-]', '', 'g')) as normalised,
         array_agg(id order by id) as organizations
    from organizations where tax_id is not null
   group by 1 having count(*) > 1;
  ```

  and give each organization its own tax ID first.
- **Contention.** The scope change takes the table's `access exclusive` lock up front, waiting at most 5 seconds. A write of organizations that loses a lock to a concurrent one — the scope change, or a racing writer (`40P01`, `55P03`) — answers `409 ORGANIZATION_WRITE_CONTENDED` (new in `ERROR_CODES`); retrying succeeds.
- **Tax IDs are validated after normalisation** wherever they enter: `registerOrganizationRequestSchema` (and so `AdminOrganizationCreateBodySchema`) and the admin organization update now normalise the tax ID first and then require 8 to 32 characters, so `--------` is refused and an over-long value is a `400`, not a `500`.
- **Search.** The admin organizations list's `q` and the global search match the tax ID in its normalised form, so `pl 526-025` finds `PL526025…`.
- **Boot** logs one error when the stored scope and the constraint present disagree; re-applying the scope repairs it.
- `ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` is new.
