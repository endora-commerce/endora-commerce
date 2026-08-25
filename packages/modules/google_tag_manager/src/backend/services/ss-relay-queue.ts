import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import type { Redis } from 'ioredis';
import type { GtmCollectRequest, GtmPageContext } from '@endora-commerce/contracts';

/**
 * BullMQ queue for the server-side Google Tag Manager relay (feature 066, US3 /
 * Principle X). The storefront `/collect` route is a pure producer: it
 * validates and enqueues one job per event, and the worker forwards each to the
 * operator's server container, throwing on failure so BullMQ retries.
 *
 * Nothing here is persisted in PostgreSQL — the relay is stateless, and
 * `removeOnFail` retention is what makes an exhausted delivery observable
 * (FR-027).
 */
export interface GtmRelayJobData {
  /** Also the BullMQ `jobId` — the idempotency key across retries (FR-028). */
  eventId: string;
  salesChannelId: string;
  clientId: string;
  event: { name: string; params: Record<string, string | number | boolean> };
  consent: { analyticsStorage: 'granted' | 'denied' };
  page: GtmPageContext;
  /** Captured server-side at ingest; forwarded only with granted consent (FR-030). */
  ip?: string;
  userAgent?: string;
  /** Stamped by the producer, so retry latency does not distort the timing. */
  occurredAt: string;
}

/** Server-observed request context the browser is never trusted to supply. */
export interface GtmIngestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Producer callback exposed to the storefront route. Assigns an `eventId` per
 * event, enqueues a relay job for each, and returns how many were accepted.
 */
export type GtmCollectEnqueuer = (
  salesChannelId: string,
  request: GtmCollectRequest,
  context: GtmIngestContext,
) => Promise<number>;

export const GTM_RELAY_QUEUE_NAME = 'google_tag_manager.ss.relay';

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 1_000 };

export function createGtmRelayQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<GtmRelayJobData> {
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
  return new Queue<GtmRelayJobData>(GTM_RELAY_QUEUE_NAME, options);
}

export function createGtmRelayWorker(
  redis: Redis,
  processor: Processor<GtmRelayJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<GtmRelayJobData> {
  const options: WorkerOptions = {
    connection: redis,
    concurrency: 8,
    ...overrides,
  };
  // Feature 072 (T033) — the job establishes its own scope; it established
  // nothing before.
  return new Worker<GtmRelayJobData>(
    GTM_RELAY_QUEUE_NAME,
    (job) => enterSystemScope('google_tag_manager: server-side relay', () => processor(job)),
    options,
  );
}
