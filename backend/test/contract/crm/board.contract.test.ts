import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityBoardResponseSchema,
  OpportunityListResponseSchema,
  type OpportunityBoard,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';

/**
 * The board (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10,
 * User Story 7 — FR-051): one column per status of the workflow, each with the
 * number of Opportunities in it, their value per currency and its first cards.
 *
 * The board is a read. Moving a card is §2's transition endpoint and is proven
 * with it; what is proven here is that the columns say the same thing as the
 * list does about the same filters, and that an Opportunity the caller cannot
 * reach is in no column **and in no count**.
 */
describe('crm board (contract)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let salesChannelId: string;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let stranger: { cookies: { b2b_session: string }; undo: () => void };
  let rep: { cookies: { b2b_session: string }; undo: () => void };

  /** Every Opportunity of this file carries it, so a search isolates them from nothing else. */
  const MARK = 'boardmark';

  const board = async (query = '', cookies: Record<string, string> = CRM_ADMIN): Promise<OpportunityBoard> => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/board${query}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityBoardResponseSchema.parse(response.json()).data;
  };

  const column = (data: OpportunityBoard, code: string) => {
    const found = data.columns.find((candidate) => candidate.status.code === code);
    if (!found) throw new Error(`the board has no column "${code}"`);
    return found;
  };

  const titles = (data: OpportunityBoard, code: string): string[] =>
    column(data, code).items.map((item) => item.title).sort();

  const make = async (title: string, body: Record<string, unknown> = {}, status?: readonly string[]) => {
    const created = await createCrmOpportunity(h, { title: `${MARK} ${title}`, ...body });
    for (const to of status ?? []) {
      const moved = await transitionCrmOpportunity(h, created.id, to);
      expect(moved.statusCode, moved.body).toBe(200);
    }
    return created;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Board other');
    const [channel] = (await h.em().getConnection().execute(
      `select "id" from "sales_channels" where "system_default" = true limit 1`,
    )) as Array<{ id: string }>;
    salesChannelId = channel!.id;
    viewer = await seedCrmAdmin(h.em(), 'board-viewer', ['crm:read']);
    stranger = await seedCrmAdmin(h.em(), 'board-stranger', ['orders:read']);
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read']);

    // new: three (two PLN, one EUR, one of them without a value) — qualified: one — won: one.
    await make('alpha', { manualValue: '100.00' });
    await make('beta', { manualValue: '250.50', salesChannelId });
    await make('gamma', { currency: 'EUR', manualValue: '40.00', organizationId: otherOrganizationId });
    await make('delta');
    await make('epsilon', { manualValue: '1000.00' }, ['qualified']);
    await make('zeta', { manualValue: '7.00', organizationId: otherOrganizationId }, [
      'qualified',
      'proposal',
      'won',
    ]);
  });

  afterAll(async () => {
    viewer.undo();
    stranger.undo();
    rep.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('is gated crm:read', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/board`,
      cookies: stranger.cookies,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    await board('', viewer.cookies);
  });

  it('answers one column per status, in weight order, an empty status included', async () => {
    const data = await board(`?q=${MARK}`);
    expect(data.columns.map((entry) => entry.status.code)).toEqual([
      'new',
      'qualified',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ]);
    expect(column(data, 'new').status).toEqual({ code: 'new', name: 'New', color: '#64748b', kind: 'open' });
    expect(column(data, 'won').status.kind).toBe('won');
    expect(column(data, 'proposal')).toMatchObject({ count: 0, valueTotals: [], items: [], hasMore: false });
  });

  it('counts every Opportunity of a column and totals its value per currency', async () => {
    const data = await board(`?q=${MARK}`);
    expect(column(data, 'new').count).toBe(4);
    // An Opportunity without a value is counted and adds nothing to a total.
    expect(column(data, 'new').valueTotals).toEqual([
      { currency: 'EUR', total: '40.00' },
      { currency: 'PLN', total: '350.50' },
    ]);
    expect(titles(data, 'new')).toEqual(
      ['alpha', 'beta', 'delta', 'gamma'].map((title) => `${MARK} ${title}`),
    );
    expect(column(data, 'qualified')).toMatchObject({
      count: 1,
      valueTotals: [{ currency: 'PLN', total: '1000.00' }],
    });
    expect(column(data, 'won')).toMatchObject({
      count: 1,
      valueTotals: [{ currency: 'PLN', total: '7.00' }],
    });
    // A card is the list's own summary of the Opportunity.
    const [card] = column(data, 'qualified').items;
    expect(card).toMatchObject({
      title: `${MARK} epsilon`,
      status: { code: 'qualified' },
      organization: { id: TEST_ORGANIZATION_ID },
      value: '1000.00',
      currency: 'PLN',
    });
  });

  it('returns at most perColumn cards, newest first, and says when a column holds more', async () => {
    const data = await board(`?q=${MARK}&perColumn=2`);
    const fresh = column(data, 'new');
    expect(fresh.items).toHaveLength(2);
    expect(fresh.hasMore).toBe(true);
    // The count and the totals are the column's, not the page's.
    expect(fresh.count).toBe(4);
    expect(fresh.valueTotals).toEqual([
      { currency: 'EUR', total: '40.00' },
      { currency: 'PLN', total: '350.50' },
    ]);
    expect(column(data, 'qualified')).toMatchObject({ count: 1, hasMore: false });

    // The cards are the first page of the list for that status, in the list's
    // default order — which is what lets a column be continued from the list.
    const listed = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/opportunities?q=${MARK}&statusCode=new&limit=2`,
      cookies: CRM_ADMIN,
    });
    expect(fresh.items.map((item) => item.id)).toEqual(
      OpportunityListResponseSchema.parse(listed.json()).data.map((item) => item.id),
    );
  });

  it('filters by organization, by sales channel, by text and by creation date', async () => {
    const byOrganization = await board(`?q=${MARK}&organizationId=${otherOrganizationId}`);
    expect(titles(byOrganization, 'new')).toEqual([`${MARK} gamma`]);
    expect(column(byOrganization, 'new')).toMatchObject({
      count: 1,
      valueTotals: [{ currency: 'EUR', total: '40.00' }],
    });
    expect(column(byOrganization, 'qualified').count).toBe(0);
    expect(column(byOrganization, 'won').count).toBe(1);

    const byChannel = await board(`?q=${MARK}&salesChannelId=${salesChannelId}`);
    expect(titles(byChannel, 'new')).toEqual([`${MARK} beta`]);
    expect(byChannel.columns.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);

    const byText = await board(`?q=${MARK}%20epsilon`);
    expect(byText.columns.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
    expect(titles(byText, 'qualified')).toEqual([`${MARK} epsilon`]);

    const today = new Date().toISOString().slice(0, 10);
    const sinceToday = await board(`?q=${MARK}&createdFrom=${today}`);
    expect(sinceToday.columns.reduce((sum, entry) => sum + entry.count, 0)).toBe(6);
    const beforeToday = await board(`?q=${MARK}&createdTo=2020-01-01`);
    expect(beforeToday.columns.reduce((sum, entry) => sum + entry.count, 0)).toBe(0);
  });

  it('finds an Opportunity by the name of its organization, in the cards and in the count alike', async () => {
    const [organization] = (await h.em().getConnection().execute(
      `select "name" from "organizations" where "id" = ?`,
      [otherOrganizationId],
    )) as Array<{ name: string }>;
    const data = await board(`?q=${encodeURIComponent(organization!.name)}`);
    expect(titles(data, 'new')).toEqual([`${MARK} gamma`]);
    expect(column(data, 'new').count).toBe(1);
    expect(column(data, 'won').count).toBe(1);
  });

  it('refuses the assignee and tag filters until their stories serve them, as the list does', async () => {
    for (const query of ['?assignedAdminUserId=me', '?tagId=00000000-0000-4000-8000-00000000dead']) {
      const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/board${query}`, cookies: CRM_ADMIN });
      expect(response.statusCode, `${query} ${response.body}`).toBe(422);
    }
  });

  it('refuses a malformed query', async () => {
    for (const query of ['?perColumn=0', '?perColumn=201', '?organizationId=nope']) {
      const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/board${query}`, cookies: CRM_ADMIN });
      expect(response.statusCode, `${query} ${response.body}`).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('puts an out-of-scope Opportunity in no column, in no count and in no total', async () => {
    // Positive control: the platform administrator sees both Organizations.
    const everything = await board(`?q=${MARK}`);
    expect(everything.columns.reduce((sum, entry) => sum + entry.count, 0)).toBe(6);

    const scoped = await board(`?q=${MARK}`, rep.cookies);
    expect(titles(scoped, 'new')).toEqual(['alpha', 'beta', 'delta'].map((title) => `${MARK} ${title}`));
    expect(column(scoped, 'new')).toMatchObject({
      count: 3,
      valueTotals: [{ currency: 'PLN', total: '350.50' }],
    });
    expect(column(scoped, 'qualified').count).toBe(1);
    // The other Organization's won Opportunity is neither shown nor counted.
    expect(column(scoped, 'won')).toMatchObject({ count: 0, valueTotals: [], items: [] });
    for (const entry of scoped.columns) {
      for (const item of entry.items) expect(item.organization.id).toBe(TEST_ORGANIZATION_ID);
    }
    // Naming the other Organization outright answers nothing, not a refusal.
    const named = await board(`?q=${MARK}&organizationId=${otherOrganizationId}`, rep.cookies);
    expect(named.columns.reduce((sum, entry) => sum + entry.count, 0)).toBe(0);
  });
});
