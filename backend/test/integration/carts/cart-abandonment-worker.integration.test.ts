import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { CartAuditEntry } from '../../../src/modules/carts/entities/cart-audit-entry.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { CartAuditService } from '../../../src/modules/carts/services/cart-audit-service.js';
import { CartAbandonmentWorker } from '../../../src/modules/carts/services/cart-abandonment-worker.js';

/**
 * T100 / T101 (feature 027 US5) — CartAbandonmentWorker integration test.
 *
 * Exercises the sweep against real PostgreSQL:
 *   - eligible carts flip from `active` → `abandoned`
 *   - empty carts flip status but suppress the notification
 *   - idempotency: a second sweep tick is a no-op
 *   - inactivityMinutes <= 0 disables the sweep
 *   - notification recipient empty → no dispatch
 */

describe('CartAbandonmentWorker.sweep', () => {
  let db: TestDb;
  let worker: CartAbandonmentWorker;
  let dispatchSpy: ReturnType<typeof vi.fn>;
  let resolveInactivity: () => Promise<number>;
  let resolveRecipient: () => Promise<string>;
  let systemDefaultChannelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    const tmpEm = db.orm.em.fork();
    const ch = await tmpEm.findOne(SalesChannel, { systemDefault: true });
    systemDefaultChannelId = ch?.id ?? '';
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    const em = db.em();
    const emFactory = () => em;
    dispatchSpy = vi.fn().mockResolvedValue(undefined);
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
