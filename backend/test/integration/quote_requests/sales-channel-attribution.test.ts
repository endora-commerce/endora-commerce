import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { HttpError } from '../../../src/http/error-envelope.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { salesChannelsServiceFor } from '../../helpers/sales-channels-service.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * A Quote Request records the sales channel it was raised on (issue #266,
 * feature 005 / FR-012).
 *
 * `20260430T170044_core_sales_channels_promote` added
 * `quote_requests.sales_channel_id` — nullable, indexed, with an
 * `on delete restrict` foreign key — and neither half of what should have
 * followed landed: the entity had no property for the column, so nothing on the
 * request path ever wrote it, and the FR-006 channel-delete guard answered
 * "nothing points here" for every RFQ ever raised. The guard was not wrong; it
 * was reading a column the platform never filled.
 *
 * The channel comes from the **resolved request channel**
 * (`currentSalesChannel()`), the value the kernel resolver middleware already
 * put on the request scope — not from a second lookup and not from the
 * system-default resolver, which is the answer for reads that happen *outside*
 * a request.
 */
describe('a quote request records the channel it was raised on', () => {
  let h: BackendServerHandle;
  const customerCookie = { b2b_session: 'stub-customer-session' };

  /** A channel of this suite's own, so no other file's rows are involved. */
  let channelCode: string;
  let channelId: string;
  let otherChannelCode: string;
  let otherChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    channelCode = `rfq-attr-${randomUUID().slice(0, 8)}`;
    channelId = await makeChannel(channelCode);
    otherChannelCode = `rfq-attr-${randomUUID().slice(0, 8)}`;
    otherChannelId = await makeChannel(otherChannelCode);
  });

  afterAll(async () => {
    // Release the attributions this suite recorded so the disposable channels
    // can go with it — `quote_requests_sales_channel_fk` is `on delete restrict`
    // and would otherwise keep both rows alive for the rest of the run.
    const em = h.em();
    await em
      .getConnection()
      .execute(
        'update "quote_requests" set "sales_channel_id" = null ' +
          'where "sales_channel_id" in (?, ?)',
        [channelId, otherChannelId],
      );
    for (const code of [channelCode, otherChannelCode]) {
      await service().delete(code);
    }
    await teardownBackendServer(h);
  });

  function service() {
    return salesChannelsServiceFor(h, h.em, { eventBus: new EventBus() });
  }

  async function makeChannel(code: string): Promise<string> {
    await service().create({
      code,
      name: { 'en-US': 'RFQ attribution probe' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    const id = (await h.em().findOneOrFail(SalesChannel, { code })).id;
    // Publish the quoted product on the probe channel (issue #259). A quote
    // line is an acquisition and is now refused on a channel that does not sell
    // it, so a disposable channel with an empty assortment can raise no quote
    // at all — and this file is about *which* channel a quote records, which
    // presupposes that one can be raised there.
    await h
      .em()
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) ` +
          `on conflict (sales_channel_id, product_id) do nothing`,
        [id, SEED_PRODUCT_101_ID],
      );
    return id;
  }

  async function createRfq(headerChannelCode?: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customerCookie,
      ...(headerChannelCode ? { headers: { 'x-sales-channel': headerChannelCode } } : {}),
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function channelOf(rfqId: string): Promise<string | null | undefined> {
    return (await h.em().findOneOrFail(QuoteRequest, { id: rfqId })).salesChannelId;
  }

  it('stamps the request channel a storefront caller named', async () => {
    const rfqId = await createRfq(channelCode);
    expect(await channelOf(rfqId)).toBe(channelId);
  });

  it('stamps the resolved fallback when the caller named no channel', async () => {
    // "No signal" is not "no channel": the resolver falls back to the system
    // default on every storefront path, so the recorded attribution is that
    // channel and never null.
    const systemDefault = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    const rfqId = await createRfq();
    expect(await channelOf(rfqId)).toBe(systemDefault.id);
  });

  it('raises a resubmit on the channel of the resubmit request, not the source RFQ', async () => {
    const sourceId = await createRfq(channelCode);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${sourceId}/resubmit`,
      cookies: customerCookie,
      headers: { 'x-sales-channel': otherChannelCode },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const resubmittedId = (res.json() as { data: { id: string } }).data.id;
    expect(resubmittedId).not.toBe(sourceId);
    expect(await channelOf(resubmittedId)).toBe(otherChannelId);
    // The source keeps the channel it was raised on.
    expect(await channelOf(sourceId)).toBe(channelId);
  });

  it('lets the FR-006 delete guard refuse a channel a quote request was raised on', async () => {
    const caught = await service()
      .delete(channelCode)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(caught).toBeInstanceOf(HttpError);
    const err = caught as HttpError;
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.SALES_CHANNEL_HAS_ATTRIBUTIONS);
    expect(err.message).toContain('quote request(s)');
    expect(await h.em().findOne(SalesChannel, { code: channelCode })).not.toBeNull();
  });
});
