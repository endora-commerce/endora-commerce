import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { CartAuditService } from '../../../src/modules/carts/services/cart-audit-service.js';
import { CartAbandonmentWorker } from '../../../src/modules/carts/services/cart-abandonment-worker.js';

/**
 * Abandonment-sweep perf harness (feature 027 T129).
 *
 * Spec target (`plan.md` § Performance Goals): seed 50_000 `active`
 * carts with stale `last_activity_at` and confirm one sweep tick
 * completes in < 5 s.
 *
 * Opt-in: set `PERF_RUN=true` to actually run. By default the suite
 * skips so regular PR runs aren't blocked.
 *
 * ## This bench does not currently finish (issue #143)
 *
 * It is excluded from the scheduled `perf:backend` job, and the exclusion is a
 * blocker rather than a tuning choice. `CartAbandonmentWorker.sweep()` runs
 * one `em.find(CartItem)` and one `CartAuditService.record()` — which flushes
 * — per eligible cart, over an identity map that keeps every cart and every
 * audit row it has already touched, so the per-cart cost grows with the sweep
 * rather than staying flat:
 *
 *   PERF_SWEEP_CART_COUNT=500   →   9 924 ms  (19.8 ms/cart)
 *   PERF_SWEEP_CART_COUNT=2000  → 130 787 ms  (65.4 ms/cart)
 *
 * At the default 50 000 the test does not fail its 5 s budget — it never
 * reaches the assertion, timing out after the 10 minutes below. That is why
 * `test:perf` was red on master, and the budget is not what is wrong: the
 * sweep is. Restore the bench to the schedule together with the fix.
 *
 * Env knobs:
 *   PERF_SWEEP_CART_COUNT  — eligible-cart seed count (default 50_000)
 *   PERF_SWEEP_BUDGET_MS   — one-tick assertion budget (default 5000)
 *   PERF_SWEEP_LINES       — items per cart (default 1 — non-empty so
 *                             the sweep records a notification)
 *   PERF_RUN               — 'true' to enable
 */

const cartCount = Number(process.env['PERF_SWEEP_CART_COUNT'] ?? '50000');
const budgetMs = Number(process.env['PERF_SWEEP_BUDGET_MS'] ?? '5000');
const linesPerCart = Number(process.env['PERF_SWEEP_LINES'] ?? '1');
const shouldRun = process.env['PERF_RUN'] === 'true';

describe.skipIf(!shouldRun)('cart abandonment sweep — perf', () => {
  let db: TestDb;
  let worker: CartAbandonmentWorker;
  let systemDefaultChannelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    const tmpEm = db.orm.em.fork();
    const ch = await tmpEm.findOne(SalesChannel, { systemDefault: true });
    systemDefaultChannelId = ch?.id ?? '';

    await db.beginTx();
    const em = db.em();
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days

    // Seed in batches so we don't blow EM identity-map memory.
    // Flush carts first so cart_items inserts can reference persisted
    // FK targets, then flush items in the same batch.
    const BATCH = 1000;
    let inserted = 0;
    while (inserted < cartCount) {
      const batch = Math.min(BATCH, cartCount - inserted);
      const carts: Cart[] = [];
      for (let i = 0; i < batch; i += 1) {
        carts.push(
          em.create(Cart, {
            status: 'active',
            approvalStatus: 'not_required',
            lastActivityAt: stale,
            createdAt: stale,
            updatedAt: stale,
            ...(systemDefaultChannelId ? { salesChannelId: systemDefaultChannelId } : {}),
          }),
        );
      }
      await em.flush();
      if (linesPerCart > 0) {
        for (const c of carts) {
          for (let l = 0; l < linesPerCart; l += 1) {
            em.create(CartItem, {
              cartId: c.id,
              productId: '00000000-0000-4000-8000-000000000101',
              quantity: 1,
              unitPrice: '1.00',
              currency: 'PLN',
            });
          }
        }
        await em.flush();
      }
      em.clear();
      inserted += batch;
    }

    const emFactory = () => db.em();
    const auditLog = new AuditLogService(emFactory);
    const cartAuditService = new CartAuditService(emFactory, auditLog);
    worker = new CartAbandonmentWorker({
      emFactory,
      cartAuditService,
      resolveInactivityMinutes: () => Promise.resolve(10), // 10 min threshold
      resolveNotificationRecipient: () => Promise.resolve(''), // empty → suppress dispatch
      dispatchNotification: vi.fn().mockResolvedValue(undefined),
    });
  }, 20 * 60_000);

  afterAll(async () => {
    await db.rollbackTx();
    await db.close();
  });

  it('sweeps {seed} carts in under {budget} ms', async () => {
    const t0 = performance.now();
    const result = await worker.sweep();
    const elapsed = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.log(
      `[perf/sweep] carts=${cartCount} abandoned=${result.abandonedCount} ` +
        `notified=${result.notifiedCount} ` +
        `elapsed=${elapsed.toFixed(1)}ms budget=${budgetMs}ms`,
    );

    expect(result.abandonedCount).toBe(cartCount);
    expect(elapsed).toBeLessThan(budgetMs);
  }, 10 * 60_000);
});
