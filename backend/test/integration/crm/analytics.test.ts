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
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  CRM_ADMIN,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';
import {
  countStatements,
  getCrmAnalytics,
  removeAnalyticsOpportunities,
  seedAnalyticsOpportunity,
  type AnalyticsOpportunitySeed,
} from '../../helpers/seed-crm-analytics.js';

/**
 * CRM analytics (User Story 13; `contracts/admin-api.md` §12; FR-053, SC-004,
 * SC-007): five figures over a date range, each equal to the one computed by
 * hand from the fixture below.
 *
 * ## The fixture
 *
 * Range under test: **2026-03-01 … 2026-04-30** (days are UTC, `to` inclusive).
 * `A` is the Organization the confined manager reaches; `B` is one they do not.
 * `X` is a Sales Channel; `R1`, `R2` are the assignees.
 *
 * | #   | Org | Cur | Value          | Created | Statuses (entered on)                          | Closed       | Days | Rep | Ch |
 * | --- | --- | --- | -------------- | ------- | ---------------------------------------------- | ------------ | ---- | --- | -- |
 * | O1  | A   | PLN | 1000           | 03-01   | new 03-01, qualified 03-03, proposal 03-06     | won 03-11    | 10   | R1  | X  |
 * | O2  | A   | PLN | 3000           | 03-05   | new 03-05, qualified 03-10                     | won 03-25    | 20   | R1  | —  |
 * | O3  | A   | EUR | 500            | 03-10   | new 03-10                                      | won 04-09    | 30   | R2  | X  |
 * | O4  | A   | PLN | 2000           | 03-20   | new 03-20                                      | lost 03-24   | 4    | R2  | —  |
 * | O5  | A   | PLN | 700 (computed) | 04-01   | new 04-01, qualified 04-11 (still there)       | —            | —    | R1  | —  |
 * | O6  | B   | PLN | 50000          | 03-02   | new 03-02                                      | won 03-04    | 2    | R1  | —  |
 * | O7  | A   | PLN | 8000           | 01-10   | new 01-10                                      | won 02-10    | 31   | R1  | —  |
 * | O8  | A   | PLN | none           | 03-15   | new 03-15 (still there)                        | —            | —    | —   | —  |
 * | O9  | A   | EUR | 1500           | 02-20   | new 02-20                                      | won 04-20    | 59   | —   | —  |
 * | O10 | A   | EUR | 250            | 03-12   | new 03-12                                      | won 03-30    | 18   | R1  | —  |
 *
 * O5 is `computed`-mode with a stale manual figure of 9999 beside it: the
 * effective value is the computed 700. O7 lies wholly before the range.
 *
 * ## By hand, for the manager confined to A
 *
 * **Handling time** (closed in range: O1, O2, O3, O4, O9, O10) —
 * (10 + 20 + 30 + 4 + 59 + 18) / 6 = 23.5 days; won (all but O4) 137 / 5 = 27.4
 * days; lost 4 days.
 *
 * **Time in status** (stays that began in range) — *proposal*: O1, 03-06 →
 * 03-11 = 5 days, one stay. *new* for R2's Opportunities: O3 30 days, O4 4
 * days → 17 days over two stays. *qualified*: O1 3 days, O2 15 days, and O5
 * from 04-11 until now.
 *
 * **Rep effectiveness** (won, closed in range, assigned) — 2026-03: R1 with
 * O1, O2, O10 → 3 won, PLN 4000.00 and EUR 250.00. 2026-04: R2 with O3 → 1 won,
 * EUR 500.00. O9 was won by nobody in particular and is in no row.
 *
 * **Top opportunities**, per currency — created in range: EUR O3 500, O10 250;
 * PLN O2 3000, O4 2000, O1 1000, O5 700. Closed in range: EUR O9 1500, O3 500,
 * O10 250; PLN O2 3000, O4 2000, O1 1000.
 *
 * **Average value** (created in range, valued) — PLN (1000 + 3000 + 2000 +
 * 700) / 4 = 1675.00; EUR (500 + 250) / 2 = 375.00.
 *
 * The platform administrator also reaches B, so O6 joins: handling time
 * (141 + 2) / 7 days, R1's March 4 won and PLN 54000.00, PLN average
 * 56700 / 5 = 11340.00, and O6 at the head of the PLN lists.
 */
describe('crm analytics', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let manager: Seeded;
  let r1: Seeded;
  let r2: Seeded;
  let organizationB: string;
  let channelX: string;
  const seeded: string[] = [];
  const id: Record<string, string> = {};

  const DAY = 86_400;
  const RANGE = { from: '2026-03-01', to: '2026-04-30' };
  const at = (day: string) => `2026-${day}T00:00:00.000Z`;

  const seed = async (key: string, opportunity: AnalyticsOpportunitySeed) => {
    const row = await seedAnalyticsOpportunity(h.em(), { title: key, ...opportunity });
    seeded.push(row.id);
    id[key] = row.id;
  };

  const ok = async (
    figure: Parameters<typeof getCrmAnalytics>[1],
    query: Parameters<typeof getCrmAnalytics>[2],
    cookies: Record<string, string>,
  ) => {
    const response = await getCrmAnalytics(h, figure, query, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as unknown;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationB = await seedCrmOrganization(h.em(), 'Analytics B');
    channelX = await systemDefaultSalesChannelId(h.em());
    manager = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:analytics', 'orders:read']);
    r1 = await seedCrmAdmin(h.em(), 'analytics-r1', ['crm:read']);
    r2 = await seedCrmAdmin(h.em(), 'analytics-r2', ['crm:read']);
    const R1 = r1.adminUserId;
    const R2 = r2.adminUserId;

    await seed('O1', {
      manualValue: '1000.00',
      assignedAdminUserId: R1,
      salesChannelId: channelX,
      statuses: [['new', at('03-01')], ['qualified', at('03-03')], ['proposal', at('03-06')], ['won', at('03-11')]],
      closedKind: 'won',
    });
    await seed('O2', {
      manualValue: '3000.00',
      assignedAdminUserId: R1,
      statuses: [['new', at('03-05')], ['qualified', at('03-10')], ['won', at('03-25')]],
      closedKind: 'won',
    });
    await seed('O3', {
      currency: 'EUR',
      manualValue: '500.00',
      assignedAdminUserId: R2,
      salesChannelId: channelX,
      statuses: [['new', at('03-10')], ['won', at('04-09')]],
      closedKind: 'won',
    });
    await seed('O4', {
      manualValue: '2000.00',
      assignedAdminUserId: R2,
      statuses: [['new', at('03-20')], ['lost', at('03-24')]],
      closedKind: 'lost',
    });
    await seed('O5', {
      manualValue: '9999.00',
      computedValue: '700.00',
      assignedAdminUserId: R1,
      statuses: [['new', at('04-01')], ['qualified', at('04-11')]],
    });
    await seed('O6', {
      organizationId: organizationB,
      manualValue: '50000.00',
      assignedAdminUserId: R1,
      statuses: [['new', at('03-02')], ['won', at('03-04')]],
      closedKind: 'won',
    });
    await seed('O7', {
      manualValue: '8000.00',
      assignedAdminUserId: R1,
      statuses: [['new', at('01-10')], ['won', at('02-10')]],
      closedKind: 'won',
    });
    await seed('O8', { statuses: [['new', at('03-15')]] });
    await seed('O9', {
      currency: 'EUR',
      manualValue: '1500.00',
      statuses: [['new', at('02-20')], ['won', at('04-20')]],
      closedKind: 'won',
    });
    await seed('O10', {
      currency: 'EUR',
      manualValue: '250.00',
      assignedAdminUserId: R1,
      statuses: [['new', at('03-12')], ['won', at('03-30')]],
      closedKind: 'won',
    });
  });

  afterAll(async () => {
    await removeAnalyticsOpportunities(h.em(), seeded);
    manager.undo();
    r1.undo();
    r2.undo();
    await teardownBackendServer(h);
  });

  describe('average handling time', () => {
    it('is creation to closing, over the Opportunities closed in the range, with each outcome apart', async () => {
      const { data } = OpportunityHandlingTimeResponseSchema.parse(
        await ok('handling-time', RANGE, manager.cookies),
      );
      expect(data.closedCount).toBe(6);
      expect(data.averageSeconds).toBeCloseTo(23.5 * DAY, 3);
      expect(data.byOutcome.won.closedCount).toBe(5);
      expect(data.byOutcome.won.averageSeconds).toBeCloseTo(27.4 * DAY, 3);
      expect(data.byOutcome.lost.closedCount).toBe(1);
      expect(data.byOutcome.lost.averageSeconds).toBeCloseTo(4 * DAY, 3);
    });

    it('narrows to a Sales Channel and to an assignee', async () => {
      const channel = OpportunityHandlingTimeResponseSchema.parse(
        await ok('handling-time', { ...RANGE, salesChannelId: channelX }, manager.cookies),
      ).data;
      // O1 (10 days) and O3 (30 days).
      expect(channel.closedCount).toBe(2);
      expect(channel.averageSeconds).toBeCloseTo(20 * DAY, 3);

      const assignee = OpportunityHandlingTimeResponseSchema.parse(
        await ok('handling-time', { ...RANGE, assignedAdminUserId: r2.adminUserId }, manager.cookies),
      ).data;
      // O3 (30 days, won) and O4 (4 days, lost).
      expect(assignee.closedCount).toBe(2);
      expect(assignee.averageSeconds).toBeCloseTo(17 * DAY, 3);
      expect(assignee.byOutcome.won).toMatchObject({ closedCount: 1 });
      expect(assignee.byOutcome.lost).toMatchObject({ closedCount: 1 });
    });

    it('answers nothing closed as null, not as zero', async () => {
      const { data } = OpportunityHandlingTimeResponseSchema.parse(
        await ok('handling-time', { from: '2025-01-01', to: '2025-01-31' }, manager.cookies),
      );
      expect(data).toEqual({
        averageSeconds: null,
        closedCount: 0,
        byOutcome: {
          won: { averageSeconds: null, closedCount: 0 },
          lost: { averageSeconds: null, closedCount: 0 },
        },
      });
    });
  });

  describe('average time in status', () => {
    it('reports each selected status only, a status nobody entered included', async () => {
      const { data } = OpportunityTimeInStatusResponseSchema.parse(
        await ok('time-in-status', { ...RANGE, statusCode: ['proposal', 'negotiation'] }, manager.cookies),
      );
      expect(data).toHaveLength(2);
      // O1 was in *proposal* from 03-06 to 03-11.
      expect(data[0]).toMatchObject({ statusCode: 'proposal', sampleCount: 1 });
      expect(data[0]?.averageSeconds).toBeCloseTo(5 * DAY, 3);
      expect(data[1]).toEqual({ statusCode: 'negotiation', averageSeconds: null, sampleCount: 0 });
    });

    it('measures a stay from one status change to the next', async () => {
      const { data } = OpportunityTimeInStatusResponseSchema.parse(
        await ok(
          'time-in-status',
          { ...RANGE, statusCode: ['new'], assignedAdminUserId: r2.adminUserId },
          manager.cookies,
        ),
      );
      // O3: 03-10 → 04-09 = 30 days. O4: 03-20 → 03-24 = 4 days.
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ statusCode: 'new', sampleCount: 2 });
      expect(data[0]?.averageSeconds).toBeCloseTo(17 * DAY, 3);
    });

    it('counts an Opportunity still in the status, up to now', async () => {
      const before = Date.now();
      const { data } = OpportunityTimeInStatusResponseSchema.parse(
        await ok('time-in-status', { ...RANGE, statusCode: ['qualified'] }, manager.cookies),
      );
      const after = Date.now();
      // O1 3 days, O2 15 days, and O5 from 04-11 until this moment.
      const entered = Date.parse(at('04-11'));
      const expected = (now: number) => (3 * DAY + 15 * DAY + (now - entered) / 1000) / 3;
      expect(data[0]).toMatchObject({ statusCode: 'qualified', sampleCount: 3 });
      expect(data[0]?.averageSeconds).toBeGreaterThanOrEqual(expected(before) - 1);
      expect(data[0]?.averageSeconds).toBeLessThanOrEqual(expected(after) + 1);
    });

    it('reports every status of the workflow, in its order, when none is selected', async () => {
      const { data } = OpportunityTimeInStatusResponseSchema.parse(
        await ok('time-in-status', RANGE, manager.cookies),
      );
      expect(data.map((row) => row.statusCode)).toEqual([
        'new',
        'qualified',
        'proposal',
        'negotiation',
        'won',
        'lost',
      ]);
      // new: O1, O2, O3, O4, O5, O8, O10 began there in range (O9 began before it).
      expect(data.find((row) => row.statusCode === 'new')?.sampleCount).toBe(7);
      // won: O1, O2, O3, O9, O10 entered it in range.
      expect(data.find((row) => row.statusCode === 'won')?.sampleCount).toBe(5);
    });
  });

  describe('most effective sales reps', () => {
    it('ranks by Opportunities won per calendar month, their value per currency', async () => {
      const { data } = OpportunityRepEffectivenessResponseSchema.parse(
        await ok('rep-effectiveness', RANGE, manager.cookies),
      );
      expect(data).toEqual([
        {
          month: '2026-03',
          adminUser: { id: r1.adminUserId, name: expect.stringContaining('analytics-r1') },
          wonCount: 3,
          wonValue: [
            { currency: 'EUR', total: '250.00' },
            { currency: 'PLN', total: '4000.00' },
          ],
        },
        {
          month: '2026-04',
          adminUser: { id: r2.adminUserId, name: expect.stringContaining('analytics-r2') },
          wonCount: 1,
          wonValue: [{ currency: 'EUR', total: '500.00' }],
        },
      ]);
    });

    it('narrows to an assignee', async () => {
      const { data } = OpportunityRepEffectivenessResponseSchema.parse(
        await ok('rep-effectiveness', { ...RANGE, assignedAdminUserId: r2.adminUserId }, manager.cookies),
      );
      expect(data.map((row) => [row.month, row.adminUser.id, row.wonCount])).toEqual([
        ['2026-04', r2.adminUserId, 1],
      ]);
    });
  });

  describe('most valuable Opportunities', () => {
    const keys = (data: ReadonlyArray<{ id: string }>) =>
      data.map((row) => Object.keys(id).find((key) => id[key] === row.id));

    it('lists the highest effective values per currency among those created in the range', async () => {
      const { data } = TopOpportunitiesResponseSchema.parse(
        await ok('top-opportunities', { ...RANGE, basis: 'created' }, manager.cookies),
      );
      expect(keys(data)).toEqual(['O3', 'O10', 'O2', 'O4', 'O1', 'O5']);
      // The computed figure, not the stale manual one beside it.
      expect(data.find((row) => row.id === id['O5'])).toMatchObject({ value: '700.00', valueMode: 'computed' });
      expect(data.map((row) => row.currency)).toEqual(['EUR', 'EUR', 'PLN', 'PLN', 'PLN', 'PLN']);
    });

    it('applies the limit to each currency apart, and can go by closing date', async () => {
      const limited = TopOpportunitiesResponseSchema.parse(
        await ok('top-opportunities', { ...RANGE, basis: 'created', limit: 2 }, manager.cookies),
      ).data;
      expect(keys(limited)).toEqual(['O3', 'O10', 'O2', 'O4']);

      const closed = TopOpportunitiesResponseSchema.parse(
        await ok('top-opportunities', { ...RANGE, basis: 'closed' }, manager.cookies),
      ).data;
      expect(keys(closed)).toEqual(['O9', 'O3', 'O10', 'O2', 'O4', 'O1']);
    });
  });

  describe('average value', () => {
    it('is per currency, over the valued Opportunities created in the range — never across currencies', async () => {
      const { data } = OpportunityAverageValueResponseSchema.parse(
        await ok('average-value', RANGE, manager.cookies),
      );
      expect(data).toEqual([
        { currency: 'EUR', average: '375.00', count: 2 },
        { currency: 'PLN', average: '1675.00', count: 4 },
      ]);
    });

    it('narrows to a Sales Channel', async () => {
      const { data } = OpportunityAverageValueResponseSchema.parse(
        await ok('average-value', { ...RANGE, salesChannelId: channelX }, manager.cookies),
      );
      expect(data).toEqual([
        { currency: 'EUR', average: '500.00', count: 1 },
        { currency: 'PLN', average: '1000.00', count: 1 },
      ]);
    });
  });

  describe('tenant isolation (SC-004)', () => {
    it('gives the platform administrator the figures with B in them — the positive control', async () => {
      const handling = OpportunityHandlingTimeResponseSchema.parse(await ok('handling-time', RANGE, CRM_ADMIN)).data;
      expect(handling.closedCount).toBe(7);
      expect(handling.averageSeconds).toBeCloseTo((143 / 7) * DAY, 3);

      const reps = OpportunityRepEffectivenessResponseSchema.parse(await ok('rep-effectiveness', RANGE, CRM_ADMIN)).data;
      expect(reps.find((row) => row.month === '2026-03' && row.adminUser.id === r1.adminUserId)).toMatchObject({
        wonCount: 4,
        wonValue: [
          { currency: 'EUR', total: '250.00' },
          { currency: 'PLN', total: '54000.00' },
        ],
      });

      const average = OpportunityAverageValueResponseSchema.parse(await ok('average-value', RANGE, CRM_ADMIN)).data;
      expect(average).toContainEqual({ currency: 'PLN', average: '11340.00', count: 5 });

      const top = TopOpportunitiesResponseSchema.parse(
        await ok('top-opportunities', { ...RANGE, basis: 'created' }, CRM_ADMIN),
      ).data;
      expect(top.filter((row) => row.currency === 'PLN')[0]?.id).toBe(id['O6']);

      const stays = OpportunityTimeInStatusResponseSchema.parse(
        await ok('time-in-status', { ...RANGE, statusCode: ['new'] }, CRM_ADMIN),
      ).data;
      expect(stays[0]?.sampleCount).toBe(8);
    });

    it('gives a manager confined to A nothing of B in any figure', async () => {
      // Every figure above was asked as the confined manager and equals the
      // hand computation without O6. Here: B's Opportunity is in no body at all.
      for (const [figure, query] of [
        ['handling-time', RANGE],
        ['time-in-status', RANGE],
        ['rep-effectiveness', RANGE],
        ['top-opportunities', { ...RANGE, basis: 'created', limit: 100 }],
        ['top-opportunities', { ...RANGE, basis: 'closed', limit: 100 }],
        ['average-value', RANGE],
      ] as const) {
        const response = await getCrmAnalytics(h, figure, query, manager.cookies);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.body, figure).not.toContain(id['O6']);
        // O6's value, and the March total it would have made.
        expect(response.body, figure).not.toContain('"50000.00"');
        expect(response.body, figure).not.toContain('"54000.00"');
      }
    });
  });

  describe('cost (SC-007)', () => {
    it('issues the same number of statements whatever the number of Opportunities', async () => {
      const figures = [
        ['handling-time', RANGE],
        ['time-in-status', RANGE],
        ['rep-effectiveness', RANGE],
        ['top-opportunities', { ...RANGE, basis: 'created' }],
        ['average-value', RANGE],
      ] as const;
      const measure = async () => {
        const counts: Record<string, number> = {};
        for (const [figure, query] of figures) {
          const { result, statements } = await countStatements(h.em(), () =>
            getCrmAnalytics(h, figure, query, CRM_ADMIN),
          );
          expect(result.statusCode, result.body).toBe(200);
          counts[figure] = statements;
        }
        return counts;
      };

      const before = await measure();
      for (const count of Object.values(before)) expect(count).toBeGreaterThan(0);

      // Sixty more, closed and won in the range, by both reps, in two currencies.
      for (let index = 0; index < 60; index += 1) {
        await seed(`extra-${index}`, {
          currency: index % 2 === 0 ? 'PLN' : 'EUR',
          manualValue: `${100 + index}.00`,
          assignedAdminUserId: index % 3 === 0 ? r2.adminUserId : r1.adminUserId,
          statuses: [['new', at('03-02')], ['qualified', at('03-04')], ['won', at('03-09')]],
          closedKind: 'won',
        });
      }
      expect(await measure()).toEqual(before);
    });
  });
});
