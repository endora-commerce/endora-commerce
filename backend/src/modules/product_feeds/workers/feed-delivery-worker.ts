import type { Job, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { FEED_DELIVERY_LIMITS } from '@endora-commerce/contracts';
import { defineModuleWorker } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { DeliveryService } from '../services/delivery/delivery.service.js';
import {
  createFeedDeliveryWorker,
  type FeedDeliveryJobData,
} from '../services/queues/feed-delivery-queue.js';

/**
 * Delivery consumer — feature 070 / FR-103, FR-104, AS-2, AS-3.
 *
 * ## Why this handler throws
 *
 * `DeliveryService.deliver` never throws; it returns an outcome. This handler
 * translates a **retryable** outcome into a throw, because that is the only
 * vocabulary BullMQ has for "try again with backoff". A terminal failure returns
 * normally: the attempt row is the record, and re-running a delivery whose
 * address the egress guard refused would produce four more identical rows.
 *
 * That is also why the run is never touched from here. The generation job has
 * already published; a delivery failure and its retries are a separate outcome
 * with a separate history (FR-103, AS-2).
 *
 * ## The last attempt is the one that notifies
 *
 * AS-3 — after the bounded attempts are exhausted the delivery stops and is
 * visible as failed, and the operator is told through the same path a failed run
 * uses (FR-056). Notifying on every attempt would ring the bell five times for
 * one problem; notifying on none would make an exhausted delivery indistinguish-
 * able from one nobody configured.
 */

export interface FeedDeliveryWorkerDeps {
  redis: Redis;
  delivery: DeliveryService;
  /** FR-056's path, reused for an exhausted delivery (AS-3). Optional. */
  notifyExhausted?: (input: {
    feedId: string;
    runId: string | null;
    failureReason: string | null;
    failureDetail: string | null;
  }) => Promise<unknown>;
  maxAttempts?: () => Promise<number>;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

export function registerFeedDeliveryWorker(
  deps: FeedDeliveryWorkerDeps,
): Worker<FeedDeliveryJobData> {
  return defineModuleWorker(
    'product_feeds',
    createFeedDeliveryWorker(deps.redis, (job) => processDeliveryJob(job, deps)),
  );
}

export async function processDeliveryJob(
  job: Job<FeedDeliveryJobData>,
  deps: Omit<FeedDeliveryWorkerDeps, 'redis'>,
): Promise<void> {
  const { productFeedId, feedRunId, feedArtefactId } = job.data;
  if (!productFeedId || !feedArtefactId) return;

  const configured = deps.maxAttempts
    ? await deps.maxAttempts()
    : FEED_DELIVERY_LIMITS.DEFAULT_MAX_ATTEMPTS;
  // BullMQ's own `attempts` was fixed when the job was enqueued; the setting can
  // have changed since. The lower of the two is the honest ceiling — promising
  // more retries than the queue will actually make would leave the exhaustion
  // notification unsent.
  const maxAttempts = Math.max(1, Math.min(configured, job.opts.attempts ?? configured));
  const attempt = (job.attemptsMade ?? 0) + 1;

  const outcome = await deps.delivery.deliver({
    feedId: productFeedId,
    runId: feedRunId,
    artefactId: feedArtefactId,
    attempt,
    maxAttempts,
  });

  if (outcome.status !== 'failed') return;

  if (outcome.retryable && attempt < maxAttempts) {
    // The throw IS the retry request. The attempt is already recorded, so the
    // message only has to be recognisable in the queue's own failure list.
    throw new Error(
      `product_feeds: delivery attempt ${attempt} of ${maxAttempts} failed (${outcome.failureReason ?? 'unknown'})`,
    );
  }

  deps.logWarn?.('product_feeds: delivery abandoned after the last attempt', {
    productFeedId,
    feedArtefactId,
    attempt,
    maxAttempts,
    failureReason: outcome.failureReason,
  });
  await deps
    .notifyExhausted?.({
      feedId: productFeedId,
      runId: feedRunId,
      failureReason: outcome.failureReason,
      failureDetail: outcome.failureDetail,
    })
    .catch(() => undefined);
}
