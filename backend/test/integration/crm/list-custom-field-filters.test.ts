import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  assignToCrmBook,
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * Custom-field filters on the Opportunities list
 * (`specs/157-custom-fields-list-filters/` US2; FR-011a, FR-016; contract §5.3;
 * threat model F-1, F-3, F-8).
 *
 * Without `cardValues=true` a `custom:` reference is governed by the
 * definition's list-filter option; with it — a board lane's continuation — and
 * on the board, the card rule stays as it was. `builtin:` references keep the
 * card rule in both modes.
 */
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const MARK = `cf157mark${RUN}`;
const key = (name: string) => `cf157_${RUN}_${name}`;

const A = key('a'); // option on, not on the card
const B = key('b'); // on the card, option off
const C = key('c'); // on the card, option on
const D = key('d'); // neither
const NUMBER = key('number');
const BOOLEAN = key('boolean');
const DATE = key('date');
const MULTI = key('multi');

type Cookies = Record<string, string>;

interface ErrorBody {
  error: { code: string; details?: { key?: string } };
}

describe('crm Opportunities list — custom-field filters', () => {
  let h: BackendServerHandle;
  let storedCard: string[] = [];
  let otherOrganization: string;
  let rep: { cookies: Cookies; undo: () => void };
  let withoutRead: { cookies: Cookies; undo: () => void };
  const definitionIds: string[] = [];
  const ids: Record<string, string> = {};
  const perType = new Map<string, { match: string; miss: string }>();

  const options = (...values: string[]) =>
    values.map((value, sortOrder) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder }));

  const define = async (definitionKey: string, valueType: string, listFilter: boolean, extra = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: CRM_ADMIN,
      payload: {
        entityType: 'opportunity',
        key: definitionKey,
        label: {},
        labelDefault: definitionKey,
        valueType,
        required: false,
        sortOrder: 0,
        config: {},
        listFilter,
        options: [],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitionIds.push((response.json() as { data: { id: string } }).data.id);
  };

  const setCard = async (fields: string[]) => {
    const response = await h.app.inject({
      method: 'PUT',
      url: `${CRM_API}/board/card-fields`,
      cookies: CRM_ADMIN,
      payload: { fields },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  const make = async (name: string, values: Record<string, unknown>, body: Record<string, unknown> = {}) => {
    const created = await createCrmOpportunity(h, {
      title: `${MARK} ${name}`,
      customFieldValues: values,
      ...body,
    });
    ids[name] = created.id;
    return created.id;
  };

  const request = (path: string, filters: unknown, extra = '', cookies: Cookies = CRM_ADMIN) =>
    h.app.inject({
      method: 'GET',
      url: `${CRM_API}/${path}?q=${MARK}${extra}${
        filters === null ? '' : `&fieldFilters=${encodeURIComponent(JSON.stringify(filters))}`
      }`,
      cookies,
    });

  /** The names listed for `filters`, over every page. */
  const listed = async (filters: unknown, extra = '', cookies: Cookies = CRM_ADMIN): Promise<string[]> => {
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(
        'opportunities',
        filters,
        `${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        cookies,
      );
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as {
        data: Array<{ title: string }>;
        pagination: { cursor: string | null };
      };
      names.push(...body.data.map((item) => item.title.replace(`${MARK} `, '')));
      cursor = body.pagination.cursor;
    } while (cursor !== null);
    return names.sort();
  };

  const onBoard = async (filters: unknown): Promise<string[]> => {
    const response = await request('board', filters);
    expect(response.statusCode, response.body).toBe(200);
    const data = (response.json() as { data: { columns: Array<{ items: Array<{ title: string }> }> } }).data;
    return data.columns.flatMap((column) => column.items.map((item) => item.title.replace(`${MARK} `, ''))).sort();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    const card = await h.app.inject({ method: 'GET', url: `${CRM_API}/board/card-fields`, cookies: CRM_ADMIN });
    expect(card.statusCode, card.body).toBe(200);
    storedCard = (card.json() as { data: { fields: Array<{ ref: string }> } }).data.fields.map((field) => field.ref);

    otherOrganization = await seedCrmOrganization(h.em(), `cf157 crm ${RUN}`);
    rep = await seedCrmSalesRep(h.em(), [otherOrganization], ['crm:read']);
    withoutRead = await seedCrmAdmin(h.em(), `cf157_no_crm_${RUN}`, ['orders:read']);

    await define(A, 'select', true, { options: options('x', 'y') });
    await define(B, 'select', false, { options: options('x', 'y') });
    await define(C, 'text', true);
    await define(D, 'text', false);
    await define(NUMBER, 'number', true);
    await define(BOOLEAN, 'boolean', true);
    await define(DATE, 'date', true);
    await define(MULTI, 'multiselect', true, { options: options('m', 'n') });
    await setCard(['builtin:value', `custom:${B}`, `custom:${C}`, `custom:${BOOLEAN}`]);

    for (let i = 0; i < 7; i += 1) {
      await make(`ax${i}`, { [A]: 'x', [B]: 'y', [C]: i < 2 ? 'needle' : 'hay' });
    }
    await make('ay', { [A]: 'y', [B]: 'x', [C]: 'needle' });
    await make('none', {});
    await make('valued', {}, { valueMode: 'manual', manualValue: '5000.00' });
    await make('other-org', { [A]: 'x' }, { organizationId: otherOrganization });

    const pair = async (name: string, match: Record<string, unknown>, miss: Record<string, unknown>) =>
      perType.set(name, { match: await make(`${name}-match`, match), miss: await make(`${name}-miss`, miss) });
    await pair('select', { [A]: 'y' }, { [A]: 'x' });
    await pair('text', { [C]: 'unique-crm-text' }, { [C]: 'other' });
    await pair('number', { [NUMBER]: 900 }, { [NUMBER]: 1 });
    await pair('boolean', { [BOOLEAN]: true }, { [BOOLEAN]: false });
    await pair('date', { [DATE]: '2032-01-01' }, { [DATE]: '2020-01-01' });
    await pair('multiselect', { [MULTI]: ['n'] }, { [MULTI]: ['m'] });
  });

  afterAll(async () => {
    await setCard(storedCard);
    rep.undo();
    withoutRead.undo();
    for (const id of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    await teardownBackendServer(h);
  });

  const ax = Array.from({ length: 7 }, (_, i) => `ax${i}`);

  describe('the list', () => {
    it('filters on an option-on field that is not on the card', async () => {
      expect(await listed({ [`custom:${A}`]: { in: ['x'] } })).toEqual([...ax, 'other-org', 'select-miss'].sort());
    });

    it('refuses an option-off field that is on the card, naming it', async () => {
      const response = await request('opportunities', { [`custom:${B}`]: { in: ['x'] } });
      expect(response.statusCode, response.body).toBe(400);
      const { error } = response.json() as ErrorBody;
      expect(error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
      expect(error.details?.key).toBe(B);
    });

    it('filters on a field that is on the card and option-on', async () => {
      expect(await listed({ [`custom:${C}`]: { contains: 'needle' } })).toEqual(['ax0', 'ax1', 'ay']);
    });

    it('ANDs two custom references', async () => {
      expect(
        await listed({ [`custom:${A}`]: { in: ['x'] }, [`custom:${C}`]: { contains: 'needle' } }),
      ).toEqual(['ax0', 'ax1']);
    });

    it('keeps the card rule for a built-in reference', async () => {
      expect(await listed({ 'builtin:value': { min: '4000' } })).toEqual(['valued']);
    });

    it('returns each matching Opportunity once across pages', async () => {
      const names = await listed({ [`custom:${A}`]: { in: ['x'] } }, '&limit=3');
      expect(names).toEqual([...ax, 'other-org', 'select-miss'].sort());
    });

    it('never shows a sales representative another Organization’s Opportunities', async () => {
      // #305 — the test Organization is another representative's: one nobody
      // is assigned to is in every representative's reach.
      const undoBook = await assignToCrmBook(h.em(), [TEST_ORGANIZATION_ID]);
      try {
        expect(await listed({ [`custom:${A}`]: { in: ['x'] } }, '', rep.cookies)).toEqual(['other-org']);
      } finally {
        await undoBook();
      }
    });

    it.each([
      ['select', { [`custom:${A}`]: { in: ['y'] } }],
      ['text', { [`custom:${C}`]: { contains: 'unique-crm-text' } }],
      ['number', { [`custom:${NUMBER}`]: { min: '500' } }],
      ['boolean', { [`custom:${BOOLEAN}`]: { is: true } }],
      ['date', { [`custom:${DATE}`]: { from: '2031-01-01' } }],
      ['multiselect', { [`custom:${MULTI}`]: { in: ['n'] } }],
    ])('filters a %s field', async (name, filters) => {
      const names = await listed(filters);
      expect(names).toContain(`${name}-match`);
      expect(names).not.toContain(`${name}-miss`);
    });

    it('matches only a stored "no" for No, and refuses an operator that does not apply', async () => {
      expect(await listed({ [`custom:${BOOLEAN}`]: { is: false } })).toEqual(['boolean-miss']);
      const response = await request('opportunities', { [`custom:${BOOLEAN}`]: { contains: 'x' } });
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses more than ten custom references as a validation failure', async () => {
      const eleven = Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`custom:${key(`k${i}`)}`, { is: true }]),
      );
      const response = await request('opportunities', eleven);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses fieldFilters given twice as a validation failure', async () => {
      const once = `fieldFilters=${encodeURIComponent(JSON.stringify({ [`custom:${A}`]: { in: ['x'] } }))}`;
      const response = await h.app.inject({
        method: 'GET',
        url: `${CRM_API}/opportunities?q=${MARK}&${once}&${once}`,
        cookies: CRM_ADMIN,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('the board mode (cardValues=true) and the board', () => {
    it('filters an on-card, option-off field by the card rule and ignores an off-card one', async () => {
      expect(await listed({ [`custom:${B}`]: { in: ['x'] } }, '&cardValues=true')).toEqual(['ay']);
      const all = await listed(null, '&cardValues=true');
      expect(await listed({ [`custom:${A}`]: { in: ['x'] } }, '&cardValues=true')).toEqual(all);
    });

    it('ignores a field that is neither on the card nor a list filter, and widens nothing', async () => {
      const response = await request('opportunities', { [`custom:${D}`]: { contains: 'x' } }, '&cardValues=true');
      expect(response.statusCode, response.body).toBe(200);
      const without = await listed(null, '&cardValues=true', rep.cookies);
      const withD = await listed({ [`custom:${D}`]: { contains: 'x' } }, '&cardValues=true', rep.cookies);
      expect(withD).toEqual(without);
    });

    it('keeps the card rule for No — false or never set — when a board lane is continued', async () => {
      const all = await listed(null, '&cardValues=true');
      const no = await listed({ [`custom:${BOOLEAN}`]: { is: false } }, '&cardValues=true');
      expect(no).toEqual(all.filter((name) => name !== 'boolean-match'));
    });

    it('keeps the board filtering an on-card, option-off field as before', async () => {
      expect(await onBoard({ [`custom:${B}`]: { in: ['x'] } })).toEqual(['ay']);
    });
  });

  describe('the offered fields', () => {
    it('lists the option-on Opportunity definitions', async () => {
      const response = await h.app.inject({
        method: 'GET',
        url: `${CRM_API}/opportunities/custom-field-filters`,
        cookies: CRM_ADMIN,
      });
      expect(response.statusCode, response.body).toBe(200);
      const keys = (response.json() as { data: Array<{ key: string }> }).data.map((field) => field.key);
      expect(keys).toEqual(expect.arrayContaining([A, C, NUMBER, BOOLEAN, DATE, MULTI]));
      expect(keys).not.toContain(B);
      expect(keys).not.toContain(D);
    });

    it('answers 403 without crm:read', async () => {
      const response = await h.app.inject({
        method: 'GET',
        url: `${CRM_API}/opportunities/custom-field-filters`,
        cookies: withoutRead.cookies,
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
