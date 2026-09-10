import { describe, it, expect } from 'vitest';
import {
  resolveTenantContext,
  systemTenantContext,
} from './resolve-tenant-context.js';
import {
  getTenantContext,
  runWithTenantContext,
  runWithoutTenantContext,
  MissingTenantContextError,
} from './tenant-context.js';
import { orgFilterCond, customerFilterCond } from './filters.js';
import { withSystemScope, withOrgScope, setEscapeHatchAuditSink } from './escape-hatch.js';
import { orgConstraintFor, ruleVisibleForScope } from './derived-scope.js';

describe('resolveTenantContext', () => {
  it('customer → single-org confined to their organization + account', () => {
    const ctx = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-A',
    });
    expect(ctx.mode).toBe('single-org');
    expect(ctx.organizationId).toBe('org-A');
    expect(ctx.customerAccountId).toBe('cust-1');
  });

  it('feature 056 — customer with a roll-up subtree → allowed-set (widened)', () => {
    const ctx = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-A',
      rollupSubtreeOrganizationIds: ['org-A', 'org-A1', 'org-A2'],
    });
    expect(ctx.mode).toBe('allowed-set');
    expect(ctx.allowedOrganizationIds).toEqual(['org-A', 'org-A1', 'org-A2']);
    expect(ctx.customerAccountId).toBe('cust-1');
  });

  it('feature 056 — customer with an empty roll-up subtree stays single-org (flat)', () => {
    const ctx = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-A',
      rollupSubtreeOrganizationIds: [],
    });
    expect(ctx.mode).toBe('single-org');
    expect(ctx.organizationId).toBe('org-A');
  });

  it('customer with impersonation records both real admin and impersonated account', () => {
    const ctx = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-A',
      impersonatorAdminUserId: 'admin-9',
    });
    expect(ctx.impersonation).toEqual({
      realAdminUserId: 'admin-9',
      impersonatedCustomerAccountId: 'cust-1',
    });
  });

  it('platform admin (allowAll) → mode all', () => {
    const ctx = resolveTenantContext({ kind: 'admin', adminUserId: 'a1' }, { allowAll: true });
    expect(ctx.mode).toBe('all');
  });

  it('scoped sales-rep → allowed-set', () => {
    const ctx = resolveTenantContext(
      { kind: 'admin', adminUserId: 'a1' },
      { allowAll: false, allowedOrganizationIds: ['org-A', 'org-B'] },
    );
    expect(ctx.mode).toBe('allowed-set');
    expect(ctx.allowedOrganizationIds).toEqual(['org-A', 'org-B']);
  });

  it('admin with no scope descriptor defaults to all (platform admin)', () => {
    const ctx = resolveTenantContext({ kind: 'admin', adminUserId: 'a1' });
    expect(ctx.mode).toBe('all');
  });
});

describe('ambient context store', () => {
  it('getTenantContext returns undefined when explicitly outside any scope', () => {
    runWithoutTenantContext(() => {
      expect(getTenantContext()).toBeUndefined();
    });
  });

  it('runWithTenantContext makes the context ambient for its subtree', async () => {
    const ctx = systemTenantContext('test');
    await runWithTenantContext(ctx, async () => {
      expect(getTenantContext()).toBe(ctx);
      await Promise.resolve();
      expect(getTenantContext()).toBe(ctx);
    });
  });

  /**
   * The cleared context has to survive an `await`, and until this test it was
   * only ever asserted synchronously.
   *
   * `AsyncLocalStorage.exit(fn)` is, on the pre-`AsyncContextFrame` runtime,
   * `disable(); try { fn() } finally { enable() }` — a *synchronous*
   * try/finally around a callback that may be `async`. Node 24 made
   * `AsyncContextFrame` the default and the same call became frame-scoped, so
   * the defect is invisible on a developer's Node 24+ and live on the Node
   * 22.17 floor this repository supports and CI runs (`engines.node`). Two
   * tests were red in CI and green on every machine for exactly that reason —
   * `test/unit/seeds/seed-scope.test.ts` and
   * `packages/platform/src/kernel/lifecycle/registry-cache-scope.test.ts`, both of which strip the
   * harness context and then assert what a scope leaves behind.
   *
   * **The middle case below is the one that was red, and its shape is the
   * reason the defect had no test.** A bare `await` inside the cleared region
   * is not enough: the re-enable has nothing to restore from and the store
   * stays clear on both runtimes. What resurfaces it is a **nested `run()`**
   * inside the cleared region — which is what both red files do, because
   * `enterPlatformScope` opens one. Nor does it show under an enclosing
   * `runWithTenantContext`: that frame contains the disable/enable pair and the
   * case passes while the defect stands. So the outer store has to be an
   * `enterWith` one that no `run()` contains, which is exactly how the harness
   * installs the ambient scope around every test (`test/tenancy-setup.ts`).
   * These tests therefore strip *that* store, and assert first that there is
   * one to strip — a run without the setup file would otherwise pass by having
   * nothing to resurface.
   */
  it('runWithoutTenantContext keeps the context cleared across an await', async () => {
    const ambient = getTenantContext();
    expect(ambient, 'the harness installs an ambient context around every test').toBeDefined();

    await runWithoutTenantContext(async () => {
      expect(getTenantContext()).toBeUndefined();
      await Promise.resolve();
      expect(getTenantContext()).toBeUndefined();
    });

    expect(getTenantContext()).toBe(ambient);
  });

  it('runWithoutTenantContext stays cleared across a nested scope of its own', async () => {
    const ambient = getTenantContext();
    expect(ambient).toBeDefined();

    await runWithoutTenantContext(async () => {
      await runWithTenantContext(systemTenantContext('a scope opened inside the cleared one'), () =>
        Promise.resolve(),
      );
      expect(getTenantContext()).toBeUndefined();
    });

    expect(getTenantContext()).toBe(ambient);
  });

  it('runWithoutTenantContext restores the caller context when its callback throws', async () => {
    const ambient = getTenantContext();
    expect(ambient).toBeDefined();

    await expect(
      runWithoutTenantContext(async () => {
        await Promise.resolve();
        expect(getTenantContext()).toBeUndefined();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(getTenantContext()).toBe(ambient);
  });
});

describe('filter cond (reads ambient context)', () => {
  it('no context → cond throws (fail-closed)', () => {
    runWithoutTenantContext(() => {
      expect(() => orgFilterCond()).toThrow(MissingTenantContextError);
      expect(() => customerFilterCond('absent')).toThrow(MissingTenantContextError);
      expect(() => customerFilterCond('present')).toThrow(MissingTenantContextError);
    });
  });

  it('single-org → equality predicates', async () => {
    const ctx = resolveTenantContext({ kind: 'customer', customerAccountId: 'c', organizationId: 'org-A' });
    await runWithTenantContext(ctx, async () => {
      expect(orgFilterCond()).toEqual({ organizationId: 'org-A' });
      // Unchanged by feature 087, and unchanged by the entity carrying an
      // organization column: a buyer is confined to their own rows, which is a
      // narrower statement than their organization's.
      expect(customerFilterCond('absent')).toEqual({ customerAccountId: 'c' });
      expect(customerFilterCond('present')).toEqual({ customerAccountId: 'c' });
    });
  });

  it('allowed-set → $in predicate on both classifications (feature 087, FR-001)', async () => {
    const ctx = resolveTenantContext(
      { kind: 'admin', adminUserId: 'a' },
      { allowAll: false, allowedOrganizationIds: ['org-A'] },
    );
    await runWithTenantContext(ctx, async () => {
      expect(orgFilterCond()).toEqual({ organizationId: { $in: ['org-A'] } });
      // This case read `toEqual({})` until feature 087 — no predicate at all,
      // for the one actor kind the whole classification exists to restrain. An
      // entity carrying the column gets the same predicate `@OrgScoped` gets;
      // one that does not gets the refusal, because a row is never visible
      // because a predicate was absent.
      expect(customerFilterCond('present')).toEqual({ organizationId: { $in: ['org-A'] } });
      expect(customerFilterCond('absent')).toEqual({ customerAccountId: { $in: [] } });
    });
  });

  it('an empty allowed-set matches nothing on both classifications (FR-007)', async () => {
    const ctx = resolveTenantContext(
      { kind: 'admin', adminUserId: 'a' },
      { allowAll: false, allowedOrganizationIds: [] },
    );
    await runWithTenantContext(ctx, async () => {
      expect(orgFilterCond()).toEqual({ organizationId: { $in: [] } });
      expect(customerFilterCond('present')).toEqual({ organizationId: { $in: [] } });
      expect(customerFilterCond('absent')).toEqual({ customerAccountId: { $in: [] } });
    });
  });

  it('all / system → no restriction', async () => {
    await runWithTenantContext(resolveTenantContext({ kind: 'admin', adminUserId: 'a' }, { allowAll: true }), async () => {
      expect(orgFilterCond()).toEqual({});
      expect(customerFilterCond('present')).toEqual({});
      expect(customerFilterCond('absent')).toEqual({});
    });
    await runWithTenantContext(systemTenantContext('r'), async () => {
      expect(orgFilterCond()).toEqual({});
      expect(customerFilterCond('present')).toEqual({});
      expect(customerFilterCond('absent')).toEqual({});
    });
  });
});

describe('escape hatch', () => {
  it('withSystemScope widens to system mode and audits', async () => {
    const records: unknown[] = [];
    setEscapeHatchAuditSink((r) => records.push(r));
    const constraint = await withSystemScope('nightly reconciliation', async () => orgConstraintFor());
    expect(constraint).toEqual({ kind: 'all' });
    expect(records).toEqual([{ scope: 'system', reason: 'nightly reconciliation' }]);
    setEscapeHatchAuditSink((r) => void r); // reset to a noop-ish sink
  });

  it('withOrgScope pins to one organization and audits', async () => {
    const records: Array<{ organizationId?: string }> = [];
    setEscapeHatchAuditSink((r) => records.push(r));
    const constraint = await withOrgScope('org-A', 'per-org sweep', async () => orgConstraintFor());
    expect(constraint).toEqual({ kind: 'single', organizationId: 'org-A' });
    expect(records[0]?.organizationId).toBe('org-A');
    setEscapeHatchAuditSink((r) => void r);
  });

  it('empty reason is rejected (synchronous programmer-error guard)', () => {
    expect(() => withSystemScope('', async () => 1)).toThrow(/non-empty reason/);
  });
});

describe('rule-scoped visibility', () => {
  it('platform admin sees every rule', async () => {
    const ctx = resolveTenantContext({ kind: 'admin', adminUserId: 'a' }, { allowAll: true });
    await runWithTenantContext(ctx, async () => {
      expect(ruleVisibleForScope(['org-B'])).toBe(true);
    });
  });

  it('scoped admin sees a rule only if it targets an assigned org (or targets none)', async () => {
    const ctx = resolveTenantContext(
      { kind: 'admin', adminUserId: 'a' },
      { allowAll: false, allowedOrganizationIds: ['org-A'] },
    );
    await runWithTenantContext(ctx, async () => {
      expect(ruleVisibleForScope(['org-B'])).toBe(false);
      expect(ruleVisibleForScope(['org-A', 'org-B'])).toBe(true);
      expect(ruleVisibleForScope([])).toBe(true);
    });
  });
});
