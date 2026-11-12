import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CommandOutboxListResponseSchema,
  CommandOutboxRetryResponseSchema,
  ERROR_CODES,
  type CommandOutboxListItem,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * `specs/176-command-hooks-outbox/` T060 (FR-040) — the operator API over
 * `command_outbox`: a status-filtered, keyset-paginated list that never
 * returns a row's `data`, and the audited retry of a dead row.
 *
 * The table is platform-global and this suite shares its database, so every
 * row it writes carries a hook module unique to the run, assertions read only
 * those rows, and `afterAll` deletes them.
 */

const LIST = '/api/v1/admin/command-outbox';
const retryUrl = (id: string): string => `/api/v1/admin/command-outbox/${id}/retry`;

const PLATFORM_ADMIN = { b2b_session: 'stub-admin-session' };
/** Holds `orders:read` only. */
const RESTRICTED_ADMIN = { b2b_session: 'stub-restricted-admin-session' };

const HOOK_MODULE = `outbox_admin_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
/** A list-1 value that would still be wrong to echo: the list never returns `data`. */
const DATA_SENTINEL = 'S176-OUTBOX-DATA';

function errorCode(body: string): string | undefined {
  return (JSON.parse(body) as { error?: { code?: string } }).error?.code;
}

describe('command outbox operator API (176 T060)', () => {
  let h: BackendServerHandle;
  let readerCookie: string;
  const rows: Record<'deadA' | 'deadB' | 'deadC' | 'pending' | 'inFlight' | 'delivered', string> = {
    deadA: randomUUID(),
    deadB: randomUUID(),
    deadC: randomUUID(),
    pending: randomUUID(),
    inFlight: randomUUID(),
    delivered: randomUUID(),
  };

  async function insert(id: string, status: string, extra: { attempts?: number; deadAt?: Date | null } = {}): Promise<void> {
    await h.em().execute(
      `insert into "command_outbox"
         ("id", "action", "object_type", "object_id", "organization_id", "hook_module", "hook_id", "data",
          "actor_kind", "status", "attempts", "last_error_code", "last_error_class", "dead_at", "locked_until")
       values (?, 'organization.register', 'organization', ?, ?, ?, 'notify-erp', ?::jsonb, 'system', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        randomUUID(),
        randomUUID(),
        HOOK_MODULE,
        JSON.stringify({ marker: DATA_SENTINEL }),
        status,
        extra.attempts ?? 0,
        status === 'dead' ? 'handler-failed' : null,
        status === 'dead' ? 'TypeError' : null,
        extra.deadAt ?? null,
        status === 'in_flight' ? new Date(Date.now() + 60_000) : null,
      ],
    );
  }

  /** Every row of this run in `status`, page by page, in the order the API served them. */
  async function listMine(status: string, limit: number, cookies = PLATFORM_ADMIN): Promise<CommandOutboxListItem[]> {
    const mine: CommandOutboxListItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 1000; page += 1) {
      const query = new URLSearchParams({ status, limit: String(limit) });
      if (cursor !== null) query.set('cursor', cursor);
      const res = await h.app.inject({ method: 'GET', url: `${LIST}?${query.toString()}`, cookies });
      expect(res.statusCode, res.body).toBe(200);
      const body = CommandOutboxListResponseSchema.parse(res.json());
      expect(body.items.length).toBeLessThanOrEqual(limit);
      mine.push(...body.items.filter((item) => item.hookModule === HOOK_MODULE));
      if (body.nextCursor === null) return mine;
      cursor = body.nextCursor;
    }
    throw new Error('the list never reached its last page');
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // An administrator who may read the outbox and nothing else: a 200 on the
    // list cannot come from the platform administrator's wildcard, and a retry
    // must be refused for want of `.manage`.
    const em = h.em();
    const role = em.create(AdminRole, {
      code: `outbox-reader-${randomUUID().slice(0, 8)}`,
      name: 'Outbox reader',
      permissions: ['platform.command_outbox.read'],
    });
    await em.persistAndFlush(role);
    const admin = em.create(AdminUser, {
      email: `outbox-reader-${randomUUID().slice(0, 8)}@command-outbox.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Outbox',
      lastName: 'Reader',
      status: 'active',
    });
    await em.persistAndFlush(admin);
    readerCookie = `stub-outbox-reader-${admin.id}`;
    ADMIN_COOKIES[readerCookie] = { adminUserId: admin.id };

    // Inserted in this order, so `sequence` ascends deadA < deadB < deadC.
    await insert(rows.deadA, 'dead', { attempts: 10, deadAt: new Date() });
    await insert(rows.deadB, 'dead', { attempts: 3, deadAt: new Date() });
    await insert(rows.deadC, 'dead', { attempts: 10, deadAt: new Date() });
    await insert(rows.pending, 'pending', { attempts: 2 });
    await insert(rows.inFlight, 'in_flight', { attempts: 1 });
    await insert(rows.delivered, 'delivered', { attempts: 1 });
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[readerCookie];
    await h.em().execute(`delete from "command_outbox" where "hook_module" = ?`, [HOOK_MODULE]);
    await teardownBackendServer(h);
  });

  describe('GET /api/v1/admin/command-outbox', () => {
    it('filters by status and pages by sequence, newest first, with no row twice', async () => {
      const dead = await listMine('dead', 2);
      expect(dead.map((item) => item.id)).toEqual([rows.deadC, rows.deadB, rows.deadA]);
      expect((await listMine('pending', 50)).map((item) => item.id)).toEqual([rows.pending]);
      expect((await listMine('in_flight', 50)).map((item) => item.id)).toEqual([rows.inFlight]);
    });

    it('serves the operator fields and never the row data', async () => {
      const res = await h.app.inject({ method: 'GET', url: `${LIST}?status=dead&limit=100`, cookies: PLATFORM_ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain(DATA_SENTINEL);
      const [item] = (await listMine('dead', 100)).filter((row) => row.id === rows.deadA);
      expect(item).toBeDefined();
      expect(Object.keys(item!).sort()).toEqual(
        [
          'action',
          'attempts',
          'availableAt',
          'createdAt',
          'deadAt',
          'hookId',
          'hookModule',
          'id',
          'lastErrorClass',
          'lastErrorCode',
          'objectId',
          'objectType',
          'organizationId',
          'status',
        ].sort(),
      );
      expect(item).toMatchObject({
        action: 'organization.register',
        objectType: 'organization',
        hookModule: HOOK_MODULE,
        hookId: 'notify-erp',
        status: 'dead',
        attempts: 10,
        lastErrorCode: 'handler-failed',
        lastErrorClass: 'TypeError',
      });
    });

    it('defaults to dead rows', async () => {
      const res = await h.app.inject({ method: 'GET', url: `${LIST}?limit=100`, cookies: PLATFORM_ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      const body = CommandOutboxListResponseSchema.parse(res.json());
      expect(body.items.every((item) => item.status === 'dead')).toBe(true);
    });

    it('refuses an unknown status and a malformed cursor with 400', async () => {
      const status = await h.app.inject({ method: 'GET', url: `${LIST}?status=delivered`, cookies: PLATFORM_ADMIN });
      expect(status.statusCode).toBe(400);
      const cursor = await h.app.inject({ method: 'GET', url: `${LIST}?cursor=abc`, cookies: PLATFORM_ADMIN });
      expect(cursor.statusCode).toBe(400);
    });

    it('answers 403 without platform.command_outbox.read and 401 without a session', async () => {
      const forbidden = await h.app.inject({ method: 'GET', url: LIST, cookies: RESTRICTED_ADMIN });
      expect(forbidden.statusCode).toBe(403);
      expect(errorCode(forbidden.body)).toBe(ERROR_CODES.FORBIDDEN);
      const anonymous = await h.app.inject({ method: 'GET', url: LIST });
      expect(anonymous.statusCode).toBe(401);
    });

    it('answers a holder of platform.command_outbox.read alone', async () => {
      const mine = await listMine('dead', 100, { b2b_session: readerCookie });
      expect(mine.map((item) => item.id)).toContain(rows.deadA);
    });
  });

  describe('POST /api/v1/admin/command-outbox/:id/retry', () => {
    it('moves a dead row to pending, due now with no attempts, and audits command_outbox.retry', async () => {
      const before = Date.now();
      const res = await h.app.inject({ method: 'POST', url: retryUrl(rows.deadB), cookies: PLATFORM_ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      const body = CommandOutboxRetryResponseSchema.parse(res.json());
      expect(body.item).toMatchObject({ id: rows.deadB, status: 'pending', attempts: 0, deadAt: null });
      expect(res.body).not.toContain(DATA_SENTINEL);

      const [row] = await h.em().execute<Array<{ status: string; attempts: number; available_at: Date; dead_at: Date | null }>>(
        `select "status", "attempts", "available_at", "dead_at" from "command_outbox" where "id" = ?`,
        [rows.deadB],
      );
      expect(row).toMatchObject({ status: 'pending', attempts: 0, dead_at: null });
      expect(new Date(row!.available_at).getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(new Date(row!.available_at).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);

      const entries = await h.em().execute<Array<{ object_type: string; state_before: unknown; state_after: unknown }>>(
        `select "object_type", "state_before", "state_after" from "audit_log_entries"
          where "action" = 'command_outbox.retry' and "object_id" = ?`,
        [rows.deadB],
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        object_type: 'command_outbox',
        state_before: { status: 'dead' },
        state_after: { status: 'pending' },
      });
    });

    it('answers 409 COMMAND_OUTBOX_NOT_DEAD for a row that is not dead, and changes nothing', async () => {
      for (const id of [rows.pending, rows.inFlight, rows.delivered]) {
        const res = await h.app.inject({ method: 'POST', url: retryUrl(id), cookies: PLATFORM_ADMIN });
        expect(res.statusCode, res.body).toBe(409);
        expect(errorCode(res.body)).toBe(ERROR_CODES.COMMAND_OUTBOX_NOT_DEAD);
      }
      const [row] = await h.em().execute<Array<{ status: string; attempts: number }>>(
        `select "status", "attempts" from "command_outbox" where "id" = ?`,
        [rows.inFlight],
      );
      expect(row).toMatchObject({ status: 'in_flight', attempts: 1 });
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      const unknown = await h.app.inject({ method: 'POST', url: retryUrl(randomUUID()), cookies: PLATFORM_ADMIN });
      expect(unknown.statusCode).toBe(404);
      expect(errorCode(unknown.body)).toBe(ERROR_CODES.NOT_FOUND);
      const malformed = await h.app.inject({ method: 'POST', url: retryUrl('not-a-uuid'), cookies: PLATFORM_ADMIN });
      expect(malformed.statusCode).toBe(400);
    });

    it('answers 403 without platform.command_outbox.manage, holding .read, and leaves the row dead', async () => {
      const res = await h.app.inject({ method: 'POST', url: retryUrl(rows.deadC), cookies: { b2b_session: readerCookie } });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res.body)).toBe(ERROR_CODES.FORBIDDEN);
      const [row] = await h.em().execute<Array<{ status: string }>>(
        `select "status" from "command_outbox" where "id" = ?`,
        [rows.deadC],
      );
      expect(row?.status).toBe('dead');
    });
  });
});
