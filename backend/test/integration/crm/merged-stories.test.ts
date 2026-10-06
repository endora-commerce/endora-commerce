import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityAverageValueResponseSchema,
  OpportunityBoardResponseSchema,
  OpportunityDetailResponseSchema,
  OpportunityListResponseSchema,
  TopOpportunitiesResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  defineCrmCustomField,
  linkCrmOrder,
  placeCrmOrder,
  removeCrmCustomFields,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmCountingStatuses,
  setCrmSetting,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * What no single story could see — the places where two stories, built on
 * separate branches, meet (`specs/143-crm-sales-opportunities/research.md`,
 * N-I2 and N-I3).
 *
 * 1. **One value, four readers.** User Story 8 made `computed_value` a real,
 *    maintained figure; User Story 13's analytics, the list's `sort=value` and
 *    the board's totals were each written against a column that was always
 *    `0.00`. They must agree with the detail about a computed Opportunity.
 * 2. **Automatic creation meets a required custom field.** User Story 9 creates
 *    an Opportunity with nobody at a form; User Story 15 refuses a create that
 *    leaves a required field empty. The first must not be refused by the
 *    second.
 */
describe('crm: stories that meet', () => {
  let h: BackendServerHandle;

  const get = async (path: string, cookies: Record<string, string> = CRM_ADMIN) => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}${path}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as unknown;
  };
  const detail = async (id: string, cookies: Record<string, string> = CRM_ADMIN) =>
    OpportunityDetailResponseSchema.parse(await get(`/opportunities/${id}`, cookies)).data;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await removeCrmCustomFields(h);
  });

  afterAll(async () => {
    await removeCrmCustomFields(h);
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('the effective value of a computed Opportunity', () => {
    // One Organization of its own, read by a manager confined to it, so every
    // aggregate below is over exactly these four Opportunities:
    //   computed, a paid Order of 321.00 linked  → 321.00
    //   manual, 100.00 typed in                   → 100.00
    //   computed, nothing linked                  →   0.00
    //   manual, nothing typed in                  → no value
    let organizationId: string;
    let manager: { cookies: { b2b_session: string }; undo: () => void };
    let computed: string;
    let manual: string;
    let computedEmpty: string;
    let unvalued: string;
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const RANGE = () => `from=${day(-1)}&to=${day(1)}`;

    beforeAll(async () => {
      organizationId = await seedCrmOrganization(h.em(), 'Merged value');
      manager = await seedCrmSalesRep(h.em(), [organizationId], ['crm:read', 'crm:analytics', 'orders:read']);
      const counting = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] });
      expect(counting.statusCode, counting.body).toBe(202);

      const create = (body: Record<string, unknown>) =>
        createCrmOpportunity(h, { organizationId, ...body }).then((row) => row.id);
      computed = await create({ title: 'Computed, one paid order', valueMode: 'computed' });
      manual = await create({ title: 'Manual, valued', manualValue: '100.00' });
      computedEmpty = await create({ title: 'Computed, nothing linked', valueMode: 'computed' });
      unvalued = await create({ title: 'Manual, not valued' });

      const order = await seedCrmOrder(h.em(), { organizationId, status: 'paid', total: '321.00' });
      const linked = await linkCrmOrder(h, computed, order.id);
      expect(linked.statusCode, linked.body).toBe(201);
    });

    afterAll(() => {
      manager.undo();
    });

    it('is what the detail shows — the positive control for everything below', async () => {
      expect((await detail(computed)).value).toBe('321.00');
      expect((await detail(computed)).valueMode).toBe('computed');
      expect((await detail(manual)).value).toBe('100.00');
      expect((await detail(computedEmpty)).value).toBe('0.00');
      expect((await detail(unvalued)).value).toBeNull();
    });

    it('is the figure the list shows and sorts by', async () => {
      const rows = OpportunityListResponseSchema.parse(
        await get(`/opportunities?organizationId=${organizationId}&sort=value&order=desc&limit=50`, manager.cookies),
      ).data;
      const valued = rows.filter((row) => row.value !== null);
      expect(valued.map((row) => [row.id, row.value])).toEqual([
        [computed, '321.00'],
        [manual, '100.00'],
        [computedEmpty, '0.00'],
      ]);
      expect(rows.find((row) => row.id === unvalued)?.value).toBeNull();
    });

    it('is the figure on the board\'s cards and in its column total', async () => {
      const board = OpportunityBoardResponseSchema.parse(await get('/board', manager.cookies)).data;
      const column = board.columns.find((entry) => entry.status.code === 'new');
      expect(column?.count).toBe(4);
      expect(column?.valueTotals).toEqual([{ currency: 'PLN', total: '421.00' }]);
      const byId = new Map(column?.items.map((card) => [card.id, card.value]));
      expect(byId.get(computed)).toBe('321.00');
      expect(byId.get(manual)).toBe('100.00');
      expect(byId.get(computedEmpty)).toBe('0.00');
      expect(byId.get(unvalued)).toBeNull();
    });

    it('is the figure the analytics average and rank by', async () => {
      const average = OpportunityAverageValueResponseSchema.parse(
        await get(`/analytics/average-value?${RANGE()}`, manager.cookies),
      ).data;
      // (321.00 + 100.00 + 0.00) / 3; the unvalued one is in no average.
      expect(average).toEqual([{ currency: 'PLN', average: '140.33', count: 3 }]);

      const top = TopOpportunitiesResponseSchema.parse(
        await get(`/analytics/top-opportunities?${RANGE()}&basis=created`, manager.cookies),
      ).data;
      expect(top.map((row) => [row.id, row.value])).toEqual([
        [computed, '321.00'],
        [manual, '100.00'],
        [computedEmpty, '0.00'],
      ]);
    });

    it('follows the Opportunity when its mode changes, in every one of them', async () => {
      const before = await detail(manual);
      const switched = await h.app.inject({
        method: 'PATCH',
        url: `${CRM_API}/opportunities/${manual}`,
        cookies: CRM_ADMIN,
        headers: { 'if-match': `"${before.version}"` },
        payload: { valueMode: 'computed' },
      });
      expect(switched.statusCode, switched.body).toBe(200);
      // Nothing is linked to it: computed, it is worth zero; the typed figure is kept, not shown.
      expect((await detail(manual)).value).toBe('0.00');

      const board = OpportunityBoardResponseSchema.parse(await get('/board', manager.cookies)).data;
      expect(board.columns.find((entry) => entry.status.code === 'new')?.valueTotals).toEqual([
        { currency: 'PLN', total: '321.00' },
      ]);
      const average = OpportunityAverageValueResponseSchema.parse(
        await get(`/analytics/average-value?${RANGE()}`, manager.cookies),
      ).data;
      expect(average).toEqual([{ currency: 'PLN', average: '107.00', count: 3 }]);
      const rows = OpportunityListResponseSchema.parse(
        await get(`/opportunities?organizationId=${organizationId}&sort=value&order=desc&limit=50`, manager.cookies),
      ).data;
      expect(rows[0]).toMatchObject({ id: computed, value: '321.00' });
      expect(rows.find((row) => row.id === manual)?.value).toBe('0.00');
    });
  });

  describe('automatic creation with a required custom field defined', () => {
    const listIds = async () =>
      new Set(
        OpportunityListResponseSchema.parse(
          await get(`/opportunities?organizationId=${TEST_ORGANIZATION_ID}&limit=200`),
        ).data.map((row) => row.id),
      );

    beforeAll(async () => {
      await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
      await defineCrmCustomField(h, {
        key: 'lead_source',
        valueType: 'select',
        required: true,
        options: ['referral', 'trade_fair'],
      });
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      await removeCrmCustomFields(h);
    });

    it('still refuses a create by hand that leaves the field empty — the field really is required', async () => {
      const refused = await h.app.inject({
        method: 'POST',
        url: `${CRM_API}/opportunities`,
        cookies: CRM_ADMIN,
        payload: { title: 'By hand', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN' },
      });
      expect(refused.statusCode, refused.body).toBe(422);
    });

    it('creates the Opportunity of a placed Order all the same, with no custom values', async () => {
      const before = await listIds();
      const order = await whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));
      const created = [...(await listIds())].filter((id) => !before.has(id));
      expect(created).toHaveLength(1);

      const opportunity = await detail(created[0]!);
      expect(opportunity.source).toBe('order');
      expect(opportunity.links.map((link) => link.documentId)).toEqual([order.id]);
      expect(opportunity.customFieldValues).toEqual({});
    });

    it('lets that Opportunity be worked without the field, and holds an edit that names the fields to them', async () => {
      const before = await listIds();
      await whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));
      const id = [...(await listIds())].find((candidate) => !before.has(candidate))!;
      const patch = async (payload: Record<string, unknown>) => {
        const current = await detail(id);
        return h.app.inject({
          method: 'PATCH',
          url: `${CRM_API}/opportunities/${id}`,
          cookies: CRM_ADMIN,
          headers: { 'if-match': `"${current.version}"` },
          payload,
        });
      };

      // An edit that says nothing about custom fields is not held to them.
      const renamed = await patch({ title: 'Renamed by a person' });
      expect(renamed.statusCode, renamed.body).toBe(200);
      // One that names the bag is — and is refused while the required field is empty…
      const emptied = await patch({ customFieldValues: {} });
      expect(emptied.statusCode, emptied.body).toBe(422);
      // …and accepted once it is filled in.
      const filled = await patch({ customFieldValues: { lead_source: 'referral' } });
      expect(filled.statusCode, filled.body).toBe(200);
      expect((await detail(id)).customFieldValues).toEqual({ lead_source: 'referral' });
    });
  });
});
