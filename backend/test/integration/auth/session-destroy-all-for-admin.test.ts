import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '@endora-commerce/mod-auth/backend';
import { Session } from '../../helpers/package-entities.js';

/**
 * `SessionService.destroyAllForAdmin` — the revocation behind a peer password
 * reset, a deactivation, a delete and a self-service password change.
 *
 * It takes the administrator's own sessions and the impersonations they
 * started, from Postgres and from the Redis cache, and nobody else's. With
 * `exceptSessionId` it leaves exactly one of them — the session the
 * administrator changed their own password from — and an id that is not one of
 * theirs spares nothing.
 *
 * The session table carries no foreign key to either account table, so the ids
 * here are free-standing.
 */
describe('SessionService.destroyAllForAdmin', () => {
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

  async function held(adminUserId: string): Promise<string[]> {
    const rows = await em.find(Session, {
      $or: [{ adminUserId }, { impersonatorAdminUserId: adminUserId }],
    });
    return rows.map((row) => row.id).sort();
  }

  it('revokes the sign-ins and the impersonations, and nobody else\'s', async () => {
    const admin = randomUUID();
    const bystander = randomUUID();
    const s1 = await service.createSession({ kind: 'admin', adminUserId: admin });
    const s2 = await service.createSession({ kind: 'admin', adminUserId: admin });
    const impersonation = await service.createSession({
      kind: 'impersonation',
      customerAccountId: randomUUID(),
      impersonatorAdminUserId: admin,
    });
    const other = await service.createSession({ kind: 'admin', adminUserId: bystander });

    await service.destroyAllForAdmin(admin);

    expect(await held(admin)).toEqual([]);
    for (const gone of [s1, s2, impersonation]) {
      expect(await redis.get(`session:${gone.session.id}`)).toBeNull();
      expect(await service.loadSession(gone.cookieValue)).toBeNull();
    }
    expect(await service.loadSession(other.cookieValue)).not.toBeNull();
  });

  it('keeps exactly the excepted session', async () => {
    const admin = randomUUID();
    const calling = await service.createSession({ kind: 'admin', adminUserId: admin });
    const otherBrowser = await service.createSession({ kind: 'admin', adminUserId: admin });
    const impersonation = await service.createSession({
      kind: 'impersonation',
      customerAccountId: randomUUID(),
      impersonatorAdminUserId: admin,
    });

    await service.destroyAllForAdmin(admin, { exceptSessionId: calling.session.id });

    expect(await held(admin)).toEqual([calling.session.id]);
    expect(await service.loadSession(calling.cookieValue)).not.toBeNull();
    expect(await redis.get(`session:${calling.session.id}`)).not.toBeNull();
    expect(await service.loadSession(otherBrowser.cookieValue)).toBeNull();
    expect(await service.loadSession(impersonation.cookieValue)).toBeNull();
  });

  it('spares nothing for an id that is not one of the administrator\'s sessions', async () => {
    const admin = randomUUID();
    const bystander = randomUUID();
    const own = await service.createSession({ kind: 'admin', adminUserId: admin });
    const other = await service.createSession({ kind: 'admin', adminUserId: bystander });

    await service.destroyAllForAdmin(admin, { exceptSessionId: other.session.id });

    expect(await held(admin)).toEqual([]);
    expect(await service.loadSession(own.cookieValue)).toBeNull();
    // Naming it as the exception did not put the bystander's session at risk either.
    expect(await service.loadSession(other.cookieValue)).not.toBeNull();
  });

  it('is a no-op for an administrator with no sessions', async () => {
    await expect(service.destroyAllForAdmin(randomUUID())).resolves.toBeUndefined();
  });
});
