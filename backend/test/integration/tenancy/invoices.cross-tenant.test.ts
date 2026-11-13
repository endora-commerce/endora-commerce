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
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import {
  ERP_SALE_DOCUMENT_WRITE_PORT,
  type AdminInvoiceListResponse,
  type ErpSaleDocumentWritePort,
} from '@endora-commerce/contracts';

/**
 * Feature 050 US1 — invoices are transitively scoped through their Order's org.
 * A sales-rep assigned to Org A cannot list, view, or issue invoices for Org B.
 */
describe('Invoices — cross-tenant scoping (feature 050 US1)', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const OTHER_REP_ID = randomUUID();
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
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: orgAId, adminUserId: rep.id }),
        // #305 — Org B is another representative's: an unassigned organization
        // is in every representative's reach.
        em.create(OrganizationSalesRepAssignment, { organizationId: orgBId, adminUserId: OTHER_REP_ID }),
      ]);
      repCookie = `stub-sales-rep-050-inv-${Date.now()}`;
      ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
    });

    invoiceAId = await issueFor(orgAId);
    invoiceBId = await issueFor(orgBId);
  });

  afterAll(async () => {
    await h.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP_ID]);
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

  // Issue #1120 — the scope is applied after the read, so a page is filled from
  // the rows the caller may see: an out-of-scope row neither shortens a page,
  // nor ends the walk early, nor names its id in a cursor.
  it('scoped sales-rep pages by cursor over the assigned org only, a full page each time', async () => {
    const day = `2092-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
    // An imported document scopes on its own `organizationId`, which is a key
    // into `organizations`: these two are real rows, assigned as A and B are.
    const { mineId, theirsId } = await withSystemScope('test seed', async () => {
      const em = h.em();
      const mine = await seedAdHocOrganization(em, 'Issue 1120 mine');
      const theirs = await seedAdHocOrganization(em, 'Issue 1120 theirs');
      const rep = await em.findOneOrFail(AdminUser, { id: ADMIN_COOKIES[repCookie]!.adminUserId });
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: mine.id, adminUserId: rep.id }),
        em.create(OrganizationSalesRepAssignment, { organizationId: theirs.id, adminUserId: OTHER_REP_ID }),
      ]);
      return { mineId: mine.id, theirsId: theirs.id };
    });
    const port = h.container.resolve<ErpSaleDocumentWritePort>(ERP_SALE_DOCUMENT_WRITE_PORT);
    const orgARows: string[] = [];
    // Newest first: B, A, B, B, A, B — every A row has a B row in front of it.
    const owners = [theirsId, mineId, theirsId, theirsId, mineId, theirsId];
    for (const [index, organizationId] of owners.entries()) {
      const tag = randomUUID().slice(0, 8);
      const imported = await port.upsertImportedDocument({
        organizationId,
        externalDocumentRef: { system: 'comarch_xl', externalId: `xl-1120-t-${tag}`, documentKind: 'wz' },
        kind: 'wz',
        number: `WZ/1120/T/${index}/${tag}`,
        currency: 'PLN',
        issuedAt: `${day}T${String(20 - index).padStart(2, '0')}:00:00.000Z`,
        grossTotal: '10.00',
      });
      if (organizationId === mineId) orgARows.push(imported.invoiceId);
    }
    const window = `filter[issuedFrom]=${day}T00:00:00.000Z&filter[issuedTo]=${day}T23:59:59.999Z`;

    const pages: AdminInvoiceListResponse[] = [];
    let cursor: string | null = null;
    do {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/invoices?limit=1&${window}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        cookies: { b2b_session: repCookie },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as AdminInvoiceListResponse;
      pages.push(body);
      cursor = body.pagination.cursor;
      expect(pages.length).toBeLessThan(10);
    } while (cursor !== null);

    expect(pages.map((p) => p.data.map((row) => row.id))).toEqual([[orgARows[0]], [orgARows[1]]]);
    expect(pages.map((p) => p.pagination.hasMore)).toEqual([true, false]);
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
