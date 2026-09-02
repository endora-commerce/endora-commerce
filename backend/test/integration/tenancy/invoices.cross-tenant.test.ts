import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedInvoiceableOrder, setSellerSettings } from '../../integration/invoices/helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

/**
 * Feature 050 US1 — invoices are transitively scoped through their Order's org.
 * A sales-rep assigned to Org A cannot list, view, or issue invoices for Org B.
 */
describe('Invoices — cross-tenant scoping (feature 050 US1)', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  // Feature 078, D-95: `{channel}` is rendered from the `sales_channels` row, so
  // this file's channel has to be one. Both organizations issue on it — the
  // point of the file is that the *organization* scopes the invoice, not the
  // channel.
  let CH: string;
  let invoiceAId: string;
  let invoiceBId: string;

  const issueFor = async (orgId: string): Promise<string> => {
    const { orderId } = await withSystemScope('test seed order', () =>
      seedInvoiceableOrder(h.em(), { salesChannelId: CH, organizationId: orgId }),
    );
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'tenancy-invoices');
    await setSellerSettings(h);

    await withSystemScope('test seed', async () => {
      const em = h.em();
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: ['invoices:read', 'invoices:write'],
        });
      } else {
        for (const p of ['invoices:read', 'invoices:write']) {
          if (!role.permissions.includes(p)) role.permissions = [...role.permissions, p];
        }
      }
      await em.persistAndFlush(role);
      const rep = em.create(AdminUser, {
        email: `sales-rep-050-inv-${Date.now()}@i.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '050',
        lastName: 'Rep',
      });
      await em.persistAndFlush(rep);
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, { organizationId: orgAId, adminUserId: rep.id }),
      );
      repCookie = `stub-sales-rep-050-inv-${Date.now()}`;
      ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
    });

    invoiceAId = await issueFor(orgAId);
    invoiceBId = await issueFor(orgBId);
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  it('scoped sales-rep list contains only assigned-org invoices', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices',
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(ids).toContain(invoiceAId);
    expect(ids).not.toContain(invoiceBId);
  });

  it('scoped sales-rep cannot view an unassigned org invoice (404)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${invoiceBId}`,
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('scoped sales-rep can view an assigned org invoice', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${invoiceAId}`,
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('platform admin sees both orgs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(ids).toContain(invoiceAId);
    expect(ids).toContain(invoiceBId);
  });
});
