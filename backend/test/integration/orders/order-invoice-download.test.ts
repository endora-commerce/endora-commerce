import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  seedInvoiceableOrder,
  setSellerSettings,
} from '../invoices/helpers.js';

/**
 * Issue #1341 — `GET /api/v1/orders/:id/invoice`, the buyer's single-document
 * download that `orders` registers.
 *
 * It took the order's newest document whatever its kind, so a proforma issued
 * after the invoice was served in its place, and it answered with a stub PDF
 * (number and total) because `invoices` never sets `pdfAssetId`. The route
 * now picks the order's newest ready **invoice** and renders it from the
 * invoice template, the same bytes path as the admin and per-invoice routes.
 */

/** The stub's text operator — present in `renderMinimal` output only. */
const STUB_MARKER = '(Total: ';

describe('GET /api/v1/orders/:id/invoice — the issued invoice, from its template (issue #1341)', () => {
  let h: BackendServerHandle;
  let channel: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    channel = await ensureSalesChannelId(h.em(), 'inv-legacy-download');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-legacy-download'],
      'FVLD {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issue(orderId: string, kind: 'invoice' | 'proforma'): Promise<{ id: string; number: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; number: string } }).data;
  }

  it('serves the invoice, not a proforma issued after it', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channel });
    const invoice = await issue(orderId, 'invoice');
    const proforma = await issue(orderId, 'proforma');

    // Precondition: the proforma is the order's newest document, which is
    // exactly what the route used to serve.
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoices`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json() as { data: Array<{ id: string }> }).data[0]?.id).toBe(proforma.id);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoice`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(invoice.number.replace(/[/\\]/g, '-'));
    expect(res.headers['content-disposition']).not.toContain(proforma.number.replace(/[/\\]/g, '-'));
    expect(res.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders the invoice from its template rather than the stub', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channel });
    const invoice = await issue(orderId, 'invoice');

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoice`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.toString('latin1')).not.toContain(STUB_MARKER);

    // The per-invoice route renders through the template facility; the two
    // answers are the same document, so they are the same size.
    const rendered = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoices/${invoice.id}/pdf`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(rendered.statusCode, rendered.body).toBe(200);
    expect(res.rawPayload.length).toBe(rendered.rawPayload.length);
  });

  it('answers INVOICE_NOT_READY for an order that has only a proforma', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channel });
    await issue(orderId, 'proforma');

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoice`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.INVOICE_NOT_READY);
  });
});
