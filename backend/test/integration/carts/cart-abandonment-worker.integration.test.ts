import { Cart, CartAuditEntry, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import { AuditLogService } from '@endora-commerce/platform/composition';

import { CartAuditService } from '../../../../packages/modules/carts/src/backend/services/cart-audit-service.js';

import {
  CartAbandonmentWorker,
  ORPHANED_WORKING_BASKET_MINUTES,
} from '../../../../packages/modules/carts/src/backend/services/cart-abandonment-worker.js';


/**
 * T100 / T101 (feature 027 US5) — CartAbandonmentWorker integration test.
 *
 * Exercises the sweep against real PostgreSQL:
 *   - eligible carts flip from `active` → `abandoned`
 *   - empty carts flip status but suppress the notification
 *   - idempotency: a second sweep tick is a no-op
 *   - inactivityMinutes <= 0 disables the sweep
 *   - notification recipient empty → no dispatch
 *   - working baskets orphaned past the safe age are removed (issue #602),
 *     and nothing else is
 */

type DispatchNotification = NonNullable<
  ConstructorParameters<typeof CartAbandonmentWorker>[0]['dispatchNotification']
>;

describe('CartAbandonmentWorker.sweep', () => {
  let db: TestDb;
  let worker: CartAbandonmentWorker;
  let dispatchSpy: Mock<DispatchNotification>;
  let resolveInactivity: () => Promise<number>;
  let resolveRecipient: () => Promise<string>;
  let systemDefaultChannelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    systemDefaultChannelId = db.systemDefaultChannelId;
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    const em = db.em();
    const emFactory = () => em;
    dispatchSpy = vi.fn<DispatchNotification>().mockResolvedValue(undefined);
    resolveInactivity = vi.fn().mockResolvedValue(10);   // 10 minutes
    resolveRecipient = vi.fn().mockResolvedValue('abandon@example.com');
    const auditLog = new AuditLogService(emFactory);
    const cartAuditService = new CartAuditService(emFactory, auditLog);
    worker = new CartAbandonmentWorker({
      emFactory,
      cartAuditService,
      resolveInactivityMinutes: () => resolveInactivity(),
      resolveNotificationRecipient: () => resolveRecipient(),
      dispatchNotification: dispatchSpy,
    });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('flips an idle non-empty cart to abandoned and dispatches one notification', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-aban-${Date.now()}-A`,
      salesChannelId: systemDefaultChannelId,
      lastActivityAt: new Date(Date.now() - 30 * 60_000), // 30 min ago
    });
    await em.persistAndFlush(cart);
    em.create(CartItem, {
      cartId: cart.id,
      productId: '00000000-0000-4000-8000-000000000101',
      quantity: 1,
      unitPrice: '12.50',
      currency: 'PLN',
    });
    await em.flush();

    const result = await worker.sweep();
    expect(result.abandonedCount).toBe(1);
    expect(result.notifiedCount).toBe(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const reload = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reload.status).toBe('abandoned');
    expect(reload.abandonmentNotifiedAt).toBeInstanceOf(Date);

    const audit = await em.find(CartAuditEntry, { cartId: cart.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('abandonment_swept');
    expect(audit[0]?.actorType).toBe('sweep');
  });

  it('flips an idle EMPTY cart to abandoned but suppresses the e-mail', async () => {
    const em = db.em();
    em.create(Cart, {
      anonymousCartToken: `anon-aban-${Date.now()}-empty`,
      salesChannelId: systemDefaultChannelId,
      lastActivityAt: new Date(Date.now() - 30 * 60_000),
    });
    await em.flush();

    const result = await worker.sweep();
    expect(result.abandonedCount).toBe(1);
    expect(result.notifiedCount).toBe(0); // suppressed
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: a second sweep tick is a no-op for already-notified carts', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-aban-${Date.now()}-idem`,
      salesChannelId: systemDefaultChannelId,
      lastActivityAt: new Date(Date.now() - 30 * 60_000),
    });
    await em.persistAndFlush(cart);
    em.create(CartItem, {
      cartId: cart.id,
      productId: '00000000-0000-4000-8000-000000000101',
      quantity: 1,
      unitPrice: '10.00',
      currency: 'PLN',
    });
    await em.flush();

    await worker.sweep();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const second = await worker.sweep();
    expect(second.abandonedCount).toBe(0);
    expect(second.notifiedCount).toBe(0);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips carts whose last_activity_at is within the threshold', async () => {
    const em = db.em();
    em.create(Cart, {
      anonymousCartToken: `anon-aban-${Date.now()}-fresh`,
      salesChannelId: systemDefaultChannelId,
      lastActivityAt: new Date(Date.now() - 5 * 60_000), // 5 min ago — threshold is 10
    });
    await em.flush();

    const result = await worker.sweep();
    expect(result.abandonedCount).toBe(0);
  });

  it('disables itself when inactivityMinutes is 0', async () => {
    resolveInactivity = vi.fn().mockResolvedValue(0);
    const em = db.em();
    em.create(Cart, {
      anonymousCartToken: `anon-aban-${Date.now()}-disabled`,
      salesChannelId: systemDefaultChannelId,
      lastActivityAt: new Date(Date.now() - 30 * 60_000),
    });
    await em.flush();

    // Rebuild worker with the new resolver.
    const emFactory = () => em;
    const auditLog = new AuditLogService(emFactory);
    const cartAuditService = new CartAuditService(emFactory, auditLog);
    const disabledWorker = new CartAbandonmentWorker({
      emFactory,
      cartAuditService,
      resolveInactivityMinutes: () => resolveInactivity(),
      resolveNotificationRecipient: () => resolveRecipient(),
      dispatchNotification: dispatchSpy,
    });

    const result = await disabledWorker.sweep();
    expect(result.abandonedCount).toBe(0);
  });

  describe('orphaned working baskets (issue #602)', () => {
    /** A basket in `status`, created `ageMinutes` ago, with one line. */
    async function basket(status: 'working' | 'active', ageMinutes: number, tag: string) {
      const em = db.em();
      const cart = em.create(Cart, {
        anonymousCartToken: `anon-orphan-${Date.now()}-${tag}`,
        salesChannelId: systemDefaultChannelId,
        status,
        lastActivityAt: new Date(),
      });
      await em.persistAndFlush(cart);
      em.create(CartItem, {
        cartId: cart.id,
        productId: '00000000-0000-4000-8000-000000000101',
        quantity: 1,
        unitPrice: '5.00',
        currency: 'PLN',
      });
      await em.flush();
      // `createdAt` is stamped on insert, so the age is written afterwards.
      await em.nativeUpdate(
        Cart,
        { id: cart.id },
        { createdAt: new Date(Date.now() - ageMinutes * 60_000) },
      );
      em.clear();
      return cart.id;
    }

    it('removes a working basket older than the safe age, lines included', async () => {
      const orphan = await basket('working', ORPHANED_WORKING_BASKET_MINUTES + 5, 'old');

      const result = await worker.sweep();
      expect(result.workingBasketsRemoved).toBe(1);

      const em = db.em();
      expect(await em.findOne(Cart, { id: orphan })).toBeNull();
      expect(await em.count(CartItem, { cartId: orphan })).toBe(0);
    });

    it('leaves a working basket younger than the safe age alone', async () => {
      const inFlight = await basket('working', ORPHANED_WORKING_BASKET_MINUTES - 5, 'young');

      const result = await worker.sweep();
      expect(result.workingBasketsRemoved).toBe(0);
      expect(await db.em().findOne(Cart, { id: inFlight })).not.toBeNull();
    });

    it('never removes a basket that is not a working one, however old', async () => {
      const buyers = await basket('active', ORPHANED_WORKING_BASKET_MINUTES * 1000, 'active');

      const result = await worker.sweep();
      expect(result.workingBasketsRemoved).toBe(0);
      expect(await db.em().findOne(Cart, { id: buyers })).not.toBeNull();
    });

    it('still removes orphans when the abandonment sweep itself is disabled', async () => {
      resolveInactivity = vi.fn().mockResolvedValue(0);
      const orphan = await basket('working', ORPHANED_WORKING_BASKET_MINUTES + 5, 'disabled');

      const result = await worker.sweep();
      expect(result.abandonedCount).toBe(0);
      expect(result.workingBasketsRemoved).toBe(1);
      expect(await db.em().findOne(Cart, { id: orphan })).toBeNull();
    });
  });

  describe('hasSweepWork — the scheduled tick\'s question (issue #1119)', () => {
    /** A cart in `status`, created and last active `ageMinutes` ago. */
    async function cartAged(status: 'working' | 'active', ageMinutes: number, tag: string) {
      const em = db.em();
      const at = new Date(Date.now() - ageMinutes * 60_000);
      const cart = em.create(Cart, {
        anonymousCartToken: `anon-probe-${Date.now()}-${tag}`,
        salesChannelId: systemDefaultChannelId,
        status,
        lastActivityAt: at,
      });
      await em.persistAndFlush(cart);
      await em.nativeUpdate(Cart, { id: cart.id }, { createdAt: at });
      em.clear();
      return cart.id;
    }

    /** What a pass would do, without letting it: the sweep runs and the transaction rolls back after the test. */
    const passDoesSomething = async (): Promise<boolean> => {
      const result = await worker.sweep();
      return result.abandonedCount + result.workingBasketsRemoved > 0;
    };

    it('answers yes for an orphaned working basket', async () => {
      await cartAged('working', ORPHANED_WORKING_BASKET_MINUTES + 5, 'orphan');
      expect(await worker.hasSweepWork()).toBe(true);
    });

    it('answers yes for an orphaned working basket while the abandonment threshold is disabled', async () => {
      resolveInactivity = vi.fn().mockResolvedValue(0);
      await cartAged('working', ORPHANED_WORKING_BASKET_MINUTES + 5, 'orphan-disabled');
      expect(await worker.hasSweepWork()).toBe(true);
    });

    it('answers yes for an active cart idle past the threshold', async () => {
      await cartAged('active', 30, 'idle');
      expect(await worker.hasSweepWork()).toBe(true);
    });

    it('does not count an idle active cart while the threshold is disabled', async () => {
      resolveInactivity = vi.fn().mockResolvedValue(0);
      await cartAged('active', 30, 'idle-disabled');
      expect(await worker.hasSweepWork()).toBe(await passDoesSomething());
    });

    it('agrees with the pass over carts it must not touch — fresh, young working, already notified', async () => {
      await cartAged('active', 5, 'fresh');
      await cartAged('working', ORPHANED_WORKING_BASKET_MINUTES - 5, 'young');
      const notified = await cartAged('active', 30, 'notified');
      await db.em().nativeUpdate(Cart, { id: notified }, { abandonmentNotifiedAt: new Date() });

      const asked = await worker.hasSweepWork();
      expect(asked).toBe(await passDoesSomething());
      // And after a pass there is nothing left to ask about.
      expect(await worker.hasSweepWork()).toBe(false);
    });
  });

  it('suppresses the e-mail when the notification recipient is empty', async () => {
    resolveRecipient = vi.fn().mockResolvedValue('');
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-aban-${Date.now()}-no-recip`,
      salesChannelId: systemDefaultChannelId,
      lastActivityAt: new Date(Date.now() - 30 * 60_000),
    });
    await em.persistAndFlush(cart);
    em.create(CartItem, {
      cartId: cart.id,
      productId: '00000000-0000-4000-8000-000000000101',
      quantity: 1,
      unitPrice: '8.00',
      currency: 'PLN',
    });
    await em.flush();

    // Rebuild worker with the empty-recipient resolver.
    const emFactory = () => em;
    const auditLog = new AuditLogService(emFactory);
    const cartAuditService = new CartAuditService(emFactory, auditLog);
    const noRecipWorker = new CartAbandonmentWorker({
      emFactory,
      cartAuditService,
      resolveInactivityMinutes: () => resolveInactivity(),
      resolveNotificationRecipient: () => resolveRecipient(),
      dispatchNotification: dispatchSpy,
    });

    const result = await noRecipWorker.sweep();
    expect(result.abandonedCount).toBe(1);
    expect(result.notifiedCount).toBe(0);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
