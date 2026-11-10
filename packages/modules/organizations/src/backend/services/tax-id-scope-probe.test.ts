import { describe, expect, it, vi } from 'vitest';
import type { TaxIdScope } from '@endora-commerce/contracts';
import { describeTaxIdScopeMismatch, probeTaxIdScope } from './tax-id-scope-probe.js';
import { enforcementOf } from './tax-id-scope-service.js';

/**
 * `specs/177-tax-id-scope/` T040 (`contracts/tax-id-scope.md` §7, research R-4)
 * — at boot the module compares the policy row with the constraint the
 * database has. A disagreement is logged once at `error`, naming both; it does
 * not fail the boot, because the repair is the scope screen of a running admin.
 */
function scopes(scope: TaxIdScope, constraints: string[]) {
  return { status: vi.fn(async () => ({ scope, constraints, enforcement: enforcementOf(scope, constraints) })) };
}

describe('the tax-ID scope boot probe', () => {
  it.each([
    ['global', ['organizations_tax_id_unique']],
    ['per-tree-root', ['organizations_tax_id_one_tree']],
  ] as const)('logs nothing when %s has its own constraint', async (scope, constraints) => {
    const log = { error: vi.fn() };
    await probeTaxIdScope(scopes(scope, [...constraints]), log);
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([
    ['global', ['organizations_tax_id_one_tree'], 'organizations_tax_id_one_tree'],
    ['per-tree-root', ['organizations_tax_id_unique'], 'organizations_tax_id_unique'],
    ['global', [], 'no tax-ID constraint'],
    ['per-tree-root', ['organizations_tax_id_one_tree', 'organizations_tax_id_unique'], 'organizations_tax_id_one_tree, organizations_tax_id_unique'],
  ] as const)('logs one error naming both when the policy says %s and the database has %j', async (scope, constraints, named) => {
    const log = { error: vi.fn() };
    await probeTaxIdScope(scopes(scope, [...constraints]), log);
    expect(log.error).toHaveBeenCalledTimes(1);
    const [context, message] = log.error.mock.calls[0]! as [Record<string, unknown>, string];
    expect(message).toBe(
      `organizations: tax-ID scope mismatch — policy says ${scope}, database has ${named}; re-apply the scope from Organizations → Tax-ID scope`,
    );
    expect(context).toEqual({ taxIdScope: scope, constraints: [...constraints] });
  });

  it('describes a consistent state as nothing', () => {
    expect(describeTaxIdScopeMismatch({ scope: 'global', constraints: ['organizations_tax_id_unique'] })).toBeNull();
  });

  it('never fails the boot: a read that throws is logged, not rethrown', async () => {
    const log = { error: vi.fn() };
    await expect(
      probeTaxIdScope({ status: vi.fn(async () => { throw new Error('relation does not exist'); }) }, log),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
