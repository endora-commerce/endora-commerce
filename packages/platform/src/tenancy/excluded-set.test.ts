import { describe, expect, it, vi } from 'vitest';
import * as tenancyBarrel from './index.js';
import { resolveTenantContext } from './resolve-tenant-context.js';
import { runWithTenantContext, type TenantContext } from './tenant-context.js';
import { customerFilterCond, orgFilterCond } from './filters.js';
import {
  assignedOrganizationIdsForRanking,
  orgConstraintFor,
  orgInScope,
  orgScopeSql,
  orgScopeTest,
  orgScopeWhere,
  ruleInScope,
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
const EXCLUDED_QUERY = { sql: 'select x from "reach_source"(?::uuid, ?::boolean) as x', params: ['rep', true] } as const;
/**
 * Issue #955 Phase 2 (owner ruling of 2026-11-10) — the id lists are no longer
 * part of the scope: the owner hands a lazy loader, and the platform memoises
 * it once per tenant context. Nothing on a request's hot path loads it; only a
 * single-id question or the ranking does.
 */
const REACH = { excludedOrganizationIds: ['org-F'], assignedOrganizationIds: ['org-A'] } as const;
const loader = () => vi.fn(async () => REACH);
const REP_SCOPE = {
  allowAll: false,
  reach: 'excluding',
  excludedOrganizationsQuery: EXCLUDED_QUERY,
  loadReach: async () => REACH,
} as const;

const repContext = (scope: Parameters<typeof resolveTenantContext>[1] = REP_SCOPE): TenantContext =>
  resolveTenantContext({ kind: 'admin', adminUserId: 'rep' }, scope);

const inRep = <T>(fn: () => T, ctx: TenantContext = repContext()): Promise<T> =>
  runWithTenantContext(ctx, async () => fn());

/**
 * Issue #955 (architect ruling, Q2) — the excluded organizations are not
 * shipped as a list: the owner's uncorrelated `SELECT` is rendered on the row's
 * own column as `col is not null and col not in (S)`, the ANY-sublink form
 * PostgreSQL hashes. Property-keyed (`$nin` with a query-builder subquery),
 * because a raw key is dropped by a joined `populate` (R-1). Read off the
 * builder rather than compared whole.
 */
function excludingSubquery(predicate: unknown): { keys: string[]; ne: unknown; sql: string; bindings: unknown[] } {
  const value = predicate as Record<string, unknown>;
  const nin = value['$nin'] as { toSQL?: () => { sql: string; bindings: readonly unknown[] } } | undefined;
  expect(typeof nin?.toSQL).toBe('function');
  const compiled = nin!.toSQL!();
  return { keys: Object.keys(value), ne: value['$ne'], sql: compiled.sql, bindings: [...compiled.bindings] };
}

const EXCLUDING_SUBQUERY = {
  keys: ['$ne', '$nin'],
  ne: null,
  sql: 'select * from (select x from "reach_source"(?::uuid, ?::boolean) as x) as "reach_excluded"',
  bindings: ['rep', true],
};

describe('resolveTenantContext — the `excluding` reach (#305)', () => {
  it('maps to the excluded-set mode, carrying the query and a loader it does not call', () => {
    const load = loader();
    const ctx = repContext({ ...REP_SCOPE, loadReach: load });
    expect(ctx.mode).toBe('excluded-set');
    expect(ctx.excludedOrganizationsQuery).toEqual(EXCLUDED_QUERY);
    // Lazy (#955 Phase 2): resolving the scope — every admin request — loads nothing.
    expect(load).not.toHaveBeenCalled();
    expect(ctx.allowedOrganizationIds).toBeUndefined();
    expect(ctx.notices).toEqual({ organizationAttributionRefused: false });
    expect(ctx.scopeUnresolved).toBeUndefined();
  });

  it('an unresolved scope beside it still holds nothing', () => {
    const refusal = new Error('no role');
    const ctx = repContext({ ...REP_SCOPE, unresolved: refusal });
    expect(ctx.mode).toBe('allowed-set');
    expect(ctx.allowedOrganizationIds).toEqual([]);
    expect(ctx.excludedOrganizationsQuery).toBeUndefined();
    expect(ctx.scopeUnresolved).toBe(refusal);
  });
});

describe('filter conds — the excluded-set arm (#305)', () => {
  it('@OrgScoped: every organization but the excluded ones, and never a null one', async () => {
    const cond = await inRep(() => orgFilterCond());
    expect(Object.keys(cond)).toEqual(['organizationId']);
    // `is not null` is spelled out: `null not in (<an empty set>)` is true.
    expect(excludingSubquery(cond['organizationId'])).toEqual(EXCLUDING_SUBQUERY);
  });

  it('@OrgScoped: the filter reads the query, not the list — an empty list renders the same predicate', async () => {
    // The list is the one `reachOf` answered when the scope was resolved; the
    // query is read live in each statement's snapshot. Only the query filters.
    const ctx = repContext({ ...REP_SCOPE, loadReach: async () => ({ excludedOrganizationIds: [], assignedOrganizationIds: [] }) });
    const cond = await inRep(() => orgFilterCond(), ctx);
    expect(excludingSubquery(cond['organizationId'])).toEqual(EXCLUDING_SUBQUERY);
  });

  it('an `excluding` scope without its query is refused, never read as "nothing excluded"', () => {
    const { excludedOrganizationsQuery: _omitted, ...withoutQuery } = REP_SCOPE;
    expect(() => repContext(withoutQuery)).toThrow(/excludedOrganizationsQuery/);
  });

  it('@CustomerScoped with an organization column: the same predicate', async () => {
    const cond = await inRep(() => customerFilterCond('present'));
    expect(Object.keys(cond)).toEqual(['organizationId']);
    expect(excludingSubquery(cond['organizationId'])).toEqual(EXCLUDING_SUBQUERY);
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
      excludedOrganizationsQuery: EXCLUDED_QUERY,
      loadReach: expect.any(Function),
    });
  });

  it('orgScopeWhere', () => {
    expect(orgScopeWhere('id', platform)).toEqual({});
    expect(orgScopeWhere('id', single)).toEqual({ id: 'org-A' });
    expect(orgScopeWhere('id', allowed)).toEqual({ id: { $in: ['org-A'] } });
    const where = orgScopeWhere('id', excluded);
    expect(Object.keys(where)).toEqual(['id']);
    expect(excludingSubquery(where['id'])).toEqual(EXCLUDING_SUBQUERY);
  });

  it('orgInScope answers every arm, asynchronously', async () => {
    expect(await orgInScope('org-F', platform)).toBe(true);
    expect(await orgInScope('org-A', single)).toBe(true);
    expect(await orgInScope('org-U', single)).toBe(false);
    expect(await orgInScope('org-A', allowed)).toBe(true);
    expect(await orgInScope('org-U', allowed)).toBe(false);
    // The unassigned organization is in reach; the one governed by another rep is not.
    expect(await orgInScope('org-U', excluded)).toBe(true);
    expect(await orgInScope('org-A', excluded)).toBe(true);
    expect(await orgInScope('org-F', excluded)).toBe(false);
    // `?? ''` is how callers spell "no organization": never in a reach that is a complement.
    expect(await orgInScope('', excluded)).toBe(false);
    expect(await orgInScope('', allowed)).toBe(false);
  });

  it('orgScopeTest answers what orgInScope answers, as a synchronous predicate', async () => {
    for (const ctx of [platform, single, allowed, excluded]) {
      const inScope = await orgScopeTest(ctx);
      for (const id of ['org-F', 'org-A', 'org-U', '']) {
        expect(inScope(id), id).toBe(await orgInScope(id, ctx));
      }
    }
  });

  it('ruleInScope answers every arm, asynchronously', async () => {
    expect(await ruleInScope(['org-F'], platform)).toBe(true);
    expect(await ruleInScope([], excluded)).toBe(true);
    expect(await ruleInScope(['org-F'], excluded)).toBe(false);
    expect(await ruleInScope(['org-F', 'org-U'], excluded)).toBe(true);
    expect(await ruleInScope(['org-U'], allowed)).toBe(false);
    expect(await ruleInScope(['org-A'], allowed)).toBe(true);
  });

  it('loads the reach at most once per tenant context, however many questions it answers', async () => {
    const load = loader();
    const ctx = repContext({ ...REP_SCOPE, loadReach: load });
    await orgInScope('org-F', ctx);
    await orgInScope('org-U', ctx);
    await ruleInScope(['org-A'], ctx);
    await assignedOrganizationIdsForRanking(ctx);
    await Promise.all([orgInScope('org-F', ctx), orgInScope('org-U', ctx)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a loader that fails refuses every question that needs it — never answers "in reach"', async () => {
    const down = new Error('reach statement failed');
    const ctx = repContext({ ...REP_SCOPE, loadReach: async () => { throw down; } });
    await expect(orgInScope('org-U', ctx)).rejects.toBe(down);
    await expect(ruleInScope(['org-U'], ctx)).rejects.toBe(down);
    await expect(assignedOrganizationIdsForRanking(ctx)).rejects.toBe(down);
    await expect(orgScopeTest(ctx)).rejects.toBe(down);
    // The filter predicate does not need the loader, so a list still renders.
    expect(excludingSubquery((await inRep(() => orgFilterCond(), ctx))['organizationId'])).toEqual(EXCLUDING_SUBQUERY);
  });

  it('the synchronous helpers are gone from the published surface (a Promise in an `if` is always truthy)', () => {
    expect('isOrgInScope' in tenancyBarrel).toBe(false);
    expect('ruleVisibleForScope' in tenancyBarrel).toBe(false);
    expect(typeof tenancyBarrel.orgInScope).toBe('function');
    expect(typeof tenancyBarrel.ruleInScope).toBe('function');
    expect(typeof tenancyBarrel.orgScopeTest).toBe('function');
  });

  it('orgScopeSql gives one array parameter per arm, and never matches a null organization', () => {
    expect(orgScopeSql('o.organization_id', platform)).toEqual({ sql: 'true', params: [] });
    expect(orgScopeSql('o.organization_id', single)).toEqual({ sql: 'o.organization_id = ?', params: ['org-A'] });
    expect(orgScopeSql('o.organization_id', allowed)).toEqual({
      sql: 'o.organization_id = any(?::uuid[])',
      params: ['{"org-A"}'],
    });
    expect(orgScopeSql('o.organization_id', excluded)).toEqual({
      sql: '(o.organization_id is not null and o.organization_id not in (select x from "reach_source"(?::uuid, ?::boolean) as x))',
      params: ['rep', true],
    });
  });

  it('assignedOrganizationIdsForRanking answers the assignments only, and never the excluded set', async () => {
    expect(await assignedOrganizationIdsForRanking(platform)).toEqual([]);
    expect(await assignedOrganizationIdsForRanking(single)).toEqual([]);
    expect(await assignedOrganizationIdsForRanking(allowed)).toEqual(['org-A']);
    expect(await assignedOrganizationIdsForRanking(excluded)).toEqual(['org-A']);
  });
});
