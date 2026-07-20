/**
 * GA4 Measurement Protocol / server-side GTM client (feature 049, US4).
 *
 * Forwards a single analytics event server-side. Unlike the legacy
 * `analytics/ga4-forwarder.ts` (fire-and-forget), this client THROWS on a
 * non-2xx response or transport error so the BullMQ worker retries
 * (Principle X / FR-024). `fetchFn` is injectable for tests.
 */

export interface Ga4MpDestination {
  /** Server-side GTM container URL; blank ⇒ GA4 MP default endpoint. */
  endpoint: string;
  measurementId: string;
  apiSecret: string;
}

export interface Ga4MpEvent {
  clientId: string;
  name: string;
  params: Record<string, string | number | boolean>;
  consent: { analyticsStorage: 'granted' | 'denied' };
}

export interface Ga4MpClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const MP_DEFAULT_BASE = 'https://www.google-analytics.com/mp/collect';

export class Ga4MpClient {
  constructor(private readonly options: Ga4MpClientOptions = {}) {}

  async send(dest: Ga4MpDestination, event: Ga4MpEvent): Promise<void> {
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const base = dest.endpoint.trim() || MP_DEFAULT_BASE;
    const url =
      `${base}?measurement_id=${encodeURIComponent(dest.measurementId)}` +
      `&api_secret=${encodeURIComponent(dest.apiSecret)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          client_id: event.clientId,
          consent: {
            ad_user_data: event.consent.analyticsStorage === 'granted' ? 'GRANTED' : 'DENIED',
            ad_personalization: event.consent.analyticsStorage === 'granted' ? 'GRANTED' : 'DENIED',
          },
          events: [{ name: event.name, params: event.params }],
        }),
      });
      // GA4 MP returns 204 on success; treat any non-2xx as retryable.
      if (!res.ok) {
        throw new Error(`GA4 MP delivery failed with status ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
