import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { PromotionStatsService } from '../../../src/modules/promotions/services/promotion-stats-service.js';

/**
 * Feature 045 (US7) — statistics reconcile with the finalized usages, overall
 * and per dimension.
 */
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
    await fin('00000000-0000-4000-8000-000000000201', ORG_A, 10);
    await fin('00000000-0000-4000-8000-000000000202', ORG_A, 15);
    await fin('00000000-0000-4000-8000-000000000203', ORG_B, 5);

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
