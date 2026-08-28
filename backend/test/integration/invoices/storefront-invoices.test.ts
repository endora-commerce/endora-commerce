import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { Order, OrderItem } from '../../helpers/package-entities.js';

// Feature 078, D-95: `{channel}` is rendered from the `sales_channels`

// row, so this file's channel has to be one. The per-file code keeps this

// file's numbers distinct in the shared test database, which is what the

// fabricated id used to be for.

let CH: string;

describe('invoices — storefront customer download (US4)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-storefront');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-storefront'],
      'FVSF {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issueFor(orderId: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('lists and downloads the customer’s own order invoices', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const invoiceId = await issueFor(orderId);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoices`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ id: string; number: string; downloadHref: string }> };
    expect(body.data.some((i) => i.id === invoiceId)).toBe(true);

    const pdf = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/invoices/${invoiceId}/pdf`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('denies access to another party’s order (404)', async () => {
    // Order owned by a different customer + organization.
    const order = h.em().create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: CH,
      status: 'paid',
      paymentStatus: 'paid',
      deliveryAddress: { recipientName: 'X', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'X', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '0.00',
      total: '123.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await h.em().persistAndFlush(order);
    h.em().create(OrderItem, {
      orderId: order.id,
      productId: randomUUID(),
      productSnapshot: { sku: 'S', name: 'N', primaryAssetUrl: null },
      quantity: 1,
      unitPrice: '100.00',
      taxRate: '0.2300',
      lineTotal: '100.00',
    });
    await h.em().flush();
    await issueFor(order.id);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}/invoices`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires a customer session', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/invoices` });
    expect([401, 403]).toContain(res.statusCode);
  });
});
