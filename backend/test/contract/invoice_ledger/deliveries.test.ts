import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  invoiceLedgerDeliveryListItemSchema,
} from '@endora-commerce/contracts';
import { AdminRole, AdminUser, InvoiceLedgerDelivery, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { ScriptedInfaktClient } from '../../helpers/scripted-infakt-client.js';
import { ADMIN_COOKIES, OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedInvoiceableOrder } from '../../integration/invoices/helpers.js';
import {
  ADMIN,
  issueInvoice,
  prepareInfaktVatCopy,
  waitForDelivery,
} from '../../integration/invoice_ledger/helpers.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';

const LIST_URL = '/api/v1/admin/invoice-ledger/deliveries';
const UNAVAILABLE = 'Infakt is unavailable. Try again later.';
const RAW_INFAKT_BODY = '{"invoice":{"errors":["numer jest zajety"]}}';

function listItems(body: unknown): unknown[] {
  const parsed = body as { data?: unknown };
  return Array.isArray(parsed.data) ? parsed.data : [];
}

describe('invoice_ledger — deliveries list and retry [contract]', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const infaktHttp = new ScriptedInfaktClient();
  let scopedCookie = '';

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer({ infaktHttp });
    channelId = await prepareInfaktVatCopy(h, 'il-deliveries', 'FVD {seq}/{YYYY}');

    await withSystemScope('seed scoped ledger reader', async () => {
      const em = h.em();
      // The second tenant needs a real row now that a delivery's
      // `organization_id` is a foreign key into `organizations`. The case below
      // seeds an order for it, and `orders` declares no such key, so the gap
      // was invisible until the ledger row grew its own tenant column.
      await seedOtherTestOrganization(em);
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: ['invoice_ledger:read', 'invoice_ledger:write'],
        });
      } else {
        for (const p of ['invoice_ledger:read', 'invoice_ledger:write']) {
          if (!role.permissions.includes(p)) role.permissions = [...role.permissions, p];
        }
      }
      await em.persistAndFlush(role);
      const rep = em.create(AdminUser, {
        email: `sales-rep-119-del-${Date.now()}@i.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '119',
        lastName: 'Ledger',
      });
      await em.persistAndFlush(rep);
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, {
          organizationId: TEST_ORGANIZATION_ID,
          adminUserId: rep.id,
        }),
      );
      scopedCookie = `stub-sales-rep-119-del-${Date.now()}`;
      ADMIN_COOKIES[scopedCookie] = { adminUserId: rep.id };
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists deliveries with filters and a mapped last_error, never an Infakt raw body', async () => {
    infaktHttp.next = { ok: false, message: UNAVAILABLE };
    const { orderId: failedOrderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const failedInvoice = await issueInvoice(h, failedOrderId, 'invoice');
    const failed = await waitForDelivery(h, failedInvoice.id);
    await h.infakt.processDelivery(failed.id);

    infaktHttp.next = { ok: true };
    const { orderId: okOrderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const okInvoice = await issueInvoice(h, okOrderId, 'invoice');
    const ok = await waitForDelivery(h, okInvoice.id);
    await h.infakt.processDelivery(ok.id);

    const listed = await h.app.inject({ method: 'GET', url: LIST_URL, ...ADMIN });
    expect(listed.statusCode, listed.body).toBe(200);
    const all = listItems(listed.json());
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const item of all) {
      expect(invoiceLedgerDeliveryListItemSchema.safeParse(item).success, JSON.stringify(item)).toBe(
        true,
      );
    }

    const failedRow = all.find((row) => (row as { invoiceId: string }).invoiceId === failedInvoice.id) as {
      id: string;
      invoiceNumber: string | null;
      status: string;
      lastError: string | null;
    };
    expect(failedRow).toMatchObject({
      id: failed.id,
      status: 'failed',
      lastError: UNAVAILABLE,
    });
    expect(failedRow.invoiceNumber).toBe(failedInvoice.number);
    expect(failedRow.lastError).not.toMatch(/[{<]|errors"/);

    await withSystemScope('plant raw Infakt body on last_error', async () => {
      const em = h.em().fork();
      const row = await em.findOneOrFail(InvoiceLedgerDelivery, { id: failed.id });
      row.lastError = RAW_INFAKT_BODY;
      await em.flush();
    });
    const afterPlant = await h.app.inject({ method: 'GET', url: LIST_URL, ...ADMIN });
    const planted = listItems(afterPlant.json()).find(
      (row) => (row as { id: string }).id === failed.id,
    ) as { lastError: string | null };
    expect(planted.lastError).toBeTruthy();
    expect(planted.lastError).not.toContain(RAW_INFAKT_BODY);
    expect(planted.lastError).not.toMatch(/[{<]|numer jest zajety/);

    const filtered = await h.app.inject({
      method: 'GET',
      url: `${LIST_URL}?status=failed&invoiceId=${failedInvoice.id}`,
      ...ADMIN,
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    const filteredItems = listItems(filtered.json()) as Array<{ invoiceId: string; status: string }>;
    expect(filteredItems).toHaveLength(1);
    expect(filteredItems[0]).toMatchObject({ invoiceId: failedInvoice.id, status: 'failed' });

    const byChannel = await h.app.inject({
      method: 'GET',
      url: `${LIST_URL}?salesChannelId=${channelId}&status=succeeded`,
      ...ADMIN,
    });
    expect(byChannel.statusCode, byChannel.body).toBe(200);
    const succeeded = listItems(byChannel.json()) as Array<{ invoiceId: string; status: string }>;
    expect(succeeded.some((row) => row.invoiceId === okInvoice.id)).toBe(true);
    expect(succeeded.every((row) => row.status === 'succeeded')).toBe(true);
  });

  it('returns 404 on retry when the admin cannot list that delivery', async () => {
    infaktHttp.next = { ok: false, message: UNAVAILABLE };
    const { orderId: homeOrderId } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: channelId,
      organizationId: TEST_ORGANIZATION_ID,
    });
    const homeInvoice = await issueInvoice(h, homeOrderId, 'invoice');
    const home = await waitForDelivery(h, homeInvoice.id);
    await h.infakt.processDelivery(home.id);

    const { orderId: foreignOrderId } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: channelId,
      organizationId: OTHER_TEST_ORGANIZATION_ID,
    });
    const foreignInvoice = await issueInvoice(h, foreignOrderId, 'invoice');
    const foreign = await waitForDelivery(h, foreignInvoice.id);
    await h.infakt.processDelivery(foreign.id);

    const scoped = { cookies: { b2b_session: scopedCookie } };
    const scopedList = await h.app.inject({ method: 'GET', url: LIST_URL, ...scoped });
    expect(scopedList.statusCode, scopedList.body).toBe(200);
    const visibleIds = listItems(scopedList.json()).map((row) => (row as { id: string }).id);
    expect(visibleIds).toContain(home.id);
    expect(visibleIds).not.toContain(foreign.id);

    const scopedRetry = await h.app.inject({
      method: 'POST',
      url: `${LIST_URL}/${foreign.id}/retry`,
      ...scoped,
    });
    expect(scopedRetry.statusCode, scopedRetry.body).toBe(404);
    expect((scopedRetry.json() as { error?: { code?: string } }).error?.code).toBe(ERROR_CODES.NOT_FOUND);

    const missing = await h.app.inject({
      method: 'POST',
      url: `${LIST_URL}/${randomUUID()}/retry`,
      ...scoped,
    });
    expect(missing.statusCode, missing.body).toBe(404);

    const homeRetry = await h.app.inject({
      method: 'POST',
      url: `${LIST_URL}/${home.id}/retry`,
      ...scoped,
    });
    expect(homeRetry.statusCode, homeRetry.body).toBe(200);
    expect((homeRetry.json() as { data: { status: string } }).data.status).toBe('queued');
  });
});
