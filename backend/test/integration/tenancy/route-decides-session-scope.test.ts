import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

import { Order, Organization } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import {
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The route decides which session scopes a request (Principle XI).
 *
 * One browser can hold an admin session and a customer session — an operator
 * who is also signed in to the storefront, and every request made while
 * impersonating. An admin route is then the admin's request: it reaches what
 * the admin reaches and its Commands record the admin. A buyer route is the
 * customer's: it is confined to that customer's organization and, during
 * impersonation, records the customer with the impersonating admin beside it.
 *
 * Everything here goes through routes a client uses, with sessions the login
 * routes issued. Each reading is taken in both directions — the admin route
 * and the buyer route, with the same cookies — because a request that reads
 * nothing passes the confined half on its own.
 */

interface CookieJar {
  b2b_session?: string;
  b2b_admin_session?: string;
  admin_shadow_session?: string;
}

function parseCookies(setCookie: string | string[] | undefined): CookieJar {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const jar: CookieJar = {};
  for (const header of headers) {
    const session = /(?:^|; )b2b_session=([^;]+)/.exec(header);
    const shadow = /admin_shadow_session=([^;]+)/.exec(header);
    const admin = /b2b_admin_session=([^;]+)/.exec(header);
    if (session?.[1]) jar.b2b_session = session[1];
    if (shadow?.[1]) jar.admin_shadow_session = shadow[1];
    if (admin?.[1]) jar.b2b_admin_session = admin[1];
  }
  return jar;
}

describe('the route decides which session scopes a request', () => {
  let h: BackendServerHandle;
  let adminSession: string;
  let customerSession: string;
  let foreignOrganizationId: string;
  let ownOrderId: string;
  let foreignOrderId: string;

  const stamp = Date.now();

  const newOrder = (em: EntityManager, organizationId: string): Order =>
    em.create(Order, {
      organizationId,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'new',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'Two sessions',
        street: 'ul. Zakresu 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'Two sessions',
        street: 'ul. Zakresu 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });

  /** The distinct organizations an order list holds. */
  async function listedOrganizations(
    url: string,
    cookies: Record<string, string>,
  ): Promise<{ status: number; organizations: string[]; orderIds: string[] }> {
    const response = await h.app.inject({ method: 'GET', url, cookies });
    const rows = (response.json() as { data?: Array<{ id: string; organizationId?: string }> }).data;
    return {
      status: response.statusCode,
      organizations: [...new Set((rows ?? []).map((row) => row.organizationId ?? ''))].sort(),
      orderIds: (rows ?? []).map((row) => row.id),
    };
  }

  async function auditEntriesAbout(objectId: string, since: Date): Promise<AuditLogEntry[]> {
    return h.em().find(
      AuditLogEntry,
      { objectId, actedAt: { $gte: since } },
      { orderBy: { actedAt: 'asc' } },
    );
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const foreign = em.create(Organization, {
      name: 'Two sessions — the other organization',
      taxId: `PL2S${String(stamp).slice(-8)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Zakresu 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });
    await em.persistAndFlush(foreign);
    foreignOrganizationId = foreign.id;

    const own = newOrder(em, TEST_ORGANIZATION_ID);
    const other = newOrder(em, foreignOrganizationId);
    await em.persistAndFlush([own, other]);
    ownOrderId = own.id;
    foreignOrderId = other.id;

    const adminLogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: 'platform-admin@example.com', password: STUB_CUSTOMER_PASSWORD },
    });
    expect(adminLogin.statusCode).toBe(200);
    adminSession = parseCookies(adminLogin.headers['set-cookie']).b2b_admin_session!;

    const customerLogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'stub-customer@example.com', password: STUB_CUSTOMER_PASSWORD },
    });
    expect(customerLogin.statusCode).toBe(200);
    customerSession = parseCookies(customerLogin.headers['set-cookie']).b2b_session!;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('an admin session and a customer session in one browser', () => {
    const both = (): Record<string, string> => ({
      b2b_admin_session: adminSession,
      b2b_session: customerSession,
    });

    it('lists every organization`s orders on the admin route', async () => {
      const listed = await listedOrganizations('/api/v1/admin/orders?pageSize=100', both());

      expect(listed.status).toBe(200);
      expect(listed.orderIds).toEqual(expect.arrayContaining([ownOrderId, foreignOrderId]));
    });

    it('lists only the customer`s organization on the buyer route', async () => {
      const listed = await listedOrganizations('/api/v1/orders?pageSize=100', both());

      expect(listed.status).toBe(200);
      expect(listed.orderIds).toContain(ownOrderId);
      expect(listed.orderIds).not.toContain(foreignOrderId);
    });

    it('reads the other organization`s order on the admin route and is refused it on the buyer route', async () => {
      const asAdmin = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/orders/${foreignOrderId}`,
        cookies: both(),
      });
      const asCustomer = await h.app.inject({
        method: 'GET',
        url: `/api/v1/orders/${foreignOrderId}`,
        cookies: both(),
      });

      expect(asAdmin.statusCode).toBe(200);
      expect(asCustomer.statusCode).toBe(404);
    });

    it('re-parents an organization as that admin, and the audit names the admin', async () => {
      const since = new Date();

      const reparent = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${foreignOrganizationId}/parent`,
        payload: { parentId: TEST_ORGANIZATION_ID },
        cookies: both(),
      });

      expect(reparent.statusCode, reparent.body).toBe(200);
      const entries = await auditEntriesAbout(foreignOrganizationId, since);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.actorAdminUserId).toBe(TEST_ADMIN_ID);
        expect(entry.impersonatedCustomerAccountId ?? null).toBeNull();
      }

      // Back to a root, so the readings below are over two unrelated
      // organizations again.
      const detach = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${foreignOrganizationId}/parent`,
        payload: { parentId: null },
        cookies: both(),
      });
      expect(detach.statusCode, detach.body).toBe(200);
    });

    it('refuses the admin route to the customer session alone', async () => {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        cookies: { b2b_session: customerSession },
      });

      expect(response.statusCode).toBe(401);
    });

    it('refuses the buyer route to the admin session alone', async () => {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        cookies: { b2b_admin_session: adminSession },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('while impersonating', () => {
    let impersonating: Record<string, string>;

    beforeAll(async () => {
      // Started from a browser that already holds a customer session of its
      // own, which the impersonation session then replaces.
      const start = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
        payload: { customerAccountId: TEST_CUSTOMER_ID },
        cookies: { b2b_admin_session: adminSession, b2b_session: customerSession },
      });
      expect(start.statusCode, start.body).toBe(200);
      const issued = parseCookies(start.headers['set-cookie']);
      expect(issued.b2b_session).toBeDefined();
      expect(issued.admin_shadow_session).toBeDefined();
      impersonating = {
        b2b_admin_session: adminSession,
        b2b_session: issued.b2b_session!,
        admin_shadow_session: issued.admin_shadow_session!,
      };
    });

    it('recorded the admin who started it', async () => {
      const entry = await h.em().findOne(
        AuditLogEntry,
        { action: 'impersonation.start' },
        { orderBy: { actedAt: 'desc' } },
      );

      expect(entry?.actorAdminUserId).toBe(TEST_ADMIN_ID);
      expect(entry?.impersonatedCustomerAccountId).toBe(TEST_CUSTOMER_ID);
    });

    it('keeps the customer`s view on the buyer route', async () => {
      const listed = await listedOrganizations('/api/v1/orders?pageSize=100', impersonating);

      expect(listed.status).toBe(200);
      expect(listed.orderIds).toContain(ownOrderId);
      expect(listed.orderIds).not.toContain(foreignOrderId);
    });

    it('keeps the admin`s reach on the admin route', async () => {
      const listed = await listedOrganizations('/api/v1/admin/orders?pageSize=100', impersonating);

      expect(listed.status).toBe(200);
      expect(listed.orderIds).toEqual(expect.arrayContaining([ownOrderId, foreignOrderId]));
    });

    it('records an admin-route Command as the admin`s own, not as an impersonated one', async () => {
      const since = new Date();

      const reparent = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${foreignOrganizationId}/parent`,
        payload: { parentId: TEST_ORGANIZATION_ID },
        cookies: impersonating,
      });

      expect(reparent.statusCode, reparent.body).toBe(200);
      const entries = await auditEntriesAbout(foreignOrganizationId, since);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.actorAdminUserId).toBe(TEST_ADMIN_ID);
        expect(entry.impersonatedCustomerAccountId ?? null).toBeNull();
      }
    });

    it('ends, restoring the admin session', async () => {
      const before = await h.em().count(AuditLogEntry, { action: 'impersonation.end' });

      const end = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/impersonation/end',
        cookies: impersonating,
      });

      expect(end.statusCode, end.body).toBe(200);
      expect(parseCookies(end.headers['set-cookie']).b2b_admin_session).toBeDefined();
      expect(await h.em().count(AuditLogEntry, { action: 'impersonation.end' })).toBe(before + 1);
      const entry = await h.em().findOne(
        AuditLogEntry,
        { action: 'impersonation.end' },
        { orderBy: { actedAt: 'desc' } },
      );
      expect(entry?.actorAdminUserId).toBe(TEST_ADMIN_ID);
      expect(entry?.impersonatedCustomerAccountId).toBe(TEST_CUSTOMER_ID);
    });
  });
});
