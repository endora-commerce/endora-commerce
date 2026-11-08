import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  seedProbeChannelAssortment,
  type ChannelAssortment,
} from '../../helpers/channel-assortment-fixture.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #303 — a quote request's lines carry the currency of the sales channel
 * the request was raised on, not a `'PLN'` literal.
 *
 * Architect ruling 7 (2026-11-07): the currency is decided **once**, at create
 * (the customer's create and the operator's `createOnBehalf`), from the
 * raised-on channel's default currency; every later line write — the buyer's
 * draft edit, the operator's modify, a resubmit — copies the currency the
 * request already has, so a request never mixes currencies. A list summary of a
 * request with no lines speaks the channel's currency; `PLN` is left only for a
 * legacy request recorded on no channel. Existing rows are not backfilled.
 *
 * The probe channel's only currency is EUR, so every `'PLN'` this file could
 * read back is the defect, not a coincidence of the seed.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

interface Created {
  id: string;
  version: number;
}

describe('quote request lines — the raised-on channel decides their currency (#303)', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'rfq-currency', { currency: 'EUR' });
  }, 60_000);

  afterAll(async () => {
    // `quote_requests_sales_channel_fk` is `on delete restrict` — release the
    // probe channel, as `line-channel-assortment.test.ts` does.
    await h
      .em()
      .getConnection()
      .execute('update "quote_requests" set "sales_channel_id" = null where "sales_channel_id" = ?', [
        probe.id,
      ]);
    await teardownBackendServer(h);
  });

  async function lineCurrencies(rfqId: string): Promise<string[]> {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ line_currency: string }>>(
        'select "line_currency" from "quote_request_items" where "quote_request_id" = ? order by "position"',
        [rfqId],
      );
    return rows.map((r) => r.line_currency);
  }

  async function createAsBuyer(): Promise<Created> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.code },
      payload: { items: [{ productId: probe.soldHereId, quantity: 2, desiredUnitPrice: 10 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: Created }).data;
  }

  async function createOnBehalf(): Promise<Created> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: probe.id,
        items: [{ productId: probe.soldHereId, quantity: 3, agreedUnitPrice: 12.5 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: Created }).data;
  }

  it('stamps the channel currency on a customer create', async () => {
    const created = await createAsBuyer();
    expect(await lineCurrencies(created.id)).toEqual(['EUR']);
  });

  it('keeps it on the buyer’s draft edit', async () => {
    const created = await createAsBuyer();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.code, 'if-match': `"${created.version}"` },
      payload: { items: [{ productId: probe.soldHereId, quantity: 7 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await lineCurrencies(created.id)).toEqual(['EUR']);
  });

  it('keeps it on the operator’s modify, a line the operator adds included', async () => {
    const created = await createAsBuyer();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [
          { productId: probe.soldHereId, quantity: 2, agreedUnitPrice: 9 },
          // A new line: no stored row to copy a currency from.
          { productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 4 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await lineCurrencies(created.id)).toEqual(['EUR', 'EUR']);
  });

  it('stamps the channel currency on the operator’s create on behalf', async () => {
    const created = await createOnBehalf();
    expect(await lineCurrencies(created.id)).toEqual(['EUR']);
  });

  it('keeps it on a resubmit', async () => {
    const source = await createAsBuyer();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${source.id}/resubmit`,
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.code },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(201);
    const resubmitted = (res.json() as { data: Created }).data;
    expect(await lineCurrencies(resubmitted.id)).toEqual(['EUR']);
  });

  describe('list summaries', () => {
    async function customerSummary(id: string): Promise<{ currency: string } | undefined> {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/quote-requests', cookies: BUYER });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Array<{ id: string; currency: string }> }).data.find((r) => r.id === id);
    }

    async function adminSummary(id: string): Promise<{ currency: string } | undefined> {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/quote-requests', cookies: ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Array<{ id: string; currency: string }> }).data.find((r) => r.id === id);
    }

    async function withoutLines(id: string, channelId: string | null): Promise<void> {
      const conn = h.em().getConnection();
      await conn.execute('delete from "quote_request_items" where "quote_request_id" = ?', [id]);
      await conn.execute('update "quote_requests" set "sales_channel_id" = ? where "id" = ?', [channelId, id]);
    }

    it('read the currency off the lines', async () => {
      const created = await createAsBuyer();
      expect((await customerSummary(created.id))?.currency).toBe('EUR');
      expect((await adminSummary(created.id))?.currency).toBe('EUR');
    });

    it('speak the channel’s currency for a request with no lines', async () => {
      const created = await createAsBuyer();
      await withoutLines(created.id, probe.id);
      expect((await customerSummary(created.id))?.currency).toBe('EUR');
      expect((await adminSummary(created.id))?.currency).toBe('EUR');
    });

    it('keep PLN only for a legacy request with no lines and no channel', async () => {
      const created = await createAsBuyer();
      await withoutLines(created.id, null);
      expect((await customerSummary(created.id))?.currency).toBe('PLN');
      expect((await adminSummary(created.id))?.currency).toBe('PLN');
    });
  });
});
