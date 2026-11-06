import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

/**
 * Issue #794 — every admin sub-resource of a customer that does not exist
 * answers `404 CUSTOMER_NOT_FOUND`, as the customer itself does and as a
 * malformed id on the same routes does (issue #781). They used to answer their
 * own `NOT_FOUND`, or an empty `200` that read as "this customer has nothing".
 *
 * The impersonation case is the security-relevant one: the permission is
 * judged before the customer is looked up, so a caller who may not impersonate
 * is refused alike for a customer that exists and one that does not — the
 * refusal does not tell them which ids name a customer.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const READER = { b2b_session: 'stub-customers-reader-session' };
const READER_ID = '00000000-0000-4000-8000-0000000794a1';
const UNKNOWN_CUSTOMER_ID = '00000000-0000-4000-8000-00000000f794';

interface SubResource {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly suffix: string;
  readonly payload?: Record<string, unknown>;
}

/** Issue #794's six, and the retired address write beside them. */
const SUB_RESOURCES: readonly SubResource[] = [
  { method: 'PATCH', suffix: 'custom-fields', payload: {} },
  { method: 'POST', suffix: 'impersonate', payload: {} },
  { method: 'GET', suffix: 'addresses' },
  // Retired (`specs/173-b2c-address-book-merge/` OD-5): `410` for a customer
  // that exists, and for one that does not the same `404` as every sibling.
  { method: 'POST', suffix: 'addresses', payload: {} },
  { method: 'GET', suffix: 'orders' },
  { method: 'GET', suffix: 'quote-requests' },
  { method: 'GET', suffix: 'carts' },
];

describe('admin sub-resources of an unknown customer (issue #794)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/customers_reader_794',
      cookies: ADMIN,
      payload: { code: 'customers_reader_794', name: 'Customers reader', permissions: ['customers:read'] },
    });
    expect(role.statusCode).toBe(200);
    const em = h.em();
    em.create(AdminUser, {
      id: READER_ID,
      email: 'customers-reader-794@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Customers',
      lastName: 'Reader',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const call = (route: SubResource, customerId: string, cookies: Record<string, string>) =>
    h.app.inject({
      method: route.method,
      url: `/api/v1/admin/customers/${customerId}/${route.suffix}`,
      cookies,
      ...(route.payload ? { payload: route.payload } : {}),
    });

  it.each(SUB_RESOURCES.map((route) => [`${route.method} …/${route.suffix}`, route] as const))(
    '%s answers 404 CUSTOMER_NOT_FOUND for a customer that does not exist',
    async (_name, route) => {
      const res = await call(route, UNKNOWN_CUSTOMER_ID, ADMIN);
      expect({ status: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code }).toEqual({
        status: 404,
        code: ERROR_CODES.CUSTOMER_NOT_FOUND,
      });
    },
  );

  it('still reads the address card of a customer that exists, in its `{ organization, personal }` shape', async () => {
    const res = await call({ method: 'GET', suffix: 'addresses' }, TEST_CUSTOMER_ID, ADMIN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { organization: unknown[]; personal: unknown[] } };
    expect(Array.isArray(body.data.organization)).toBe(true);
    expect(Array.isArray(body.data.personal)).toBe(true);
  });

  it('still tells an admin adding an address to a customer that exists that the book is retired', async () => {
    const res = await call({ method: 'POST', suffix: 'addresses', payload: {} }, TEST_CUSTOMER_ID, ADMIN);
    expect({ status: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code }).toEqual({
      status: 410,
      code: ERROR_CODES.CUSTOMER_ADDRESS_BOOK_RETIRED,
    });
  });

  it.each(['orders', 'quote-requests', 'carts'])('still lists %s of a customer that exists', async (suffix) => {
    const res = await call({ method: 'GET', suffix }, TEST_CUSTOMER_ID, ADMIN);
    expect(res.statusCode).toBe(200);
  });

  it('refuses impersonation without the permission alike for a known and an unknown customer', async () => {
    const impersonate: SubResource = { method: 'POST', suffix: 'impersonate', payload: {} };
    // The status, the code and the message: everything but a per-request id.
    const answer = async (customerId: string) => {
      const res = await call(impersonate, customerId, READER);
      const { code, message } = (res.json() as { error: { code: string; message: string } }).error;
      return { status: res.statusCode, code, message };
    };
    const known = await answer(TEST_CUSTOMER_ID);
    expect(known).toMatchObject({ status: 403, code: ERROR_CODES.FORBIDDEN });
    expect(await answer(UNKNOWN_CUSTOMER_ID)).toEqual(known);
  });

  it('answers an anonymous impersonation 401 for an unknown customer, before any lookup', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${UNKNOWN_CUSTOMER_ID}/impersonate`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
