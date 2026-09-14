import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import { OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `POST /api/v1/storefront/inventory/notify-when-available` answers one
 * refusal, and an unauthenticated caller cannot tell which of three states
 * produced it.
 *
 * ## Why this is asserted as an equality rather than as three status codes
 *
 * The seam's rule is not "refuse the restricted product" — it is that *"sold on
 * another channel", "restricted to another organisation" and "does not exist"
 * have to be one answer*, in `CartService.addItem`'s own words. A suite that
 * asserts `404` three times passes against a future refusal that is a
 * distinguishable 404: a different `code`, a different sentence, a header only
 * one arm sets. So the assertion here is the **response**, compared whole,
 * between two requests that differ in nothing but the product id.
 *
 * ## How "byte for byte" is made to mean something
 *
 * Fastify is configured with `requestIdHeader: 'x-request-id'`
 * (`packages/platform/src/http/server.ts`), so a caller may **pin** the request
 * id. Both the `x-request-id` response header and the envelope's
 * `error.requestId` are derived from it, which leaves `date` as the only
 * remaining per-request field — the timing-dependent one the comparison is
 * allowed to drop. Everything else, `content-length` included, is compared as
 * it came off the wire.
 *
 * ## What was wrong
 *
 * Neither axis was applied on this path. `AvailabilityNotificationService.
 * subscribe` resolved the product through the row-level read port and went
 * straight to the stock gates, so the three states above produced three
 * different answers — one of which carried a `subscriptionId` — and an
 * unauthenticated caller could sort product ids into "exists here" and
 * "does not" by reading them.
 */

const PROBE_CHANNEL_PREFIX = 'notify-oracle';

interface Probe {
  /** `X-Sales-Channel` value for the channel every request below is made on. */
  channelCode: string;
  /** Public, out of stock, published on the probe channel — the positive half. */
  acquirableId: string;
  /** Public and out of stock, but published on another channel only. */
  otherChannelId: string;
  /** Published on the probe channel, allow-listed to an organisation the
   *  caller is not in. */
  otherOrganizationId: string;
  /** No such row. */
  absentId: string;
}

describe('the anonymous notify-when-available endpoint answers one refusal for three states', () => {
  let h: BackendServerHandle;
  let probe: Probe;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // Products of this file's own, with **no** `stock_levels` row at all:
    // `subscribe` refuses with 422 `PRODUCT_IN_STOCK` above zero on hand, and
    // the state a "notify me when it is back" dialog is for is the empty one.
    // `sum(on_hand)` over no row is `null`, which the service reads as zero.
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const make = async (
      label: string,
      extra: Partial<{ visibility: 'public'; allowedOrganizationIds: string[] }> = {},
    ): Promise<string> => {
      const product = em.create(Product, {
        sku: `NOTIFY-ORACLE-${label}-${stamp}`,
        slug: `notify-oracle-${label}-${stamp}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Notify oracle probe ${label}` },
        description: { 'en-US': 'Out of stock, so the notify-me path is reachable.' },
        visibility: 'public',
        attributeValues: { defaultPrice: 10 },
        ...extra,
      });
      await em.persistAndFlush(product);
      return product.id;
    };

    const acquirableId = await make('sold-here');
    const otherChannelId = await make('sold-elsewhere');
    // A non-empty allow-list restricts whatever `visibility` says, `public`
    // included — so this row is a product that exists, is live and is simply
    // not this caller's. The state the entry called "restricted to one
    // organisation".
    const otherOrganizationId = await make('other-org', {
      allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID],
    });

    const code = `${PROBE_CHANNEL_PREFIX}-${randomUUID().slice(0, 8)}`;
    const channel = em.create(SalesChannel, {
      code,
      name: { 'en-US': `Notify oracle probe ${code}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    const elsewhere = em.create(SalesChannel, {
      code: `${code}-elsewhere`,
      name: { 'en-US': `Notify oracle elsewhere ${code}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush([channel, elsewhere]);

    // Written with SQL rather than through `SalesChannelMembershipService` for
    // the reason `channel-assortment-fixture.ts` gives: the service audits and
    // emits, and a fixture that produces audit rows is a fixture the audit
    // assertions in the same composition have to know about.
    await em
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?), (?,?) ` +
          `on conflict (sales_channel_id, product_id) do nothing`,
        [
          channel.id,
          acquirableId,
          channel.id,
          otherOrganizationId,
          elsewhere.id,
          otherChannelId,
        ],
      );

    probe = {
      channelCode: code,
      acquirableId,
      otherChannelId,
      otherOrganizationId,
      absentId: randomUUID(),
    };
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * One anonymous subscribe attempt, with the request id pinned so the whole
   * response is comparable. The e-mail address is the same for every probe:
   * an address that differed per call would be a second thing separating two
   * responses this file's whole point is to compare.
   */
  async function attempt(
    productId: string,
    requestId: string,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/inventory/notify-when-available',
      headers: { 'x-sales-channel': probe.channelCode, 'x-request-id': requestId },
      payload: { productId, email: 'notify-oracle@example.com' },
    });
    // `date` is the one field a comparison may not hold two responses to; it is
    // timing-dependent by definition. Everything else stays, `content-length`
    // included — which is what makes a differing message body a failure here
    // even if some future refusal kept the status and the code.
    const { date: _date, ...headers } = res.headers as Record<string, unknown>;
    return { statusCode: res.statusCode, body: res.body, headers };
  }

  it('answers a product sold on another channel exactly as it answers an absent one', async () => {
    const absent = await attempt(probe.absentId, 'oracle-probe-1');
    const elsewhere = await attempt(probe.otherChannelId, 'oracle-probe-1');

    expect(elsewhere.statusCode).toBe(absent.statusCode);
    expect(elsewhere.body).toBe(absent.body);
    expect(elsewhere.headers).toEqual(absent.headers);
  });

  it('answers a product allow-listed to another organisation exactly as it answers an absent one', async () => {
    const absent = await attempt(probe.absentId, 'oracle-probe-2');
    const restricted = await attempt(probe.otherOrganizationId, 'oracle-probe-2');

    expect(restricted.statusCode).toBe(absent.statusCode);
    expect(restricted.body).toBe(absent.body);
    expect(restricted.headers).toEqual(absent.headers);
  });

  it('refuses all three with the answer an absent product has always had', async () => {
    // The equality above is the guarantee; this pins *which* answer the three
    // agree on, so a repair that made them agree on `202` would not pass.
    for (const productId of [probe.absentId, probe.otherChannelId, probe.otherOrganizationId]) {
      const res = await attempt(productId, 'oracle-probe-3');
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toMatchObject({
        error: { code: ERROR_CODES.PRODUCT_NOT_FOUND },
      });
    }
  });

  it('still lets an anonymous caller register for a product the channel sells', async () => {
    // The half that makes the three refusals mean something: a gate that
    // refuses everything would pass every case above. Same request shape, same
    // channel, same anonymous caller — only the product id differs.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/inventory/notify-when-available',
      headers: { 'x-sales-channel': probe.channelCode },
      payload: { productId: probe.acquirableId, email: 'notify-oracle-ok@example.com' },
    });
    expect(res.statusCode).toBe(202);
    expect((res.json() as { data: { subscriptionId: string } }).data.subscriptionId).toBeTruthy();
  });
});
