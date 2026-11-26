import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';

/**
 * Issue #1903 — custom fields as filters of the admin Organizations list, the
 * way the Orders, Quote Requests, Opportunities, Projects and Tasks lists take
 * them (`specs/157-custom-fields-list-filters/contracts/list-filter-api.md`).
 *
 * The filter narrows what the caller reaches and never widens it: a sales
 * representative still sees only the Organizations of their book (issue #305),
 * and the total and the pages are those of the narrowed set.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const API = '/api/v1/admin/custom-fields';
const LIST = '/api/v1/admin/organizations';
const RUN = randomUUID().slice(0, 8);
const key = (name: string) => `cf1903_org_${RUN}_${name}`;

const SEGMENT = key('segment');
const NOTE = key('note');
const OFF = key('off');

type Cookies = Record<string, string>;

interface ListBody {
  data: Array<{ id: string }>;
  meta: { page: number; pageSize: number; total: number };
  pagination: { hasMore: boolean };
}

interface ErrorBody {
  error: { code: string; message: string; details?: { key?: string; keys?: string[] } };
}

const param = (filters: unknown) => `customFieldFilters=${encodeURIComponent(JSON.stringify(filters))}`;

describe('admin Organizations list — custom-field filters (#1903)', () => {
  let h: BackendServerHandle;
  let rep: { cookies: Cookies; undo: () => void };
  let withoutCustomers: { cookies: Cookies; undo: () => void };
  const definitionIds: string[] = [];
  /** In the representative's book, segment `a`. */
  const reachableA: string[] = [];
  /** In another representative's book, segment `a`. */
  const foreignA: string[] = [];
  /** Segment `b`, or no value at all. */
  const others: string[] = [];

  const get = (url: string, cookies: Cookies = ADMIN) => h.app.inject({ method: 'GET', url, cookies });

  const list = async (query: string, cookies: Cookies = ADMIN): Promise<ListBody> => {
    const response = await get(`${LIST}?${query}`, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as ListBody;
  };

  /** Every id over every page of `query`, three rows a page. */
  const allIds = async (query: string, cookies: Cookies = ADMIN): Promise<string[]> => {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const body = await list(`${query}&pageSize=3&page=${page}`, cookies);
      ids.push(...body.data.map((row) => row.id));
      if (!body.pagination.hasMore) return ids;
    }
  };

  const define = async (definitionKey: string, valueType: string, extra: Record<string, unknown> = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType: 'organization',
        key: definitionKey,
        label: { en: definitionKey },
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

  const options = (...values: string[]) =>
    values.map((value, sortOrder) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder }));

  const organization = async (values: Record<string, unknown>): Promise<string> => {
    const id = await seedCrmOrganization(h.em(), `cf1903 ${RUN}`);
    await h
      .em()
      .getConnection()
      .execute(`update "organizations" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify(values),
        id,
      ]);
    return id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await define(SEGMENT, 'select', { options: options('a', 'b') });
    await define(NOTE, 'text', { audience: 'internal' });
    await define(OFF, 'select', { options: options('a'), listFilter: false });

    for (let i = 0; i < 4; i += 1) reachableA.push(await organization({ [SEGMENT]: 'a', [NOTE]: i < 2 ? 'needle' : 'hay' }));
    for (let i = 0; i < 3; i += 1) foreignA.push(await organization({ [SEGMENT]: 'a' }));
    others.push(await organization({ [SEGMENT]: 'b', [NOTE]: 'needle' }));
    others.push(await organization({}));

    const em = h.em();
    rep = await seedCrmSalesRep(em, [...reachableA], ['customers:read']);
    withoutCustomers = await seedCrmAdmin(em, `cf1903_no_customers_${RUN}`, ['custom_fields:read']);
  });

  afterAll(async () => {
    rep.undo();
    withoutCustomers.undo();
    for (const id of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  describe('the offered fields', () => {
    it('lists the option-on Organization definitions, and not the others', async () => {
      const response = await get(`${LIST}/custom-field-filters`);
      expect(response.statusCode, response.body).toBe(200);
      const keys = (response.json() as { data: Array<{ key: string }> }).data.map((field) => field.key);
      expect(keys).toEqual(expect.arrayContaining([SEGMENT, NOTE]));
      expect(keys).not.toContain(OFF);
    });

    it('answers 403 without customers:read', async () => {
      const response = await get(`${LIST}/custom-field-filters`, withoutCustomers.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });
  });

  describe('filtering', () => {
    it('pages through exactly the matching Organizations, with the total of the narrowed set', async () => {
      const query = param({ [SEGMENT]: { in: ['a'] } });
      const first = await list(`${query}&pageSize=3`);
      expect(first.meta.total).toBe(7);
      expect(first.data).toHaveLength(3);
      expect(first.pagination.hasMore).toBe(true);
      const ids = await allIds(query);
      expect(ids).toHaveLength(7);
      expect([...ids].sort()).toEqual([...reachableA, ...foreignA].sort());
    });

    it('ANDs two keys, and with the search', async () => {
      const both = await list(param({ [SEGMENT]: { in: ['a', 'b'] }, [NOTE]: { contains: 'needle' } }));
      expect(both.meta.total).toBe(3);
      const searched = await list(`${param({ [SEGMENT]: { in: ['a'] } })}&q=${encodeURIComponent('no such name')}`);
      expect(searched.meta.total).toBe(0);
    });

    it('confines a sales representative to their book — the filter narrows, never widens', async () => {
      const query = param({ [SEGMENT]: { in: ['a'] } });
      const ids = await allIds(query, rep.cookies);
      expect([...ids].sort()).toEqual([...reachableA].sort());
      expect((await list(`${query}&pageSize=3`, rep.cookies)).meta.total).toBe(reachableA.length);
      // A filter matching only a row of another book: the platform
      // administrator sees it, the representative does not.
      const foreignOnly = param({ [NOTE]: { contains: 'needle' }, [SEGMENT]: { in: ['b'] } });
      expect((await list(foreignOnly)).data.map((row) => row.id)).toEqual([others[0]]);
      expect((await list(foreignOnly, rep.cookies)).meta.total).toBe(0);
    });
  });

  describe('refusals', () => {
    it.each([
      ['an unknown key', key('unknown')],
      ['a field with the option off', OFF],
    ])('refuses %s, naming it', async (_name, refused) => {
      const response = await get(`${LIST}?${param({ [refused]: { in: ['a'] } })}`);
      expect(response.statusCode, response.body).toBe(400);
      const { error } = response.json() as ErrorBody;
      expect(error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
      expect(error.details?.key).toBe(refused);
    });

    it('refuses an operator that does not apply to the field as a validation failure', async () => {
      const response = await get(`${LIST}?${param({ [SEGMENT]: { min: '1' } })}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses the parameter given twice', async () => {
      const once = param({ [SEGMENT]: { in: ['a'] } });
      const response = await get(`${LIST}?${once}&${once}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });
  });
});
