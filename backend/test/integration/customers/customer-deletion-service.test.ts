import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '../../../src/modules/auth/services/session-service.js';
import { AuditLogService } from '../../../src/modules/audit_logs/services/audit-log-service.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { CustomerAuthorityService } from '../../../src/modules/customers/services/customer-authority-service.js';
import { CustomerDeletionService } from '../../../src/modules/customers/services/customer-deletion-service.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';

/**
 * Feature 040, US7 — soft-delete, restore within window, and the permanent
 * anonymization sweep.
 */
describe('CustomerDeletionService', () => {
  let db: TestDb;
  let em: EntityManager;
  let redis: Redis;
  let svc: CustomerDeletionService;
  const actor = { adminUserId: '00000000-0000-4000-8000-00000000b001', isPlatformAdmin: true };

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  beforeEach(async () => {
    em = await db.beginTx();
    const sessions = new SessionService(() => em, redis);
    svc = new CustomerDeletionService(
      () => em,
      new CustomerAuthorityService({ canSeeOrganization: async () => true }),
      new AuditLogService(() => em),
      { destroyAllForCustomer: (id) => sessions.destroyAllForCustomer(id) },
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await redis.quit();
    await db.close();
  });

  async function makeCustomer(): Promise<CustomerAccount> {
    const c = em.create(CustomerAccount, {
      email: `del-${Date.now()}-${Math.floor(performance.now())}@example.test`,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Del',
      lastName: 'Target',
    });
    await em.persistAndFlush(c);
    return c;
  }

  it('soft-deletes (sets deletedAt + audit) and refuses a second delete', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.deletedAt).not.toBeNull();
    expect(reloaded!.deletionRequestedByAdminUserId).toBe(actor.adminUserId);
    expect(await em.find(AuditLogEntry, { action: 'customer_account.deleted', objectId: c.id })).toHaveLength(1);

    await expect(svc.softDelete(c.id, actor)).rejects.toMatchObject({ code: 'CUSTOMER_ALREADY_DELETED' });
  });

  it('restores within the window and audits', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    await svc.restore(c.id, actor);
    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.deletedAt).toBeNull();
    expect(await em.find(AuditLogEntry, { action: 'customer_account.restored', objectId: c.id })).toHaveLength(1);
  });

  it('sweep does not anonymize within the retention window', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    const count = await svc.sweep(365, new Date());
    expect(count).toBe(0);
    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.anonymizedAt ?? null).toBeNull();
  });

  it('sweep anonymizes after the window; restore then fails', async () => {
    const c = await makeCustomer();
    const originalEmail = c.email;
    await svc.softDelete(c.id, actor);

    // retentionDays 0 with a future "now" puts the cutoff after deletedAt.
    const count = await svc.sweep(0, new Date(Date.now() + 60_000));
    expect(count).toBe(1);

    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.anonymizedAt).not.toBeNull();
    expect(reloaded!.email).not.toBe(originalEmail);
    expect(reloaded!.email).toContain('anonymized.invalid');
    expect(reloaded!.firstName).toBe('Deleted customer');
    expect(await em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: c.id })).toHaveLength(1);

    await expect(svc.restore(c.id, actor)).rejects.toMatchObject({
      code: 'CUSTOMER_RESTORE_WINDOW_ELAPSED',
    });
  });
});
