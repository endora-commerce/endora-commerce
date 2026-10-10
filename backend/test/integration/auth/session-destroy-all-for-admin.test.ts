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

  /**
   * The revocation racing a request from the session it revokes.
   *
   * `loadSession` reads the row and then fills the Redis cache. A revocation
   * that lands between the two used to leave the fill behind: the row was
   * gone, the cache entry was written after the revocation had cleared it, and
   * the revoked session answered from the cache until its thirty-day expiry.
   * The interleaving is forced here by revoking from inside the cache write.
   */
  it('does not let a cache fill outlive the row it was filled from', async () => {
    const admin = randomUUID();
    const calling = await service.createSession({ kind: 'admin', adminUserId: admin });
    const other = await service.createSession({ kind: 'admin', adminUserId: admin });
    // The other session is not cached, so its next load goes to the database.
    await redis.del(`session:${other.session.id}`);

    let revoked = false;
    const racing = new Proxy(redis, {
      get(target, property, receiver) {
        if (property !== 'set') {
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          const key = String(args[0]);
          if (!revoked && key === `session:${other.session.id}`) {
            revoked = true;
            // The row has been read; revoke before the fill is written.
            await service.destroyAllForAdmin(admin, { exceptSessionId: calling.session.id });
          }
          return (target.set as (...a: unknown[]) => Promise<unknown>)(...args);
        };
      },
    });
    const racingService = new SessionService(() => em, racing);

    const duringTheRace = await racingService.loadSession(other.cookieValue);
    expect(revoked).toBe(true);
    expect(duringTheRace).toBeNull();
    expect(await redis.get(`session:${other.session.id}`)).toBeNull();
    expect(await service.loadSession(other.cookieValue)).toBeNull();
    expect(await service.loadSession(calling.cookieValue)).not.toBeNull();
  });

  it('removes the rows before the cache entries', async () => {
    const admin = randomUUID();
    const held = await service.createSession({ kind: 'admin', adminUserId: admin });
    const order: string[] = [];
    const observing = new Proxy(redis, {
      get(target, property, receiver) {
        if (property !== 'del') {
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          const rows = await em.count(Session, { id: held.session.id });
          order.push(`del-with-${rows}-rows`);
          return (target.del as (...a: unknown[]) => Promise<unknown>)(...args);
        };
      },
    });
    await new SessionService(() => em, observing).destroyAllForAdmin(admin);
    expect(order).toEqual(['del-with-0-rows']);
  });
});

