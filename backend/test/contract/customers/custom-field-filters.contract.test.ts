import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CustomerAccount } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';

/**
 * Issue #1903 — custom fields as filters of the admin Customers list, the way
 * the Orders, Quote Requests, Opportunities, Projects and Tasks lists take
 * them (`specs/157-custom-fields-list-filters/contracts/list-filter-api.md`).
 *
 * The filter narrows what the caller reaches and never widens it: a sales
 * representative still sees only the customers of the Organizations in their
 * book (the tenant filter on `CustomerAccount`, issue #305), and the total and
 * the pages are those of the narrowed set.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const API = '/api/v1/admin/custom-fields';
const LIST = '/api/v1/admin/customers';
const RUN = randomUUID().slice(0, 8);
const key = (name: string) => `cf1903_cus_${RUN}_${name}`;

const TIER = key('tier');
const VIP = key('vip');
const OFF = key('off');

type Cookies = Record<string, string>;

interface ListBody {
  data: Array<{ id: string }>;
  meta: { page: number; pageSize: number; total: number };
}

interface ErrorBody {
  error: { code: string; message: string; details?: { key?: string; keys?: string[] } };
}

const param = (filters: unknown) => `customFieldFilters=${encodeURIComponent(JSON.stringify(filters))}`;

describe('admin Customers list — custom-field filters (#1903)', () => {
  let h: BackendServerHandle;
  let rep: { cookies: Cookies; undo: () => void };
  let withoutCustomers: { cookies: Cookies; undo: () => void };
  const definitionIds: string[] = [];
  const accountIds: string[] = [];
  /** Of the representative's Organization, tier `gold`. */
  const reachableGold: string[] = [];
  /** Of another representative's Organization, tier `gold`. */
  const foreignGold: string[] = [];
  /** Tier `silver`, VIP. */
  let silverVip = '';

  const get = (url: string, cookies: Cookies = ADMIN) => h.app.inject({ method: 'GET', url, cookies });

  const list = async (query: string, cookies: Cookies = ADMIN): Promise<ListBody> => {
    const response = await get(`${LIST}?${query}`, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as ListBody;
  };

  /** Every id over every page of `query`, two rows a page. */
  const allIds = async (query: string, cookies: Cookies = ADMIN): Promise<string[]> => {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const body = await list(`${query}&pageSize=2&page=${page}`, cookies);
      ids.push(...body.data.map((row) => row.id));
      if (page * 2 >= body.meta.total) return ids;
    }
  };

  const define = async (definitionKey: string, valueType: string, extra: Record<string, unknown> = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType: 'customer',
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

  const customer = async (organizationId: string, values: Record<string, unknown>): Promise<string> => {
    const em = h.em();
    const account = em.create(CustomerAccount, {
      organizationId,
      email: `cf1903-${RUN}-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Filter',
      lastName: `Customer ${accountIds.length}`,
    } as never);
    await em.persist(account).flush();
    const id = (account as unknown as { id: string }).id;
    await em
      .getConnection()
      .execute(`update "customer_accounts" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify(values),
        id,
      ]);
    accountIds.push(id);
    return id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await define(TIER, 'select', { options: options('gold', 'silver') });
    await define(VIP, 'boolean');
    await define(OFF, 'select', { options: options('gold'), listFilter: false });

    const em = h.em();
    const own = await seedCrmOrganization(em, `cf1903 own ${RUN}`);
    const foreign = await seedCrmOrganization(em, `cf1903 foreign ${RUN}`);
    for (let i = 0; i < 3; i += 1) reachableGold.push(await customer(own, { [TIER]: 'gold', [VIP]: i === 0 }));
    for (let i = 0; i < 2; i += 1) foreignGold.push(await customer(foreign, { [TIER]: 'gold' }));
    silverVip = await customer(foreign, { [TIER]: 'silver', [VIP]: true });
    await customer(own, {});

    rep = await seedCrmSalesRep(em, [own], ['customers:read']);
    withoutCustomers = await seedCrmAdmin(em, `cf1903_no_customers_${RUN}`, ['custom_fields:read']);
  });

  afterAll(async () => {
    rep.undo();
    withoutCustomers.undo();
    if (accountIds.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from customer_accounts where id in (${accountIds.map(() => '?').join(', ')})`, accountIds);
    }
    for (const id of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  describe('the offered fields', () => {
    it('lists the option-on Customer definitions, and not the others', async () => {
      const response = await get(`${LIST}/custom-field-filters`);
      expect(response.statusCode, response.body).toBe(200);
      const keys = (response.json() as { data: Array<{ key: string }> }).data.map((field) => field.key);
      expect(keys).toEqual(expect.arrayContaining([TIER, VIP]));
      expect(keys).not.toContain(OFF);
    });

    it('answers 403 without customers:read', async () => {
      const response = await get(`${LIST}/custom-field-filters`, withoutCustomers.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });
  });

  describe('filtering', () => {
    it('pages through exactly the matching customers, with the total of the narrowed set', async () => {
      const query = param({ [TIER]: { in: ['gold'] } });
      const first = await list(`${query}&pageSize=2`);
      expect(first.meta.total).toBe(5);
      expect(first.data).toHaveLength(2);
      const ids = await allIds(query);
      expect(ids).toHaveLength(5);
      expect([...ids].sort()).toEqual([...reachableGold, ...foreignGold].sort());
    });

    it('ANDs two keys, and with the list’s own filters', async () => {
      const vip = await list(param({ [TIER]: { in: ['gold', 'silver'] }, [VIP]: { is: true } }));
      expect([...vip.data.map((row) => row.id)].sort()).toEqual([reachableGold[0], silverVip].sort());
      const blocked = await list(`${param({ [TIER]: { in: ['gold'] } })}&status=blocked`);
      expect(blocked.meta.total).toBe(0);
    });

    it('confines a sales representative to their book — the filter narrows, never widens', async () => {
      const query = param({ [TIER]: { in: ['gold'] } });
      const ids = await allIds(query, rep.cookies);
      expect([...ids].sort()).toEqual([...reachableGold].sort());
      expect((await list(query, rep.cookies)).meta.total).toBe(reachableGold.length);
      // A filter matching only a customer of another book: the platform
      // administrator sees it, the representative does not.
      const foreignOnly = param({ [TIER]: { in: ['silver'] } });
      expect((await list(foreignOnly)).data.map((row) => row.id)).toEqual([silverVip]);
      expect((await list(foreignOnly, rep.cookies)).meta.total).toBe(0);
    });
  });

  describe('refusals', () => {
    it.each([
      ['an unknown key', key('unknown')],
      ['a field with the option off', OFF],
    ])('refuses %s, naming it', async (_name, refused) => {
      const response = await get(`${LIST}?${param({ [refused]: { in: ['gold'] } })}`);
      expect(response.statusCode, response.body).toBe(400);
      const { error } = response.json() as ErrorBody;
      expect(error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
      expect(error.details?.key).toBe(refused);
    });

    it('refuses an operator that does not apply to the field as a validation failure', async () => {
      const response = await get(`${LIST}?${param({ [VIP]: { contains: 'x' } })}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses the parameter given twice', async () => {
      const once = param({ [TIER]: { in: ['gold'] } });
      const response = await get(`${LIST}?${once}&${once}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });
  });
});
