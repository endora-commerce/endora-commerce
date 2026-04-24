import { createHmac } from 'crypto';
import type { Job } from 'bullmq';
import type { WebhookJobData } from './webhook-queue.js';

/**
 * Worker-side processor: signs the payload with HMAC-SHA-256, POSTs it to the
 * receiver URL, and throws on non-2xx so BullMQ retries (R-13).
 */

export interface ProcessorDependencies {
  /** Injectable for tests; defaults to globalThis.fetch at call time. */
  fetchFn?: typeof fetch;
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Logger for failed deliveries (pino.Logger compatible). */
  onFailure?: (err: unknown, job: Job<WebhookJobData>) => void;
}

export function createDeliveryProcessor(deps: ProcessorDependencies = {}) {
  const { fetchFn, timeoutMs = 10_000, onFailure } = deps;
  return async function process(job: Job<WebhookJobData>): Promise<void> {
    const doFetch = fetchFn ?? globalThis.fetch;
    const { url, secret, payload, eventId, eventType } = job.data;
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event-Id': eventId,
          'X-Webhook-Event-Type': eventType,
          'X-Webhook-Signature-256': signature,
          'X-Webhook-Attempt': String(job.attemptsMade + 1),
        },
        body,
        signal: abort.signal,
      });
      if (!response.ok) {
        throw new Error(`webhook receiver returned ${response.status}`);
      }
    } catch (err) {
      onFailure?.(err, job);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
