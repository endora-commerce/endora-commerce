import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  FORMS_COUNTER_REPAIR_SCOPE_REASON,
  FORMS_ERASURE_SCOPE_REASON,
  FORMS_MAINTENANCE_EVERY_MS,
  FORMS_MAINTENANCE_QUEUE,
  FORMS_MAINTENANCE_SCHEDULER_ID,
  FORMS_RETENTION_SCOPE_REASON,
  runFormsMaintenanceJob,
  startFormsMaintenance,
  type FormsMaintenanceJobDeps,
  type FormsMaintenancePass,
} from './forms-maintenance-worker.js';

/**
 * The `forms-maintenance` clock (`specs/170-forms-module/` research R-20, data-model §10,
 * Constitution X) — the tasks reminders worker's shape: BullMQ is the clock and nothing more, a tick
 * carries no data, and what is due is read from the tables on every tick.
 */

/** BullMQ, stood in for: what is held here is what this module hands it, and no connection is opened. */
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

const log = () => ({ warn: vi.fn() });

function pass(scopeReason: string, hasWork: () => Promise<boolean> = async () => true) {
  const scopes: Array<{ kind: string | undefined; mode: string | undefined }> = [];
  const probeScopes: Array<string | undefined> = [];
  const run = vi.fn(async (_now: Date) => {
    const context = getTenantContext();
    scopes.push({ kind: context?.actor.kind, mode: context?.mode });
  });
  const probe = vi.fn(async (now: Date) => {
    void now;
    probeScopes.push(getTenantContext()?.mode);
    return hasWork();
  });
  const value: FormsMaintenancePass = { scopeReason, hasWork: probe, run };
  return { value, run, probe, scopes, probeScopes };
}

function deps(overrides: Partial<FormsMaintenanceJobDeps> = {}): FormsMaintenanceJobDeps {
  return {
    isPresent: () => true,
    retention: pass(FORMS_RETENTION_SCOPE_REASON).value,
    erasure: pass(FORMS_ERASURE_SCOPE_REASON).value,
    counters: pass(FORMS_COUNTER_REPAIR_SCOPE_REASON).value,
    log: log(),
    ...overrides,
  };
}

const NOW = new Date('2032-01-01T08:00:00Z');

describe('the forms-maintenance worker (R-20)', () => {
  it('names a queue BullMQ accepts and ticks every fifteen minutes', () => {
    expect(FORMS_MAINTENANCE_QUEUE).toBe('forms-maintenance');
    expect(FORMS_MAINTENANCE_SCHEDULER_ID).toBe(FORMS_MAINTENANCE_QUEUE);
    expect(FORMS_MAINTENANCE_EVERY_MS).toBe(15 * 60_000);
  });

  it('gives every pass its own non-empty reason', () => {
    const reasons = [FORMS_RETENTION_SCOPE_REASON, FORMS_ERASURE_SCOPE_REASON, FORMS_COUNTER_REPAIR_SCOPE_REASON];
    for (const reason of reasons) expect(reason.trim()).not.toBe('');
    expect(new Set(reasons).size).toBe(3);
  });

  it('runs the three passes in order, each inside its own system scope', async () => {
    const order: string[] = [];
    const tracked = (reason: string) => {
      const p = pass(reason);
      p.run.mockImplementation(async () => {
        order.push(reason);
        const context = getTenantContext();
        p.scopes.push({ kind: context?.actor.kind, mode: context?.mode });
      });
      return p;
    };
    const retention = tracked(FORMS_RETENTION_SCOPE_REASON);
    const erasure = tracked(FORMS_ERASURE_SCOPE_REASON);
    const counters = tracked(FORMS_COUNTER_REPAIR_SCOPE_REASON);

    await runFormsMaintenanceJob(deps({ retention: retention.value, erasure: erasure.value, counters: counters.value }), NOW);

    expect(order).toEqual([FORMS_RETENTION_SCOPE_REASON, FORMS_ERASURE_SCOPE_REASON, FORMS_COUNTER_REPAIR_SCOPE_REASON]);
    for (const p of [retention, erasure, counters]) {
      expect(p.scopes).toEqual([{ kind: 'system', mode: 'system' }]);
      expect(p.run).toHaveBeenCalledWith(NOW);
    }
  });

  it('asks nothing, opens nothing and runs nothing while Forms is off — presence before any probe', async () => {
    const retention = pass(FORMS_RETENTION_SCOPE_REASON);
    const erasure = pass(FORMS_ERASURE_SCOPE_REASON);
    const counters = pass(FORMS_COUNTER_REPAIR_SCOPE_REASON);

    await runFormsMaintenanceJob(
      deps({ isPresent: () => false, retention: retention.value, erasure: erasure.value, counters: counters.value }),
      NOW,
    );

    for (const p of [retention, erasure, counters]) {
      expect(p.probe).not.toHaveBeenCalled();
      expect(p.run).not.toHaveBeenCalled();
    }
  });

  it('stops between passes when Forms is switched off during the tick', async () => {
    let present = true;
    const retention = pass(FORMS_RETENTION_SCOPE_REASON);
    retention.run.mockImplementation(async () => {
      present = false;
    });
    const erasure = pass(FORMS_ERASURE_SCOPE_REASON);
    await runFormsMaintenanceJob(deps({ isPresent: () => present, retention: retention.value, erasure: erasure.value }), NOW);
    expect(retention.run).toHaveBeenCalledTimes(1);
    expect(erasure.probe).not.toHaveBeenCalled();
  });

  it('probes outside any scope and enters the scope only when the probe says there is work', async () => {
    const retention = pass(FORMS_RETENTION_SCOPE_REASON, async () => false);
    const erasure = pass(FORMS_ERASURE_SCOPE_REASON, async () => true);

    await runFormsMaintenanceJob(deps({ retention: retention.value, erasure: erasure.value }), NOW);

    expect(retention.probeScopes).toEqual([undefined]);
    expect(erasure.probeScopes).toEqual([undefined]);
    expect(retention.run).not.toHaveBeenCalled();
    expect(erasure.run).toHaveBeenCalledTimes(1);
  });

  it('counts a probe that cannot answer as work', async () => {
    const counters = pass(FORMS_COUNTER_REPAIR_SCOPE_REASON, async () => {
      throw new Error('no database');
    });
    await runFormsMaintenanceJob(deps({ counters: counters.value }), NOW);
    expect(counters.run).toHaveBeenCalledTimes(1);
  });

  it('logs a failed pass and goes on — the next tick is the retry — but never absorbs a module switched off', async () => {
    const retention = pass(FORMS_RETENTION_SCOPE_REASON);
    retention.run.mockRejectedValueOnce(new Error('boom'));
    const erasure = pass(FORMS_ERASURE_SCOPE_REASON);
    const logger = log();

    await runFormsMaintenanceJob(deps({ retention: retention.value, erasure: erasure.value, log: logger }), NOW);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({ pass: FORMS_RETENTION_SCOPE_REASON, error: 'boom' });
    expect(erasure.run).toHaveBeenCalledTimes(1);

    retention.run.mockRejectedValueOnce(new ModuleDisabledError('forms'));
    await expect(runFormsMaintenanceJob(deps({ retention: retention.value }), NOW)).rejects.toBeInstanceOf(ModuleDisabledError);

    const probing = pass(FORMS_ERASURE_SCOPE_REASON, async () => {
      throw new ModuleDisabledError('customer_accounts');
    });
    await expect(runFormsMaintenanceJob(deps({ erasure: probing.value }), NOW)).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    expect(await startFormsMaintenance({ deps: deps(), attach, onClose, ...host })).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('where the process consumes queues: one consumer through the seam, one tick at a time, the schedule upserted idempotently', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];
    const retention = pass(FORMS_RETENTION_SCOPE_REASON);
    const start = () =>
      startFormsMaintenance({
        deps: deps({ retention: retention.value }),
        processRunsWorkers: true,
        moduleQueueRedis: {} as never,
        attach,
        onClose: (close) => closers.push(close),
      });

    expect(await start()).toBe(true);
    expect(bull.workers).toHaveLength(1);
    expect(bull.workers[0]!.name).toBe(FORMS_MAINTENANCE_QUEUE);
    expect(bull.workers[0]!.options).toMatchObject({ concurrency: 1 });
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    const expected = [FORMS_MAINTENANCE_SCHEDULER_ID, { every: FORMS_MAINTENANCE_EVERY_MS }, { name: 'tick', data: {} }];
    expect(bull.queues[0]!.upsertJobScheduler).toHaveBeenCalledWith(...expected);

    // A second boot upserts the same scheduler id — one schedule, however many processes start.
    await start();
    expect(bull.queues[1]!.upsertJobScheduler).toHaveBeenCalledWith(...expected);

    await bull.workers[0]!.processor();
    expect(retention.run).toHaveBeenCalledTimes(1);
    await closers[0]!();
    expect(bull.queues[0]!.close).toHaveBeenCalled();
  });
});
