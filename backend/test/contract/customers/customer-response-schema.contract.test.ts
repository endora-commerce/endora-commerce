import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminCustomerDetailSchema,
  adminCustomerListItemSchema,
  customerAddressBookSchema,
  customerAddressSchema,
  customerDefaultsSchema,
  customerSelfProfileSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/**
 * The customer routes answer what `@endora-commerce/contracts` publishes, and
 * nothing beside it (Constitution II, issue #128).
 *
 * Each reply is driven through the real HTTP stack and its `data` parsed with
 * a **strict copy** of the published schema (`test/helpers/strict-schema.ts`):
 * a declared field answered with a type the schema refuses, a required field
 * not answered, and a key no schema declares all red this file. The address is
 * saved without a phone on purpose — `phone: null` against "a string, or
 * absent" is the drift issue #125 was opened for.
 */
describe('customer responses parse with the published customer schemas', () => {
  let h: BackendServerHandle;
  let created: unknown;

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/addresses',
      ...CUSTOMER,
      payload: {
        kind: 'delivery',
        recipientName: 'Contract Reader',
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    });
    expect(res.statusCode).toBe(201);
    created = (res.json() as { data: unknown }).data;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function data(url: string, actor: typeof CUSTOMER): Promise<unknown> {
    const res = await h.app.inject({ method: 'GET', url, ...actor });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: unknown }).data;
  }

  it('GET /api/v1/me/customer — the buyer profile', async () => {
    const profile = await data('/api/v1/me/customer', CUSTOMER);
    expect(disagreements(deepStrict(customerSelfProfileSchema), profile)).toEqual([]);
  });

  it('POST /api/v1/me/customer/addresses — the saved address, no phone', () => {
    expect(disagreements(deepStrict(customerAddressSchema), created)).toEqual([]);
  });

  it('GET /api/v1/me/customer/addresses — the address book', async () => {
    const book = (await data('/api/v1/me/customer/addresses', CUSTOMER)) as { personal: unknown[] };
    expect(book.personal.length).toBeGreaterThan(0);
    expect(disagreements(deepStrict(customerAddressBookSchema), book)).toEqual([]);
  });

  it('GET /api/v1/me/customer/defaults — the checkout defaults', async () => {
    const defaults = await data('/api/v1/me/customer/defaults', CUSTOMER);
    expect(disagreements(deepStrict(customerDefaultsSchema), defaults)).toEqual([]);
  });

  it('GET /api/v1/admin/customers — every row of the admin list', async () => {
    const rows = (await data('/api/v1/admin/customers?pageSize=100', ADMIN)) as unknown[];
    expect(rows.length).toBeGreaterThan(0);
    const strictRow = deepStrict(adminCustomerListItemSchema);
    expect(rows.flatMap((row) => disagreements(strictRow, row))).toEqual([]);
  });

  it('GET /api/v1/admin/customers/:id — the admin detail', async () => {
    const detail = await data(`/api/v1/admin/customers/${TEST_CUSTOMER_ID}`, ADMIN);
    expect(disagreements(deepStrict(adminCustomerDetailSchema), detail)).toEqual([]);
  });

  it('GET /api/v1/admin/customers/:id/addresses — the admin view of the address book', async () => {
    const book = await data(`/api/v1/admin/customers/${TEST_CUSTOMER_ID}/addresses`, ADMIN);
    expect(disagreements(deepStrict(customerAddressBookSchema), book)).toEqual([]);
  });
});
