import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defineModuleWorker,
  resetModuleWorkersForTesting,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { makeFakeModuleWorker } from '../../helpers/fake-module-worker.js';

/**
 * Integration test for queue-consumer lifecycle logging.
 *
 * When `defineModuleWorker(moduleId, worker, { logger })` is given a logger,
 * the worker's BullMQ lifecycle events MUST be logged with a consistent
 * `{ module, queue, ... }` shape so the `worker` / `worker:dev` processes have
 * a visible heartbeat (and a clear reason on failure / stall).
 *
 * Uses an in-memory worker stub that records its event handlers, then fires
 * them, instead of spinning up a real Redis-backed BullMQ queue.
 */

interface LogLine {
  level: 'info' | 'warn' | 'error';
  obj: Record<string, unknown>;
  msg: string;
}

function makeFakeLogger(sink: LogLine[]) {
  return {
    info: (obj: object, msg: string) => sink.push({ level: 'info', obj: obj as Record<string, unknown>, msg }),
    warn: (obj: object, msg: string) => sink.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
    error: (obj: object, msg: string) => sink.push({ level: 'error', obj: obj as Record<string, unknown>, msg }),
  };
}

function makeFakeWorker(queueName: string) {
  return makeFakeModuleWorker({ name: queueName });
}

describe('defineModuleWorker — lifecycle logging (integration)', () => {
  beforeEach(() => {
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting(['fixture_log_workers']);
  });

  afterEach(() => {
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([]);
  });

  it('logs a registration line when a logger is provided', () => {
    const sink: LogLine[] = [];
    const worker = makeFakeWorker('catalog.bulk-operation');
    defineModuleWorker('fixture_log_workers', worker.worker, { logger: makeFakeLogger(sink) });

    const registered = sink.find((l) => l.msg === 'queue consumer registered');
    expect(registered).toBeDefined();
    expect(registered?.obj).toMatchObject({
      module: 'fixture_log_workers',
      queue: 'catalog.bulk-operation',
    });
  });

  it('logs active / completed / failed / stalled events with module + queue context', () => {
    const sink: LogLine[] = [];
    const worker = makeFakeWorker('catalog.bulk-operation');
    defineModuleWorker('fixture_log_workers', worker.worker, { logger: makeFakeLogger(sink) });

    worker.emit('active', { id: '1', name: 'process', data: { operationId: 'op-1' } });
    worker.emit('completed', { id: '1', name: 'process', processedOn: 1000, finishedOn: 1500 });
    worker.emit('failed', { id: '2', name: 'process', data: { operationId: 'op-2' }, attemptsMade: 3 }, new Error('boom'));
    worker.emit('stalled', '3');

    const active = sink.find((l) => l.msg === 'queue job active');
    expect(active?.obj).toMatchObject({ jobId: '1', jobName: 'process' });

    const completed = sink.find((l) => l.msg === 'queue job completed');
    expect(completed?.obj).toMatchObject({ jobId: '1', durationMs: 500 });

    const failed = sink.find((l) => l.msg === 'queue job failed');
    expect(failed?.level).toBe('error');
    expect(failed?.obj).toMatchObject({ jobId: '2', attemptsMade: 3 });
    expect(failed?.obj['err']).toBeInstanceOf(Error);

    const stalled = sink.find((l) => l.msg.startsWith('queue job stalled'));
    expect(stalled?.level).toBe('warn');
    expect(stalled?.obj).toMatchObject({ jobId: '3' });
  });

  it('attaches no lifecycle logging when no logger is provided', () => {
    const worker = makeFakeWorker('catalog.bulk-operation');
    defineModuleWorker('fixture_log_workers', worker.worker);

    // The seam attaches exactly one listener of its own, whatever the logging
    // options say: `closed`, which is how a worker leaves the per-module
    // registry the presence reconcile iterates. Anything beyond it is logging,
    // and there is to be none of it here — asserting "no listeners at all"
    // would make the registry-hygiene listener look like a defect.
    expect(worker.state.listenedEvents).toEqual(['closed']);
  });
});
