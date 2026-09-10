import { Cart, CartAuditEntry, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import type { Knex } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import { AuditLogEntry } from '@endora-commerce/platform/kernel';

import { AuditLogService } from '@endora-commerce/platform/composition';

import { CartAuditService } from '../../../../packages/modules/carts/src/backend/services/cart-audit-service.js';

import { CartAbandonmentWorker } from '../../../../packages/modules/carts/src/backend/services/cart-abandonment-worker.js';


/**
 * Issue #152 — the sweep's cost must not grow with the corpus.
 *
 * The wall clock says so on a benchmark machine; these assertions say so
 * anywhere, which is the half of #142's pattern a p95 cannot supply. The sweep
 * used to issue one `em.find(CartItem)` and one `CartAuditService.record()` —
 * itself two flushes over two forks — per eligible cart, so the statement count
 * tracked the cart count and the identity map retained everything it had
 * touched. Both are asserted here directly:
 *
 *   - statements per **batch** are constant, so statements per **cart** fall as
 *     the batch fills;
 *   - the identity map is empty when the sweep returns, whatever it swept.
 *
 * `batchSize` is driven down to a handful so the multi-batch path — the one
 * that decides whether a crash mid-sweep loses one batch or everything — is
 * exercised by a fixture small enough to run in the integration suite.
 */

/**
 * Statements one batch may issue, whatever it holds.
 *
 * Measured at **six**: the eligible-cart page, the grouped line count, and the
 * four the single flush costs (its transaction bracket, the batched cart
 * update, the `cart_audit_entries` insert, the `audit_log_entries` insert). The
 * ceiling leaves two for an ORM that brackets a flush differently and still
 * refuses anything per cart — one statement per cart puts a ten-cart batch at
 * sixteen. Plus one for the final page that comes back empty.
 */
const STATEMENTS_PER_BATCH_CEILING = 8;

describe('CartAbandonmentWorker.sweep — batching', () => {
  let db: TestDb;
  let systemDefaultChannelId: string;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    db = await setupTestDb();
    systemDefaultChannelId = db.systemDefaultChannelId;
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    dispatchSpy = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  function buildWorker(batchSize: number): CartAbandonmentWorker {
    const em = db.em();
    const emFactory = (): typeof em => em;
    const auditLog = new AuditLogService(emFactory);
    return new CartAbandonmentWorker({
      emFactory,
      cartAuditService: new CartAuditService(emFactory, auditLog),
      resolveInactivityMinutes: () => Promise.resolve(10),
      resolveNotificationRecipient: () => Promise.resolve('abandon@example.com'),
      dispatchNotification: dispatchSpy as unknown as NonNullable<
        ConstructorParameters<typeof CartAbandonmentWorker>[0]['dispatchNotification']
      >,
      batchSize,
    });
  }

  /** Seeds `count` eligible carts, each carrying `lines` items. */
  async function seedEligibleCarts(count: number, lines: number): Promise<string[]> {
    const em = db.em();
    const stale = new Date(Date.now() - 60 * 60_000);
    const carts = Array.from({ length: count }, (_, i) =>
      em.create(Cart, {
        anonymousCartToken: `anon-batch-${Date.now()}-${i}`,
        ...(systemDefaultChannelId ? { salesChannelId: systemDefaultChannelId } : {}),
        lastActivityAt: stale,
      }),
    );
    await em.flush();
    for (const cart of carts) {
      for (let l = 0; l < lines; l += 1) {
        em.create(CartItem, {
          cartId: cart.id,
          productId: '00000000-0000-4000-8000-000000000101',
          quantity: 1,
          unitPrice: '1.00',
          currency: 'PLN',
        });
      }
    }
    await em.flush();
    em.clear();
    return carts.map((c) => c.id);
  }

  it('issues a constant number of statements per batch, not one per cart', async () => {
    const cartCount = 40;
    const batchSize = 10;
    await seedEligibleCarts(cartCount, 2);

    const knex: Knex = db.em().getConnection().getKnex();
    let statements = 0;
    const count = (): void => {
      statements += 1;
    };

    knex.on('query', count);
    const result = await buildWorker(batchSize).sweep();
    knex.off('query', count);

    expect(result.abandonedCount).toBe(cartCount);
    // What was measured, before how long it took (issue #140): a sweep that
    // found nothing issues one statement and would pass any ceiling.
    const batches = cartCount / batchSize;
    expect(statements).toBeLessThanOrEqual(batches * STATEMENTS_PER_BATCH_CEILING + 1);
  });

  it('costs the same at ten times the corpus, in one batch — the O(batches) claim', async () => {
    // Two corpus sizes, one batch each, so the only difference is how many
    // carts that batch holds. A statement per cart puts the ratio at ten; a
    // statement per batch leaves it at one. Unlike a wall clock, the ratio
    // says the same thing on a busy machine as on an idle one.
    const small = 4;
    const large = 40;
    const knex: Knex = db.em().getConnection().getKnex();

    const statementsFor = async (cartCount: number): Promise<number> => {
      await seedEligibleCarts(cartCount, 1);
      let statements = 0;
      const count = (): void => {
        statements += 1;
      };
      knex.on('query', count);
      const result = await buildWorker(cartCount).sweep();
      knex.off('query', count);
      expect(result.abandonedCount).toBe(cartCount);
      return statements;
    };

    const smallStatements = await statementsFor(small);
    const largeStatements = await statementsFor(large);

    expect(smallStatements).toBeLessThanOrEqual(STATEMENTS_PER_BATCH_CEILING + 1);
    expect(largeStatements).toBeLessThanOrEqual(STATEMENTS_PER_BATCH_CEILING + 1);
    expect(largeStatements / smallStatements).toBeLessThan(2);
  });

  it('audits every swept cart exactly once across batch boundaries', async () => {
    const cartIds = await seedEligibleCarts(25, 1);

    const result = await buildWorker(10).sweep();
    expect(result.abandonedCount).toBe(25);
    expect(result.notifiedCount).toBe(25);

    const em = db.em();
    const cartAudits = await em.find(CartAuditEntry, { cartId: { $in: cartIds } });
    expect(cartAudits).toHaveLength(25);
    expect(cartAudits.every((a) => a.action === 'abandonment_swept')).toBe(true);
    expect(cartAudits.every((a) => a.actorType === 'sweep')).toBe(true);

    const platformAudits = await em.find(AuditLogEntry, {
      objectType: 'cart',
      objectId: { $in: cartIds },
    });
    expect(platformAudits).toHaveLength(25);

    const swept = await em.find(Cart, { id: { $in: cartIds } });
    expect(swept.every((c) => c.status === 'abandoned')).toBe(true);
  });

  it('leaves nothing it swept in the identity map', async () => {
    await seedEligibleCarts(30, 1);

    const em = db.em();
    await buildWorker(10).sweep();

    // The retained identity map is the other half of the superlinear cost: the
    // flush cost of batch N used to include every entity batches 1..N-1 had
    // touched. Counting what survives the sweep is how that stays fixed.
    const retained = [...em.getUnitOfWork().getIdentityMap().values()];
    expect(retained).toHaveLength(0);
  });

  it('records the line count each cart actually had', async () => {
    const em = db.em();
    const stale = new Date(Date.now() - 60 * 60_000);
    const empty = em.create(Cart, {
      anonymousCartToken: `anon-lines-${Date.now()}-empty`,
      ...(systemDefaultChannelId ? { salesChannelId: systemDefaultChannelId } : {}),
      lastActivityAt: stale,
    });
    const three = em.create(Cart, {
      anonymousCartToken: `anon-lines-${Date.now()}-three`,
      ...(systemDefaultChannelId ? { salesChannelId: systemDefaultChannelId } : {}),
      lastActivityAt: stale,
    });
    await em.flush();
    for (let l = 0; l < 3; l += 1) {
      em.create(CartItem, {
        cartId: three.id,
        productId: '00000000-0000-4000-8000-000000000101',
        quantity: 1,
        unitPrice: '1.00',
        currency: 'PLN',
      });
    }
    await em.flush();
    em.clear();

    const result = await buildWorker(10).sweep();
    expect(result.abandonedCount).toBe(2);
    // Empty-cart suppression survives the batched line-count read.
    expect(result.notifiedCount).toBe(1);

    const emptyAudit = await em.findOneOrFail(CartAuditEntry, { cartId: empty.id });
    expect((emptyAudit.metadata as { lineCount: number }).lineCount).toBe(0);
    const threeAudit = await em.findOneOrFail(CartAuditEntry, { cartId: three.id });
    expect((threeAudit.metadata as { lineCount: number }).lineCount).toBe(3);
  });
});
