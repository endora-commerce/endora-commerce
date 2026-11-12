import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { ModuleDisabledError } from '../../kernel/lifecycle/plugin-helpers.js';
import { getCurrentPlatformScope } from '../../kernel/scope.js';
import { getTenantContext } from '../../tenancy/tenant-context.js';
import type { AfterCommitContext } from '../hooks/types.js';
import {
  COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS,
  COMMAND_OUTBOX_BATCH_SIZE,
  COMMAND_OUTBOX_DEAD_RETENTION_MS,
  COMMAND_OUTBOX_DELIVERED_RETENTION_MS,
  COMMAND_OUTBOX_LEASE_MS,
  COMMAND_OUTBOX_MAX_ATTEMPTS,
} from './constants.js';
import { commandOutboxBackoffMs, drainCommandOutbox, type OutboxDrainDeps } from './drain.js';
import { PermanentOutboxFailure } from './errors.js';
import type { ClaimedOutboxRow, OutboxFailure, OutboxStore } from './store.js';

/**
 * `specs/176-command-hooks-outbox/` T041 (FR-035 – FR-037): the drain's
 * decisions, over an in-memory store and a clock the test moves.
 *
 * The fake store keeps the row's state the way the Postgres store does — a
 * claim moves a due `pending` row to `in_flight`, takes a lease and counts the
 * attempt — so every assertion here reads a row's resulting state rather than
 * which method was called.
 */

type Status = 'pending' | 'in_flight' | 'delivered' | 'dead';

interface FakeRow extends Omit<ClaimedOutboxRow, 'attempts'> {
  attempts: number;
  status: Status;
  availableAt: Date;
  lockedUntil: Date | null;
  lastErrorCode: string | null;
  lastErrorClass: string | null;
  deliveredAt: Date | null;
  deadAt: Date | null;
}

const ORG_A = '0b6a2c9e-5d41-4c1f-9a8e-7f6d5c4b3a21';

function fakeStore(rows: FakeRow[]): OutboxStore & { rows: FakeRow[] } {
  const find = (claimed: ClaimedOutboxRow): FakeRow | undefined =>
    rows.find((row) => row.id === claimed.id && row.status === 'in_flight' && row.attempts === claimed.attempts);
  return {
    rows,
    async hasWork(now) {
      return rows.some(
        (row) =>
          (row.status === 'pending' && row.availableAt <= now) ||
          (row.status === 'in_flight' && row.lockedUntil !== null && row.lockedUntil < now) ||
          (row.status === 'delivered' && row.deliveredAt! < new Date(now.getTime() - COMMAND_OUTBOX_DELIVERED_RETENTION_MS)) ||
          (row.status === 'dead' && row.deadAt! < new Date(now.getTime() - COMMAND_OUTBOX_DEAD_RETENTION_MS)),
      );
    },
    async reclaimExpiredLeases(now) {
      let count = 0;
      for (const row of rows) {
        if (row.status === 'in_flight' && row.lockedUntil !== null && row.lockedUntil < now) {
          row.status = 'pending';
          row.lockedUntil = null;
          count += 1;
        }
      }
      return count;
    },
    async claim(now, limit, leaseUntil) {
      const due = rows
        .filter((row) => row.status === 'pending' && row.availableAt <= now)
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, limit);
      for (const row of due) {
        row.status = 'in_flight';
        row.lockedUntil = leaseUntil;
        row.attempts += 1;
      }
      return due.map((row) => ({ ...row }));
    },
    async markDelivered(claimed, now) {
      const row = find(claimed);
      if (!row) return;
      row.status = 'delivered';
      row.deliveredAt = now;
      row.lockedUntil = null;
    },
    async markRetry(claimed, availableAt, failure: OutboxFailure) {
      const row = find(claimed);
      if (!row) return;
      row.status = 'pending';
      row.availableAt = availableAt;
      row.lockedUntil = null;
      row.lastErrorCode = failure.code;
      row.lastErrorClass = failure.errorClass;
    },
    async markDead(claimed, now, failure: OutboxFailure) {
      const row = find(claimed);
      if (!row) return;
      row.status = 'dead';
      row.deadAt = now;
      row.lockedUntil = null;
      row.lastErrorCode = failure.code;
      row.lastErrorClass = failure.errorClass;
    },
    async release(claimed, availableAt) {
      const row = find(claimed);
      if (!row) return;
      row.status = 'pending';
      row.attempts -= 1;
      row.availableAt = availableAt;
      row.lockedUntil = null;
    },
    async purge(deliveredBefore, deadBefore) {
      const before = rows.length;
      const keep = rows.filter(
        (row) =>
          !(row.status === 'delivered' && row.deliveredAt! < deliveredBefore) &&
          !(row.status === 'dead' && row.deadAt! < deadBefore),
      );
      const delivered = rows.filter((row) => row.status === 'delivered' && row.deliveredAt! < deliveredBefore).length;
      rows.splice(0, rows.length, ...keep);
      return { delivered, dead: before - keep.length - delivered };
    },
  };
}

let seq = 0;
function row(overrides: Partial<FakeRow> = {}): FakeRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sequence: seq,
    action: 'widget.create',
    objectType: 'widget',
    objectId: 'w-1',
    organizationId: ORG_A,
    hookModule: 'acme_erp',
    hookId: 'notify-erp',
    data: { organizationId: ORG_A, status: 'active' },
    actorKind: 'admin',
    actorAdminUserId: 'admin-1',
    impersonatedCustomerAccountId: null,
    actorCustomerAccountId: null,
    requestId: 'req-1',
    createdAt: new Date('2026-11-12T10:00:00.000Z'),
    attempts: 0,
    status: 'pending',
    availableAt: new Date('2026-11-12T10:00:00.000Z'),
    lockedUntil: null,
    lastErrorCode: null,
    lastErrorClass: null,
    deliveredAt: null,
    deadAt: null,
    ...overrides,
  };
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function harness(
  rows: FakeRow[],
  handler: (ctx: AfterCommitContext<Record<string, never>>) => Promise<void>,
  options: { present?: (moduleId: string) => boolean; registered?: boolean; action?: string } = {},
) {
  const store = fakeStore(rows);
  let now = new Date('2026-11-12T10:00:00.000Z');
  const deps: OutboxDrainDeps = {
    store,
    handlers: {
      isPresent: options.present ?? (() => true),
      afterCommitHandler: (moduleId, hookId) =>
        options.registered === false || moduleId !== 'acme_erp' || hookId !== 'notify-erp'
          ? undefined
          : { action: options.action ?? 'widget.create', handler: handler as never },
    },
    log,
    now: () => now,
  };
  return {
    store,
    deps,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    get now() {
      return now;
    },
  };
}

describe('drainCommandOutbox — delivery (176 T041)', () => {
  it('delivers a due row with its messageId, attempt, data and recorded causation, and marks it delivered', async () => {
    const seen: AfterCommitContext<Record<string, never>>[] = [];
    const h = harness([row()], async (ctx) => {
      seen.push(ctx);
    });
    const result = await drainCommandOutbox(h.deps);
    expect(result.delivered).toBe(1);
    expect(h.store.rows[0]).toMatchObject({ status: 'delivered', deliveredAt: h.now, attempts: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      messageId: h.store.rows[0]!.id,
      attempt: 1,
      action: 'widget.create',
      objectType: 'widget',
      objectId: 'w-1',
      organizationId: ORG_A,
      data: { organizationId: ORG_A, status: 'active' },
      causation: {
        actor: {
          kind: 'admin',
          actorAdminUserId: 'admin-1',
          impersonatedCustomerAccountId: null,
          actorCustomerAccountId: null,
        },
        requestId: 'req-1',
        committedAt: '2026-11-12T10:00:00.000Z',
      },
    });
  });

  it('runs the handler pinned to the row’s Organization, with the recorded request id as the scope’s', async () => {
    const seen: Array<{ tenant: unknown; requestId: unknown }> = [];
    const h = harness([row()], async () => {
      seen.push({ tenant: getTenantContext(), requestId: getCurrentPlatformScope()?.requestMeta?.requestId });
    });
    await drainCommandOutbox(h.deps);
    expect(seen).toEqual([
      {
        tenant: expect.objectContaining({ mode: 'single-org', organizationId: ORG_A, actor: { kind: 'system' } }),
        requestId: 'req-1',
      },
    ]);
  });

  it('drains batch by batch within one tick, each row under the lease its claim took', async () => {
    const rows = Array.from({ length: COMMAND_OUTBOX_BATCH_SIZE + 5 }, () => row());
    const h = harness(rows, async () => {
      const inFlight = h.store.rows.find((r) => r.status === 'in_flight');
      expect(inFlight?.lockedUntil).toEqual(new Date(h.now.getTime() + COMMAND_OUTBOX_LEASE_MS));
    });
    const result = await drainCommandOutbox(h.deps);
    // Every due row is delivered in one tick, batch by batch.
    expect(result.delivered).toBe(COMMAND_OUTBOX_BATCH_SIZE + 5);
  });
});

describe('drainCommandOutbox — failure (176 T041, FR-035)', () => {
  it('backs off min(30 s · 2^(n-1), 1 h)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(commandOutboxBackoffMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
  });

  it('retries each failure later than the last, then dead-letters after the tenth attempt', async () => {
    const h = harness([row()], async () => {
      throw new Error('ERP said no to Jan Kowalski');
    });
    const waits: number[] = [];
    for (let attempt = 1; attempt <= COMMAND_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      await drainCommandOutbox(h.deps);
      const current = h.store.rows[0]!;
      if (attempt < COMMAND_OUTBOX_MAX_ATTEMPTS) {
        expect(current).toMatchObject({ status: 'pending', attempts: attempt });
        waits.push(current.availableAt.getTime() - h.now.getTime());
        h.advance(current.availableAt.getTime() - h.now.getTime());
      }
    }
    for (let i = 1; i < waits.length; i += 1) expect(waits[i]!).toBeGreaterThanOrEqual(waits[i - 1]!);
    expect(waits[0]).toBeLessThan(waits[waits.length - 1]!);
    expect(h.store.rows[0]).toMatchObject({
      status: 'dead',
      attempts: COMMAND_OUTBOX_MAX_ATTEMPTS,
      deadAt: h.now,
      lastErrorCode: 'handler-failed',
      lastErrorClass: 'Error',
    });
  });

  it('never stores the error text — only a code-shaped code and the class', async () => {
    const h = harness([row(), row(), row()], async (ctx) => {
      if (ctx.messageId === h.store.rows[0]!.id) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Acme Trading Sp. z o.o. already exists');
      }
      if (ctx.messageId === h.store.rows[1]!.id) {
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:443 jan@example.com'), { code: 'ECONNREFUSED' });
      }
      throw Object.assign(new TypeError('boom'), { code: 'not a code, a sentence about Jan' });
    });
    await drainCommandOutbox(h.deps);
    expect(h.store.rows.map((r) => [r.lastErrorCode, r.lastErrorClass])).toEqual([
      ['VERSION_CONFLICT', 'HttpError'],
      ['ECONNREFUSED', 'Error'],
      ['handler-failed', 'TypeError'],
    ]);
    expect(JSON.stringify(h.store.rows)).not.toMatch(/Acme|ECONNREFUSED 10|jan@|Jan/);
  });

  it('dead-letters a PermanentOutboxFailure at once, with its code', async () => {
    const h = harness([row()], async () => {
      throw new PermanentOutboxFailure('acme-erp-rejected', 'ERP rejected organization Acme permanently');
    });
    await drainCommandOutbox(h.deps);
    expect(h.store.rows[0]).toMatchObject({
      status: 'dead',
      attempts: 1,
      lastErrorCode: 'acme-erp-rejected',
      lastErrorClass: 'PermanentOutboxFailure',
    });
  });
});

describe('drainCommandOutbox — presence and registration (176 T041, FR-036)', () => {
  it('leaves a row whose handler module is absent pending, restores its attempt and looks again in 30 s', async () => {
    const handler = vi.fn(async () => undefined);
    const h = harness([row()], handler, { present: () => false });
    const result = await drainCommandOutbox(h.deps);
    expect(handler).not.toHaveBeenCalled();
    expect(result.released).toBe(1);
    expect(h.store.rows[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
      availableAt: new Date(h.now.getTime() + COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS),
    });
  });

  it('treats a ModuleDisabledError from the handler as absence, not as a failed attempt', async () => {
    const h = harness([row()], async () => {
      throw new ModuleDisabledError('acme_erp');
    });
    await drainCommandOutbox(h.deps);
    expect(h.store.rows[0]).toMatchObject({ status: 'pending', attempts: 0, lastErrorCode: null });
  });

  it('delivers the row once its module is back on', async () => {
    let present = false;
    const handler = vi.fn(async () => undefined);
    const h = harness([row()], handler, { present: () => present });
    await drainCommandOutbox(h.deps);
    present = true;
    h.advance(COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS);
    await drainCommandOutbox(h.deps);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(h.store.rows[0]).toMatchObject({ status: 'delivered', attempts: 1 });
  });

  it('dead-letters hook-unregistered when the module is present and no longer registers the handler', async () => {
    const h = harness([row()], async () => undefined, { registered: false });
    await drainCommandOutbox(h.deps);
    expect(h.store.rows[0]).toMatchObject({ status: 'dead', lastErrorCode: 'hook-unregistered', lastErrorClass: null });
  });

  it('dead-letters hook-unregistered when the id now names a handler on another action', async () => {
    const h = harness([row()], async () => undefined, { action: 'widget.archive' });
    await drainCommandOutbox(h.deps);
    expect(h.store.rows[0]).toMatchObject({ status: 'dead', lastErrorCode: 'hook-unregistered' });
  });
});

describe('drainCommandOutbox — leases and retention (176 T041, FR-032, FR-037)', () => {
  it('reclaims an expired lease and delivers the row', async () => {
    const handler = vi.fn(async () => undefined);
    const h = harness(
      [row({ status: 'in_flight', attempts: 1, lockedUntil: new Date('2026-11-12T09:59:00.000Z') })],
      handler,
    );
    const result = await drainCommandOutbox(h.deps);
    expect(result.reclaimed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(h.store.rows[0]).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('leaves a live lease alone', async () => {
    const handler = vi.fn(async () => undefined);
    const h = harness(
      [row({ status: 'in_flight', attempts: 1, lockedUntil: new Date('2026-11-12T10:04:00.000Z') })],
      handler,
    );
    await drainCommandOutbox(h.deps);
    expect(handler).not.toHaveBeenCalled();
    expect(h.store.rows[0]!.status).toBe('in_flight');
  });

  it('purges delivered rows after 7 days and dead rows after 90, and keeps younger ones', async () => {
    const now = new Date('2026-11-12T10:00:00.000Z').getTime();
    const day = 24 * 60 * 60 * 1000;
    const h = harness(
      [
        row({ status: 'delivered', deliveredAt: new Date(now - 7 * day - 1) }),
        row({ status: 'delivered', deliveredAt: new Date(now - 6 * day) }),
        row({ status: 'dead', deadAt: new Date(now - 90 * day - 1) }),
        row({ status: 'dead', deadAt: new Date(now - 89 * day) }),
      ],
      async () => undefined,
    );
    const result = await drainCommandOutbox(h.deps);
    expect(result.purged).toEqual({ delivered: 1, dead: 1 });
    expect(h.store.rows.map((r) => r.status)).toEqual(['delivered', 'dead']);
  });
});
