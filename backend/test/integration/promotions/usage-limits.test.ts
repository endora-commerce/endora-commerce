import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * Feature 045 (US5) — usage-limit enforcement: the atomic finalize gate caps
 * usage and is race-safe on the last available use (SC-005).
 */
describe('promotion usage limits', () => {
  let h: BackendServerHandle;
  let svc: PromotionService;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new PromotionService(h.em);
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
          salesChannelId: null,
          ...ctx,
        },
        applied: [{ promotionId, couponId: null, amount: 5 }],
      }),
    );

  it('enforces a global usage limit', async () => {
    const id = await makePromo({ usageLimitGlobal: 1 });
    await finalize(id, '00000000-0000-4000-8000-00000000a001');
    await expect(finalize(id, '00000000-0000-4000-8000-00000000a002')).rejects.toBeInstanceOf(HttpError);
  });

  it('enforces a per-customer limit independently per customer', async () => {
    const id = await makePromo({ usageLimitPerCustomer: 1 });
    const custA = '00000000-0000-4000-8000-0000000000c1';
    const custB = '00000000-0000-4000-8000-0000000000c2';
    await finalize(id, '00000000-0000-4000-8000-00000000b001', { customerAccountId: custA });
    await expect(
      finalize(id, '00000000-0000-4000-8000-00000000b002', { customerAccountId: custA }),
    ).rejects.toBeInstanceOf(HttpError);
    // A different customer can still redeem.
    await expect(
      finalize(id, '00000000-0000-4000-8000-00000000b003', { customerAccountId: custB }),
    ).resolves.toBeUndefined();
  });

  it('never exceeds the cap under concurrent finalize for the last use', async () => {
    const id = await makePromo({ usageLimitGlobal: 1 });
    const results = await Promise.allSettled([
      finalize(id, '00000000-0000-4000-8000-00000000d001'),
      finalize(id, '00000000-0000-4000-8000-00000000d002'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
  });
});
