import { Queue, Worker, type KeepJobs, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
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
 *
 * A job carries the visitor's `clientId`, the event's `params`, the page
 * context and, with consent, the IP address and user agent, so a finished job
 * is kept in Redis by age as well as by count (issue #1248): see
 * {@link GTM_RELAY_KEEP_COMPLETED} and {@link GTM_RELAY_KEEP_FAILED}.
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
const HOUR_SECONDS = 60 * 60;

/**
 * How long BullMQ keeps a relayed job (issue #1248): one hour. A delivered
 * event has nothing left to say, and the operator's container holds the copy
 * that matters; the hour is a short tail for an operator looking at the queue.
 */
export const GTM_RELAY_KEEP_COMPLETED = { age: HOUR_SECONDS, count: 500 } satisfies KeepJobs;

/**
 * How long BullMQ keeps a job that ran out of retries (issue #1248): three
 * days. That is what keeps an exhausted relay observable (FR-027) long enough
 * to diagnose a failing container over a weekend, and no longer, because the
 * job still holds the visitor's data.
 *
 * BullMQ applies both bounds only when another job finishes in the same set,
 * so a quiet queue would keep its last jobs indefinitely; the hourly sweep in
 * `ss-relay-sweep.ts` is the clock that does not depend on traffic.
 */
export const GTM_RELAY_KEEP_FAILED = { age: 3 * 24 * HOUR_SECONDS, count: 5_000 } satisfies KeepJobs;

export function createGtmRelayQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<GtmRelayJobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
      removeOnComplete: GTM_RELAY_KEEP_COMPLETED,
      removeOnFail: GTM_RELAY_KEEP_FAILED,
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
