/**
 * GA4 Measurement Protocol forwarder (T237 / FR-111).
 *
 * Off by default. Activate by setting both env vars:
 *   ANALYTICS_GA4_MEASUREMENT_ID
 *   ANALYTICS_GA4_API_SECRET
 *
 * The forwarder is intentionally fire-and-forget so that ingest never
 * blocks on the external HTTP. A failed request is logged via the supplied
 * `onError` callback; we do not retry — the source events are already
 * durable in `analytics_events` and an admin replay path can drain them
 * separately if real-time GA4 fidelity is required.
 */

export interface ForwardableEvent {
  type: string;
  occurredAt: string;
  salesChannelId?: string;
  customerAccountId?: string;
  organizationId?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
}

export interface AnalyticsForwarder {
  readonly enabled: boolean;
  forwardMany(events: ForwardableEvent[]): Promise<void>;
}

export interface Ga4ForwarderOptions {
  measurementId: string;
  apiSecret: string;
  /** Optional `fetch` override — used by the integration test. */
  fetchFn?: typeof fetch;
  onError?: (err: unknown) => void;
}

export class Ga4Forwarder implements AnalyticsForwarder {
  readonly enabled = true;

  constructor(private readonly options: Ga4ForwarderOptions) {}

  async forwardMany(events: ForwardableEvent[]): Promise<void> {
    if (events.length === 0) return;
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const url =
      `https://www.google-analytics.com/mp/collect` +
      `?measurement_id=${encodeURIComponent(this.options.measurementId)}` +
      `&api_secret=${encodeURIComponent(this.options.apiSecret)}`;

    // GA4's MP requires a non-empty client_id per request and a max of 25
    // events per request. We batch by sessionId or customerAccountId; events
    // with neither use a stable "anonymous" bucket per occurredAt date.
    const batches = bucketByClient(events);
    for (const [clientId, bucket] of batches) {
      for (let i = 0; i < bucket.length; i += 25) {
        const slice = bucket.slice(i, i + 25);
        try {
          await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              events: slice.map((ev) => ({
                name: ev.type.replace(/[.-]/g, '_'),
                params: {
                  ...ev.properties,
                  occurred_at: ev.occurredAt,
                  ...(ev.organizationId ? { organization_id: ev.organizationId } : {}),
                  ...(ev.salesChannelId ? { sales_channel_id: ev.salesChannelId } : {}),
                },
              })),
            }),
          });
        } catch (err) {
          this.options.onError?.(err);
        }
      }
    }
  }
}

/**
 * Off-mode forwarder — used when env vars are missing. Conforms to the same
 * interface so the ingest service can hold a single non-null reference.
 */
export class NoopForwarder implements AnalyticsForwarder {
  readonly enabled = false;
  async forwardMany(): Promise<void> {
    // Intentionally empty.
  }
}

export function buildForwarderFromEnv(env: NodeJS.ProcessEnv): AnalyticsForwarder {
  const id = env['ANALYTICS_GA4_MEASUREMENT_ID'];
  const secret = env['ANALYTICS_GA4_API_SECRET'];
  if (!id || !secret) return new NoopForwarder();
  return new Ga4Forwarder({ measurementId: id, apiSecret: secret });
}

function bucketByClient(
  events: ForwardableEvent[],
): Map<string, ForwardableEvent[]> {
  const out = new Map<string, ForwardableEvent[]>();
  for (const ev of events) {
    const key =
      ev.sessionId ?? ev.customerAccountId ?? ev.organizationId ?? 'anonymous';
    const arr = out.get(key) ?? [];
    arr.push(ev);
    out.set(key, arr);
  }
  return out;
}
