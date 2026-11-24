/**
 * `specs/177-tax-id-scope/` (`contracts/tax-id-scope.md` §5, research R-6) —
 * which database refusals are a tax-ID conflict, and which one.
 *
 * The two scopes are enforced by two constraints, exactly one of which exists:
 *
 * - `global` — `organizations_tax_id_unique`, raising `23505`;
 * - `per-tree-root` — `organizations_tax_id_one_tree`, a deferred exclusion
 *   constraint raising `23P01`, at the statement or at `COMMIT`.
 *
 * MikroORM 6.6 maps `23505` to `UniqueConstraintViolationException` and has no
 * case for `23P01`. A deferred `23P01` raised at a statement (the constraint
 * made immediate) arrives as a `DriverException` that is not a unique
 * violation; one raised at `COMMIT` is not converted at all, and arrives as
 * pg's own error. Every one of them keeps the pg error's `code` and
 * `constraint`, on the error or on what it wraps (`cause`, or `previous` on a
 * MikroORM exception), and this helper reads all of them. MikroORM 7 may
 * change the classes; `backend/test/integration/organizations/
 * tax-id-conflict-translation.test.ts` is the guard (#1860). Pure: every write path
 * turns the answer into its own 409 — a creation that trips `23P01` is still
 * `ORGANIZATION_TAX_ID_EXISTS` — and never shows the constraint name.
 */
export type TaxIdConflict = 'tax_id_exists' | 'tax_id_shared_across_trees';

export const TAX_ID_UNIQUE_CONSTRAINT = 'organizations_tax_id_unique';
export const TAX_ID_ONE_TREE_CONSTRAINT = 'organizations_tax_id_one_tree';

const RECOGNISED: Readonly<Record<string, { constraint: string; conflict: TaxIdConflict }>> = {
  '23505': { constraint: TAX_ID_UNIQUE_CONSTRAINT, conflict: 'tax_id_exists' },
  '23P01': { constraint: TAX_ID_ONE_TREE_CONSTRAINT, conflict: 'tax_id_shared_across_trees' },
};

export function taxIdConflictOf(err: unknown): TaxIdConflict | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) continue;
    seen.add(candidate);
    const { code, constraint, cause, previous } = candidate as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
      previous?: unknown;
    };
    if (typeof code === 'string') {
      const rule = RECOGNISED[code];
      if (rule && constraint === rule.constraint) return rule.conflict;
    }
    queue.push(cause, previous);
  }
  return null;
}
