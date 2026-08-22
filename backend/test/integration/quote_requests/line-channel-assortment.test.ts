import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { QuoteRequest } from '../../../src/modules/quote_requests/entities/quote-request.entity.js';
import {
  seedProbeChannelAssortment,
  type ChannelAssortment,
} from '../../helpers/channel-assortment-fixture.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #259 — a quote line is an acquisition, on all three of this module's
 * write seams (Constitution XII).
 *
 * `createForCustomer` and `patchDraft` filter by `isProductVisibleTo` and by
 * nothing else, so a buyer could ask to be quoted, on any storefront, a product
 * that storefront does not sell. `resubmit` is the interesting one: it names no
 * product id at all — it copies the source RFQ's line snapshots — while
 * stamping the **current** request's channel on the new quote (issue #266). So
 * without a gate it is the one-hop bypass of the other two: raise the quote on
 * the channel that sells the product, resubmit it with another channel's
 * header, and the line arrives in a pipeline that does not sell it.
 *
 * Every case pairs a refusal with an acceptance on the same channel, so a
 * filter narrowing against the wrong channel fails rather than passes.
 */

const BUYER = { b2b_session: 'stub-customer-session' };

describe('quote-request lines — the request channel has to sell them', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'rfq-assortment');
  }, 60_000);

  afterAll(async () => {
    // `quote_requests_sales_channel_fk` is `on delete restrict`, and the probe
    // channel outlives this file only if something still points at it. Release
    // the attributions rather than leaving the row pinned for the rest of the
    // composition.
    await h
      .em()
      .getConnection()
      .execute('update "quote_requests" set "sales_channel_id" = null where "sales_channel_id" = ?', [
        probe.id,
      ]);
    await teardownBackendServer(h);
  });

  async function create(
    productId: string,
    channelCode: string,
  ): Promise<{ statusCode: number; code: string | undefined; id: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: BUYER,
      headers: { 'x-sales-channel': channelCode },
      payload: { items: [{ productId, quantity: 2 }] },
    });
    const body = res.json() as { data?: { id: string }; error?: { code?: string } };
    return { statusCode: res.statusCode, code: body.error?.code, id: body.data?.id };
  }

  describe('create', () => {
    it('refuses a line the request channel does not publish', async () => {
      const { statusCode, code } = await create(probe.notSoldHereId, probe.code);
      expect(statusCode).toBe(404);
      // One sentence for "restricted", "sold elsewhere" and "never existed".
      expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('still accepts a line the same channel does publish', async () => {
      const { statusCode, id } = await create(probe.soldHereId, probe.code);
      expect(statusCode).toBe(201);
      expect(id).toBeDefined();
    });

    it('accepts the withheld product on a channel that does publish it', async () => {
      const { statusCode } = await create(probe.notSoldHereId, 'pl_retail');
      expect(statusCode).toBe(201);
    });
  });

  describe('patch', () => {
    it('refuses a revision that adds a line the request channel does not publish', async () => {
      const created = await create(probe.soldHereId, probe.code);
      expect(created.statusCode).toBe(201);

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${created.id}`,
        cookies: BUYER,
        headers: { 'x-sales-channel': probe.code },
        payload: { items: [{ productId: probe.notSoldHereId, quantity: 1 }] },
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.PRODUCT_NOT_FOUND,
      );
    });

    it('still accepts a revision over a line the same channel publishes', async () => {
      const created = await create(probe.soldHereId, probe.code);
      expect(created.statusCode).toBe(201);

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${created.id}`,
        cookies: BUYER,
        headers: { 'x-sales-channel': probe.code },
        payload: { items: [{ productId: probe.soldHereId, quantity: 7 }] },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('resubmit', () => {
    it('refuses to re-raise a quote on a channel that does not sell its lines', async () => {
      // Raised where the product is sold…
      const source = await create(probe.notSoldHereId, 'pl_retail');
      expect(source.statusCode).toBe(201);

      // …and re-raised where it is not. Nothing in the request body names a
      // product, which is exactly why this seam was invisible.
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${source.id}/resubmit`,
        cookies: BUYER,
        headers: { 'x-sales-channel': probe.code },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.PRODUCT_NOT_FOUND,
      );

      // And the refusal left no quote behind on the probe channel.
      const raised = await h.em().find(QuoteRequest, { salesChannelId: probe.id });
      for (const rfq of raised) {
        const items = await h
          .em()
          .getConnection()
          .execute<Array<{ product_id: string }>>(
            'select product_id from quote_request_items where quote_request_id = ?',
            [rfq.id],
          );
        expect(items.map((i) => i.product_id)).not.toContain(probe.notSoldHereId);
      }
    });

    it('still re-raises a quote whose lines the target channel does sell', async () => {
      const source = await create(probe.soldHereId, 'pl_retail');
      expect(source.statusCode).toBe(201);

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${source.id}/resubmit`,
        cookies: BUYER,
        headers: { 'x-sales-channel': probe.code },
        payload: {},
      });
      expect(res.statusCode).toBe(201);
    });
  });
});
