import { asValue, type Resolver } from 'awilix';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequestItem } from '../../helpers/package-entities.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { addOrganizationChannels } from '../../helpers/sales-channel-access.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 146, Phase 5 (T027) — the reference price is captured, server-side,
 * at every customer create (FR-001; US1 #1, #4b).
 *
 * The buyer pays 120.00 on channel A and 130.00 on the system-default channel
 * (the same pricing the probe's contract test sets up). A request raised on A
 * stores 120.00; a resubmit is its own request and resolves on its own channel.
 * A pricing failure does not block the write (spec Assumptions). A reference
 * the client sends is never trusted: the create schema is not strict and strips
 * it (M4), the patch schema already is and refuses it (T6).
 */
describe('146 — reference price captured at customer submission [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const CHANNEL_A = 'rfq146_ref_a';

  const create = (payload: Record<string, unknown>, channelCode?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      ...(channelCode ? { headers: { 'x-sales-channel': channelCode } } : {}),
      payload,
    });

  const linesOf = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: { createdAt: 'asc' } });
  };

  const idOf = (res: { json: () => unknown }) => (res.json() as { data: { id: string } }).data.id;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // `setupBackendServer` has just emptied the price tables (`price_lists` is
    // a seeded table, truncated with cascade), so this block adds its lists
    // and wipes nothing (`check-shared-table-wipes`).
    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await lists.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '130.0000' }],
    });

    const channelA = await ensureSalesChannel(em, CHANNEL_A);
    // Feature 154 — the buyer shops on channel A.
    await addOrganizationChannels(h, TEST_ORGANIZATION_ID, [CHANNEL_A]);
    // A quote line is refused on a channel that does not publish its product (#259).
    await em
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) ` +
          `on conflict (sales_channel_id, product_id) do nothing`,
        [channelA.id, SEED_PRODUCT_101_ID],
      );
    // Feature 160 — channel A's price is a book for everyone bound to channel A
    // (the catalogue tier there), where it was a channel-rule list.
    await seedPriceBookSql(em, {
      name: 'Feature 146 reference channel A',
      audience: 'everyone',
      channelIds: [channelA.id],
      rows: [{ productId: SEED_PRODUCT_101_ID, fixed: '120.0000' }],
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a request raised on channel A stores 120.00 PLN and a capture timestamp (US1 #1, #4b)', async () => {
    const before = Date.now();
    const res = await create(
      { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 100 }] },
      CHANNEL_A,
    );
    expect(res.statusCode, res.body).toBe(201);
    const [line] = await linesOf(idOf(res));
    expect(line?.referenceUnitPrice).toBe('120.00');
    expect(line?.referenceCurrency).toBe('PLN');
    expect(line?.referenceCapturedAt).toBeInstanceOf(Date);
    expect(line!.referenceCapturedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The proposal is the customer's, untouched by the reference.
    expect(line?.desiredUnitPrice).toBe('100.00');
  });

  it('a request on the system-default channel stores that channel’s price (130.00)', async () => {
    const res = await create({ items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] });
    expect(res.statusCode, res.body).toBe(201);
    const [line] = await linesOf(idOf(res));
    expect(line?.referenceUnitPrice).toBe('130.00');
  });

  it('a resubmit resolves on its own channel, not the source request’s', async () => {
    const source = await create({ items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] }, CHANNEL_A);
    expect(source.statusCode, source.body).toBe(201);
    const resubmit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${idOf(source)}/resubmit`,
      cookies: customer,
      payload: {},
    });
    expect(resubmit.statusCode, resubmit.body).toBe(201);
    const [line] = await linesOf(idOf(resubmit));
    expect(line?.referenceUnitPrice).toBe('130.00');
    expect(line?.referenceCurrency).toBe('PLN');
    expect(line?.desiredUnitPrice ?? null).toBeNull();
  });

  it('quick order → quote request takes the same server-side reference (FR-001)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      cookies: customer,
      payload: { target: 'quote_request', items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
    const [line] = await linesOf(quoteRequestId);
    expect(line?.referenceUnitPrice).toBe('130.00');
    expect(line?.referenceCurrency).toBe('PLN');
    expect(line?.desiredUnitPrice ?? null).toBeNull();
  });

  it('a pricing failure still creates the request, with no reference', async () => {
    const original = h.container.registrations['buyerLinePricePort'] as Resolver<unknown>;
    let asked = 0;
    h.container.register({
      buyerLinePricePort: asValue({
        resolveForBuyer: async () => {
          asked += 1;
          throw new Error('pricing read failed (test)');
        },
      }),
    });
    try {
      const res = await create(
        { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, desiredUnitPrice: 90 }] },
        CHANNEL_A,
      );
      expect(res.statusCode, res.body).toBe(201);
      // The failing port was the one asked — otherwise this proves nothing.
      expect(asked).toBe(1);
      const [line] = await linesOf(idOf(res));
      expect(line?.referenceUnitPrice ?? null).toBeNull();
      expect(line?.referenceCurrency ?? null).toBeNull();
      expect(line?.referenceCapturedAt ?? null).toBeNull();
      expect(line?.desiredUnitPrice).toBe('90.00');
    } finally {
      h.container.register('buyerLinePricePort', original);
    }
  });

  it('ignores a reference sent in a create body — per line and at the top level (M4, T6)', async () => {
    const res = await create(
      {
        lineReferencePrices: [{ amount: '1.00', currency: 'PLN' }],
        referencePrice: { amount: '1.00', currency: 'PLN' },
        items: [
          {
            productId: SEED_PRODUCT_101_ID,
            quantity: 1,
            referenceUnitPrice: '1.00',
            referenceCurrency: 'EUR',
            referencePrice: { amount: '1.00', currency: 'EUR' },
            lineReferencePrices: [{ amount: '1.00', currency: 'EUR' }],
          },
        ],
      },
      CHANNEL_A,
    );
    expect(res.statusCode, res.body).toBe(201);
    const [line] = await linesOf(idOf(res));
    expect(line?.referenceUnitPrice).toBe('120.00');
    expect(line?.referenceCurrency).toBe('PLN');
  });

  it('refuses a top-level reference in a draft-edit body and never takes a per-line one (T6, M4)', async () => {
    const created = await create({ items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] }, CHANNEL_A);
    expect(created.statusCode, created.body).toBe(201);
    const id = idOf(created);
    const patch = (payload: Record<string, unknown>) =>
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${id}`,
        cookies: customer,
        headers: { 'x-sales-channel': CHANNEL_A },
        payload,
      });

    // The patch schema is strict at the body level (unchanged by this feature):
    // a top-level key is refused and nothing is written.
    const topLevel = await patch({
      lineReferencePrices: [{ amount: '1.00', currency: 'PLN' }],
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    });
    expect(topLevel.statusCode, topLevel.body).toBe(400);
    const [kept] = await linesOf(id);
    expect(kept?.referenceUnitPrice).toBe('120.00');

    // Its line schema is the create line schema, which is not strict (M4): a
    // per-line key is stripped, so the edit goes through and the value sent is
    // never the stored reference.
    const perLine = await patch({
      items: [
        { productId: SEED_PRODUCT_101_ID, quantity: 1, referenceUnitPrice: '1.00', referenceCurrency: 'EUR' },
      ],
    });
    expect(perLine.statusCode, perLine.body).toBe(200);
    const [line] = await linesOf(id);
    expect(line?.referenceUnitPrice ?? null).not.toBe('1.00');
    expect(line?.referenceCurrency ?? null).not.toBe('EUR');
  });
});
