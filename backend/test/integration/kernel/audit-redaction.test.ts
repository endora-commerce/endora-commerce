import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import { AuditLogService, AuditRedactionService } from '@endora-commerce/platform/composition';
import { AUDIT_REDACTED_ACTION, type AuditRedactionInput } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #844 — `AuditRedactionService` against PostgreSQL.
 *
 * The unit file pins the algorithm on a stand-in table; this one pins what the
 * statements do to the real one: a `jsonb` rewrite by id in chunks of 500, a run
 * interrupted by a failing statement that the next run finishes with one marker
 * row in all, a row written while the run is under way caught by the top-up
 * pass, and the rows about any other object left byte-identical.
 *
 * Every row is inserted with fresh ids and deleted afterwards, so the shared
 * test database keeps nothing of it.
 */
describe('AuditRedactionService against PostgreSQL (issue #844)', () => {
  let db: TestDb;
  let redaction: AuditRedactionService;
  const written: string[] = [];

  beforeAll(async () => {
    db = await setupTestDb();
    const fork = (): EntityManager => db.orm.em.fork();
    redaction = new AuditRedactionService(fork, new AuditLogService(fork));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const ids = written.splice(0);
    if (ids.length > 0) {
      await db.orm.em
        .fork()
        .execute(`delete from "audit_log_entries" where "object_id" in (${ids.map(() => '?').join(', ')})`, ids);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  type WriteChunk = (this: unknown, ...args: unknown[]) => Promise<void>;
  /** The private one-statement write, which a case counts, fails or extends. */
  const writes = AuditRedactionService.prototype as unknown as { writeChunk: WriteChunk };

  function track(id: string): string {
    written.push(id);
    return id;
  }

  async function seed(
    objectType: string,
    objectId: string,
    count: number,
    extra: { actorCustomerAccountId?: string | null; action?: string } = {},
  ): Promise<void> {
    const em = db.orm.em.fork();
    for (let offset = 0; offset < count; offset += 500) {
      const n = Math.min(500, count - offset);
      const tuples: string[] = [];
      const params: unknown[] = [];
      for (let i = 0; i < n; i += 1) {
        tuples.push('(?, now(), ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)');
        params.push(
          randomUUID(),
          extra.action ?? 'customer_account.update_profile',
          objectType,
          objectId,
          JSON.stringify({ email: `before-${offset + i}@example.com` }),
          JSON.stringify({ email: `after-${offset + i}@example.com`, organizationId: objectId, status: 'active' }),
          '203.0.113.7',
          'Mozilla/5.0 (seeded)',
          extra.actorCustomerAccountId ?? null,
          `req-${offset + i}`,
        );
      }
      await em.execute(
        `insert into "audit_log_entries" ("id", "acted_at", "action", "object_type", "object_id",
           "state_before", "state_after", "ip_address", "user_agent", "actor_customer_account_id", "request_id")
         values ${tuples.join(', ')}`,
        params,
      );
    }
  }

  type Stored = {
    id: string;
    action: string;
    object_id: string;
    acted_at: string | Date;
    request_id: string | null;
    actor_customer_account_id: string | null;
    state_before: Record<string, unknown> | null;
    state_after: Record<string, unknown> | null;
    ip_address: string | null;
    user_agent: string | null;
  };

  async function rowsOf(objectId: string): Promise<Stored[]> {
    return db.orm.em
      .fork()
      .execute<Stored[]>(
        `select "id", "action", "object_id", "acted_at", "request_id", "actor_customer_account_id",
                "state_before", "state_after", "ip_address", "user_agent"
           from "audit_log_entries" where "object_id" = ? order by "id"`,
        [objectId],
      );
  }

  function run(input: AuditRedactionInput): ReturnType<AuditRedactionService['redact']> {
    return withSystemScope('test: audit redaction (issue #844)', () => redaction.redact(input));
  }

  function forSubject(subject: string, targets: AuditRedactionInput['targets']): AuditRedactionInput {
    return {
      reason: 'anonymization',
      subject: { objectType: 'customer_account', objectId: subject },
      subjectActorAccountId: subject,
      targets,
    };
  }

  it('rewrites 1,203 rows over three objects in place, keeping every column but the values', async () => {
    const subject = track(randomUUID());
    const org = track(randomUUID());
    const address = track(randomUUID());
    await seed('customer_account', subject, 600, { actorCustomerAccountId: subject });
    await seed('organization', org, 403);
    await seed('address', address, 200);
    const before = [...(await rowsOf(subject)), ...(await rowsOf(org)), ...(await rowsOf(address))];
    const update = vi.spyOn(writes, 'writeChunk');

    const result = await run(
      forSubject(subject, [
        { objectType: 'customer_account', objectIds: [subject] },
        { objectType: 'organization', objectIds: [org] },
        { objectType: 'address', objectIds: [address] },
      ]),
    );

    expect(result).toEqual({ rowsInScope: 1203, rowsChanged: 1203, markerWritten: true });
    expect(update).toHaveBeenCalledTimes(3);
    const after = [...(await rowsOf(subject)), ...(await rowsOf(org)), ...(await rowsOf(address))].filter(
      (r) => r.action !== AUDIT_REDACTED_ACTION,
    );
    expect(after).toHaveLength(1203);
    const text = JSON.stringify(after);
    expect(text).not.toMatch(/@example\.com/);
    for (const r of after) {
      expect(r.state_before).toEqual({ email: AUDIT_ERASED_MARKER });
      expect(r.state_after).toEqual({ email: AUDIT_ERASED_MARKER, organizationId: r.object_id, status: 'active' });
    }
    // The subject's own rows lose their IP and user agent; the organisation's
    // and the address's, written by nobody in particular, keep theirs.
    expect(after.filter((r) => r.object_id === subject).every((r) => r.ip_address === AUDIT_ERASED_MARKER && r.user_agent === AUDIT_ERASED_MARKER)).toBe(true);
    expect(after.filter((r) => r.object_id !== subject).every((r) => r.ip_address === '203.0.113.7')).toBe(true);
    // Action, actors, time, object and request are the record, and they stay.
    const keep = (r: Stored) => [r.id, r.action, r.object_id, String(r.acted_at), r.request_id, r.actor_customer_account_id];
    expect(after.map(keep).sort()).toEqual(before.map(keep).sort());
  });

  it('redacts 1,001 address and 1,001 retired-book ids in one call, under one marker row (issue #959)', async () => {
    const subject = track(randomUUID());
    const addresses = Array.from({ length: 1001 }, () => track(randomUUID()));
    const retired = Array.from({ length: 1001 }, () => track(randomUUID()));
    const em = db.orm.em.fork();
    for (const [objectType, ids] of [['address', addresses], ['customer_address', retired]] as const) {
      for (let offset = 0; offset < ids.length; offset += 500) {
        const slice = ids.slice(offset, offset + 500);
        await em.execute(
          `insert into "audit_log_entries" ("id", "acted_at", "action", "object_type", "object_id", "state_after")
           values ${slice.map(() => "(?, now(), 'address.update', ?, ?, ?::jsonb)").join(', ')}`,
          slice.flatMap((id) => [randomUUID(), objectType, id, JSON.stringify({ line1: 'Somewhere 1' })]),
        );
      }
    }

    const result = await run(
      forSubject(subject, [
        { objectType: 'address', objectIds: addresses },
        { objectType: 'customer_address', objectIds: retired },
      ]),
    );

    expect(result).toEqual({ rowsInScope: 2002, rowsChanged: 2002, markerWritten: true });
    const rewritten = await db.orm.em
      .fork()
      .execute<Array<{ n: string }>>(
        `select count(*) as n from "audit_log_entries" where "object_type" in ('address', 'customer_address')
           and "object_id" in (${[...addresses, ...retired].map(() => '?').join(', ')}) and "state_after" ->> 'line1' = ?`,
        [...addresses, ...retired, AUDIT_ERASED_MARKER],
      );
    expect(Number(rewritten[0]!.n)).toBe(2002);
    expect((await rowsOf(subject)).filter((r) => r.action === AUDIT_REDACTED_ACTION)).toHaveLength(1);
  });

  it('writes exactly one audit.redacted row, and a second run changes nothing', async () => {
    const subject = track(randomUUID());
    await seed('customer_account', subject, 3);

    await run(forSubject(subject, [{ objectType: 'customer_account', objectIds: [subject] }]));
    const once = await rowsOf(subject);
    const second = await run(forSubject(subject, [{ objectType: 'customer_account', objectIds: [subject] }]));

    expect(second).toEqual({ rowsInScope: 3, rowsChanged: 0, markerWritten: false });
    expect(await rowsOf(subject)).toEqual(once);
    const markers = once.filter((r) => r.action === AUDIT_REDACTED_ACTION);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ actor_customer_account_id: null, state_before: null });
    expect(markers[0]!.state_after).toEqual({
      reason: 'anonymization',
      rowsInScope: 3,
      rowsChanged: 3,
      byObjectType: { customer_account: 3 },
      objectIds: { customer_account: [subject] },
    });
  });

  it('finishes a run interrupted after its first chunk, with one marker row in all', async () => {
    const subject = track(randomUUID());
    await seed('customer_account', subject, 1100);
    const original = writes.writeChunk;
    let calls = 0;
    vi.spyOn(writes, 'writeChunk').mockImplementation(
      async function (this: unknown, ...args: unknown[]) {
        calls += 1;
        if (calls === 2) throw new Error('injected: connection lost');
        return original.apply(this, args);
      },
    );

    await expect(run(forSubject(subject, [{ objectType: 'customer_account', objectIds: [subject] }]))).rejects.toThrow(
      'injected',
    );
    const midway = await rowsOf(subject);
    expect(midway.filter((r) => r.state_after?.['email'] === AUDIT_ERASED_MARKER)).toHaveLength(500);
    expect(midway.filter((r) => r.action === AUDIT_REDACTED_ACTION)).toHaveLength(0);

    vi.restoreAllMocks();
    const result = await run(forSubject(subject, [{ objectType: 'customer_account', objectIds: [subject] }]));

    expect(result).toEqual({ rowsInScope: 1100, rowsChanged: 600, markerWritten: true });
    const done = await rowsOf(subject);
    expect(done.filter((r) => r.action === AUDIT_REDACTED_ACTION)).toHaveLength(1);
    expect(JSON.stringify(done)).not.toMatch(/@example\.com/);
  });

  it('catches a row written while the run is under way', async () => {
    const subject = track(randomUUID());
    const org = track(randomUUID());
    await seed('customer_account', subject, 2);
    const original = writes.writeChunk;
    let injected = false;
    vi.spyOn(writes, 'writeChunk').mockImplementation(
      async function (this: unknown, ...args: unknown[]) {
        await original.apply(this, args);
        if (!injected) {
          injected = true;
          // A late write about the organisation, after the snapshot was taken.
          await seed('organization', org, 1);
        }
      },
    );

    const result = await run(
      forSubject(subject, [
        { objectType: 'customer_account', objectIds: [subject] },
        { objectType: 'organization', objectIds: [org] },
      ]),
    );

    expect(result).toEqual({ rowsInScope: 3, rowsChanged: 3, markerWritten: true });
    expect((await rowsOf(org))[0]!.state_after).toMatchObject({ email: AUDIT_ERASED_MARKER });
  });

  it('leaves every row about another object byte-identical, the subject\'s orders included', async () => {
    const subject = track(randomUUID());
    const stranger = track(randomUUID());
    const order = track(randomUUID());
    await seed('customer_account', subject, 2);
    await seed('customer_account', stranger, 2);
    // A row the subject wrote about its own order: the actor is the subject,
    // the object is not in scope.
    await seed('order', order, 2, { actorCustomerAccountId: subject, action: 'order.place' });
    const strangerBefore = await rowsOf(stranger);
    const orderBefore = await rowsOf(order);

    await run(forSubject(subject, [{ objectType: 'customer_account', objectIds: [subject] }]));

    expect(await rowsOf(stranger)).toEqual(strangerBefore);
    expect(await rowsOf(order)).toEqual(orderBefore);
  });
});
