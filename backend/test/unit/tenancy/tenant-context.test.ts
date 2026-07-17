import { describe, it, expect } from 'vitest';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../../../src/tenancy/resolve-tenant-context.js';
import {
  getTenantContext,
  runWithTenantContext,
  MissingTenantContextError,
} from '../../../src/tenancy/tenant-context.js';
import { orgFilterArgsFor, customerFilterArgsFor } from '../../../src/tenancy/scoped-em.js';
import { orgFilterCond, customerFilterCond } from '../../../src/tenancy/filters.js';
import { withSystemScope, withOrgScope, setEscapeHatchAuditSink } from '../../../src/tenancy/escape-hatch.js';
import { orgConstraintFor, ruleVisibleForScope } from '../../../src/tenancy/derived-scope.js';

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
  it('getTenantContext returns undefined outside any run scope', () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it('runWithTenantContext makes the context ambient for its subtree', async () => {
    const ctx = systemTenantContext('test');
    await runWithTenantContext(ctx, async () => {
      expect(getTenantContext()).toBe(ctx);
      await Promise.resolve();
      expect(getTenantContext()).toBe(ctx);
    });
    expect(getTenantContext()).toBeUndefined();
  });
});

describe('filter arg mapping', () => {
  it('no context → no-context args → cond throws (fail-closed)', () => {
    expect(orgFilterArgsFor(undefined)).toEqual({ mode: 'no-context' });
    expect(() => orgFilterCond(orgFilterArgsFor(undefined))).toThrow(MissingTenantContextError);
    expect(() => customerFilterCond(customerFilterArgsFor(undefined))).toThrow(MissingTenantContextError);
  });

  it('single-org → organizationId equality predicate', () => {
    const args = orgFilterArgsFor(resolveTenantContext({ kind: 'customer', customerAccountId: 'c', organizationId: 'org-A' }));
    expect(orgFilterCond(args)).toEqual({ organizationId: 'org-A' });
  });

  it('allowed-set → $in predicate', () => {
    const args = orgFilterArgsFor(
      resolveTenantContext({ kind: 'admin', adminUserId: 'a' }, { allowAll: false, allowedOrganizationIds: ['org-A'] }),
    );
    expect(orgFilterCond(args)).toEqual({ organizationId: { $in: ['org-A'] } });
  });

  it('all / system → no restriction', () => {
    const all = orgFilterArgsFor(resolveTenantContext({ kind: 'admin', adminUserId: 'a' }, { allowAll: true }));
    expect(orgFilterCond(all)).toEqual({});
    expect(orgFilterCond(orgFilterArgsFor(systemTenantContext('r')))).toEqual({});
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
