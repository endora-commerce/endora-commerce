import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS,
  OpportunityBoardCardConfigResponseSchema,
  OpportunityBoardResponseSchema,
  OpportunityListResponseSchema,
  type OpportunityBoard,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  defineCrmCustomField,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmSetting,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { countStatements } from '../../helpers/seed-crm-analytics.js';

/**
 * Filtering the board by the fields its cards show
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12c, User Story
 * 19 — FR-091 – FR-093), against the real `custom_fields` and `settings`
 * modules.
 *
 * Every filter is asked of the board **and** of the list, and the two must
 * agree — a lane is continued from the list — and of the board's counts and
 * totals, which come from a statement of their own.
 */
describe('crm board card fields — filters, values and cost (User Story 19)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let rep: { cookies: { b2b_session: string }; undo: () => void };
  const definitionIds: string[] = [];

  const MARK = 'bffiltermark';
  const KEY = {
    source: 'bfi_lead_source',
    interests: 'bfi_interests',
    vip: 'bfi_vip',
    seats: 'bfi_seats',
    competitor: 'bfi_competitor',
    decision: 'bfi_decision_date',
  } as const;
  const ref = (key: keyof typeof KEY): string => `custom:${KEY[key]}`;
  const ALL_CUSTOM = (Object.keys(KEY) as Array<keyof typeof KEY>).map(ref);

  const setCard = async (fields: readonly string[]): Promise<void> => {
    const response = await h.app.inject({
      method: 'PUT',
      url: `${CRM_API}/board/card-fields`,
      cookies: CRM_ADMIN,
      payload: { fields: [...fields] },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  const tail = (filters: Record<string, unknown> | null, extra = ''): string =>
    `?q=${MARK}${extra}${filters ? `&fieldFilters=${encodeURIComponent(JSON.stringify(filters))}` : ''}`;

  const board = async (
    filters: Record<string, unknown> | null,
    cookies: Record<string, string> = CRM_ADMIN,
    extra = '',
  ): Promise<OpportunityBoard> => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/board${tail(filters, extra)}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityBoardResponseSchema.parse(response.json()).data;
  };

  const listed = async (
    filters: Record<string, unknown> | null,
    cookies: Record<string, string> = CRM_ADMIN,
  ): Promise<string[]> => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/opportunities${tail(filters)}`,
      cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityListResponseSchema.parse(response.json())
      .data.map((item) => item.title.replace(`${MARK} `, ''))
      .sort();
  };

  const onBoard = (data: OpportunityBoard): string[] =>
    data.columns.flatMap((column) => column.items.map((item) => item.title.replace(`${MARK} `, ''))).sort();

  const counted = (data: OpportunityBoard): number =>
    data.columns.reduce((sum, column) => sum + column.count, 0);

  /** The cards, the counts and the list all say `expected` for `filters`. */
  const expectMatches = async (filters: Record<string, unknown>, expected: string[]): Promise<void> => {
    const data = await board(filters);
    const label = JSON.stringify(filters);
    expect(onBoard(data), label).toEqual([...expected].sort());
    expect(counted(data), label).toBe(expected.length);
    expect(await listed(filters), label).toEqual([...expected].sort());
  };

  const make = (title: string, body: Record<string, unknown> = {}) =>
    createCrmOpportunity(h, { title: `${MARK} ${title}`, ...body });

  let alpha: { id: string; number: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Board fields other');
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read']);

    const define = async (definition: Parameters<typeof defineCrmCustomField>[1]): Promise<void> => {
      definitionIds.push((await defineCrmCustomField(h, definition)).id);
    };
    await define({ key: KEY.source, valueType: 'select', options: ['referral', 'trade_fair', 'web'] });
    await define({ key: KEY.interests, valueType: 'multiselect', options: ['tyres', 'oil', 'service'] });
    await define({ key: KEY.vip, valueType: 'boolean' });
    await define({ key: KEY.seats, valueType: 'number' });
    await define({ key: KEY.competitor, valueType: 'text' });
    await define({ key: KEY.decision, valueType: 'date' });

    alpha = await make('alpha', {
      manualValue: '100.00',
      expectedCloseDate: '2026-03-10',
      customFieldValues: {
        [KEY.source]: 'referral',
        [KEY.interests]: ['tyres', 'oil'],
        [KEY.vip]: true,
        [KEY.seats]: 5,
        [KEY.competitor]: 'Acme Tyres',
        [KEY.decision]: '2026-04-01',
      },
    });
    const beta = await make('beta', {
      manualValue: '250.50',
      expectedCloseDate: '2026-05-20',
      customFieldValues: {
        [KEY.source]: 'trade_fair',
        [KEY.interests]: ['service'],
        [KEY.vip]: false,
        [KEY.seats]: 40,
        [KEY.competitor]: 'Globex',
        [KEY.decision]: '2026-06-15',
      },
    });
    // No custom value at all, no value, no date — in another Organization.
    await make('gamma', { organizationId: otherOrganizationId, currency: 'EUR' });
    await make('delta', {
      manualValue: '1000.00',
      organizationId: otherOrganizationId,
      customFieldValues: { [KEY.source]: 'web', [KEY.interests]: ['oil'], [KEY.seats]: 12.5 },
    });
    const moved = await transitionCrmOpportunity(h, beta.id, 'qualified');
    expect(moved.statusCode, moved.body).toBe(200);
    const order = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    const linked = await linkCrmOrder(h, alpha.id, order.id);
    expect(linked.statusCode, linked.body).toBe(201);
  });

  afterAll(async () => {
    await setCard(OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS);
    for (const id of definitionIds) {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/custom-fields/definitions/${id}`,
        cookies: CRM_ADMIN,
      });
    }
    rep.undo();
    await teardownBackendServer(h);
  });

  describe('custom fields', () => {
    beforeAll(async () => {
      await setCard(ALL_CUSTOM);
    });

    it('select: one of the options named', async () => {
      await expectMatches({ [ref('source')]: { in: ['referral'] } }, ['alpha']);
      await expectMatches({ [ref('source')]: { in: ['referral', 'web'] } }, ['alpha', 'delta']);
      await expectMatches({ [ref('source')]: { in: ['nobody_chose_this'] } }, []);
    });

    it('multiselect: at least one of the options named is chosen', async () => {
      await expectMatches({ [ref('interests')]: { in: ['oil'] } }, ['alpha', 'delta']);
      await expectMatches({ [ref('interests')]: { in: ['service', 'tyres'] } }, ['alpha', 'beta']);
    });

    it('boolean: yes is true, no is false or never set', async () => {
      await expectMatches({ [ref('vip')]: { is: true } }, ['alpha']);
      await expectMatches({ [ref('vip')]: { is: false } }, ['beta', 'delta', 'gamma']);
    });

    it('number: an inclusive lowest and highest', async () => {
      await expectMatches({ [ref('seats')]: { min: '12.5' } }, ['beta', 'delta']);
      await expectMatches({ [ref('seats')]: { max: '12.5' } }, ['alpha', 'delta']);
      await expectMatches({ [ref('seats')]: { min: '6', max: '39' } }, ['delta']);
    });

    it('text: contains, whatever the case, with the wildcards taken literally', async () => {
      await expectMatches({ [ref('competitor')]: { contains: 'acme' } }, ['alpha']);
      await expectMatches({ [ref('competitor')]: { contains: 'E' } }, ['alpha', 'beta']);
      await expectMatches({ [ref('competitor')]: { contains: '%' } }, []);
    });

    it('date: a range inclusive of both days', async () => {
      await expectMatches({ [ref('decision')]: { from: '2026-04-01', to: '2026-04-01' } }, ['alpha']);
      await expectMatches({ [ref('decision')]: { from: '2026-04-02' } }, ['beta']);
      await expectMatches({ [ref('decision')]: { to: '2026-06-15' } }, ['alpha', 'beta']);
    });

    it('filters combine with AND, with each other and with the filters the board had', async () => {
      await expectMatches(
        { [ref('interests')]: { in: ['oil'] }, [ref('seats')]: { min: '10' } },
        ['delta'],
      );
      const data = await board({ [ref('interests')]: { in: ['oil'] } }, CRM_ADMIN, `&organizationId=${TEST_ORGANIZATION_ID}`);
      expect(onBoard(data)).toEqual(['alpha']);
    });

    it('narrows the totals of every column with the cards', async () => {
      const data = await board({ [ref('source')]: { in: ['referral', 'trade_fair'] } });
      const column = (code: string) => data.columns.find((entry) => entry.status.code === code)!;
      expect(column('new')).toMatchObject({ count: 1, valueTotals: [{ currency: 'PLN', total: '100.00' }] });
      expect(column('qualified')).toMatchObject({ count: 1, valueTotals: [{ currency: 'PLN', total: '250.50' }] });
    });

    it('an operator that does not belong to the kind of the field is ignored', async () => {
      await expectMatches({ [ref('seats')]: { contains: '5' } }, ['alpha', 'beta', 'delta', 'gamma']);
    });

    it('never reaches an Opportunity outside the reader\'s Organizations', async () => {
      const filters = { [ref('interests')]: { in: ['oil'] } };
      const data = await board(filters, rep.cookies);
      expect(onBoard(data)).toEqual(['alpha']);
      expect(counted(data)).toBe(1);
      expect(await listed(filters, rep.cookies)).toEqual(['alpha']);
      // The value of the Opportunity the reader cannot see is in no total.
      expect(JSON.stringify(data)).not.toContain('1000.00');
    });
  });

  describe('built-in fields', () => {
    beforeAll(async () => {
      await setCard([
        'builtin:number',
        'builtin:value',
        'builtin:expectedCloseDate',
        'builtin:source',
        'builtin:linkedOrders',
        'builtin:contact',
      ]);
    });

    it('value: an inclusive lowest and highest amount, an unvalued Opportunity matching neither', async () => {
      await expectMatches({ 'builtin:value': { min: '250.50' } }, ['beta', 'delta']);
      await expectMatches({ 'builtin:value': { max: '250.50' } }, ['alpha', 'beta']);
    });

    it('number: no filter of its own — the search finds it', async () => {
      await expectMatches({ 'builtin:number': { contains: 'no-such-number' } }, ['alpha', 'beta', 'delta', 'gamma']);
      const found = await h.app.inject({
        method: 'GET',
        url: `${CRM_API}/board?q=${alpha.number}`,
        cookies: CRM_ADMIN,
      });
      expect(onBoard(OpportunityBoardResponseSchema.parse(found.json()).data)).toEqual(['alpha']);
    });

    it('expected close date: a range', async () => {
      await expectMatches({ 'builtin:expectedCloseDate': { from: '2026-03-10', to: '2026-05-19' } }, ['alpha']);
      await expectMatches({ 'builtin:expectedCloseDate': { from: '2026-03-11' } }, ['beta']);
    });

    it('source: one of those named', async () => {
      await expectMatches({ 'builtin:source': { in: ['manual'] } }, ['alpha', 'beta', 'delta', 'gamma']);
      await expectMatches({ 'builtin:source': { in: ['order'] } }, []);
    });

    it('linked orders: a lowest and a highest count', async () => {
      await expectMatches({ 'builtin:linkedOrders': { min: '1' } }, ['alpha']);
      await expectMatches({ 'builtin:linkedOrders': { max: '0' } }, ['beta', 'delta', 'gamma']);
      const [card] = (await board({ 'builtin:linkedOrders': { min: '1' } })).columns.flatMap((column) => column.items);
      expect(card?.cardValues).toMatchObject({ 'builtin:linkedOrders': 1, 'builtin:contact': null });
    });

    it('contact: nobody is the contact person named', async () => {
      await expectMatches({ 'builtin:contact': { in: ['0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01'] } }, []);
      // Not an id at all: nothing matches, and nothing breaks.
      await expectMatches({ 'builtin:contact': { in: ['somebody'] } }, []);
    });

    it('a filter on a field that is not on the card is ignored, not refused', async () => {
      await expectMatches({ [ref('source')]: { in: ['referral'] } }, ['alpha', 'beta', 'delta', 'gamma']);
      await expectMatches({ 'builtin:updatedAt': { to: '2000-01-01' } }, ['alpha', 'beta', 'delta', 'gamma']);
    });
  });

  describe('what the independent review found (N-BFR1, N-BFR4)', () => {
    const ALL = ['alpha', 'beta', 'delta', 'gamma'];
    const day = (offset: number): string => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };

    beforeAll(async () => {
      await setCard(['builtin:updatedAt', 'builtin:closedAt', 'builtin:salesChannel']);
    });

    it('an instant is filtered by UTC day, inclusive of both, up to the last day a date can name', async () => {
      await expectMatches({ 'builtin:updatedAt': { from: day(0), to: day(0) } }, ALL);
      await expectMatches({ 'builtin:updatedAt': { to: day(-1) } }, []);
      await expectMatches({ 'builtin:updatedAt': { from: day(1) } }, []);
      // Nothing is closed: a bound on the closing instant matches nothing, whichever it is.
      await expectMatches({ 'builtin:closedAt': { from: '2000-01-01' } }, []);
      // The day after the last one is past what an ISO instant can say in four digits.
      await expectMatches({ 'builtin:updatedAt': { to: '9999-12-31' } }, ALL);
      await expectMatches({ 'builtin:closedAt': { to: '9999-12-31' } }, []);
      await expectMatches({ 'builtin:updatedAt': { from: '9999-12-31' } }, []);
    });

    it('the Sales Channel on a card is its name, a text — not the name in every language', async () => {
      const connection = h.em().getConnection();
      const [channel] = (await connection.execute(
        `select "id", "name" from "sales_channels" where "system_default" = true limit 1`,
      )) as Array<{ id: string; name: Record<string, string> }>;
      expect(channel).toBeDefined();
      await connection.execute(`update "crm_opportunities" set "sales_channel_id" = ? where "id" = ?`, [
        channel!.id,
        alpha.id,
      ]);
      try {
        const cards = (await board(null)).columns.flatMap((column) => column.items);
        const shown = cards.find((card) => card.id === alpha.id)?.cardValues?.['builtin:salesChannel'];
        expect(typeof shown).toBe('string');
        expect(Object.values(channel!.name)).toContain(shown);
        expect(
          cards.filter((card) => card.id !== alpha.id).map((card) => card.cardValues?.['builtin:salesChannel']),
        ).toEqual([null, null, null]);
      } finally {
        await connection.execute(`update "crm_opportunities" set "sales_channel_id" = null where "id" = ?`, [
          alpha.id,
        ]);
      }
    });
  });

  describe('a value that is not of its definition\'s type (N-BFR7)', () => {
    let strayId: string;

    beforeAll(async () => {
      await setCard(ALL_CUSTOM);
      // What a definition retyped while no value was held, an import or an
      // older release can leave behind: every key holding another type.
      strayId = (await make('stray')).id;
      await h
        .em()
        .getConnection()
        .execute(`update "crm_opportunities" set "custom_field_values" = ?::jsonb where "id" = ?`, [
          JSON.stringify({
            [KEY.seats]: 'forty',
            [KEY.decision]: true,
            [KEY.source]: ['referral', 'web'],
            [KEY.interests]: 'oil',
            [KEY.competitor]: { name: 'Acme' },
            [KEY.vip]: 'true',
          }),
          strayId,
        ]);
    });

    afterAll(async () => {
      await h.em().getConnection().execute(`delete from "crm_opportunities" where "id" = ?`, [strayId]);
    });

    it('matches no bound, no option and no yes — and never fails the read', async () => {
      await expectMatches({ [ref('seats')]: { min: '0' } }, ['alpha', 'beta', 'delta']);
      await expectMatches({ [ref('seats')]: { max: '1000' } }, ['alpha', 'beta', 'delta']);
      await expectMatches({ [ref('interests')]: { in: ['oil'] } }, ['alpha', 'delta']);
      await expectMatches({ [ref('source')]: { in: ['referral'] } }, ['alpha']);
      await expectMatches({ [ref('vip')]: { is: true } }, ['alpha']);
      await expectMatches({ [ref('vip')]: { is: false } }, ['beta', 'delta', 'gamma', 'stray']);
      await expectMatches({ [ref('decision')]: { from: '2026-01-01', to: '2026-12-31' } }, ['alpha', 'beta']);
      // The card is still answered, the stray values as they are stored.
      const cards = (await board(null)).columns.flatMap((column) => column.items);
      expect(cards.find((card) => card.id === strayId)?.cardValues).toMatchObject({ [ref('seats')]: 'forty' });
    });
  });

  describe('a field that is gone', () => {
    it('a deleted custom field drops out of the card, the choices and the filters', async () => {
      const doomed = await defineCrmCustomField(h, { key: 'bfi_doomed', valueType: 'text' });
      await setCard(['custom:bfi_doomed', 'builtin:value']);
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/custom-fields/definitions/${doomed.id}`,
        cookies: CRM_ADMIN,
      });
      expect(removed.statusCode, removed.body).toBe(204);

      const config = OpportunityBoardCardConfigResponseSchema.parse(
        (await h.app.inject({ method: 'GET', url: `${CRM_API}/board/card-fields`, cookies: CRM_ADMIN })).json(),
      ).data;
      expect(config.fields.map((field) => field.ref)).toEqual(['builtin:value']);
      expect(config.available.map((field) => field.ref)).not.toContain('custom:bfi_doomed');

      const data = await board({ 'custom:bfi_doomed': { contains: 'x' } });
      expect(data.cardFields.map((field) => field.ref)).toEqual(['builtin:value']);
      expect(onBoard(data)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
      for (const card of data.columns.flatMap((column) => column.items)) {
        expect(card.cardValues).toEqual({});
      }
    });

    it('a stored value the Settings screen could have written is read forgivingly', async () => {
      await setCrmSetting(h, 'crm.board_card_fields', { not: 'an array' });
      expect((await board(null)).cardFields.map((field) => field.ref)).toEqual([
        ...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS,
      ]);
      await setCrmSetting(h, 'crm.board_card_fields', [
        'builtin:value',
        7,
        'builtin:nope',
        'builtin:value',
        'builtin:tags',
        'builtin:number',
        'builtin:source',
        'builtin:contact',
        'builtin:assignee',
        'builtin:organization',
      ]);
      expect((await board(null)).cardFields.map((field) => field.ref)).toEqual([
        'builtin:value',
        'builtin:tags',
        'builtin:number',
        'builtin:source',
        'builtin:contact',
        'builtin:assignee',
      ]);
    });
  });

  describe('cost (FR-091)', () => {
    it('issues the same number of statements whatever the number of cards', async () => {
      await setCard([ref('source'), ref('seats'), 'builtin:contact', 'builtin:salesChannel', 'builtin:linkedOrders', 'builtin:source']);
      const measure = async (): Promise<number> => {
        const { statements } = await countStatements(h.em(), () => board({ [ref('seats')]: { min: '0' } }));
        return statements;
      };
      // Every card has a contact person and a Sales Channel, so the reads of
      // both are among the statements counted — before and after (N-BFR8).
      const connection = h.em().getConnection();
      const [channel] = (await connection.execute(
        `select "id" from "sales_channels" where "system_default" = true limit 1`,
      )) as Array<{ id: string }>;
      const attribute = (): Promise<unknown> =>
        connection.execute(
          `update "crm_opportunities" set "customer_account_id" = ?, "sales_channel_id" = ?
            where "organization_id" = ? and "title" like ?`,
          [TEST_CUSTOMER_ID, channel!.id, TEST_ORGANIZATION_ID, `${MARK} %`],
        );
      await attribute();
      // Twice before measuring: the definition cache and the settings cache are warm.
      await measure();
      const before = await measure();
      expect(before).toBeGreaterThan(0);
      for (let index = 0; index < 25; index += 1) {
        await make(`extra ${index}`, { customFieldValues: { [KEY.seats]: index, [KEY.source]: 'web' } });
      }
      await attribute();
      expect(await measure()).toBe(before);
      const extra = (await board({ [ref('seats')]: { min: '0' } })).columns
        .flatMap((column) => column.items)
        .find((card) => card.title.startsWith(`${MARK} extra`));
      expect(typeof extra?.cardValues?.['builtin:contact']).toBe('string');
      expect(typeof extra?.cardValues?.['builtin:salesChannel']).toBe('string');
    });
  });
});
