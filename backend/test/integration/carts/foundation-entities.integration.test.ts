import { Cart, CartAuditEntry, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { setupTestDb, type TestDb } from '../../helpers/test-db.js';


/**
 * T018 (feature 027) — Foundational entity round-trip + CHECK constraint
 * coverage for the consolidation migration (050_carts_consolidation).
 *
 * Exercises the real PostgreSQL schema (Principle III — no DB mocks):
 *   - every new column on `carts` round-trips through MikroORM
 *   - `carts_status_check` refuses out-of-set status values
 *   - `carts_approval_status_check` refuses out-of-set approval values
 *   - `cart_audit_entries_actor_type_check` refuses out-of-set actor types
 *   - `cart_items.recomputed_*` round-trip
 *   - `version` increments on every update (optimistic-lock token)
 */

describe('carts foundation — entity round-trip & CHECK constraints', () => {
  let db: TestDb;
  let systemDefaultChannelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    systemDefaultChannelId = db.systemDefaultChannelId;
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('persists every new column on the carts entity through MikroORM', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-test-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
      appliedPromotionCode: 'WIOSNA10',
    });
    await em.persistAndFlush(cart);

    const reload = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reload.status).toBe('active');
    expect(reload.approvalStatus).toBe('not_required');
    expect(reload.appliedPromotionCode).toBe('WIOSNA10');
    expect(reload.lastActivityAt).toBeInstanceOf(Date);
    // `version` starts at 0 on INSERT; the @Property({version:true}) decorator
    // auto-increments only on UPDATE (covered by the next test).
    expect(reload.version).toBeGreaterThanOrEqual(0);
  });

  it('increments `version` on every update (optimistic-lock token)', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-version-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);
    const initialVersion = cart.version;

    cart.appliedPromotionCode = 'CHANGED';
    await em.flush();
    expect(cart.version).toBeGreaterThan(initialVersion);
  });

  it('refuses an out-of-set status via the CHECK constraint', async () => {
    const em = db.em();
    // Raw SQL bypasses entity validation so we land squarely on the DB CHECK.
    await expect(
      em
        .getConnection()
        .execute(
          `insert into "carts" ("id", "status", "approval_status", "last_activity_at", "created_at", "updated_at", "version")
           values (gen_random_uuid(), 'paused', 'not_required', now(), now(), now(), 0)`,
        ),
    ).rejects.toThrow(/carts_status_check/);
  });

  it('refuses an out-of-set approval_status via the CHECK constraint', async () => {
    const em = db.em();
    await expect(
      em
        .getConnection()
        .execute(
          `insert into "carts" ("id", "status", "approval_status", "last_activity_at", "created_at", "updated_at", "version")
           values (gen_random_uuid(), 'active', 'waiting', now(), now(), now(), 0)`,
        ),
    ).rejects.toThrow(/carts_approval_status_check/);
  });

  it('refuses an out-of-set actor_type on cart_audit_entries', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-audit-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);

    await expect(
      em
        .getConnection()
        .execute(
          `insert into "cart_audit_entries" ("id", "cart_id", "occurred_at", "actor_type", "action", "metadata")
           values (gen_random_uuid(), ?, now(), 'robot', 'line_added', '{}'::jsonb)`,
          [cart.id],
        ),
    ).rejects.toThrow(/cart_audit_entries_actor_type_check/);
  });

  it('round-trips the two-layer pricing snapshot on cart_items', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-cart-item-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);

    const item = em.create(CartItem, {
      cartId: cart.id,
      productId: '00000000-0000-4000-8000-000000000101',
      quantity: 3,
      unitPrice: '19.99',
      currency: 'PLN',
      recomputedUnitPrice: '17.50',
      recomputedCurrency: 'PLN',
      recomputedAt: new Date(),
    });
    await em.persistAndFlush(item);

    const reload = await em.findOneOrFail(CartItem, { id: item.id });
    expect(reload.unitPrice).toBe('19.99');
    expect(reload.recomputedUnitPrice).toBe('17.50');
    expect(reload.recomputedCurrency).toBe('PLN');
    expect(reload.recomputedAt).toBeInstanceOf(Date);
  });

  it('persists a CartAuditEntry row with typed metadata', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-audit-row-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);

    const entry = em.create(CartAuditEntry, {
      cartId: cart.id,
      actorType: 'system',
      action: 'abandonment_swept',
      fromState: 'active',
      toState: 'abandoned',
      metadata: { threshold_minutes: 10080 },
    });
    await em.persistAndFlush(entry);

    const reload = await em.findOneOrFail(CartAuditEntry, { id: entry.id });
    expect(reload.action).toBe('abandonment_swept');
    expect(reload.fromState).toBe('active');
    expect(reload.toState).toBe('abandoned');
    expect((reload.metadata as { threshold_minutes: number }).threshold_minutes).toBe(10080);
  });
});
