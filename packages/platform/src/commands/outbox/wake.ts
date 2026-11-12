import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { COMMAND_OUTBOX_DRAIN_QUEUE, COMMAND_OUTBOX_WAKE_JOB_ID } from './constants.js';

/**
 * The post-commit wake-up of the command outbox drain
 * (`specs/176-command-hooks-outbox/` FR-033, `contracts/command-hooks-api.md`
 * §4.7).
 *
 * The Command Bus calls `wake()` once a transaction that wrote outbox rows has
 * committed, and never before: a wake for a row that might still roll back
 * would send the drain looking for nothing. It is a latency optimisation and
 * nothing more — the rows are in Postgres and the scheduled tick delivers them
 * within ten seconds whether or not a wake-up ever arrives. So:
 *
 *  - **it never rejects.** Redis down at commit is a lost wake-up, not a lost
 *    delivery, and a write that committed must not answer an error for it;
 *  - **the bus does not wait for it**, so a Redis that hangs cannot hold the
 *    request that committed;
 *  - **it is deduplicated** on {@link COMMAND_OUTBOX_WAKE_JOB_ID}: a burst of
 *    commits costs one waiting job, not one per commit.
 */
export interface OutboxWakePort {
  wake(): Promise<void>;
}

/** A wake-up on the drain queue, built on the composition's Redis connection. */
export interface CommandOutboxWake extends OutboxWakePort {
  /** Close the producer queue, if a wake-up ever built it. */
  close(): Promise<void>;
}

/**
 * Build the wake-up both composition roots hand their bus. The producer queue
 * is created on the **first** wake-up rather than here, so a process whose
 * Commands never write a row — every process until some module registers an
 * `afterCommit` handler — opens nothing. `prefix` is BullMQ's key prefix, left
 * alone in production.
 */
export function createCommandOutboxWake(redis: Redis, options: { readonly prefix?: string } = {}): CommandOutboxWake {
  let queue: Queue | undefined;
  return {
    async wake(): Promise<void> {
      try {
        queue ??= new Queue(COMMAND_OUTBOX_DRAIN_QUEUE, {
          connection: redis,
          ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
        });
        await queue.add(
          'wake',
          {},
          { deduplication: { id: COMMAND_OUTBOX_WAKE_JOB_ID }, removeOnComplete: true, removeOnFail: true },
        );
      } catch {
        // A lost wake-up: the scheduled tick delivers the row. See above.
      }
    },
    async close(): Promise<void> {
      if (queue !== undefined) await queue.close();
    },
  };
}
