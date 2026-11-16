import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

/**
 * Custom fields as filters of the admin Quote Request list
 * (`specs/157-custom-fields-list-filters/` US2; FR-009 – FR-012; contract §5.1;
 * threat model F-1, F-3, F-4).
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const API = '/api/v1/admin/custom-fields';
const LIST = '/api/v1/admin/quote-requests';
const RUN = randomUUID().slice(0, 8);
const key = (name: string) => `cf157_${RUN}_${name}`;

const M = key('m');
const Y = key('y');
const TEXT = key('text');
const NUMBER = key('number');
const DATE = key('date');
const SELECT = key('select');
const OFF = key('off');
const ORDER_KEY = key('order');

type Cookies = Record<string, string>;

interface ErrorBody {
  error: { code: string; details?: { key?: string } };
}

const param = (filters: unknown) => `customFieldFilters=${encodeURIComponent(JSON.stringify(filters))}`;

describe('admin Quote Request list — custom-field filters', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let rep: { cookies: Cookies; undo: () => void };
  let withoutHandle: { cookies: Cookies; undo: () => void };
  const definitionIds: string[] = [];
  const inA = { x: [] as string[], z: [] as string[], none: [] as string[], yesX: [] as string[], noX: [] as string[] };
  const inB: string[] = [];
  const perType = new Map<string, { match: string; miss: string }>();

  const get = (url: string, cookies: Cookies = ADMIN) => h.app.inject({ method: 'GET', url, cookies });

  // The largest page (issue #317): these cases compare whole result sets.
  const ids = async (query: string, cookies: Cookies = ADMIN): Promise<string[]> => {
    const response = await get(`${LIST}?${query}&pageSize=200`, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
  };

  const options = (...values: string[]) =>
    values.map((value, sortOrder) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder }));

  const define = async (
    entityType: string,
    definitionKey: string,
    valueType: string,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType,
        key: definitionKey,
        label: {},
        labelDefault: definitionKey,
        valueType,
        required: false,
        sortOrder: 0,
        config: {},
        listFilter: true,
        options: [],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitionIds.push((response.json() as { data: { id: string } }).data.id);
  };

  /** A Quote Request moved into `organizationId`, carrying `values`. */
  const quote = async (organizationId: string, values: Record<string, unknown>): Promise<string> => {
    const { id } = await submitCrmQuoteRequest(h);
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set organization_id = ?, custom_field_values = ?::jsonb where id = ?`, [
        organizationId,
        JSON.stringify(values),
        id,
      ]);
    return id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    organizationA = await seedCrmOrganization(em, `cf157 QR A ${RUN}`);
    organizationB = await seedCrmOrganization(em, `cf157 QR B ${RUN}`);
    rep = await seedCrmSalesRep(em, [organizationA], ['rfqs:handle']);
    withoutHandle = await seedCrmAdmin(em, `cf157_no_rfqs_${RUN}`, ['orders:read']);

    await define('quote_request', M, 'multiselect', { options: options('x', 'z') });
    await define('quote_request', Y, 'boolean');
    await define('quote_request', TEXT, 'text');
    await define('quote_request', NUMBER, 'number');
    await define('quote_request', DATE, 'date');
    await define('quote_request', SELECT, 'select', { options: options('p', 'q') });
    await define('quote_request', OFF, 'text', { listFilter: false });
    await define('order', ORDER_KEY, 'text');

    for (let i = 0; i < 12; i += 1) inA.x.push(await quote(organizationA, { [M]: ['x'] }));
    for (let i = 0; i < 6; i += 1) inA.yesX.push(await quote(organizationA, { [M]: ['x', 'z'], [Y]: true }));
    for (let i = 0; i < 4; i += 1) inA.noX.push(await quote(organizationA, { [M]: ['x'], [Y]: false }));
    for (let i = 0; i < 5; i += 1) inA.z.push(await quote(organizationA, { [M]: ['z'] }));
    for (let i = 0; i < 3; i += 1) inA.none.push(await quote(organizationA, {}));
    for (let i = 0; i < 3; i += 1) inB.push(await quote(organizationB, { [M]: ['x'], [Y]: true }));

    const pair = async (name: string, match: Record<string, unknown>, miss: Record<string, unknown>) =>
      perType.set(name, { match: await quote(organizationB, match), miss: await quote(organizationB, miss) });
    await pair('multiselect', { [M]: ['z'] }, { [M]: [] });
    await pair('boolean', { [Y]: false }, { [Y]: true });
    await pair('text', { [TEXT]: 'unique-match' }, { [TEXT]: 'other' });
    await pair('number', { [NUMBER]: 777 }, { [NUMBER]: 1 });
    await pair('date', { [DATE]: '2031-05-05' }, { [DATE]: '2020-05-05' });
    await pair('select', { [SELECT]: 'q' }, { [SELECT]: 'p' });
  });

  afterAll(async () => {
    rep.undo();
    withoutHandle.undo();
    for (const id of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  const allX = () => [...inA.x, ...inA.yesX, ...inA.noX, ...inB].sort();

  describe('the offered fields', () => {
    it('lists the option-on Quote Request definitions only', async () => {
      const response = await get(`${LIST}/custom-field-filters`);
      expect(response.statusCode, response.body).toBe(200);
      const keys = (response.json() as { data: Array<{ key: string }> }).data.map((field) => field.key);
      expect(keys).toEqual(expect.arrayContaining([M, Y, TEXT, NUMBER, DATE, SELECT]));
      expect(keys).not.toContain(OFF);
      expect(keys).not.toContain(ORDER_KEY);
    });

    it('answers 403 without rfqs:handle', async () => {
      expect((await get(`${LIST}/custom-field-filters`, withoutHandle.cookies)).statusCode).toBe(403);
    });

    it('is its own route, not a request lookup', async () => {
      const response = await get(`${LIST}/custom-field-filters`);
      expect(Array.isArray((response.json() as { data: unknown }).data)).toBe(true);
    });
  });

  describe('filtering', () => {
    it('answers exactly the matching requests, each once, past the first page', async () => {
      const found = await ids(param({ [M]: { in: ['x'] } }));
      expect(found).toHaveLength(new Set(found).size);
      expect([...found].sort()).toEqual(allX());
    });

    it('ORs the values of one key', async () => {
      const found = await ids(`${param({ [M]: { in: ['x', 'z'] } })}&organizationId=${organizationA}`);
      expect([...found].sort()).toEqual([...inA.x, ...inA.yesX, ...inA.noX, ...inA.z].sort());
    });

    it('ANDs two keys, and `is: false` excludes requests without a value', async () => {
      const yes = await ids(`${param({ [M]: { in: ['x'] }, [Y]: { is: true } })}&organizationId=${organizationA}`);
      expect([...yes].sort()).toEqual([...inA.yesX].sort());
      const no = await ids(`${param({ [M]: { in: ['x'] }, [Y]: { is: false } })}&organizationId=${organizationA}`);
      expect([...no].sort()).toEqual([...inA.noX].sort());
    });

    it('ANDs with the organization filter rather than replacing it', async () => {
      const found = await ids(`${param({ [M]: { in: ['x'] } })}&organizationId=${organizationA}`);
      expect(found).not.toEqual(expect.arrayContaining([inB[0]]));
      expect([...found].sort()).toEqual([...inA.x, ...inA.yesX, ...inA.noX].sort());
    });

    it('never shows a sales representative another Organization’s requests', async () => {
      for (const extra of ['assignmentScope=mine', `organizationId=${organizationA}`, '']) {
        const found = await ids(`${param({ [M]: { in: ['x'] } })}&${extra}`, rep.cookies);
        for (const id of inB) expect(found).not.toContain(id);
        expect(found).toEqual(expect.arrayContaining(inA.x));
      }
    });

    it('combines scope, status, organization and a custom filter, all as AND', async () => {
      const filters = param({ [M]: { in: ['x'] } });
      const mine = await ids(`${filters}&assignmentScope=mine&status=Pending&organizationId=${organizationA}`, rep.cookies);
      expect([...mine].sort()).toEqual([...inA.x, ...inA.yesX, ...inA.noX].sort());
      expect(await ids(`${filters}&assignmentScope=mine&status=Approved&organizationId=${organizationA}`, rep.cookies)).toEqual([]);
      expect(await ids(`${filters}&assignmentScope=mine&organizationId=${organizationB}`, rep.cookies)).toEqual([]);
    });

    it('answers as before without the parameter', async () => {
      const found = await ids(`organizationId=${organizationA}`);
      expect([...found].sort()).toEqual(
        [...inA.x, ...inA.yesX, ...inA.noX, ...inA.z, ...inA.none].sort(),
      );
    });

    it.each([
      ['multiselect', { [M]: { in: ['z'] } }],
      ['boolean', { [Y]: { is: false } }],
      ['text', { [TEXT]: { contains: 'unique-match' } }],
      ['number', { [NUMBER]: { min: '700' } }],
      ['date', { [DATE]: { from: '2030-01-01' } }],
      ['select', { [SELECT]: { in: ['q'] } }],
    ])('filters a %s field', async (name, filters) => {
      const found = await ids(`${param(filters)}&organizationId=${organizationB}`);
      const { match, miss } = perType.get(name)!;
      expect(found).toContain(match);
      expect(found).not.toContain(miss);
    });
  });

  describe('refusals', () => {
    it('refuses an operator that does not apply to the field, naming the key and the operator', async () => {
      const response = await get(`${LIST}?${param({ [Y]: { contains: 'x' } })}`);
      expect(response.statusCode, response.body).toBe(400);
      const body = response.json() as { error: { code: string; details?: Array<{ path: string }> } };
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.map((detail) => detail.path)).toEqual([`${Y}.contains`]);
    });

    it('locates a malformed filter under the parameter', async () => {
      const response = await get(`${LIST}?${param({ [Y]: { from: '2026-02-30' } })}`);
      expect(response.statusCode, response.body).toBe(400);
      const body = response.json() as { error: { details?: Array<{ path: string }> } };
      expect(body.error.details?.map((detail) => detail.path)).toEqual([`customFieldFilters.${Y}.from`]);
    });

    it.each([
      ['an unknown key', key('unknown')],
      ['an Order key', ORDER_KEY],
      ['a field with the option off', OFF],
      ['constructor', 'constructor'],
    ])('refuses %s, naming it', async (_name, refused) => {
      const response = await get(`${LIST}?${param({ [refused]: { contains: 'x' } })}`);
      expect(response.statusCode, response.body).toBe(400);
      const { error } = response.json() as ErrorBody;
      expect(error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
      expect(error.details?.key).toBe(refused);
    });

    it.each([
      ['a parameter that is not JSON', 'customFieldFilters=x'],
      ['the parameter given twice', `${param({ [M]: { in: ['x'] } })}&${param({ [M]: { in: ['z'] } })}`],
      [
        'eleven keys',
        param(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [key(`k${i}`), { is: true }]))),
      ],
    ])('refuses %s as a validation failure', async (_name, query) => {
      const response = await get(`${LIST}?${query}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });
  });
});
