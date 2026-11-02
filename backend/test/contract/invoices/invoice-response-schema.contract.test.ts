import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceDetailSchema, issueInvoiceResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from '../../integration/invoices/helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

/**
 * The invoice routes that claim a published shape answer it, and nothing
 * beside it (Constitution II, issue #128).
 *
 * `POST /api/v1/admin/orders/:id/invoices` claims `issueInvoiceResponseSchema`
 * and `GET /api/v1/admin/invoices/:id` claims `invoiceDetailSchema`; both are
 * parsed here with a **strict copy** of that schema
 * (`test/helpers/strict-schema.ts`), so a field answered with a type the
 * schema refuses, a required field not answered and a key no schema declares
 * all red this file. The invoice is issued with no seller bank details beyond
 * the defaults and a buyer without a second address line — the optional
 * fields a `null` would drift on.
 */
describe('invoice responses parse with the published invoice schemas', () => {
  let h: BackendServerHandle;
  let issued: unknown;
  let invoiceId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const channelId = await ensureSalesChannelId(h.em(), 'inv-schema');
    await setSellerSettings(h);
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, res.body).toBe(201);
    issued = res.json();
    invoiceId = (issued as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /api/v1/admin/orders/:id/invoices — the issuance reply', () => {
    expect(disagreements(deepStrict(issueInvoiceResponseSchema), issued)).toEqual([]);
  });

  it('GET /api/v1/admin/invoices/:id — the admin detail', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${invoiceId}`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: unknown }).data;
    expect(disagreements(deepStrict(invoiceDetailSchema), detail)).toEqual([]);
  });
});
