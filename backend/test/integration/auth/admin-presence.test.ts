import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type AuthSessionReadPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { authPlugin, type AuthPluginOptions } from '../../../../packages/modules/auth/src/backend/plugin.js';

/**
 * When an administrator was last seen — the stamp and the read, against the
 * real session table and the real Redis throttle
 * (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §CAL-B).
 *
 * The shared harness resolves actors through a stand-in of its own and never
 * runs `auth`'s `onRequest` hook, so the plugin is mounted here on a small
 * application beside it, over the harness's own `SessionService` — the store
 * and the throttle are the ones every other test of the run uses.
 *
 * The stamp is fire-and-forget by design (a presence write must never slow or
 * fail a request), so each assertion waits for the row rather than for the
 * response.
 */
describe('auth — an administrator’s presence', () => {
  let h: BackendServerHandle;
  let app: FastifyInstance;

  const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

  const lastSeenOf = async (sessionId: string): Promise<Date | null> => {
    const rows = (await h.em().getConnection().execute(`select "last_seen_at" from "sessions" where "id" = ?`, [
      sessionId,
    ])) as Array<{ last_seen_at: Date | null }>;
    return rows[0]?.last_seen_at ? new Date(rows[0].last_seen_at) : null;
  };
  const backdate = (sessionId: string, to: Date = LONG_AGO) =>
    h.em().getConnection().execute(`update "sessions" set "last_seen_at" = ? where "id" = ?`, [to, sessionId]);

  /** Wait until the row says something other than `stale`, or give up. */
  const stampedAfter = async (sessionId: string, stale: Date): Promise<Date | null> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const seen = await lastSeenOf(sessionId);
      if (seen && seen.getTime() !== stale.getTime()) return seen;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };
  /** Long enough for a stamp that was going to be written to have been. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  const ask = async (cookies: Record<string, string>) => {
    const response = await app.inject({ method: 'GET', url: '/who', cookies });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { actor: string; admin: string | null }) ?? null;
  };

  const reads = () => h.container.resolve('authSessionReadPort') as AuthSessionReadPort;

  beforeAll(async () => {
    h = await setupBackendServer();
    app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin, {
      // The plugin is this checkout's source and the harness's service is the
      // built package's: one class, two declarations to the type-checker.
      sessionService: h.sessionService as unknown as AuthPluginOptions['sessionService'],
    });
    app.get('/who', async (request) => ({
      actor: request.actor.kind,
      admin: request.adminActor?.adminUserId ?? null,
    }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await teardownBackendServer(h);
  });

  describe('the stamp (§CAL-B3)', () => {
    it('an authenticated admin request stamps the session, and a second one inside the minute writes nothing', async () => {
      const { cookieValue, session } = await h.sessionService.createSession({ kind: 'admin', adminUserId: TEST_ADMIN_ID });
      await backdate(session.id);
      const before = Date.now();

      expect(await ask({ [ADMIN_SESSION_COOKIE_NAME]: cookieValue })).toEqual({ actor: 'admin', admin: TEST_ADMIN_ID });
      const stamped = await stampedAfter(session.id, LONG_AGO);
      expect(stamped, 'the admin request left last_seen_at where it was').not.toBeNull();
      expect(stamped!.getTime()).toBeGreaterThanOrEqual(before - 1_000);

      // Inside the minute: the Redis marker holds, and the row is not written again.
      await backdate(session.id);
      await ask({ [ADMIN_SESSION_COOKIE_NAME]: cookieValue });
      await ask({ [ADMIN_SESSION_COOKIE_NAME]: cookieValue });
      await settle();
      expect((await lastSeenOf(session.id))?.toISOString()).toBe(LONG_AGO.toISOString());

      // The minute over (the marker gone), the next request stamps again.
      await h.redis.del(`seen:${session.id}`);
      await ask({ [ADMIN_SESSION_COOKIE_NAME]: cookieValue });
      expect(await stampedAfter(session.id, LONG_AGO)).not.toBeNull();
    });

    it('a customer request stamps its session as before, and never an administrator’s', async () => {
      const admin = await h.sessionService.createSession({ kind: 'admin', adminUserId: TEST_ADMIN_ID });
      const customer = await h.sessionService.createSession({ kind: 'customer', customerAccountId: TEST_CUSTOMER_ID });
      await backdate(admin.session.id);
      await backdate(customer.session.id);

      expect((await ask({ [SESSION_COOKIE_NAME]: customer.cookieValue })).actor).toBe('customer');
      expect(await stampedAfter(customer.session.id, LONG_AGO)).not.toBeNull();
      await settle();
      expect((await lastSeenOf(admin.session.id))?.toISOString()).toBe(LONG_AGO.toISOString());
    });

    it('a request with no session, or with a cookie that resolves to nothing, stamps nothing', async () => {
      const admin = await h.sessionService.createSession({ kind: 'admin', adminUserId: TEST_ADMIN_ID });
      await backdate(admin.session.id);
      expect((await ask({})).actor).toBe('anonymous');
      expect((await ask({ [ADMIN_SESSION_COOKIE_NAME]: `${admin.session.id}.not-the-token` })).actor).toBe('anonymous');
      await settle();
      expect((await lastSeenOf(admin.session.id))?.toISOString()).toBe(LONG_AGO.toISOString());
    });
  });

  describe('the read (§CAL-B2)', () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    /** An id no other case of the run holds a session for; the column has no foreign key. */
    const someone = () => randomUUID();

    const sessionFor = async (
      input: { adminUserId?: string; customerAccountId?: string; impersonatorAdminUserId?: string },
      seenAt: Date | null,
    ) => {
      const kind = input.impersonatorAdminUserId ? 'impersonation' : input.adminUserId ? 'admin' : 'customer';
      const { session } = await h.sessionService.createSession({ kind, ...input });
      await h.em().getConnection().execute(`update "sessions" set "last_seen_at" = ? where "id" = ?`, [seenAt, session.id]);
      return session.id;
    };

    it('answers the newest stamp per administrator, restricted to those asked about and to `since`', async () => {
      const online = someone();
      const away = someone();
      const never = someone();
      const stranger = someone();
      const newest = minutesAgo(1);
      await sessionFor({ adminUserId: online }, minutesAgo(30));
      await sessionFor({ adminUserId: online }, newest);
      await sessionFor({ adminUserId: away }, minutesAgo(20));
      await sessionFor({ adminUserId: never }, null);
      await sessionFor({ adminUserId: stranger }, minutesAgo(1));

      const seen = await reads().lastSeenByAdminUser([online, away, never], minutesAgo(5));
      expect(seen).toHaveLength(1);
      expect(seen[0]?.adminUserId).toBe(online);
      expect(new Date(seen[0]!.lastSeenAt).toISOString()).toBe(newest.toISOString());

      const wider = await reads().lastSeenByAdminUser([online, away, never], minutesAgo(60));
      expect(wider.map((row) => row.adminUserId).sort()).toEqual([online, away].sort());
    });

    it('does not take an impersonation for the administrator’s own presence', async () => {
      const administrator = someone();
      await sessionFor({ customerAccountId: TEST_CUSTOMER_ID, impersonatorAdminUserId: administrator }, minutesAgo(1));
      expect(await reads().lastSeenByAdminUser([administrator], minutesAgo(5))).toEqual([]);

      await sessionFor({ adminUserId: administrator }, minutesAgo(2));
      const seen = await reads().lastSeenByAdminUser([administrator], minutesAgo(5));
      expect(seen.map((row) => row.adminUserId)).toEqual([administrator]);
    });

    it('answers nobody for nobody', async () => {
      expect(await reads().lastSeenByAdminUser([], minutesAgo(5))).toEqual([]);
    });
  });
});
