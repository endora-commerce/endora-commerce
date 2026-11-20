import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { RequestExpiryService } from '../services/request-expiry.js';
import {
  ensureRequestExpirySweepSchedule,
  REQUEST_EXPIRY_SWEEP_EVERY_MS,
  REQUEST_EXPIRY_SWEEP_QUEUE,
  REQUEST_EXPIRY_SWEEP_SCHEDULER_ID,
  runRequestExpirySweepTick,
  startRequestExpirySweep,
} from './request-expiry-sweep-worker.js';

/**
 * `specs/182-related-payers/` T074 (FR-045, FR-102) — the request expiry sweep: overdue pending
 * requests become `expired` through the `request.expire` Command, as the system actor; nothing
 * runs while the module is off, and the first tick after reactivation expires what fell due
 * meanwhile. BullMQ is stood in for: what is held is what this module hands it.
 */
const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; upsertJobScheduler: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown>; options: Record<string, unknown> }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly upsertJobScheduler = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      bull.queues.push(this);
    }
  },
  Worker: class {
    constructor(
      readonly name: string,
      readonly processor: () => Promise<unknown>,
      readonly options: Record<string, unknown>,
    ) {
      bull.workers.push(this);
    }
  },
}));

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

type Row = { id: string; version: number; expiresAt: Date; state: string };

/** A request table and a Command Bus, stood in for; the bus records the actor it ran under. */
function fakeStore(rows: Row[], listedAs?: () => Row[]) {
  const ran: Array<{ action: string; objectId: string; actorKind: string | undefined; mode: string | undefined }> = [];
  const em = {
    execute: vi.fn(async (_sql: string, params: unknown[]) => {
      const now = params[0] as Date;
      return [{ due: rows.some((r) => r.state === 'pending' && r.expiresAt <= now) }];
    }),
    find: vi.fn(async (_entity: unknown, where: { expiresAt: { $lte: Date } }) =>
      (listedAs?.() ?? rows).filter((r) => r.state === 'pending' && r.expiresAt <= where.expiresAt.$lte),
    ),
  };
  const commandBus = {
    run: vi.fn(async (command: { action: string; objectId: string }) => {
      const context = getTenantContext();
      ran.push({ action: command.action, objectId: command.objectId, actorKind: context?.actor.kind, mode: context?.mode });
      const row = rows.find((r) => r.id === command.objectId)!;
      if (row.state !== 'pending') throw new HttpError(409, 'RELATED_PAYER_REQUEST_DECIDED', 'decided');
      row.state = 'expired';
      return row;
    }),
  };
  const service = new RequestExpiryService({ emFactory: () => em as never, commandBus: commandBus as never });
  return { service, ran, rows };
}

const PAST = new Date('2026-11-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');

describe('related_payers request expiry sweep (T074)', () => {
  it('names a queue BullMQ accepts and installs one module-wide schedule', async () => {
    expect(REQUEST_EXPIRY_SWEEP_QUEUE).not.toContain(':');
    expect(REQUEST_EXPIRY_SWEEP_EVERY_MS).toBe(30 * 60 * 1000);
    const queue = { upsertJobScheduler: vi.fn(async () => undefined) };
    await ensureRequestExpirySweepSchedule(queue as never);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      REQUEST_EXPIRY_SWEEP_SCHEDULER_ID,
      { every: REQUEST_EXPIRY_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
  });

  it('where the process consumes queues: one consumer through the module\'s worker seam, one tick at a time', async () => {
    bull.workers.length = 0;
    const attach = vi.fn();
    const started = await startRequestExpirySweep({
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      expiry: fakeStore([]).service,
      isPresent: () => true,
      log: logger(),
      attach,
      onClose: () => undefined,
    });
    expect(started).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(bull.workers[0]).toMatchObject({ name: REQUEST_EXPIRY_SWEEP_QUEUE, options: { concurrency: 1 } });
    const none = await startRequestExpirySweep({
      processRunsWorkers: false,
      moduleQueueRedis: {} as never,
      expiry: fakeStore([]).service,
      isPresent: () => true,
      log: logger(),
      attach,
      onClose: () => undefined,
    });
    expect(none).toBe(false);
  });

  it('expires the overdue pending requests through `request.expire`, as the system actor, and nothing else', async () => {
    const { service, ran, rows } = fakeStore([
      { id: 'a', version: 1, expiresAt: PAST, state: 'pending' },
      { id: 'b', version: 1, expiresAt: FUTURE, state: 'pending' },
      { id: 'c', version: 2, expiresAt: PAST, state: 'active' },
    ]);
    await runRequestExpirySweepTick({ expiry: service, isPresent: () => true, log: logger() });
    expect(ran).toEqual([{ action: 'related_payers.request.expire', objectId: 'a', actorKind: 'system', mode: 'system' }]);
    expect(rows.map((r) => r.state)).toEqual(['expired', 'pending', 'active']);
  });

  it('a request decided between the read and its Command is skipped, not a failure', async () => {
    const listed: Row[] = [
      { id: 'a', version: 1, expiresAt: PAST, state: 'pending' },
      { id: 'b', version: 1, expiresAt: PAST, state: 'pending' },
    ];
    // `b` is accepted by its counterparty just after the sweep listed it.
    const { service, rows } = fakeStore(
      listed.map((r) => ({ ...r, state: r.id === 'b' ? 'active' : r.state })),
      () => listed,
    );
    const result = await service.sweepInScope(new Date());
    expect(result).toEqual({ expiredCount: 1, skippedCount: 1 });
    expect(rows.map((r) => r.state)).toEqual(['expired', 'active']);
  });

  it('does nothing while the module is off, and expires what fell due on the first tick after reactivation', async () => {
    const { service, ran, rows } = fakeStore([{ id: 'a', version: 1, expiresAt: PAST, state: 'pending' }]);
    let present = false;
    const deps = { expiry: service, isPresent: () => present, log: logger() };
    await runRequestExpirySweepTick(deps);
    expect(ran).toEqual([]);
    expect(rows[0]!.state).toBe('pending');
    present = true;
    await runRequestExpirySweepTick(deps);
    expect(ran.map((r) => r.objectId)).toEqual(['a']);
    expect(rows[0]!.state).toBe('expired');
  });

  it('an idle tick opens no system scope; a module switched off under the pass is never swallowed', async () => {
    const idle = fakeStore([{ id: 'a', version: 1, expiresAt: FUTURE, state: 'pending' }]);
    const sweep = vi.spyOn(idle.service, 'sweepInScope');
    await runRequestExpirySweepTick({ expiry: idle.service, isPresent: () => true, log: logger() });
    expect(sweep).not.toHaveBeenCalled();

    const failing = {
      hasExpirable: async () => true,
      sweepInScope: async () => {
        throw new ModuleDisabledError('related_payers');
      },
    };
    await expect(runRequestExpirySweepTick({ expiry: failing, isPresent: () => true, log: logger() })).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });
});
