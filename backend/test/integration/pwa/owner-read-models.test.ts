import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderReadPort, QuoteRequestReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * `specs/149-pwa-order-status-push/` T004 — the two additive facts `pwa`'s
 * status push reads off its owners' published read models.
 *
 * It lives with the consumer rather than beside either owner because it exists
 * for this feature: `orders` publishes `findStatusDefinition` so a push can name
 * the status the way the shop labels it, and `quote_requests` publishes
 * `salesChannelId` so a quote push is sent on — and in the language of — the
 * channel the request was raised on. Since `specs/179-rfq-and-customer-notifications/`
 * WP-10 the quote push is `quote_requests`' own (through `customerPushPort`);
 * the field stays published and these cases still hold it.
 */
describe('149 — owner read models consumed by the status push [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  let quoteId: string;

  const orders = () => h.container.resolve<OrderReadPort>('orderReadPort');
  const quotes = () => h.container.resolve<QuoteRequestReadPort>('quoteRequestReadPort');

  beforeAll(async () => {
    h = await setupBackendServer();
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: customer,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(add.statusCode, add.body).toBe(200);
    const convert = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      cookies: customer,
      payload: {},
    });
    expect(convert.statusCode, convert.body).toBe(200);
    quoteId = (convert.json() as { data: { quoteRequestId: string } }).data.quoteRequestId;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers a seeded status definition by code, with its per-language names', async () => {
    const definition = await orders().findStatusDefinition('shipment_sent');
    expect(definition).not.toBeNull();
    expect(definition!.code).toBe('shipment_sent');
    expect(typeof definition!.defaultName).toBe('string');
    expect(definition!.defaultName.length).toBeGreaterThan(0);
    expect(typeof definition!.name).toBe('object');
  });

  it('answers null for a status code nobody configured', async () => {
    expect(await orders().findStatusDefinition('no_such_status_149')).toBeNull();
  });

  it('carries the channel a quote request was raised on', async () => {
    const record = await quotes().findById(quoteId);
    expect(record).not.toBeNull();
    expect(record!.salesChannelId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('carries null for a quote request raised outside a channel', async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "sales_channel_id" = null where "id" = ?`, [quoteId]);
    const record = await quotes().findById(quoteId);
    expect(record).not.toBeNull();
    expect(record!.salesChannelId).toBeNull();
  });
});
