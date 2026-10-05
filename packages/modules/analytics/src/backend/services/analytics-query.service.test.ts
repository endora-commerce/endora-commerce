/**
 * The analytics summary is confined to the organizations its reader reaches.
 *
 * `analytics_events` is organization-scoped, and the summary is aggregated in
 * SQL the entity filter never sees — so the confinement has to be written into
 * the statement, for every statement, or an admin whose authority is a set of
 * organizations is shown totals over all of them.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrgConstraint } from '@endora-commerce/platform/tenancy';
import { describe, expect, it } from 'vitest';
import { AnalyticsQueryService } from './analytics-query.service.js';

const WINDOW = { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' };

function serviceOver(): {
  service: AnalyticsQueryService;
  statements: Array<{ sql: string; params: unknown[] }>;
} {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const em = {
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        statements.push({ sql, params });
        return [];
      },
    }),
  } as unknown as EntityManager;
  return { service: new AnalyticsQueryService(() => em), statements };
}

describe('AnalyticsQueryService.summary — tenant confinement', () => {
  it('adds no organization predicate for a reader who reaches every organization', async () => {
    const { service, statements } = serviceOver();
    await service.summary(WINDOW, { kind: 'all' });

    expect(statements).toHaveLength(2);
    for (const { sql, params } of statements) {
      expect(sql).not.toContain('organization_id');
      expect(params).toEqual([WINDOW.from, WINDOW.to]);
    }
  });

  it('confines every statement to the reader\'s organizations', async () => {
    const { service, statements } = serviceOver();
    const scope: OrgConstraint = { kind: 'set', organizationIds: ['o1', 'o2'] };
    await service.summary({ ...WINDOW, salesChannelId: 'c1' }, scope);

    expect(statements).toHaveLength(2);
    for (const { sql, params } of statements) {
      expect(sql).toContain('organization_id in (?, ?)');
      expect(params).toEqual([WINDOW.from, WINDOW.to, 'c1', 'o1', 'o2']);
    }
  });

  it('reads nothing for a reader who reaches no organization', async () => {
    const { service, statements } = serviceOver();
    const summary = await service.summary(WINDOW, { kind: 'set', organizationIds: [] });

    expect(summary).toEqual({ totalsByType: [], daily: [] });
    expect(statements).toEqual([]);
  });

  it('confines a single-organization reader to that organization', async () => {
    const { service, statements } = serviceOver();
    await service.summary(WINDOW, { kind: 'single', organizationId: 'o1' });

    for (const { sql, params } of statements) {
      expect(sql).toContain('organization_id in (?)');
      expect(params).toEqual([WINDOW.from, WINDOW.to, 'o1']);
    }
  });

  it('never matches events that belong to no organization for a confined reader', async () => {
    const { service, statements } = serviceOver();
    await service.summary(WINDOW, { kind: 'set', organizationIds: ['o1'] });
    for (const { sql } of statements) expect(sql).not.toMatch(/organization_id\s+is\s+null/i);

    const none = await service.summary(WINDOW, { kind: 'single', organizationId: null });
    expect(none).toEqual({ totalsByType: [], daily: [] });
  });
});
