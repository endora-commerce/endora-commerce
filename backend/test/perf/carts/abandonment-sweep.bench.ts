import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { CartAuditService } from '../../../src/modules/carts/services/cart-audit-service.js';
import {
  CartAbandonmentWorker,
  DEFAULT_SWEEP_BATCH_SIZE,
} from '../../../src/modules/carts/services/cart-abandonment-worker.js';

/**
 * Abandonment-sweep perf harness (feature 027 T129).
 *
 * Spec target (`plan.md` § Performance Goals): "a single sweep tick handles up
 * to 10 k active carts in < 5 s (single indexed query + batched updates),
 * running every 5 minutes". The 50 000 in the same document is the *scale*
 * envelope — "abandonment sweep scoped to handle 50 k actives in a single
 * tick" — with no time attached to it. This file used to state the 5 s over the
 * 50 000, which is neither number the spec wrote.
 *
 * Opt-in: set `PERF_RUN=true` to actually run. By default the suite
 * skips so regular PR runs aren't blocked.
 *
 * ## It finishes now (issue #152)
 *
 * It did not before, and its exclusion from the `perf:backend` schedules was a
 * blocker rather than a tuning choice. `CartAbandonmentWorker.sweep()` ran one
 * `em.find(CartItem)` and one `CartAuditService.record()` — which flushed —
 * per eligible cart, over an identity map that kept every cart and every audit
 * row it had already touched, so the per-cart cost grew with the sweep. On a
 * 16-core / 64 GB Linux dev box, Postgres 16 on localhost:
 *
 *              before                       after
 *      500     8 423 ms (16.8 ms/cart)      307 ms (0.61 ms/cart)
 *    2 000   131 980 ms (66.0 ms/cart)    1 094 ms (0.55 ms/cart)
 *   10 000   (never measured)             4 666 … 5 492 ms over seven runs
 *   50 000   timed out at 10 min         37 152 ms (0.74 ms/cart)
 *
 * Four times the carts used to cost sixteen times the time; it now costs four.
 * The exclusion is removed from `.gitlab-ci.yml` with this change.
 *
 * ## The budget, and the assertion that does not need one (issue #143, D-65)
 *
 * The spec's < 5 s is the product promise. The budget the assertion uses is a
 * *regression detector*, set from what the code costs today so that a 3×
 * slowdown fails here long before anybody notices it against the promise:
 * worst of the seven 10 000-cart runs above (5 492 ms) × 3 → **17 000 ms**. The
 * multiplier is ×3 for the reason `test/perf/catalog-list.bench.ts` states —
 * ×2 of regression headroom plus ×1.5 for the gap between this box and the
 * 4 vCPU / 8 GB docker runner the scheduled job measures on. Re-base from the
 * first three scheduled `perf:backend` runs.
 *
 * Be honest about what those readings say against the promise: at 10 000 carts
 * the sweep lands at 4.7-5.5 s on a box carrying load average 5, so it is *at*
 * the promise rather than comfortably inside it. What is left is not an N+1 —
 * it is two audit rows per swept cart (`cart_audit_entries` +
 * `audit_log_entries`), which is the guarantee, not overhead. Tightening it
 * further means arguing about the audit, not about the loop.
 *
 * Beside the clock sits the assertion a busy runner cannot move (issue #142):
 * statements **per cart**. The sweep talks to PostgreSQL once per batch of
 * {@link DEFAULT_SWEEP_BATCH_SIZE} — the eligible-cart page, the grouped line
 * count, the transaction bracket, and the writes, which MikroORM chunks at its
 * own insert batch size. Ten statements per 500-cart batch, measured, so
 * **0.020 per cart**; the ceiling is 0.05 and one statement per cart — the
 * shape this whole change is about — is 1.0. Stated per cart rather than per
 * batch on purpose: a per-batch number would have to encode the ORM's write
 * chunking, and would go red on an ORM upgrade that batches differently while
 * the sweep is doing nothing wrong.
 *
 * Env knobs:
 *   PERF_SWEEP_CART_COUNT  — eligible-cart seed count (default 10_000)
 *   PERF_SWEEP_BUDGET_MS   — one-tick assertion budget (default 17_000)
 *   PERF_SWEEP_LINES       — items per cart (default 1 — non-empty so
 *                             the sweep records a notification)
 *   PERF_SWEEP_STATEMENTS_PER_CART — statement ceiling per cart (default 0.05)
 *   PERF_RUN               — 'true' to enable
 */

const cartCount = Number(process.env['PERF_SWEEP_CART_COUNT'] ?? '10000');
const budgetMs = Number(process.env['PERF_SWEEP_BUDGET_MS'] ?? '17000');
const linesPerCart = Number(process.env['PERF_SWEEP_LINES'] ?? '1');
const statementsPerCartCeiling = Number(
  process.env['PERF_SWEEP_STATEMENTS_PER_CART'] ?? '0.05',
);
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
    const knex: Knex = db.em().getConnection().getKnex();
    let statements = 0;
    const countStatement = (): void => {
      statements += 1;
    };

    knex.on('query', countStatement);
    const t0 = performance.now();
    const result = await worker.sweep();
    const elapsed = performance.now() - t0;
    knex.off('query', countStatement);

    const batches = Math.ceil(cartCount / DEFAULT_SWEEP_BATCH_SIZE);
    const statementsPerCart = statements / result.abandonedCount;

    // eslint-disable-next-line no-console
    console.log(
      `[perf/sweep] carts=${cartCount} abandoned=${result.abandonedCount} ` +
        `notified=${result.notifiedCount} batches=${batches} ` +
        `statements=${statements} per-cart=${statementsPerCart.toFixed(3)} ` +
        `(ceiling ${statementsPerCartCeiling}) ` +
        `elapsed=${elapsed.toFixed(1)}ms budget=${budgetMs}ms`,
    );

    // What was swept, before how long it took (issue #140): a sweep that found
    // nothing returns in a millisecond and passes any budget. `>=` rather than
    // `===` because the sweep is platform-wide — a shared test database can
    // hold an eligible cart this file did not seed, and one extra cart says
    // nothing about the cost of the ten thousand that follow it.
    expect(result.abandonedCount).toBeGreaterThanOrEqual(cartCount);
    // Issue #142 — the half that means the same thing on a busy runner. A count
    // that tracks the cart count is the N+1 back, whatever the clock says.
    expect(statementsPerCart).toBeLessThanOrEqual(statementsPerCartCeiling);
    expect(elapsed).toBeLessThan(budgetMs);
  }, 10 * 60_000);
});
