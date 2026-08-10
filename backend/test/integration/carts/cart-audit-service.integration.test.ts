import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartAuditEntry } from '../../../src/modules/carts/entities/cart-audit-entry.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { CartAuditService } from '../../../src/modules/carts/services/cart-audit-service.js';

/**
 * T019 (feature 027) — Cart audit writer lands two rows per record() call,
 * always in the same transaction (partial commit is structurally
 * impossible). Tests against real PostgreSQL.
 */

describe('CartAuditService — dual-landing audit writer', () => {
  let db: TestDb;
  let auditLog: AuditLogService;
  let cartAudit: CartAuditService;
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
    auditLog = new AuditLogService(emFactory);
    cartAudit = new CartAuditService(emFactory, auditLog);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('writes one cart_audit_entries row + one audit_log_entries row per call', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-audit-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);

    await cartAudit.record({
      cartId: cart.id,
      actorType: 'customer',
      actorId: '00000000-0000-4000-8000-000000000c11',
      action: 'line_added',
      fromState: null,
      toState: 'active',
      metadata: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
    });

    const cartRows = await em.find(CartAuditEntry, { cartId: cart.id });
    expect(cartRows).toHaveLength(1);
    expect(cartRows[0]?.action).toBe('line_added');
    expect(cartRows[0]?.actorType).toBe('customer');
    expect((cartRows[0]?.metadata as { quantity: number }).quantity).toBe(2);

    const platformRows = await em.find(AuditLogEntry, { objectType: 'cart', objectId: cart.id });
    expect(platformRows).toHaveLength(1);
    expect(platformRows[0]?.action).toBe('cart.line_added');
    expect(platformRows[0]?.impersonatedCustomerAccountId).toBe(
      '00000000-0000-4000-8000-000000000c11',
    );
    expect(platformRows[0]?.actorAdminUserId ?? null).toBeNull();
  });

  it('routes platform_admin actors into audit_log_entries.actor_admin_user_id', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-admin-audit-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);

    await cartAudit.record({
      cartId: cart.id,
      actorType: 'platform_admin',
      actorId: '00000000-0000-4000-8000-0000000000b1',
      action: 'admin_rejected',
      fromState: 'active',
      toState: 'rejected',
      reason: 'Out of budget',
    });

    const platformRow = await em.findOneOrFail(AuditLogEntry, {
      objectType: 'cart',
      objectId: cart.id,
    });
    expect(platformRow.actorAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');
    expect(platformRow.impersonatedCustomerAccountId ?? null).toBeNull();
    expect(platformRow.action).toBe('cart.admin_rejected');
  });

  it('lands sweep / system actors with no admin or customer id (audit-only)', async () => {
    const em = db.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-sweep-audit-${Date.now()}`,
      salesChannelId: systemDefaultChannelId,
    });
    await em.persistAndFlush(cart);

    await cartAudit.record({
      cartId: cart.id,
      actorType: 'sweep',
      action: 'abandonment_swept',
      fromState: 'active',
      toState: 'abandoned',
    });

    const platformRow = await em.findOneOrFail(AuditLogEntry, {
      objectType: 'cart',
      objectId: cart.id,
    });
    expect(platformRow.actorAdminUserId ?? null).toBeNull();
    expect(platformRow.impersonatedCustomerAccountId ?? null).toBeNull();
    expect(platformRow.action).toBe('cart.abandonment_swept');
  });
});
