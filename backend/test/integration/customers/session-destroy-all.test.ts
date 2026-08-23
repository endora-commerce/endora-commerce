import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '../../../src/modules/auth/services/session-service.js';
import { Session } from '../../../src/modules/auth/entities/session.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * Integration test for SessionService.destroyAllForCustomer (feature 040,
 * FR-016/SC-002): blocking or deleting a customer must revoke every one of
 * their sessions across both Postgres and the Redis cache, without touching
 * other customers' sessions.
 */
describe('SessionService.destroyAllForCustomer', () => {
  let db: TestDb;
  let em: EntityManager;
  let redis: Redis;
  let service: SessionService;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  beforeEach(async () => {
    em = await db.beginTx();
    service = new SessionService(() => em, redis);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await redis.quit();
    await db.close();
  });

  async function makeCustomer(email: string): Promise<string> {
    const c = em.create(CustomerAccount, {
      email,
      passwordHash: 'x'.repeat(32),
      firstName: 'Test',
      lastName: 'Customer',
    });
    await em.persistAndFlush(c);
    return c.id;
  }

  it('revokes all of a customer\'s sessions and leaves others intact', async () => {
    const targetId = await makeCustomer(`target-${Date.now()}@example.test`);
    const otherId = await makeCustomer(`other-${Date.now()}@example.test`);

    const s1 = await service.createSession({ kind: 'customer', customerAccountId: targetId });
    const s2 = await service.createSession({ kind: 'customer', customerAccountId: targetId });
    const sOther = await service.createSession({ kind: 'customer', customerAccountId: otherId });

    // Sanity: both target sessions resolve before revocation.
    expect(await service.loadSession(s1.cookieValue)).not.toBeNull();
    expect(await service.loadSession(s2.cookieValue)).not.toBeNull();

    await service.destroyAllForCustomer(targetId);

    // Target sessions gone from Postgres…
    const remainingForTarget = await em.find(Session, { customerAccountId: targetId });
    expect(remainingForTarget).toHaveLength(0);
    // …and from the Redis cache.
    expect(await redis.get(`session:${s1.session.id}`)).toBeNull();
    expect(await redis.get(`session:${s2.session.id}`)).toBeNull();

    // The unrelated customer's session survives.
    const remainingForOther = await em.find(Session, { customerAccountId: otherId });
    expect(remainingForOther).toHaveLength(1);
    expect(remainingForOther[0]!.id).toBe(sOther.session.id);
  });

  it('is a no-op for a customer with no sessions', async () => {
    const id = await makeCustomer(`empty-${Date.now()}@example.test`);
    await expect(service.destroyAllForCustomer(id)).resolves.toBeUndefined();
  });
});
