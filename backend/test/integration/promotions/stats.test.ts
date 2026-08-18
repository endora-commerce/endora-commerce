import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { PromotionStatsService } from '../../../src/modules/promotions/services/promotion-stats-service.js';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';


/**
 * Feature 045 (US7) — statistics reconcile with the finalized usages, overall
 * and per dimension.
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

describe('promotion statistics', () => {
  let h: BackendServerHandle;
  let svc: PromotionService;
  let stats: PromotionStatsService;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = promotionServiceFor(h);
    stats = new PromotionStatsService(h.em);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });
  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
    await h.em().getConnection().execute('truncate table promotion_usages cascade');
    await h.em().getConnection().execute('truncate table promotion_usage_counters cascade');
  });

  const ORG_A = '00000000-0000-4000-8000-0000000000a1';
  const ORG_B = '00000000-0000-4000-8000-0000000000a2';
  const CH = '00000000-0000-4000-8000-0000000000f1';

  it('reconciles totals and an organization breakdown', async () => {
    const p = await svc.upsert({ name: 's', action: { type: 'free_delivery' }, rule: { kind: 'all' } });
    const fin = (orderId: string, organizationId: string, amount: number) =>
      h.em().transactional((tx) =>
        svc.finalizeUsage(tx, {
          orderId,
          currency: 'PLN',
          ctx: { organizationId, customerAccountId: null, customerGroupId: null, salesChannelId: CH },
          applied: [{ promotionId: p.id, couponId: null, amount }],
        }),
      );
    // Real order rows since D-94.1: `promotion_usages_order_fk` refuses the
    // literal ids this case used to finalize against. `ORG_A` / `ORG_B` stay
    // literals — `promotion_usages.organization_id` is one of the 141 columns
    // D-94.6 classified and left unconstrained.
    await fin(await seedOrderId(h.em(), ORG_A), ORG_A, 10);
    await fin(await seedOrderId(h.em(), ORG_A), ORG_A, 15);
    await fin(await seedOrderId(h.em(), ORG_B), ORG_B, 5);

    const totals = await stats.forPromotion(p.id);
    expect(totals.totalUses).toBe(3);
    expect(totals.totalDiscount).toBeCloseTo(30, 2);

    const byOrg = await stats.forPromotion(p.id, { groupBy: 'organization' });
    const a = byOrg.breakdown.find((b) => b.key === ORG_A);
    const b = byOrg.breakdown.find((b) => b.key === ORG_B);
    expect(a?.uses).toBe(2);
    expect(a?.discount).toBeCloseTo(25, 2);
    expect(b?.uses).toBe(1);
    expect(b?.discount).toBeCloseTo(5, 2);
  });
});
