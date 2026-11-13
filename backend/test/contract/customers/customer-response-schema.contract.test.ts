import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminCustomerDetailSchema,
  adminCustomerListResponseSchema,
  customerAddressBookSchema,
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
 * not answered, and a key no schema declares all red this file.
 *
 * The self-service address book is gone (`specs/173-b2c-address-book-merge/`
 * release 1): its routes answer 410, and the one book a buyer reads is the
 * Organization's, whose shapes `organizations` owns.
 */
describe('customer responses parse with the published customer schemas', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
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

  it('GET /api/v1/me/customer/defaults — the checkout defaults', async () => {
    const defaults = await data('/api/v1/me/customer/defaults', CUSTOMER);
    expect(disagreements(deepStrict(customerDefaultsSchema), defaults)).toEqual([]);
  });

  it('GET /api/v1/admin/customers — the admin list: every row and the page envelope', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/customers?pageSize=100', ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
    // Issue #599 §4 — the rows were parsed; `meta` was described by no schema.
    expect(disagreements(deepStrict(adminCustomerListResponseSchema), body)).toEqual([]);
  });

  it('GET /api/v1/admin/customers/:id — the admin detail', async () => {
    const detail = await data(`/api/v1/admin/customers/${TEST_CUSTOMER_ID}`, ADMIN);
    expect(disagreements(deepStrict(adminCustomerDetailSchema), detail)).toEqual([]);
  });

  it('GET /api/v1/admin/customers/:id/addresses — the admin view: the Organization book and any refused personal rows', async () => {
    const book = await data(`/api/v1/admin/customers/${TEST_CUSTOMER_ID}/addresses`, ADMIN);
    expect(disagreements(deepStrict(customerAddressBookSchema), book)).toEqual([]);
  });
});
