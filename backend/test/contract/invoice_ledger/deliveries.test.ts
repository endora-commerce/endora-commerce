import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  invoiceLedgerDeliveryListItemSchema,
} from '@endora-commerce/contracts';
import { AdminRole, AdminUser, InvoiceLedgerDelivery, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { ScriptedLedgerFixtureClient } from '../../helpers/ledger-fixture-client.js';
import { ADMIN_COOKIES, OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedInvoiceableOrder } from '../../integration/invoices/helpers.js';
import { ADMIN, issueInvoice, waitForDelivery } from '../../integration/invoice_ledger/helpers.js';
import {
  prepareLedgerFixtureVatCopy,
  processFixtureDelivery,
} from '../../integration/invoice_ledger/fixture-vendor.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';

const LIST_URL = '/api/v1/admin/invoice-ledger/deliveries';

/**
 * Feature 134 / D-256 — this file is the free module's own admin API contract,
 * so it is **re-pointed** at `ledger_vendor_fixture` rather than moved into a
 * vendor's host directory. It drove `infakt` only because feature 119 built the
 * ledger and that vendor together, and nothing it asserts is a vendor's: the
 * list schema, the channel and status filters, the org-scoped read and the
 * retry's 404 are all `invoice_ledger`'s.
 *
 * The two error fixtures keep their *shapes* and lose their vendor. `UNAVAILABLE`
 * is a sentence the fixture vendor authors, which the ledger's shape floor lets
 * through unchanged; `RAW_VENDOR_BODY` is a serialised body, which the floor
 * refuses. That is D-256's verdict stated as a pair rather than as a vocabulary:
 * *"the floor's promise is 'no dump reaches the stored field', not 'only these
 * sentences do'"*.
 */
const UNAVAILABLE = 'The fixture ledger vendor is temporarily unavailable.';
const RAW_VENDOR_BODY = '{"invoice":{"errors":["the number is taken"]}}';

function listItems(body: unknown): unknown[] {
  const parsed = body as { data?: unknown };
  return Array.isArray(parsed.data) ? parsed.data : [];
}

describe('invoice_ledger — deliveries list and retry [contract]', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const ledgerFixtureHttp = new ScriptedLedgerFixtureClient();
  let scopedCookie = '';

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer({
      deployment: 'example',
      moduleOverrides: { ledgerFixtureHttp },
    });
    channelId = await prepareLedgerFixtureVatCopy(h, 'il-deliveries', 'FVD {seq}/{YYYY}');

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

  it('lists deliveries with filters and a mapped last_error, never a vendor raw body', async () => {
    ledgerFixtureHttp.next = { ok: false, message: UNAVAILABLE, transient: true };
    const { orderId: failedOrderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const failedInvoice = await issueInvoice(h, failedOrderId, 'invoice');
    const failed = await waitForDelivery(h, failedInvoice.id);
    await processFixtureDelivery(h, failed.id);

    ledgerFixtureHttp.next = null;
    const { orderId: okOrderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const okInvoice = await issueInvoice(h, okOrderId, 'invoice');
    const ok = await waitForDelivery(h, okInvoice.id);
    await processFixtureDelivery(h, ok.id);

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

    await withSystemScope('plant a raw vendor body on last_error', async () => {
      const em = h.em().fork();
      const row = await em.findOneOrFail(InvoiceLedgerDelivery, { id: failed.id });
      row.lastError = RAW_VENDOR_BODY;
      await em.flush();
    });
    const afterPlant = await h.app.inject({ method: 'GET', url: LIST_URL, ...ADMIN });
    const planted = listItems(afterPlant.json()).find(
      (row) => (row as { id: string }).id === failed.id,
    ) as { lastError: string | null };
    expect(planted.lastError).toBeTruthy();
    expect(planted.lastError).not.toContain(RAW_VENDOR_BODY);
    expect(planted.lastError).not.toMatch(/[{<]|the number is taken/);

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
    ledgerFixtureHttp.next = { ok: false, message: UNAVAILABLE, transient: true };
    const { orderId: homeOrderId } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: channelId,
      organizationId: TEST_ORGANIZATION_ID,
    });
    const homeInvoice = await issueInvoice(h, homeOrderId, 'invoice');
    const home = await waitForDelivery(h, homeInvoice.id);
    await processFixtureDelivery(h, home.id);

    const { orderId: foreignOrderId } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: channelId,
      organizationId: OTHER_TEST_ORGANIZATION_ID,
    });
    const foreignInvoice = await issueInvoice(h, foreignOrderId, 'invoice');
    const foreign = await waitForDelivery(h, foreignInvoice.id);
    await processFixtureDelivery(h, foreign.id);

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
