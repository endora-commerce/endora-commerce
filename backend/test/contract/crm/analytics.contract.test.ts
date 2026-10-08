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

/**
 * Analytics (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12):
 * the five reads against their schemas, their gate and their refusals. What
 * each figure *is* — computed by hand from a fixture — is
 * `test/integration/crm/analytics.test.ts`.
 */
describe('crm analytics (contract)', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let analyst: Seeded;
  let reader: Seeded;
  let rep: Seeded;
  const seeded: string[] = [];

  const FIGURES = [
    ['handling-time', OpportunityHandlingTimeResponseSchema],
    ['time-in-status', OpportunityTimeInStatusResponseSchema],
    ['rep-effectiveness', OpportunityRepEffectivenessResponseSchema],
    ['top-opportunities', TopOpportunitiesResponseSchema],
    ['average-value', OpportunityAverageValueResponseSchema],
  ] as const;
  const RANGE = { from: '2025-06-01', to: '2025-06-30' };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    // The analytics code alone: the endpoints ask for nothing else.
    analyst = await seedCrmAdmin(h.em(), 'analyst', ['crm:analytics']);
    reader = await seedCrmAdmin(h.em(), 'analytics-reader', ['crm:read', 'crm:write', 'crm:configure']);
    rep = await seedCrmAdmin(h.em(), 'analytics-rep', ['crm:read']);
    for (const [closedAt, value] of [
      ['2025-06-10T09:00:00.000Z', '1200.00'],
      // The last hour of the last day of the range.
      ['2025-06-30T23:30:00.000Z', '800.00'],
    ] as const) {
      const row = await seedAnalyticsOpportunity(h.em(), {
        manualValue: value,
        assignedAdminUserId: rep.adminUserId,
        statuses: [['new', '2025-06-01T09:00:00.000Z'], ['won', closedAt]],
        closedKind: 'won',
      });
      seeded.push(row.id);
    }
  });

  afterAll(async () => {
    await removeAnalyticsOpportunities(h.em(), seeded);
    for (const admin of [analyst, reader, rep]) admin.undo();
    await teardownBackendServer(h);
  });

  it.each(FIGURES)('GET /analytics/%s answers its schema', async (figure, schema) => {
    const response = await getCrmAnalytics(h, figure, RANGE, analyst.cookies);
    expect(response.statusCode, response.body).toBe(200);
    expect(() => schema.parse(response.json())).not.toThrow();
  });

  it.each(FIGURES)('GET /analytics/%s is gated crm:analytics — every other CRM code is 403', async (figure) => {
    const refused = await getCrmAnalytics(h, figure, RANGE, reader.cookies);
    expect(refused.statusCode, refused.body).toBe(403);
    const admitted = await getCrmAnalytics(h, figure, RANGE, CRM_ADMIN);
    expect(admitted.statusCode, admitted.body).toBe(200);
  });

  it.each(FIGURES)('GET /analytics/%s refuses a query its schema does not accept — 400', async (figure) => {
    for (const query of [
      {},
      { from: '2025-06-01' },
      { from: '01.06.2025', to: '2025-06-30' },
      { ...RANGE, salesChannelId: 'nope' },
      { ...RANGE, assignedAdminUserId: 'me' },
    ]) {
      const response = await getCrmAnalytics(h, figure, query, analyst.cookies);
      expect(response.statusCode, `${JSON.stringify(query)} ${response.body}`).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a range that ends before it begins — 422', async () => {
    for (const [figure] of FIGURES) {
      const response = await getCrmAnalytics(h, figure, { from: '2025-06-30', to: '2025-06-01' }, analyst.cookies);
      expect(response.statusCode, `${figure} ${response.body}`).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses the extra parameters of its two parameterised reads when malformed — 400', async () => {
    for (const [figure, query] of [
      ['top-opportunities', { ...RANGE, limit: 0 }],
      ['top-opportunities', { ...RANGE, limit: 101 }],
      ['top-opportunities', { ...RANGE, basis: 'won' }],
      ['time-in-status', { ...RANGE, statusCode: ['Not A Code'] }],
    ] as const) {
      const response = await getCrmAnalytics(h, figure, query, analyst.cookies);
      expect(response.statusCode, `${figure} ${JSON.stringify(query)} ${response.body}`).toBe(400);
    }
  });

  it('takes `to` as the whole day named, and `from` from its first instant', async () => {
    const closedIn = async (range: { from: string; to: string }) =>
      OpportunityHandlingTimeResponseSchema.parse(
        (await getCrmAnalytics(h, 'handling-time', range, analyst.cookies)).json(),
      ).data.closedCount;
    expect(await closedIn(RANGE)).toBe(2);
    expect(await closedIn({ from: '2025-06-01', to: '2025-06-29' })).toBe(1);
    expect(await closedIn({ from: '2025-06-30', to: '2025-06-30' })).toBe(1);
    expect(await closedIn({ from: '2025-07-01', to: '2025-07-31' })).toBe(0);
  });

  it('answers `OpportunitySummary` rows for the most valuable Opportunities, highest first', async () => {
    const { data } = TopOpportunitiesResponseSchema.parse(
      (await getCrmAnalytics(h, 'top-opportunities', { ...RANGE, basis: 'closed' }, analyst.cookies)).json(),
    );
    expect(data.map((row) => row.value)).toEqual(['1200.00', '800.00']);
    expect(data[0]).toMatchObject({
      currency: 'PLN',
      status: { code: 'won', kind: 'won' },
      assignee: { id: rep.adminUserId },
      closedKind: 'won',
    });
  });
});
