import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityAverageValueResponseSchema,
  OpportunityHandlingTimeResponseSchema,
  OpportunityRepEffectivenessResponseSchema,
  OpportunityTimeInStatusResponseSchema,
  TopOpportunitiesResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CRM_ADMIN, restoreDefaultCrmWorkflow, seedCrmAdmin } from '../../helpers/seed-crm.js';
import {
  getCrmAnalytics,
  removeAnalyticsOpportunities,
  seedAnalyticsOpportunity,
} from '../../helpers/seed-crm-analytics.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';

/**
 * CRM analytics count days in the reporting time zone (issue #474; owner
 * ruling of 2026-10-27): `analytics.reporting_time_zone`, the setting the
 * `analytics` module owns and Projects analytics already counts in. It
 * defaults to `UTC`, in which the figures are those CRM answered before; with
 * `analytics` off CRM counts in `UTC` and never fails (a `degrades-without`
 * edge). Every answer names the zone it was counted in (issue #475).
 *
 * Two Opportunities, dated in 2004 — a year no other CRM file uses — and
 * assigned to a Sales Rep of this file's own, whom every read filters on, so
 * no other file's rows are counted. Europe/Warsaw is UTC+1 in winter:
 *
 * - A, created 2003-12-31 23:30 UTC (1 January 00:30 in Warsaw), won
 *   2004-01-31 23:30 UTC (1 February 00:30 in Warsaw);
 * - F, created 2004-01-15 12:00 UTC — mid-January everywhere — and open.
 */
describe('crm — analytics in the reporting time zone (#474)', () => {
  let h: BackendServerHandle;
  let rep: { adminUserId: string; undo: () => void };
  const seeded: string[] = [];

  const setZone = (value: unknown) =>
    h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/analytics.reporting_time_zone/value',
      cookies: CRM_ADMIN,
      payload: { scope: 'all', value },
    });

  const read = async (figure: Parameters<typeof getCrmAnalytics>[1], from: string, to: string) => {
    const response = await getCrmAnalytics(h, figure, { from, to, assignedAdminUserId: rep.adminUserId }, CRM_ADMIN);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as unknown;
  };
  const created = async (from: string, to: string) =>
    OpportunityAverageValueResponseSchema.parse(await read('average-value', from, to)).data.reduce(
      (sum, row) => sum + row.count,
      0,
    );
  const closed = async (from: string, to: string) =>
    OpportunityHandlingTimeResponseSchema.parse(await read('handling-time', from, to)).data.closedCount;
  const wonMonths = async (from: string, to: string) =>
    OpportunityRepEffectivenessResponseSchema.parse(await read('rep-effectiveness', from, to)).data.map(
      (row) => row.month,
    );
  /** The zone each of the five figures says it was counted in. */
  const zones = async (from: string, to: string) => [
    OpportunityHandlingTimeResponseSchema.parse(await read('handling-time', from, to)).timeZone,
    OpportunityTimeInStatusResponseSchema.parse(await read('time-in-status', from, to)).timeZone,
    OpportunityRepEffectivenessResponseSchema.parse(await read('rep-effectiveness', from, to)).timeZone,
    TopOpportunitiesResponseSchema.parse(await read('top-opportunities', from, to)).timeZone,
    OpportunityAverageValueResponseSchema.parse(await read('average-value', from, to)).timeZone,
  ];

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    rep = await seedCrmAdmin(h.em(), 'analytics-zone-rep', ['crm:read']);
    for (const [title, seed] of [
      [
        'Zone A',
        {
          manualValue: '100.00',
          statuses: [
            ['new', '2003-12-31T23:30:00.000Z'],
            ['won', '2004-01-31T23:30:00.000Z'],
          ],
          closedKind: 'won',
        },
      ],
      ['Zone F', { manualValue: '200.00', statuses: [['new', '2004-01-15T12:00:00.000Z']] }],
    ] as const) {
      const row = await seedAnalyticsOpportunity(h.em(), { title, assignedAdminUserId: rep.adminUserId, ...seed });
      seeded.push(row.id);
    }
  });

  afterAll(async () => {
    await setZone('UTC');
    await removeAnalyticsOpportunities(h.em(), seeded);
    rep.undo();
    await teardownBackendServer(h);
  });

  it('defaults to UTC, counting as CRM did before the setting, and says so', async () => {
    expect(await zones('2004-01-01', '2004-01-31')).toEqual(['UTC', 'UTC', 'UTC', 'UTC', 'UTC']);
    expect(await created('2004-01-01', '2004-01-31')).toBe(1);
    expect(await created('2003-12-31', '2003-12-31')).toBe(1);
    expect(await closed('2004-01-31', '2004-01-31')).toBe(1);
    expect(await closed('2004-02-01', '2004-02-29')).toBe(0);
    expect(await wonMonths('2004-01-01', '2004-02-29')).toEqual(['2004-01']);
  });

  it('in Europe/Warsaw counts days and months at that zone’s midnights, and says so', async () => {
    const accepted = await setZone('Europe/Warsaw');
    expect(accepted.statusCode, accepted.body).toBeLessThan(400);
    expect(await zones('2004-01-01', '2004-01-31')).toEqual([
      'Europe/Warsaw',
      'Europe/Warsaw',
      'Europe/Warsaw',
      'Europe/Warsaw',
      'Europe/Warsaw',
    ]);
    expect(await created('2004-01-01', '2004-01-31')).toBe(2);
    expect(await created('2003-12-31', '2003-12-31')).toBe(0);
    expect(await closed('2004-01-31', '2004-01-31')).toBe(0);
    expect(await closed('2004-02-01', '2004-02-29')).toBe(1);
    // The month a win is ranked in is the zone's month too.
    expect(await wonMonths('2004-01-01', '2004-02-29')).toEqual(['2004-02']);
  });

  it('with analytics off counts in UTC whatever the setting says — degraded, never failing', async () => {
    const accepted = await setZone('Europe/Warsaw');
    expect(accepted.statusCode, accepted.body).toBeLessThan(400);
    await withModulesDeactivated(['analytics'], async () => {
      expect(await zones('2004-01-01', '2004-01-31')).toEqual(['UTC', 'UTC', 'UTC', 'UTC', 'UTC']);
      expect(await created('2004-01-01', '2004-01-31')).toBe(1);
      expect(await closed('2004-02-01', '2004-02-29')).toBe(0);
      expect(await wonMonths('2004-01-01', '2004-02-29')).toEqual(['2004-01']);
    });
    // On again, the zone is back.
    expect(await closed('2004-02-01', '2004-02-29')).toBe(1);
  });
});
