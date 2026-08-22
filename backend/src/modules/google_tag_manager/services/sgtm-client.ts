/**
 * Client for the operator's server-side Google Tag Manager container (feature
 * 066, US3).
 *
 * Posts one event to `{server_container_url}{server_ingest_path}` as a JSON
 * envelope the container's ingest client parses — Google's Data Client (default
 * path `/data`) or an equivalent custom client. No credentials are sent: an
 * sGTM ingest endpoint is a public collection endpoint by design, exactly like
 * `google-analytics.com/g/collect`.
 *
 * Like `Ga4MpClient` and unlike the legacy fire-and-forget forwarder, this
 * client THROWS on a non-2xx response or a transport error so the BullMQ worker
 * retries (Principle X / FR-027). `fetchFn` is injectable, so no test touches
 * the network.
 */

import type { GtmPageContext } from '@endora-commerce/contracts';

export interface SgtmDestination {
  /** Base URL of the server container, e.g. `https://sgtm.example.com`. */
  baseUrl: string;
  /** Request path the container's ingest client claims. Blank ⇒ `/data`. */
  ingestPath: string;
}

export interface SgtmEvent {
  eventId: string;
  clientId: string;
  name: string;
  params: Record<string, string | number | boolean>;
  consent: { analyticsStorage: 'granted' | 'denied' };
  page: GtmPageContext;
  /** Present only when the relay processor kept them (granted consent). */
  ip?: string;
  userAgent?: string;
}

export interface SgtmClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_INGEST_PATH = '/data';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The outbound wire format. snake_case by the vendor's convention, and a plain
 * interface rather than a Zod schema deliberately: it is constructed in exactly
 * one place and never parsed back, so modelling it as a `z.object()` would only
 * buy a `naming:allow-snake-case` escape hatch (research §R6).
 *
 * `client_id`, `ip_override` and `user_agent` reuse the GA4 Measurement
 * Protocol field names, which sGTM's clients already recognise, so an operator
 * mapping the payload writes no translation layer.
 */
interface SgtmRequestBody {
  event_name: string;
  client_id: string;
  event_id: string;
  page_location: string;
  page_referrer?: string;
  page_title?: string;
  language?: string;
  consent: { analytics_storage: 'granted' | 'denied' };
  ip_override?: string;
  user_agent?: string;
}

export class SgtmClient {
  constructor(private readonly options: SgtmClientOptions = {}) {}

  get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(dest: SgtmDestination, event: SgtmEvent): Promise<void> {
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    const base = dest.baseUrl.trim().replace(/\/+$/, '');
    const rawPath = dest.ingestPath.trim() || DEFAULT_INGEST_PATH;
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const granted = event.consent.analyticsStorage === 'granted';

    const envelope: SgtmRequestBody = {
      event_name: event.name,
      client_id: event.clientId,
      event_id: event.eventId,
      page_location: event.page.location,
      ...(event.page.referrer ? { page_referrer: event.page.referrer } : {}),
      ...(event.page.title ? { page_title: event.page.title } : {}),
      ...(event.page.language ? { language: event.page.language } : {}),
      consent: { analytics_storage: event.consent.analyticsStorage },
      // Second enforcement point for FR-030: the processor already strips them
      // on denied consent, and the last gate before the wire refuses to send
      // them regardless of what reached it.
      ...(granted && event.ip ? { ip_override: event.ip } : {}),
      ...(granted && event.userAgent ? { user_agent: event.userAgent } : {}),
    };

    // Params are flattened at the top level, but the envelope wins on a
    // collision — a caller-supplied `event_name` must not be able to redirect
    // the operator's tags.
    const body = { ...event.params, ...envelope };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetchFn(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`sGTM delivery failed with status ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
