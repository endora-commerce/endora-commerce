import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '../../../kernel/scope.js';
import type Redis from 'ioredis';

/**
 * BullMQ queue for push delivery fan-out (Principle X). One job per
 * `push_message_deliveries` row; the unique (message_id, subscription_id)
 * delivery row makes redelivery idempotent.
 */
export interface PushDeliveryJobData {
  deliveryId: string;
}

export const PUSH_DELIVERY_QUEUE_NAME = 'pwa.push.deliver';

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 2_000 };

export function createPushDeliveryQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<PushDeliveryJobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    },
    ...overrides,
  };
  return new Queue<PushDeliveryJobData>(PUSH_DELIVERY_QUEUE_NAME, options);
}

export function createPushDeliveryWorker(
  redis: Redis,
  processor: Processor<PushDeliveryJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<PushDeliveryJobData> {
  // Feature 072 (T033) — the scope moves here from inside the processor, so it
  // sits at the entry point like every other queue in the tree; a processor
  // called directly (a test, a future in-process caller) is no longer the only
  // thing that decides whether a context exists.
  return new Worker<PushDeliveryJobData>(
    PUSH_DELIVERY_QUEUE_NAME,
    (job) => enterSystemScope('pwa: push delivery', () => processor(job)),
    {
      connection: redis,
      concurrency: 8,
      ...overrides,
    },
  );
}
