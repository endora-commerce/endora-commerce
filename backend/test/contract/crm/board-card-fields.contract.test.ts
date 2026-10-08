import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OPPORTUNITY_BOARD_CARD_MAX_FIELDS,
  OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS,
  OpportunityBoardCardConfigResponseSchema,
  OpportunityBoardResponseSchema,
  OpportunityListResponseSchema,
  type OpportunityBoard,
  type OpportunityBoardCardConfig,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  defineCrmCustomField,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
} from '../../helpers/seed-crm.js';

/**
 * What a board card shows (`specs/143-crm-sales-opportunities/contracts/admin-api.md`
 * §12c, User Story 19 — FR-090, FR-091): the configuration's two routes and
 * their gates, the default, the refusals, and the board answering the choice
 * with its cards.
 *
 * The filters are proven against data in
 * `backend/test/integration/crm/board-card-fields.test.ts`.
 */
describe('crm board card fields (contract)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let configurer: { cookies: { b2b_session: string }; undo: () => void };
  let stranger: { cookies: { b2b_session: string }; undo: () => void };
  let definitionId: string;

  const MARK = 'cardfieldsmark';
  const URL = `${CRM_API}/board/card-fields`;
  const CUSTOM_KEY = 'bfc_lead_source';

  const read = async (cookies: Record<string, string> = CRM_ADMIN): Promise<OpportunityBoardCardConfig> => {
    const response = await h.app.inject({ method: 'GET', url: URL, cookies });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityBoardCardConfigResponseSchema.parse(response.json()).data;
  };

  const write = (fields: unknown, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'PUT', url: URL, cookies, payload: { fields } as Record<string, unknown> });

  const board = async (query = ''): Promise<OpportunityBoard> => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/board?q=${MARK}${query}`,
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityBoardResponseSchema.parse(response.json()).data;
  };

  const cards = (data: OpportunityBoard) => data.columns.flatMap((column) => column.items);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    viewer = await seedCrmAdmin(h.em(), 'cardfields-viewer', ['crm:read']);
    configurer = await seedCrmAdmin(h.em(), 'cardfields-configurer', ['crm:read', 'crm:configure']);
    stranger = await seedCrmAdmin(h.em(), 'cardfields-stranger', ['orders:read']);
    definitionId = (
      await defineCrmCustomField(h, {
        key: CUSTOM_KEY,
        valueType: 'select',
        labelDefault: 'Lead source',
        label: { pl: 'Źródło pozyskania' },
        options: ['referral', 'trade_fair'],
      })
    ).id;
    expect((await write([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS])).statusCode).toBe(200);
    await createCrmOpportunity(h, {
      title: `${MARK} with`,
      manualValue: '10.00',
      customFieldValues: { [CUSTOM_KEY]: 'referral' },
    });
    await createCrmOpportunity(h, { title: `${MARK} without` });
  });

  afterAll(async () => {
    await write([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS]);
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${definitionId}`,
      cookies: CRM_ADMIN,
    });
    viewer.undo();
    configurer.undo();
    stranger.undo();
    await teardownBackendServer(h);
  });

  it('reads on crm:read and writes on crm:configure', async () => {
    expect((await h.app.inject({ method: 'GET', url: URL, cookies: stranger.cookies })).statusCode).toBe(403);
    await read(viewer.cookies);
    const refused = await write(['builtin:value'], viewer.cookies);
    expect(refused.statusCode, refused.body).toBe(403);
    // Nothing was stored by the refused write.
    expect((await read()).fields.map((field) => field.ref)).toEqual([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS]);
    const accepted = await write([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS], configurer.cookies);
    expect(accepted.statusCode, accepted.body).toBe(200);
  });

  it('answers the card as it was until somebody configures it, and everything that can be chosen', async () => {
    const config = await read();
    expect(config.maxFields).toBe(OPPORTUNITY_BOARD_CARD_MAX_FIELDS);
    expect(config.fields.map((field) => field.ref)).toEqual([
      'builtin:number',
      'builtin:organization',
      'builtin:value',
      'builtin:assignee',
      'builtin:tags',
    ]);
    const offered = config.available.map((field) => field.ref);
    for (const ref of [
      'builtin:number',
      'builtin:organization',
      'builtin:contact',
      'builtin:assignee',
      'builtin:value',
      'builtin:salesChannel',
      'builtin:tags',
      'builtin:expectedCloseDate',
      'builtin:source',
      'builtin:createdAt',
      'builtin:updatedAt',
      'builtin:closedAt',
      'builtin:linkedOrders',
      `custom:${CUSTOM_KEY}`,
    ]) {
      expect(offered, ref).toContain(ref);
    }
    expect(new Set(offered).size).toBe(offered.length);
    expect(config.available.find((field) => field.ref === `custom:${CUSTOM_KEY}`)).toEqual({
      ref: `custom:${CUSTOM_KEY}`,
      source: 'custom',
      key: CUSTOM_KEY,
      kind: 'select',
      label: { pl: 'Źródło pozyskania' },
      labelDefault: 'Lead source',
      options: [
        { value: 'referral', label: {}, labelDefault: 'referral' },
        { value: 'trade_fair', label: {}, labelDefault: 'trade_fair' },
      ],
    });
    expect(config.available.find((field) => field.ref === 'builtin:value')).toMatchObject({
      source: 'builtin',
      key: 'value',
      kind: 'money',
      label: {},
      labelDefault: null,
    });
  });

  it('refuses a field that is not offered, a duplicate and a seventh field, storing nothing', async () => {
    // A reference of the right shape that names nothing offered: the service's refusal.
    for (const fields of [['builtin:nope'], ['custom:bfc_never_defined']]) {
      const response = await write(fields);
      expect(response.statusCode, `${JSON.stringify(fields)} ${response.body}`).toBe(422);
      expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
    // A body that is not of the request's shape: the schema's.
    for (const fields of [
      ['builtin:value', 'builtin:value'],
      [
        'builtin:number',
        'builtin:organization',
        'builtin:contact',
        'builtin:assignee',
        'builtin:value',
        'builtin:tags',
        'builtin:source',
      ],
      'builtin:value',
    ]) {
      const response = await write(fields);
      expect(response.statusCode, `${JSON.stringify(fields)} ${response.body}`).toBe(400);
      expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
    expect((await read()).fields.map((field) => field.ref)).toEqual([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS]);
  });

  it('stores the choice in its order, and the board answers it with exactly those values', async () => {
    const untouched = await board();
    expect(untouched.cardFields.map((field) => field.ref)).toEqual([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS]);
    // Every default field is a member of the summary itself: nothing is added.
    for (const card of cards(untouched)) expect(card.cardValues).toEqual({});

    const chosen = [`custom:${CUSTOM_KEY}`, 'builtin:value', 'builtin:source', 'builtin:linkedOrders'];
    const saved = await write(chosen);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      OpportunityBoardCardConfigResponseSchema.parse(saved.json()).data.fields.map((field) => field.ref),
    ).toEqual(chosen);
    expect((await read(viewer.cookies)).fields.map((field) => field.ref)).toEqual(chosen);

    const data = await board();
    expect(data.cardFields.map((field) => field.ref)).toEqual(chosen);
    const byTitle = new Map(cards(data).map((card) => [card.title, card]));
    // The value is the summary's own member and is not repeated.
    expect(byTitle.get(`${MARK} with`)?.cardValues).toEqual({
      [`custom:${CUSTOM_KEY}`]: 'referral',
      'builtin:source': 'manual',
      'builtin:linkedOrders': 0,
    });
    expect(byTitle.get(`${MARK} without`)?.cardValues).toEqual({
      [`custom:${CUSTOM_KEY}`]: null,
      'builtin:source': 'manual',
      'builtin:linkedOrders': 0,
    });
  });

  it('the list answers card values only when asked', async () => {
    const list = async (query: string) => {
      const response = await h.app.inject({
        method: 'GET',
        url: `${CRM_API}/opportunities?q=${MARK}${query}`,
        cookies: CRM_ADMIN,
      });
      expect(response.statusCode, response.body).toBe(200);
      return OpportunityListResponseSchema.parse(response.json()).data;
    };
    for (const item of await list('')) expect(item).not.toHaveProperty('cardValues');
    const asked = await list('&cardValues=true');
    expect(asked.find((item) => item.title === `${MARK} with`)?.cardValues).toMatchObject({
      [`custom:${CUSTOM_KEY}`]: 'referral',
    });
  });

  it('refuses a fieldFilters parameter that is not of its shape', async () => {
    for (const raw of ['{not json', JSON.stringify({ lead: { in: ['x'] } }), JSON.stringify({ 'builtin:value': { min: 'ten' } })]) {
      for (const path of ['board', 'opportunities']) {
        const response = await h.app.inject({
          method: 'GET',
          url: `${CRM_API}/${path}?fieldFilters=${encodeURIComponent(raw)}`,
          cookies: CRM_ADMIN,
        });
        expect(response.statusCode, `${path} ${raw} ${response.body}`).toBe(400);
      }
    }
  });
});
