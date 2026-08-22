import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '../../../kernel/scope.js';
import type { Redis } from 'ioredis';

/**
 * BullMQ queue manager for catalog bulk operations (product bulk-edit and
 * `search_reindex`), per Constitution Principle X (Scalable Queue Consumers).
 *
 * - The producer ({@link BulkOperationService.create}) persists a `pending`
 *   row and enqueues `{ operationId }` here — it never inline-executes the job.
 * - The consumer is a BullMQ {@link Worker} that claims the operation
 *   atomically (BullMQ job lock + the row's conditional `pending → running`
 *   UPDATE) and runs the idempotent handler, so N ≥ 2 worker instances never
 *   double-process a job.
 * - The worker is a **separable entrypoint**: co-located in the API process by
 *   default (single-VPS posture) but startable as its own process via
 *   `pnpm --filter backend run worker` without code changes.
 */

export interface BulkOperationJobData {
  /** Primary key of the {@link BulkOperation} row to process. */
  operationId: string;
}

export const BULK_OPERATION_QUEUE_NAME = 'catalog.bulk-operation';

/** Stable job name; the row is the source of truth, so a single name suffices. */
export const BULK_OPERATION_JOB_NAME = 'process';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 2_000 };

export function createBulkOperationQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<BulkOperationJobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 5_000 },
    },
    ...overrides,
  };
  return new Queue<BulkOperationJobData>(BULK_OPERATION_QUEUE_NAME, options);
}

export function createBulkOperationWorker(
  redis: Redis,
  processor: Processor<BulkOperationJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<BulkOperationJobData> {
  const options: WorkerOptions = {
    connection: redis,
    // Bulk operations are heavy (one drains a whole selection); keep a small
    // concurrency per instance and scale out by adding worker processes.
    concurrency: 2,
    ...overrides,
  };
  // Feature 072 (T033) — the job establishes its own scope. A bulk operation
  // writes through the Command Bus, which derives its actor from the ambient
  // context, so "no context" was never a safe state here.
  return new Worker<BulkOperationJobData>(
    BULK_OPERATION_QUEUE_NAME,
    (job) => enterSystemScope('catalog: bulk operation', () => processor(job)),
    options,
  );
}
