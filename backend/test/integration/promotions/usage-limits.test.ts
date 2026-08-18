import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { HttpError } from '../../../src/http/error-envelope.js';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';


/**
 * Feature 045 (US5) — usage-limit enforcement: the atomic finalize gate caps
 * usage and is race-safe on the last available use (SC-005).
 */
/**
 * A bare placed order for a redemption row to reference (D-94.1).
 *
 * `promotion_usages_order_fk` (`on delete restrict`) refuses the fixed literal
 * order ids this file used to finalize against. Kept local rather than added to
 * `seed-commerce.ts`: what these cases need is a row with an id, not the
 * commerce fixture.
 */
async function seedOrderId(em: EntityManager, organizationId: string): Promise<string> {
  const order = em.create(Order, {
    organizationId,
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    status: 'paid',
    paymentStatus: 'paid',
    deliveryAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
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
  return order.id;
}

describe('promotion usage limits', () => {
  let h: BackendServerHandle;
  let svc: PromotionService;
  /**
   * `promotion_usages.sales_channel_id` is `uuid not null`, and D-48 made the
   * context field non-nullable to match: the one production caller is
   * `placeOrder`, which stamps the same id onto the order. The fixture used to
   * pass `null` and the service turned it into a `randomUUID()` at the insert —
   * issue #85's shape, one table over.
   */
  let channelId: string;
  /** The tenant every seeded order below belongs to; not otherwise asserted. */
  let ORG: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = promotionServiceFor(h);
    channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    const org = h.em().create(Organization, {
      name: 'D94 usage-limit org',
      taxId: 'PL0940000002',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await h.em().persistAndFlush(org);
    ORG = org.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });
  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
    await h.em().getConnection().execute('truncate table promotion_usage_counters cascade');
    await h.em().getConnection().execute('truncate table promotion_usages cascade');
  });

  async function makePromo(limits: Record<string, number>): Promise<string> {
    const p = await svc.upsert({
      name: 'limited',
      action: { type: 'free_delivery' },
      rule: { kind: 'all' },
      ...limits,
    });
    return p.id;
  }

  const finalize = (promotionId: string, orderId: string, ctx: Record<string, string | null> = {}) =>
    h.em().transactional((tx) =>
      svc.finalizeUsage(tx, {
        orderId,
        currency: 'PLN',
        ctx: {
          organizationId: null,
          customerAccountId: null,
          customerGroupId: null,
          salesChannelId: channelId,
          ...ctx,
        },
        applied: [{ promotionId, couponId: null, amount: 5 }],
      }),
    );

  it('enforces a global usage limit', async () => {
    const id = await makePromo({ usageLimitGlobal: 1 });
    await finalize(id, await seedOrderId(h.em(), ORG));
    await expect(finalize(id, await seedOrderId(h.em(), ORG))).rejects.toBeInstanceOf(HttpError);
  });

  it('enforces a per-customer limit independently per customer', async () => {
    const id = await makePromo({ usageLimitPerCustomer: 1 });
    const custA = '00000000-0000-4000-8000-0000000000c1';
    const custB = '00000000-0000-4000-8000-0000000000c2';
    await finalize(id, await seedOrderId(h.em(), ORG), { customerAccountId: custA });
    await expect(
      finalize(id, await seedOrderId(h.em(), ORG), { customerAccountId: custA }),
    ).rejects.toBeInstanceOf(HttpError);
    // A different customer can still redeem.
    await expect(
      finalize(id, await seedOrderId(h.em(), ORG), { customerAccountId: custB }),
    ).resolves.toBeUndefined();
  });

  it('never exceeds the cap under concurrent finalize for the last use', async () => {
    const id = await makePromo({ usageLimitGlobal: 1 });
    const [orderOne, orderTwo] = [
      await seedOrderId(h.em(), ORG),
      await seedOrderId(h.em(), ORG),
    ];
    const results = await Promise.allSettled([finalize(id, orderOne), finalize(id, orderTwo)]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
  });
});
