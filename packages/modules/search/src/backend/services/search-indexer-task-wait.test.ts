import { describe, expect, it } from 'vitest';
import {
  awaitIndexTask,
  DEFAULT_INDEX_TASK_TIMEOUT_MS,
  SearchIndexTaskFailed,
  SearchIndexTaskStillRunning,
} from './search-indexer.js';

/**
 * The two ways a Meilisearch task wait ends badly are not one failure, and the
 * indexer used to react to the wrong one.
 *
 * Measured against Meilisearch 1.x through `meilisearch@0.57.0`:
 *
 *  - A task that **genuinely died** comes back from `waitForTask` as a resolved
 *    promise carrying `status: 'failed'` and Meilisearch's own `error`. The
 *    client does not throw. Every one of the indexer's twelve waits discarded
 *    that value, so a refused document batch was indistinguishable from an
 *    applied one and `reindexChannel` returned a document count for an index
 *    Meilisearch had written nothing into.
 *  - A task that is merely **queued behind other work** throws
 *    `MeilisearchTaskTimeOutError`. With the client default of 5000 ms, a
 *    one-document task was measured throwing after 5006 ms and then settling
 *    `succeeded` 10540 ms later — the wait expired, the task was never in
 *    trouble.
 *
 * So the old code failed loudly on the benign case and silently on the
 * malignant one. These tests pin the inversion shut.
 */

type Waiter = Parameters<typeof awaitIndexTask>[0];

function waiterResolving(task: { status: string; error?: unknown }): Waiter {
  return {
    waitForTask: async () => task as never,
  } as Waiter;
}

function waiterThrowing(error: Error): Waiter {
  return {
    waitForTask: async () => {
      throw error;
    },
  } as Waiter;
}

/** The shape `meilisearch` raises; matched on `name`, never on identity. */
function taskTimeOutError(): Error {
  const err = new Error('timeout of 5000ms has exceeded on task 210203 when waiting for it to be resolved.');
  err.name = 'MeilisearchTaskTimeOutError';
  return err;
}

describe('awaitIndexTask', () => {
  it('returns when the task succeeded', async () => {
    await expect(
      awaitIndexTask(waiterResolving({ status: 'succeeded' }), { taskUid: 1 }, 'wipe', 1000),
    ).resolves.toBeUndefined();
  });

  it('throws SearchIndexTaskFailed when the task came back failed', async () => {
    // The whole point: `waitForTask` RESOLVED. Nothing threw. Before this
    // existed, the indexer read that as success.
    const waiter = waiterResolving({
      status: 'failed',
      error: {
        message: "Document doesn't have a `id` attribute.",
        code: 'missing_document_id',
      },
    });
    await expect(
      awaitIndexTask(waiter, { taskUid: 7 }, 'document batch', 1000),
    ).rejects.toBeInstanceOf(SearchIndexTaskFailed);
  });

  it('carries Meilisearch own diagnosis on the failure', async () => {
    const waiter = waiterResolving({
      status: 'failed',
      error: { message: 'Index `products_x` already exists.', code: 'index_already_exists' },
    });
    const err = await awaitIndexTask(waiter, { taskUid: 9 }, 'index create', 1000).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SearchIndexTaskFailed);
    const failure = err as SearchIndexTaskFailed;
    expect(failure.meilisearchCode).toBe('index_already_exists');
    expect(failure.taskUid).toBe(9);
    expect(failure.what).toBe('index create');
    expect(failure.message).toContain('already exists');
  });

  it('treats a cancelled task as a failure rather than a success', async () => {
    await expect(
      awaitIndexTask(waiterResolving({ status: 'canceled' }), { taskUid: 3 }, 'wipe', 1000),
    ).rejects.toBeInstanceOf(SearchIndexTaskFailed);
  });

  it('tolerates exactly the Meilisearch codes the caller names', async () => {
    const waiter = waiterResolving({
      status: 'failed',
      error: { message: 'Index `products_x` already exists.', code: 'index_already_exists' },
    });
    // `ensureIndex` races itself whenever two processes index the same channel:
    // both miss `getIndex`, both `createIndex`, one task fails. The index is
    // there either way, which is the whole postcondition.
    await expect(
      awaitIndexTask(waiter, { taskUid: 9 }, 'index create', 1000, ['index_already_exists']),
    ).resolves.toBeUndefined();
  });

  it('does not tolerate a different failure just because a tolerance was named', async () => {
    const waiter = waiterResolving({
      status: 'failed',
      error: { message: 'nope', code: 'invalid_document_id' },
    });
    await expect(
      awaitIndexTask(waiter, { taskUid: 9 }, 'index create', 1000, ['index_already_exists']),
    ).rejects.toBeInstanceOf(SearchIndexTaskFailed);
  });

  it('reports an expired wait as still-running, not as a failure', async () => {
    // A queue this wait outlasted is not a task that died, and the two must not
    // arrive at an operator under one name: the first says "wait longer or
    // raise the setting", the second says "the write was refused".
    const err = await awaitIndexTask(
      waiterThrowing(taskTimeOutError()),
      { taskUid: 210203 },
      'document batch',
      5000,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SearchIndexTaskStillRunning);
    expect(err).not.toBeInstanceOf(SearchIndexTaskFailed);
    const pending = err as SearchIndexTaskStillRunning;
    expect(pending.taskUid).toBe(210203);
    expect(pending.timeoutMs).toBe(5000);
    // The operator's remedy has to be in the sentence, or the sentence is
    // `MeilisearchTaskTimeOutError` with extra steps.
    expect(pending.message).toContain('search.index_task_timeout_seconds');
  });

  it('passes the caller timeout through to the client', async () => {
    let seen: unknown;
    const waiter = {
      waitForTask: async (_uid: number, options: { timeout: number }) => {
        seen = options.timeout;
        return { status: 'succeeded' } as never;
      },
    } as Waiter;
    await awaitIndexTask(waiter, { taskUid: 1 }, 'wipe', 90_000);
    expect(seen).toBe(90_000);
  });

  it('lets an unrelated client error through untouched', async () => {
    const boom = new Error('connect ECONNREFUSED 127.0.0.1:7700');
    await expect(
      awaitIndexTask(waiterThrowing(boom), { taskUid: 1 }, 'wipe', 1000),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('defaults far above the client 5000 ms that produced the defect', () => {
    // The client default is 5000 ms and is not a considered number for a task
    // whose wait includes an unbounded queue term.
    expect(DEFAULT_INDEX_TASK_TIMEOUT_MS).toBeGreaterThan(5000);
  });
});
