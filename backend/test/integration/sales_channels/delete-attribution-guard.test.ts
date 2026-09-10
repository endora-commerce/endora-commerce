import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type SalesChannelAttributionRegistryPort } from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { salesChannelsServiceFor } from '../../helpers/sales-channels-service.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * FR-006's delete guard, on a composed platform (feature 075, D-87 drain).
 *
 * `SalesChannelsService.delete` used to answer "who still points at this
 * channel?" itself, with one statement naming `orders` and `quote_requests` —
 * two other modules' tables and two other modules' column names, invisible to
 * the import-level boundary check because raw SQL names no specifier. The
 * question is inverted onto `salesChannelAttributionRegistry`: each owner
 * counts its own rows from its own contribution boot hook.
 *
 * The unit test beside this one pins the registry's arithmetic over descriptors
 * it controls. What it cannot see is whether the two boot hooks actually ran —
 * a contribution nobody registers degrades to "no attributions", which is a
 * perfectly plausible-looking answer and would let the guard pass a channel
 * with ten thousand orders on it. That is what the first assertion here is for,
 * and the guard had no test of any kind before this file.
 *
 * **`orders.sales_channel_id` carries no foreign key** (it is `not null` and
 * indexed, and `20260425T050720_core_commerce_init` adds no constraint), so
 * this guard is the only thing between an operator and ten thousand orphaned
 * orders. `quote_requests_sales_channel_fk` is `on delete restrict`, which is
 * why the off-state case below asserts a 422 and not a rollback.
 */
describe('sales channel delete — the attribution guard asks the owners', () => {
  let h: BackendServerHandle;
  /** A disposable channel with nothing pointing at it, recreated per case. */
  let channelCode: string;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function registry(): SalesChannelAttributionRegistryPort {
    return (
      h.container.cradle as unknown as {
        salesChannelAttributionRegistry: SalesChannelAttributionRegistryPort;
      }
    ).salesChannelAttributionRegistry;
  }

  function service() {
    return salesChannelsServiceFor(h, h.em, { eventBus: new EventBus() });
  }

  async function makeChannel(): Promise<string> {
    channelCode = `attr-guard-${randomUUID().slice(0, 8)}`;
    await service().create({
      code: channelCode,
      name: { 'en-US': 'Attribution guard probe' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    const em = h.em();
    const row = await em.findOneOrFail(SalesChannel, { code: channelCode });
    return row.id;
  }

  async function placeOrderOn(salesChannelId: string): Promise<void> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId,
      status: 'new',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'S',
        street: 's',
        city: 'c',
        postalCode: '00-000',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'S',
        street: 's',
        city: 'c',
        postalCode: '00-000',
        country: 'PL',
      },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
  }

  async function attributeQuoteRequestTo(salesChannelId: string): Promise<void> {
    const em = h.em();
    // The attribution is set through the entity, which is what issue #266
    // changed: `QuoteRequest` had no property for the column feature 005 /
    // FR-012 added, so this used to be a raw `update "quote_requests" set
    // "sales_channel_id"` — the only way to produce the row this case is about,
    // and an admission that no request path could produce it either. The
    // end-to-end version, an RFQ raised over HTTP on a named channel, lives in
    // `test/integration/quote_requests/sales-channel-attribution.test.ts`; this
    // file stays on a hand-built row so the off-state case below is about the
    // registry and not about the RFQ request path.
    const quote = em.create(QuoteRequest, {
      organizationId: randomUUID(),
      customerAccountId: randomUUID(),
      salesChannelId,
    });
    await em.persistAndFlush(quote);
  }

  it('has every owner registered by its own boot hook', () => {
    expect([...registry().owners()].sort()).toEqual(['orders', 'quote_requests']);
  });

  it('deletes a channel nothing is attributed to', async () => {
    await makeChannel();
    await service().delete(channelCode);
    expect(await h.em().findOne(SalesChannel, { code: channelCode })).toBeNull();
  });

  it('refuses the delete and names the module that still points at the channel', async () => {
    const id = await makeChannel();
    await placeOrderOn(id);

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
    // The consumer's own name, off its own descriptor — `sales_channels` no
    // longer spells `order(s)` into its own message.
    expect(err.message).toContain('order(s)');
    expect(await h.em().findOne(SalesChannel, { code: channelCode })).not.toBeNull();
  });

  /**
   * The off-state case is `quote_requests`, and only `quote_requests`: of the
   * two contributors it is the one whose manifest declares no
   * `activation.nonDeactivatable`, so it is the one an operator can switch off.
   * `orders` is locked, and an off-state assertion over it would be asserting a
   * state the platform refuses to enter.
   *
   * It asserts **honour**, not skip — the opposite of what a surface registry
   * would do, and the reason is at `SalesChannelAttributionRegistryPort`: the
   * requests survive the deactivation, so skipping the counter would delete the
   * channel underneath them. The database agrees, which is what makes the
   * assertion observable either way: with the counter honoured this is a 422
   * naming the module; skipped, `quote_requests_sales_channel_fk` turns it into
   * a raw constraint violation.
   */
  it('honours a switched-off contributor, because its rows outlive the switch', async () => {
    const id = await makeChannel();
    await attributeQuoteRequestTo(id);

    const caught = await withModuleOff('quote_requests', 'deactivated', () =>
      service()
        .delete(channelCode)
        .then(
          () => null,
          (err: unknown) => err,
        ),
    );
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).statusCode).toBe(422);
    expect((caught as HttpError).code).toBe(ERROR_CODES.SALES_CHANNEL_HAS_ATTRIBUTIONS);
    expect((caught as HttpError).message).toContain('quote request(s)');
  });

  it('restores an ordinary delete when the contributor comes back and its rows are gone', async () => {
    const em = h.em();
    await em
      .getConnection()
      .execute('update "quote_requests" set "sales_channel_id" = null where "sales_channel_id" = ?', [
        (await em.findOneOrFail(SalesChannel, { code: channelCode })).id,
      ]);
    await service().delete(channelCode);
    expect(await h.em().findOne(SalesChannel, { code: channelCode })).toBeNull();
  });
});
