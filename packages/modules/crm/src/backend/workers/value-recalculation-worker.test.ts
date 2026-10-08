import { describe, expect, it, vi } from 'vitest';
import {
  createValueRecalculationProducer,
  startValueRecalculation,
  valueRecalculationJob,
  VALUE_RECALCULATION_QUEUE,
} from './value-recalculation-worker.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

describe('crm value recalculation worker', () => {
  it('names a queue BullMQ accepts', () => {
    expect(VALUE_RECALCULATION_QUEUE).toBe('crm-value-recalculation');
    expect(VALUE_RECALCULATION_QUEUE).not.toContain(':');
  });

  it('builds no consumer where the process runs none', () => {
    const attach = vi.fn();
    const started = startValueRecalculation({
      processRunsWorkers: false,
      moduleQueueRedis: {} as never,
      recalculateAll: async () => 0,
      recalculateOne: async () => false,
      log,
      attach,
    });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
  });

  it('builds no consumer where the composition offers no connection', () => {
    const attach = vi.fn();
    const started = startValueRecalculation({
      processRunsWorkers: true,
      moduleQueueRedis: undefined,
      recalculateAll: async () => 0,
      recalculateOne: async () => false,
      log,
      attach,
    });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
  });

  it('enqueues nothing, and says so, in a composition without queues', async () => {
    const producer = createValueRecalculationProducer(undefined);
    expect(await producer.enqueue()).toBe(false);
    await producer.close();
  });

  it('one job is one pass, and a failed pass fails the job', async () => {
    const recalculateAll = vi.fn(async () => 3);
    await valueRecalculationJob({ recalculateAll, recalculateOne: async () => false, log })();
    expect(recalculateAll).toHaveBeenCalledTimes(1);

    const failing = valueRecalculationJob({
      recalculateAll: async () => {
        throw new Error('database is away');
      },
      recalculateOne: async () => false,
      log,
    });
    await expect(failing()).rejects.toThrow('database is away');
  });

  it('a job that names an Opportunity recalculates that one and makes no pass', async () => {
    const recalculateAll = vi.fn(async () => 0);
    const recalculateOne = vi.fn(async () => true);
    await valueRecalculationJob({ recalculateAll, recalculateOne, log })({ data: { opportunityId: 'an-id' } });
    expect(recalculateOne).toHaveBeenCalledWith('an-id');
    expect(recalculateAll).not.toHaveBeenCalled();
  });

  it('asks for one Opportunity nowhere, and says so, in a composition without queues', async () => {
    const producer = createValueRecalculationProducer(undefined);
    expect(await producer.enqueueOne('an-id')).toBe(false);
    await producer.close();
  });
});
