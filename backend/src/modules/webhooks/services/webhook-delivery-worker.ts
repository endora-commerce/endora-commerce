import { createHmac } from 'crypto';
import type { Job } from 'bullmq';
import type { WebhookJobData } from './webhook-queue.js';

/**
 * Worker-side processor: signs the payload with HMAC-SHA-256, POSTs it to the
 * receiver URL, and throws on non-2xx so BullMQ retries (R-13).
 */

export interface DeliveryRecordInput {
  webhookId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  status: 'succeeded' | 'failed' | 'dead_lettered';
  attemptCount: number;
  lastResponseStatus?: number;
  lastError?: string;
}

export interface ProcessorDependencies {
  /** Injectable for tests; defaults to globalThis.fetch at call time. */
  fetchFn?: typeof fetch;
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Logger for failed deliveries (pino.Logger compatible). */
  onFailure?: (err: unknown, job: Job<WebhookJobData>) => void;
  /**
   * Feature 062 — persistence hook for the `webhook_deliveries` audit trail
   * (typically `WebhookService.recordDelivery`). One row per attempt outcome:
   * `succeeded` on 2xx, `failed` on a retryable attempt, `dead_lettered` on
   * the final exhausted attempt. Best-effort: a bookkeeping failure never
   * changes the delivery outcome.
   */
  recordDelivery?: (input: DeliveryRecordInput) => Promise<unknown>;
}

export function createDeliveryProcessor(deps: ProcessorDependencies = {}) {
  const { fetchFn, timeoutMs = 10_000, onFailure, recordDelivery } = deps;

  const record = async (input: DeliveryRecordInput): Promise<void> => {
    if (!recordDelivery) return;
    try {
      await recordDelivery(input);
    } catch {
      // Bookkeeping is best-effort — never let it mask the delivery outcome.
    }
  };

  return async function process(job: Job<WebhookJobData>): Promise<void> {
    const doFetch = fetchFn ?? globalThis.fetch;
    const { webhookId, url, secret, payload, eventId, eventType } = job.data;
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const attemptCount = job.attemptsMade + 1;
    const maxAttempts = job.opts?.attempts ?? 1;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let responseStatus: number | undefined;
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event-Id': eventId,
          'X-Webhook-Event-Type': eventType,
          'X-Webhook-Signature-256': signature,
          'X-Webhook-Attempt': String(attemptCount),
        },
        body,
        signal: abort.signal,
      });
      responseStatus = response.status;
      if (!response.ok) {
        throw new Error(`webhook receiver returned ${response.status}`);
      }
      await record({
        webhookId,
        eventId,
        eventType,
        payload,
        status: 'succeeded',
        attemptCount,
        lastResponseStatus: response.status,
      });
    } catch (err) {
      onFailure?.(err, job);
      await record({
        webhookId,
        eventId,
        eventType,
        payload,
        status: attemptCount >= maxAttempts ? 'dead_lettered' : 'failed',
        attemptCount,
        lastError: err instanceof Error ? err.message : String(err),
        ...(responseStatus !== undefined ? { lastResponseStatus: responseStatus } : {}),
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
