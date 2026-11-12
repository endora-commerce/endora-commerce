import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hookableAction } from '@endora-commerce/contracts';
import { CommandBus, type AfterCommitContext, type Command } from '@endora-commerce/platform/commands';
import {
  AuditLogService,
  CommandHookRegistry,
  PostgresOutboxStore,
  drainCommandOutbox,
} from '@endora-commerce/platform/composition';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `specs/176-command-hooks-outbox/` T043 (FR-032, SC-003, SC-004) — the outbox
 * against a real Postgres.
 *
 *  1. Two drains over 200 committed rows deliver every row, and no row is ever
 *     in two handlers at once: the claim is `for update skip locked` and the
 *     claim's own commit moves the row to `in_flight`, so the second drain's
 *     `select` cannot see it. The assertion is inside the handler.
 *  2. A process that dies after the commit loses nothing. The rows were
 *     written by the Command's transaction, so a "crash" before any delivery
 *     (no drain ran, no wake reached Redis) and a crash in the middle of one
 *     (a claim whose lease is never released) both end with every row
 *     delivered once a later drain runs.
 *
 * The bus forks its own transaction, so these rows commit for real. Every row
 * this file writes names the fixture hook module below, which is what the
 * clean-up deletes by.
 */

const HOOK_MODULE = 'outbox_concurrency_fixture';
const OWNER = 'outbox_concurrency_owner';
const ACTION = 'outbox_probe.create';
const PROBE = hookableAction<unknown, { probeId: string }>(ACTION, 'outbox_probe', ['afterCommit']);
const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: randomUUID() } };
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('command outbox drain against Postgres (176 T043)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 60_000);

  afterEach(async () => {
    await db.orm.em.fork().execute(`delete from "command_outbox" where "hook_module" = ?`, [HOOK_MODULE]);
    await db.orm.em.fork().nativeDelete(AuditLogEntry, { action: ACTION });
  });

  afterAll(async () => {
    await db.close();
  });

  function composition(handler: (ctx: AfterCommitContext<{ probeId: string }>) => Promise<void>) {
    const registry = new CommandHookRegistry();
    registry.register(HOOK_MODULE, [{ id: 'deliver', on: PROBE, phase: 'afterCommit', handler }]);
    registry.seal({
      hookableActions: [{ moduleId: OWNER, action: ACTION, objectType: 'outbox_probe', phases: ['afterCommit'] }],
      moduleDependencies: { [OWNER]: [], [HOOK_MODULE]: [OWNER] },
    });
    // No wake: nothing reaches Redis, which is the "died before any delivery" half.
    const bus = new CommandBus(db.orm, new AuditLogService(() => db.orm.em.fork()), new EventBus<Record<string, EventBase>>(), {
      hooks: registry,
    });
    return { registry, bus };
  }

  function probe(): Command<string> {
    const probeId = randomUUID();
    return {
      action: ACTION,
      objectType: 'outbox_probe',
      objectId: probeId,
      async run() {
        return { result: probeId, after: { probed: true } };
      },
      outboxData: () => ({ probeId }),
    };
  }

  async function statuses(): Promise<Record<string, number>> {
    const rows = await db.orm.em
      .fork()
      .execute<Array<{ status: string; n: string }>>(
        `select "status", count(*) as n from "command_outbox" where "hook_module" = ? group by "status"`,
        [HOOK_MODULE],
      );
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
  }

  const store = () => new PostgresOutboxStore(() => db.orm.em.fork());

  it('two concurrent drains deliver all 200 rows, and never hand one row to two handlers at once', async () => {
    const inFlight = new Set<string>();
    const deliveries = new Map<string, number>();
    const overlaps: string[] = [];
    const { registry, bus } = composition(async (ctx) => {
      if (inFlight.has(ctx.messageId)) overlaps.push(ctx.messageId);
      inFlight.add(ctx.messageId);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight.delete(ctx.messageId);
      deliveries.set(ctx.messageId, (deliveries.get(ctx.messageId) ?? 0) + 1);
    });

    const ids: string[] = [];
    await runWithTenantContext(adminCtx, async () => {
      for (let i = 0; i < 200; i += 1) ids.push(await bus.run(probe()));
    });
    expect(await statuses()).toEqual({ pending: 200 });

    await Promise.all([
      drainCommandOutbox({ store: store(), handlers: registry, log }),
      drainCommandOutbox({ store: store(), handlers: registry, log }),
    ]);

    expect(overlaps).toEqual([]);
    expect(deliveries.size).toBe(200);
    expect([...deliveries.values()].every((count) => count === 1)).toBe(true);
    expect(await statuses()).toEqual({ delivered: 200 });
  }, 120_000);

  it('a crash after the commit loses nothing — before any delivery, and in the middle of one', async () => {
    const delivered: string[] = [];
    const { registry, bus } = composition(async (ctx) => {
      delivered.push(ctx.data.probeId);
    });
    const ids: string[] = [];
    await runWithTenantContext(adminCtx, async () => {
      for (let i = 0; i < 6; i += 1) ids.push(await bus.run(probe()));
    });

    // The "dead" process: it claimed three rows (taking their lease) and never
    // came back to mark them.
    const t0 = new Date();
    const claimed = await store().claim(t0, 3, new Date(t0.getTime() + 5 * 60_000));
    expect(claimed).toHaveLength(3);
    expect(await statuses()).toEqual({ pending: 3, in_flight: 3 });

    // A fresh process: the three it can see now, then the other three once the lease has run out.
    await drainCommandOutbox({ store: store(), handlers: registry, log });
    expect(delivered).toHaveLength(3);
    const later = new Date(t0.getTime() + 5 * 60_000 + 1_000);
    await drainCommandOutbox({ store: store(), handlers: registry, log, now: () => later });

    expect([...delivered].sort()).toEqual([...ids].sort());
    expect(await statuses()).toEqual({ delivered: 6 });
    const attempts = await db.orm.em
      .fork()
      .execute<Array<{ attempts: number }>>(`select "attempts" from "command_outbox" where "hook_module" = ?`, [HOOK_MODULE]);
    // The reclaimed three spent the attempt the dead process took.
    expect(attempts.map((row) => row.attempts).sort()).toEqual([1, 1, 1, 2, 2, 2]);
  }, 60_000);

  it('a rolled-back Command leaves no row', async () => {
    const { bus } = composition(async () => undefined);
    const failing: Command<string> = {
      ...probe(),
      async run() {
        throw new Error('the owner failed after deciding to write');
      },
    };
    await expect(runWithTenantContext(adminCtx, () => bus.run(failing))).rejects.toThrow();
    expect(await statuses()).toEqual({});
  });
});
