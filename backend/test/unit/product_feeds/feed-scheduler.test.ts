import { describe, expect, it } from 'vitest';
import {
  FEED_SCHEDULER_ID_PREFIX,
  feedSchedulerId,
  reconcileSchedulers,
  type FeedScheduleSpec,
  type SchedulerBackend,
  type SchedulerBackendEntry,
} from '../../../src/modules/product_feeds/services/queues/feed-scheduler.js';

/**
 * Feature 067 / T070 — the schedule reconciler (FR-031, research §R5.2).
 *
 * Postgres is the source of truth and Redis is a derived index. The reconciler
 * is what makes that inversion real: it re-asserts the desired state rather
 * than diffing, so a flushed Redis, a restored-from-snapshot Redis and a crash
 * between the Postgres commit and the Redis call all converge to the same place
 * at the next boot.
 *
 * It is tested against a **fake backend** rather than a live queue on purpose.
 * `backend/test/helpers/test-server.ts` runs once per test file in a single
 * fork, and adding Redis connections to that path has previously taken ~225
 * test files down with "too many clients" (research §R18).
 */

const FEED_A = '00000000-0000-4000-8000-0000000000a1';
const FEED_B = '00000000-0000-4000-8000-0000000000a2';
const FEED_C = '00000000-0000-4000-8000-0000000000a3';

class FakeSchedulerBackend implements SchedulerBackend {
  readonly entries = new Map<string, SchedulerBackendEntry>();
  upsertCalls: string[] = [];
  removeCalls: string[] = [];
  /** Set to throw from `upsert`, to model a Redis that is down. */
  failUpsert = false;

  async upsert(id: string, pattern: string, tz: string): Promise<void> {
    if (this.failUpsert) throw new Error('redis unavailable');
    this.upsertCalls.push(id);
    this.entries.set(id, { id, pattern, tz, next: 1_800_000_000_000 });
  }

  async remove(id: string): Promise<void> {
    this.removeCalls.push(id);
    this.entries.delete(id);
  }

  async list(): Promise<SchedulerBackendEntry[]> {
    return [...this.entries.values()];
  }

  /** Models a foreign scheduler on the same queue, which we must never touch. */
  seedForeign(id: string): void {
    this.entries.set(id, { id, pattern: '* * * * *', tz: 'UTC', next: null });
  }
}

function spec(productFeedId: string, pattern = '0 */4 * * *'): FeedScheduleSpec {
  return { productFeedId, pattern, timezone: 'Europe/Warsaw' };
}

describe('feed scheduler reconciliation [unit]', () => {
  it('upserts every enabled, scheduled feed', async () => {
    const backend = new FakeSchedulerBackend();
    const result = await reconcileSchedulers(backend, [spec(FEED_A), spec(FEED_B)]);

    expect(backend.upsertCalls.sort()).toEqual(
      [feedSchedulerId(FEED_A), feedSchedulerId(FEED_B)].sort(),
    );
    expect(result.upserted).toBe(2);
    expect(result.removed).toBe(0);
  });

  it('removes every `feed:*` id with no live counterpart', async () => {
    const backend = new FakeSchedulerBackend();
    await reconcileSchedulers(backend, [spec(FEED_A), spec(FEED_B), spec(FEED_C)]);
    backend.upsertCalls = [];
    backend.removeCalls = [];

    // FEED_B was disabled, FEED_C deleted — both vanish from the desired set.
    const result = await reconcileSchedulers(backend, [spec(FEED_A)]);

    expect(backend.removeCalls.sort()).toEqual(
      [feedSchedulerId(FEED_B), feedSchedulerId(FEED_C)].sort(),
    );
    expect(result.removed).toBe(2);
    expect([...backend.entries.keys()]).toEqual([feedSchedulerId(FEED_A)]);
  });

  it('never touches a scheduler that is not ours', async () => {
    const backend = new FakeSchedulerBackend();
    backend.seedForeign('invoices:nightly');
    backend.seedForeign('some-other-module');

    await reconcileSchedulers(backend, [spec(FEED_A)]);

    expect(backend.removeCalls).toEqual([]);
    expect(backend.entries.has('invoices:nightly')).toBe(true);
    expect(backend.entries.has('some-other-module')).toBe(true);
  });

  it('is idempotent — a second pass changes nothing and removes nothing', async () => {
    const backend = new FakeSchedulerBackend();
    const specs = [spec(FEED_A), spec(FEED_B)];
    await reconcileSchedulers(backend, specs);
    const after = new Map(backend.entries);
    backend.upsertCalls = [];
    backend.removeCalls = [];

    const result = await reconcileSchedulers(backend, specs);

    expect(backend.removeCalls).toEqual([]);
    expect(result.removed).toBe(0);
    expect(backend.entries).toEqual(after);
  });

  it('rebuilds a Redis that was flushed', async () => {
    const backend = new FakeSchedulerBackend();
    const specs = [spec(FEED_A), spec(FEED_B)];
    await reconcileSchedulers(backend, specs);

    backend.entries.clear(); // FLUSHALL
    backend.upsertCalls = [];

    await reconcileSchedulers(backend, specs);

    expect(backend.upsertCalls.sort()).toEqual(
      [feedSchedulerId(FEED_A), feedSchedulerId(FEED_B)].sort(),
    );
    expect(backend.entries.size).toBe(2);
  });

  it('applies a changed pattern to the same scheduler id', async () => {
    const backend = new FakeSchedulerBackend();
    await reconcileSchedulers(backend, [spec(FEED_A, '0 */4 * * *')]);
    await reconcileSchedulers(backend, [spec(FEED_A, '*/15 * * * *')]);

    expect(backend.entries.size).toBe(1);
    expect(backend.entries.get(feedSchedulerId(FEED_A))?.pattern).toBe('*/15 * * * *');
    // Same id ⇒ an edit is an upsert, never a remove-then-add that could drop a
    // tick in between.
    expect(backend.removeCalls).toEqual([]);
  });

  it('reports a backend failure instead of pretending it succeeded', async () => {
    const backend = new FakeSchedulerBackend();
    backend.failUpsert = true;

    const result = await reconcileSchedulers(backend, [spec(FEED_A), spec(FEED_B)]);

    // A Redis that is down must not abort the whole reconcile — the caller logs
    // and the next boot repairs it (research §R5.2). But it must be counted, so
    // "reconciled 0 of 2" is visible rather than silent.
    expect(result.upserted).toBe(0);
    expect(result.failed).toBe(2);
  });

  it('keeps the id prefix that makes ownership decidable', () => {
    expect(feedSchedulerId(FEED_A)).toBe(`${FEED_SCHEDULER_ID_PREFIX}${FEED_A}`);
    expect(feedSchedulerId(FEED_A).startsWith('feed:')).toBe(true);
  });
});
