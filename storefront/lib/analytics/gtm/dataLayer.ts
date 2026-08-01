'use client';

import {
  GTM_RELAY_ELIGIBLE_EVENTS,
  type GtmPageContext,
  type GtmRelayEligibleEvent,
  type GtmStorefrontConfig,
} from '@b2b/contracts';
import { readConsent } from '../consent';

/**
 * Google Tag Manager `dataLayer` emitter (feature 066).
 *
 * The container script, the Consent Mode v2 defaults and the `window.gtag`
 * shim are injected by the <GoogleTagManager/> server component; this module
 * only publishes the platform's own commerce vocabulary and owns the
 * client-vs-relay dispatch switch.
 *
 * Two gates apply before anything is emitted, and they are independent of what
 * the operator's container does:
 *   - the channel must be tracked (module on and a valid container id);
 *   - consent must be granted when the channel requires it (FR-014), so no
 *     shop data enters the `dataLayer` pre-consent.
 */

type Primitive = string | number | boolean;
export type GtmEventParams = Record<string, Primitive>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let config: GtmStorefrontConfig | null = null;

export function configureGtm(next: GtmStorefrontConfig): void {
  config = next;
}

export function getGtmConfig(): GtmStorefrontConfig | null {
  return config;
}

/** The channel is tracked: the module is on and a container id is configured. */
export function isGtmActive(): boolean {
  return !!config?.enabled && !!config.containerId;
}

/** The visitor's effective decision for this channel. */
export function gtmConsentGranted(): boolean {
  if (config === null) return false;
  return !config.requireConsent || readConsent() === 'granted';
}

/**
 * Drop anything that is not a scalar. The typed signature already forbids a
 * file upload, but `place_order_clicked` and `contact_form_submitted` forward
 * caller-supplied payloads, so the rule is enforced at runtime too (FR-021).
 */
function scalarsOnly(params: GtmEventParams): GtmEventParams {
  const out: GtmEventParams = {};
  for (const [key, value] of Object.entries(params)) {
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * Emit one event for a tracked, consented channel.
 *
 * The event name is restricted to the relay-eligible vocabulary: the
 * client-only events (scroll, outbound clicks, file downloads, form
 * interaction, the container's own `gtm.*`) are never authored by the platform
 * — the container observes them itself — so they cannot be pushed through here
 * at all (FR-025).
 */
export function pushGtmEvent(
  name: GtmRelayEligibleEvent,
  params: GtmEventParams = {},
): void {
  if (typeof window === 'undefined') return;
  if (!isGtmActive() || !gtmConsentGranted()) return;

  const scalars = scalarsOnly(params);

  // The dispatch switch. In server-side mode a relay-eligible event goes to the
  // platform backend and is deliberately NOT pushed to `window.dataLayer`, so
  // each logical event is reported exactly once (FR-026). The membership check
  // is what stops a client-only name from ever acquiring a server path from
  // this side; the ingest route rejects one from the other side (FR-025).
  if (
    config?.serverSide === true &&
    (GTM_RELAY_ELIGIBLE_EVENTS as readonly string[]).includes(name)
  ) {
    void postToCollect(name, scalars);
    return;
  }

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event: name, ...scalars });
}

/** Page context as observed in the browser at emit time. */
function pageContext(): GtmPageContext {
  const location = typeof window !== 'undefined' ? window.location.href : '';
  if (typeof document === 'undefined') return { location };
  const language = document.documentElement?.lang;
  return {
    location,
    ...(document.referrer ? { referrer: document.referrer } : {}),
    ...(document.title ? { title: document.title } : {}),
    ...(language ? { language } : {}),
  };
}

async function postToCollect(name: string, params: GtmEventParams): Promise<void> {
  const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';
  const channel = process.env['NEXT_PUBLIC_SALES_CHANNEL_CODE'] ?? '';
  try {
    await fetch(`${base}/api/v1/storefront/google-tag-manager/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(channel ? { 'X-Sales-Channel': channel } : {}),
      },
      body: JSON.stringify({
        clientId: resolveGtmClientId(),
        // The visitor's effective decision: granted once the gate above has let
        // the event through. The backend keys FR-030 (no IP, no user agent
        // without consent) off this field rather than off the channel setting.
        consent: { analyticsStorage: gtmConsentGranted() ? 'granted' : 'denied' },
        page: pageContext(),
        events: [{ name, params }],
      }),
      // Survives the unload of a page the visitor is navigating away from.
      keepalive: true,
    });
  } catch {
    // Best-effort beacon; a failed relay must never surface to the shopper.
  }
}

/**
 * `page_view` for a resolved App-Router destination. Kept here rather than in
 * <PageViewTracker/> so the payload is unit-testable without a DOM renderer.
 */
export function sendGtmPageView(path: string): void {
  pushGtmEvent('page_view', {
    page_path: path,
    page_location: typeof window !== 'undefined' ? window.location.href : path,
    page_title: typeof document !== 'undefined' ? document.title : '',
  });
}

/** Search-parameter names the storefront's own search surfaces use. */
const SEARCH_PARAM_KEYS = ['q', 's', 'search', 'query', 'keyword'];

/** `view_search_results` derived from a destination's query string. */
export function sendGtmSearchResults(search: string): void {
  const params = new URLSearchParams(search);
  for (const key of SEARCH_PARAM_KEYS) {
    const term = params.get(key);
    if (term) {
      pushGtmEvent('view_search_results', { search_term: term });
      return;
    }
  }
}

// --- Client identity --------------------------------------------------------
// The module owns its own first-party cookie rather than reading GA's
// `_b2b_ga_cid`: GTM must keep working on a deployment where the Google
// Analytics module is off or absent (research §R8). The cookie is written only
// once consent is granted; before then an in-memory id is used, so a visitor
// who declined stays cookie-free.

const CID_COOKIE = '_b2b_gtm_cid';
const CID_MAX_AGE_SEC = 60 * 60 * 24 * 730; // 2 years

let ephemeralCid: string | null = null;

function genId(): string {
  return `${Math.floor(Math.random() * 1e10)}.${Math.floor(Date.now() / 1000)}`;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
}

/** Stable client id for the relay payload. */
export function resolveGtmClientId(): string {
  if (gtmConsentGranted()) {
    const existing = readCookie(CID_COOKIE);
    if (existing) return existing;
    const cid = ephemeralCid ?? genId();
    writeCookie(CID_COOKIE, cid, CID_MAX_AGE_SEC);
    return cid;
  }
  if (!ephemeralCid) ephemeralCid = genId();
  return ephemeralCid;
}

/** Test seam — resets module state between cases. */
export function resetGtmForTesting(): void {
  config = null;
  ephemeralCid = null;
}
