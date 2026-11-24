import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CustomerAccount, Order, OrderItem, Organization, QuoteRequest } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { markUnsharedForTest, shareQuoteRequestForTest } from '../../helpers/quote-request-share.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

/**
 * `specs/192-quote-request-draft-share/` T009 (FR-003, FR-004, FR-010, SC-001)
 * — an operator's quote the customer has not been shared yet is invisible to
 * every customer surface: its own account, its Organization's *Administrator*,
 * a roll-up login of the tree, `customers`' lists (self and the admin
 * customer-detail tab) and `carts`' conversion. Every customer action on it
 * answers exactly as a quote that does not exist and changes nothing. A
 * customer's own submission and an order's *Clone to quote* stay visible at
 * once.
 */
describe('an unshared quote is invisible to every customer surface', () => {
  let h: BackendServerHandle;
  let unshared: string;
  let shared: string;
  const cookies: string[] = [];

  const inject = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    as: Record<string, string>,
    payload?: Record<string, unknown>,
  ) => h.app.inject({ method, url, cookies: as, ...(payload ? { payload } : {}) });

  const errorOf = (res: { json(): unknown }) => {
    const { error } = res.json() as { error: { code: string; message: string } };
    return { code: error.code, message: error.message };
  };

  const versionOf = async (id: string): Promise<number> =>
    Number(
      (await h.em().fork().execute<Array<{ version: number }>>(`select "version" from "quote_requests" where "id" = ?`, [id]))[0]!
        .version,
    );

  async function operatorQuote(): Promise<string> {
    const res = await inject('POST', '/api/v1/admin/quote-requests', ADMIN, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_ID,
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  /** An account of `organizationId` behind a fresh cookie. */
  async function account(
    em: EntityManager,
    organizationId: string,
    label: string,
    extra: Partial<{ subtreeRollupEnabled: boolean; organizationRoleId: string }> = {},
  ): Promise<Record<string, string>> {
    const created = em.create(CustomerAccount, {
      organizationId,
      email: `${label}-${randomUUID()}@unshared-visibility.example`,
      passwordHash: 'x',
      firstName: 'Unshared',
      lastName: label,
      ...extra,
    });
    await em.persistAndFlush(created);
    const cookie = `stub-192-${label}-${created.id.slice(0, 8)}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: created.id, organizationId };
    cookies.push(cookie);
    return { b2b_session: cookie };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    unshared = await operatorQuote();
    shared = await operatorQuote();
    await shareQuoteRequestForTest(h.app, shared);
    // An operator's quote starts unshared; said again so the case does not lean on it.
    await markUnsharedForTest(h.em(), unshared);
  }, 120_000);

  afterAll(async () => {
    for (const cookie of cookies) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  it('the customer: the list omits it; the detail and every action answer as a missing quote; nothing changes', async () => {
    const list = await inject('GET', '/api/v1/quote-requests', CUSTOMER);
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(ids).toContain(shared);
    expect(ids).not.toContain(unshared);

    const version = await versionOf(unshared);
    const calls: Array<['GET' | 'POST' | 'PATCH', string, Record<string, unknown> | undefined]> = [
      ['GET', '', undefined],
      ['PATCH', '', { headerNote: 'mine now' }],
      ['POST', '/accept-revision', { expectedRevisionNumber: 1 }],
      ['POST', '/reject-revision', { expectedRevisionNumber: 1 }],
      ['POST', '/convert-to-order', {}],
      ['POST', '/resubmit', {}],
    ];
    for (const [method, suffix, payload] of calls) {
      const missing = await inject(method, `/api/v1/quote-requests/${randomUUID()}${suffix}`, CUSTOMER, payload);
      const res = await inject(method, `/api/v1/quote-requests/${unshared}${suffix}`, CUSTOMER, payload);
      expect(res.statusCode, `${method} ${suffix}: ${res.body}`).toBe(404);
      expect(missing.statusCode, `${method} ${suffix} (missing)`).toBe(404);
      expect(errorOf(res), `${method} ${suffix}`).toEqual(errorOf(missing));
    }

    const missingCart = await inject('POST', `/api/v1/cart/from-quote-request/${randomUUID()}`, CUSTOMER);
    const cart = await inject('POST', `/api/v1/cart/from-quote-request/${unshared}`, CUSTOMER);
    expect(cart.statusCode).toBe(404);
    expect(errorOf(cart)).toEqual(errorOf(missingCart));

    expect(await versionOf(unshared)).toBe(version);
  });

  // Owner decision of 2026-11-24 (OQ-6, research R-20) — the customer's list
  // is ordered by when the customer received each quote: the share for an
  // operator's quote, the creation for any other.
  it('the customer’s list sorts by the share: a quote shared later sorts above one created later but shared earlier', async () => {
    const em = h.em();
    const own = await account(em, TEST_ORGANIZATION_ID, 'order');
    const ownerId = CUSTOMER_COOKIES[own['b2b_session']!]!.customerAccountId;
    const createdFirst = await inject('POST', '/api/v1/admin/quote-requests', ADMIN, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: ownerId,
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 2 }],
    });
    const createdSecond = await inject('POST', '/api/v1/admin/quote-requests', ADMIN, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: ownerId,
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 3 }],
    });
    const older = (createdFirst.json() as { data: { id: string } }).data.id;
    const younger = (createdSecond.json() as { data: { id: string } }).data.id;
    await em
      .getConnection()
      .execute(`update "quote_requests" set "created_at" = now() - interval '10 days' where "id" = ?`, [older]);
    await em
      .getConnection()
      .execute(`update "quote_requests" set "created_at" = now() - interval '5 days' where "id" = ?`, [younger]);
    // The younger one is shared first, the older one after it.
    await shareQuoteRequestForTest(h.app, younger);
    await em
      .getConnection()
      .execute(`update "quote_requests" set "shared_at" = now() - interval '2 days' where "id" = ?`, [younger]);
    await shareQuoteRequestForTest(h.app, older);
    // A buyer's own submission, created between the two shares, sorts by its creation.
    const submitted = await inject('POST', '/api/v1/quote-requests', own, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const submittedId = (submitted.json() as { data: { id: string } }).data.id;
    await em
      .getConnection()
      .execute(`update "quote_requests" set "created_at" = now() - interval '1 day' where "id" = ?`, [submittedId]);

    const list = await inject('GET', '/api/v1/quote-requests', own);
    expect(list.statusCode, list.body).toBe(200);
    const ids = (list.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(ids).toEqual([older, submittedId, younger]);
  });

  it('the Organization’s Administrator: neither listed nor readable', async () => {
    const em = h.em();
    const administrator = await account(em, TEST_ORGANIZATION_ID, 'org-admin');
    const id = CUSTOMER_COOKIES[administrator['b2b_session']!]!.customerAccountId;
    await assignOrganizationRole(em, id, await predefinedRoleIdOf(em, TEST_ORGANIZATION_ID, 'administrator'));

    const list = await inject('GET', '/api/v1/quote-requests', administrator);
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(ids).toContain(shared);
    expect(ids).not.toContain(unshared);
    expect((await inject('GET', `/api/v1/quote-requests/${unshared}`, administrator)).statusCode).toBe(404);
  });

  it('a roll-up login of the tree: neither listed nor readable', async () => {
    const em = h.em();
    const org = async (name: string) => {
      const created = em.create(Organization, {
        name,
        taxId: `PL192UV${randomUUID().slice(0, 8)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      });
      await em.persistAndFlush(created);
      await bindOrganizationsToFixtureChannelsSql(em, [created.id]);
      return created;
    };
    const head = await org('192 Head');
    const branch = await org('192 Branch');
    head.path = `/${head.id}/`;
    branch.parentId = head.id;
    branch.path = `/${head.id}/${branch.id}/`;
    await em.flush();

    const headLogin = await account(em, head.id, 'rollup', {
      subtreeRollupEnabled: true,
      organizationRoleId: await predefinedRoleIdOf(em, head.id, 'administrator'),
    });
    const headId = CUSTOMER_COOKIES[headLogin['b2b_session']!]!.customerAccountId;
    const branchShared = em.create(QuoteRequest, { organizationId: branch.id, customerAccountId: headId });
    const branchUnshared = em.create(QuoteRequest, {
      organizationId: branch.id,
      customerAccountId: headId,
      status: 'Created from admin',
      sharedWithCustomer: false,
    });
    await em.flush();

    const list = await inject('GET', '/api/v1/quote-requests', headLogin);
    expect(list.statusCode, list.body).toBe(200);
    const ids = (list.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(ids).toContain(branchShared.id);
    expect(ids).not.toContain(branchUnshared.id);
    expect((await inject('GET', `/api/v1/quote-requests/${branchUnshared.id}`, headLogin)).statusCode).toBe(404);
  });

  it('`customers`: the buyer’s own list and the admin customer-detail tab omit it (OQ-4)', async () => {
    const self = await inject('GET', '/api/v1/me/customer/quote-requests', CUSTOMER);
    expect(self.statusCode, self.body).toBe(200);
    const selfIds = (self.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(selfIds).toContain(shared);
    expect(selfIds).not.toContain(unshared);

    const tab = await inject('GET', `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/quote-requests`, ADMIN);
    expect(tab.statusCode, tab.body).toBe(200);
    const tabIds = (tab.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(tabIds).toContain(shared);
    expect(tabIds).not.toContain(unshared);
  });

  it('the operator still reads it, in the list and the detail', async () => {
    const detail = await inject('GET', `/api/v1/admin/quote-requests/${unshared}`, ADMIN);
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { data: { sharedWithCustomer: boolean } }).data.sharedWithCustomer).toBe(false);
    const list = await inject('GET', '/api/v1/admin/quote-requests?pageSize=200&sharing=unshared', ADMIN);
    expect((list.json() as { data: Array<{ id: string }> }).data.map((row) => row.id)).toContain(unshared);
  });

  it('a customer submission and an order’s Clone to quote are visible at once (FR-010)', async () => {
    const submitted = await inject('POST', '/api/v1/quote-requests', CUSTOMER, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const submittedId = (submitted.json() as { data: { id: string } }).data.id;

    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: await systemDefaultSalesChannelId(em),
      status: 'completed',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '20.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '20.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    await em.persistAndFlush(
      em.create(OrderItem, {
        orderId: order.id,
        productId: SEED_PRODUCT_101_ID,
        productSnapshot: { sku: 'SKU-192', name: 'Cloned line', primaryAssetUrl: null },
        quantity: 2,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '20.00',
      }),
    );
    const cloned = await inject('POST', `/api/v1/admin/orders/${order.id}/clone-to-quote`, ADMIN);
    expect(cloned.statusCode, cloned.body).toBe(200);
    const clonedId = (cloned.json() as { data: { quoteRequestId: string } }).data.quoteRequestId;

    const list = await inject('GET', '/api/v1/quote-requests', CUSTOMER);
    const ids = (list.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([submittedId, clonedId]));
    for (const id of [submittedId, clonedId]) {
      expect((await inject('GET', `/api/v1/quote-requests/${id}`, CUSTOMER)).statusCode).toBe(200);
    }
  });
});
