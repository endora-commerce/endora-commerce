import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { GS_COOKIES, GS_SALES_REP_ID, ensureSalesRep } from '../../helpers/admin-search-fixtures.js';
import { OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN_COOKIE, setSellerSettings } from '../invoices/helpers.js';
import { placePaidOrder } from './fixtures.js';

/**
 * `specs/182-related-payers/` T040 (FR-080, RP-8, RP-13, SC-010) — in the Admin UI the invoice
 * of a paid order belongs to the payer: the organization filter lists it under Y and not under
 * X, and a scoped administrator reaches it through Y. The buyer still downloads it from its
 * own order (RP-8's read-only download).
 */
const X = TEST_ORGANIZATION_ID;

describe('related payers — the invoice of a paid order is the payer\'s', () => {
  let h: BackendServerHandle;
  let paid: Awaited<ReturnType<typeof placePaidOrder>>;
  let invoiceId: string;
  let cleanupRep: (() => Promise<void>) | undefined;
  const OTHER_REP = randomUUID();

  const list = (query: string, cookies: Record<string, string> = ADMIN_COOKIE) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/invoices?${query}`, cookies });
  const ids = (res: { json(): { data: Array<{ id: string }> } }) => res.json().data.map((i) => i.id);

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    paid = await placePaidOrder(h);
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${paid.orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    invoiceId = issued.json().data.id;
  }, 120_000);

  afterAll(async () => {
    await h?.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP]);
    await cleanupRep?.();
    await teardownBackendServer(h);
  });

  it('the organization filter lists it under the payer, not under the buyer', async () => {
    const underY = await list(`filter[organizationId]=${paid.payerId}`);
    expect(underY.statusCode, underY.body).toBe(200);
    expect(ids(underY)).toContain(invoiceId);
    const underX = await list(`filter[organizationId]=${X}`);
    expect(underX.statusCode, underX.body).toBe(200);
    expect(ids(underX)).not.toContain(invoiceId);
  });

  it('a scoped administrator reaches it through the payer, not through the buyer', async () => {
    // X is governed by another representative; Y is in the representative's reach.
    await withSystemScope('test seed: X is another representative\'s', async () => {
      const em = h.em();
      await em.persist(em.create(OrganizationSalesRepAssignment, { organizationId: X, adminUserId: OTHER_REP })).flush();
    });
    cleanupRep = await ensureSalesRep(h, [paid.payerId], ['invoices:read']);
    expect(ids(await list('limit=200', GS_COOKIES.salesRep))).toContain(invoiceId);
    await h.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id in (?, ?)', [OTHER_REP, GS_SALES_REP_ID]);
    await withSystemScope('test seed: Y is another representative\'s, X in reach', async () => {
      const em = h.em();
      await em.persist(em.create(OrganizationSalesRepAssignment, { organizationId: paid.payerId, adminUserId: OTHER_REP })).flush();
    });
    expect(ids(await list('limit=200', GS_COOKIES.salesRep))).not.toContain(invoiceId);
  });

  it('RP-8: the buyer keeps its read-only download from its own order', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${paid.orderId}/invoice`, cookies: { b2b_session: 'stub-customer-session' } });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  });
});
