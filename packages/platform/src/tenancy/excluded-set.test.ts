import { describe, expect, it } from 'vitest';
import { resolveTenantContext } from './resolve-tenant-context.js';
import { runWithTenantContext, type TenantContext } from './tenant-context.js';
import { customerFilterCond, orgFilterCond } from './filters.js';
import {
  assignedOrganizationIdsForRanking,
  isOrgInScope,
  orgConstraintFor,
  orgScopeSql,
  orgScopeWhere,
  ruleVisibleForScope,
} from './derived-scope.js';

/**
 * Issue #305 — one sales-representative reach rule on every surface.
 *
 * A sales representative reaches every Organization that is **not governed by
 * somebody else**, so the tenant scope describes the reach by its complement:
 * the `excluded-set` mode, a predicate `organization_id NOT IN (excluded)` on
 * the row's own column. These are the platform half of that: the mode, the two
 * filter arms, and every derived-scope helper's new arm.
 */
const REP_SCOPE = {
  allowAll: false,
  reach: 'excluding',
  excludedOrganizationIds: ['org-F'],
  assignedOrganizationIds: ['org-A'],
} as const;

const repContext = (scope: Parameters<typeof resolveTenantContext>[1] = REP_SCOPE): TenantContext =>
  resolveTenantContext({ kind: 'admin', adminUserId: 'rep' }, scope);

const inRep = <T>(fn: () => T, ctx: TenantContext = repContext()): Promise<T> =>
  runWithTenantContext(ctx, async () => fn());

describe('resolveTenantContext — the `excluding` reach (#305)', () => {
  it('maps to the excluded-set mode, carrying both id lists', () => {
    const ctx = repContext();
    expect(ctx.mode).toBe('excluded-set');
    expect(ctx.excludedOrganizationIds).toEqual(['org-F']);
    expect(ctx.assignedOrganizationIds).toEqual(['org-A']);
    expect(ctx.allowedOrganizationIds).toBeUndefined();
    expect(ctx.notices).toEqual({ organizationAttributionRefused: false });
    expect(ctx.scopeUnresolved).toBeUndefined();
  });

  it('an unresolved scope beside it still holds nothing', () => {
    const refusal = new Error('no role');
    const ctx = repContext({ ...REP_SCOPE, unresolved: refusal });
    expect(ctx.mode).toBe('allowed-set');
    expect(ctx.allowedOrganizationIds).toEqual([]);
    expect(ctx.excludedOrganizationIds).toBeUndefined();
    expect(ctx.scopeUnresolved).toBe(refusal);
  });
});

describe('filter conds — the excluded-set arm (#305)', () => {
  it('@OrgScoped: every organization but the excluded ones, and never a null one', async () => {
    expect(await inRep(() => orgFilterCond())).toEqual({
      organizationId: { $ne: null, $nin: ['org-F'] },
    });
  });

  it('@OrgScoped: an empty excluded list restricts nothing but the null organization', async () => {
    const ctx = repContext({ ...REP_SCOPE, excludedOrganizationIds: [] });
    expect(await inRep(() => orgFilterCond(), ctx)).toEqual({ organizationId: { $ne: null } });
  });

  it('@CustomerScoped with an organization column: the same predicate', async () => {
    expect(await inRep(() => customerFilterCond('present'))).toEqual({
      organizationId: { $ne: null, $nin: ['org-F'] },
    });
  });

  it('@CustomerScoped without one: matches nothing and notes the refusal', async () => {
    const ctx = repContext();
    expect(await inRep(() => customerFilterCond('absent'), ctx)).toEqual({ customerAccountId: { $in: [] } });
    expect(ctx.notices?.organizationAttributionRefused).toBe(true);
  });
});

describe('derived-scope helpers — one case per arm', () => {
  const platform = resolveTenantContext({ kind: 'admin', adminUserId: 'a' }, { allowAll: true });
  const single = resolveTenantContext({ kind: 'customer', customerAccountId: 'c', organizationId: 'org-A' });
  const allowed = resolveTenantContext(
    { kind: 'admin', adminUserId: 'a' },
    { allowAll: false, allowedOrganizationIds: ['org-A'] },
  );
  const excluded = repContext();

  it('orgConstraintFor names the allowed and the excluded arms', () => {
    expect(orgConstraintFor(platform)).toEqual({ kind: 'all' });
    expect(orgConstraintFor(single)).toEqual({ kind: 'single', organizationId: 'org-A' });
    expect(orgConstraintFor(allowed)).toEqual({ kind: 'allowed', organizationIds: ['org-A'] });
    expect(orgConstraintFor(excluded)).toEqual({
      kind: 'excluded',
      excludedOrganizationIds: ['org-F'],
      assignedOrganizationIds: ['org-A'],
    });
  });

  it('orgScopeWhere', () => {
    expect(orgScopeWhere('id', platform)).toEqual({});
    expect(orgScopeWhere('id', single)).toEqual({ id: 'org-A' });
    expect(orgScopeWhere('id', allowed)).toEqual({ id: { $in: ['org-A'] } });
    expect(orgScopeWhere('id', excluded)).toEqual({ id: { $ne: null, $nin: ['org-F'] } });
    expect(orgScopeWhere('id', repContext({ ...REP_SCOPE, excludedOrganizationIds: [] }))).toEqual({
      id: { $ne: null },
    });
  });

  it('isOrgInScope', () => {
    expect(isOrgInScope('org-F', platform)).toBe(true);
    expect(isOrgInScope('org-A', single)).toBe(true);
    expect(isOrgInScope('org-U', single)).toBe(false);
    expect(isOrgInScope('org-A', allowed)).toBe(true);
    expect(isOrgInScope('org-U', allowed)).toBe(false);
    // The unassigned organization is in reach; the one governed by another rep is not.
    expect(isOrgInScope('org-U', excluded)).toBe(true);
    expect(isOrgInScope('org-A', excluded)).toBe(true);
    expect(isOrgInScope('org-F', excluded)).toBe(false);
  });

  it('ruleVisibleForScope', () => {
    expect(ruleVisibleForScope(['org-F'], platform)).toBe(true);
    expect(ruleVisibleForScope([], excluded)).toBe(true);
    expect(ruleVisibleForScope(['org-F'], excluded)).toBe(false);
    expect(ruleVisibleForScope(['org-F', 'org-U'], excluded)).toBe(true);
    expect(ruleVisibleForScope(['org-U'], allowed)).toBe(false);
    expect(ruleVisibleForScope(['org-A'], allowed)).toBe(true);
  });

  it('orgScopeSql gives one array parameter per arm, and never matches a null organization', () => {
    expect(orgScopeSql('o.organization_id', platform)).toEqual({ sql: 'true', params: [] });
    expect(orgScopeSql('o.organization_id', single)).toEqual({ sql: 'o.organization_id = ?', params: ['org-A'] });
    expect(orgScopeSql('o.organization_id', allowed)).toEqual({
      sql: 'o.organization_id = any(?::uuid[])',
      params: ['{"org-A"}'],
    });
    expect(orgScopeSql('o.organization_id', excluded)).toEqual({
      sql: '(o.organization_id is not null and o.organization_id <> all(?::uuid[]))',
      params: ['{"org-F"}'],
    });
  });

  it('assignedOrganizationIdsForRanking answers the assignments only, and never the excluded set', () => {
    expect(assignedOrganizationIdsForRanking(platform)).toEqual([]);
    expect(assignedOrganizationIdsForRanking(single)).toEqual([]);
    expect(assignedOrganizationIdsForRanking(allowed)).toEqual(['org-A']);
    expect(assignedOrganizationIdsForRanking(excluded)).toEqual(['org-A']);
  });
});
