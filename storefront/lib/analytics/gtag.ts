'use client';

import type { GaStorefrontConfig } from '@b2b/contracts';

/**
 * Client-side Google Analytics helper (feature 049). Wraps `gtag`/`dataLayer`,
 * Consent Mode v2, and the client-vs-server dispatch switch:
 *   - client mode  → gtag sends events straight to Google.
 *   - server mode  → events are POSTed to the module's /collect endpoint and
 *     forwarded by the backend worker (no double count — FR-023).
 *
 * The GA script + consent defaults + `config` are injected by the
 * <GoogleAnalytics/> server component; this module only dispatches.
 */

type Primitive = string | number | boolean;
type GaParams = Record<string, Primitive>;

let config: GaStorefrontConfig | null = null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function configureGa(next: GaStorefrontConfig): void {
  config = next;
}

export function getGaConfig(): GaStorefrontConfig | null {
  return config;
}

export function isGaActive(): boolean {
  return !!config?.enabled && !!config.measurementId;
}

function gtag(...args: unknown[]): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer ?? [];
  if (window.gtag) window.gtag(...args);
  else window.dataLayer.push(args);
}

/** localStorage key shared with the consent banner (ConsentBanner.tsx). */
const CONSENT_KEY = 'ga-consent';

/**
 * The visitor's effective analytics-consent state. When the channel does not
 * require consent, it is always granted; otherwise it reflects the banner's
 * saved decision and defaults to denied until the visitor decides. Used by the
 * server-side path so `/collect` forwards the real decision (not just the
 * require-consent flag).
 */
function consentState(): 'granted' | 'denied' {
  if (!config?.requireConsent) return 'granted';
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Consent Mode v2 update — call from a cookie banner on grant/deny. */
export function updateAnalyticsConsent(granted: boolean): void {
  const value = granted ? 'granted' : 'denied';
  gtag('consent', 'update', {
    analytics_storage: value,
    ad_storage: value,
    ad_user_data: value,
    ad_personalization: value,
  });
}

/** Emit a GA4 `page_view` for a resolved route (client or server path). */
export function sendPageView(path: string): void {
  if (!isGaActive()) return;
  const params: GaParams = {
    page_path: path,
    page_location: typeof window !== 'undefined' ? window.location.href : path,
    page_title: typeof document !== 'undefined' ? document.title : '',
  };
  dispatch('page_view', params);
}

/** Emit a GA4 event (ecommerce or custom) via the active dispatch path. */
export function trackGaEvent(name: string, params: GaParams = {}): void {
  if (!isGaActive()) return;
  dispatch(name, params);
}

function dispatch(name: string, params: GaParams): void {
  if (config?.serverSide) {
    void postToCollect(name, params);
  } else {
    gtag('event', name, params);
  }
}

// --- Pure server-side identity (Measurement Protocol) -----------------------
// In server-side mode gtag.js is not loaded, so we own client/session identity.
// GA4 auto-derives `first_visit` (new client_id) and `session_start` (new
// session_id) from the MP stream, so sending page_view/ecommerce/custom events
// with a stable client_id + a rolling session_id + `engagement_time_msec` gives
// us GA4's default session/engagement metrics without gtag.js.

const CID_COOKIE = '_b2b_ga_cid';
const SID_COOKIE = '_b2b_ga_sid';
const SESSION_TTL_MS = 30 * 60 * 1000; // GA4 default 30-minute session window
const CID_MAX_AGE_SEC = 60 * 60 * 24 * 730; // 2 years

/** Ephemeral (no-cookie) identity used before consent is granted. */
let ephemeralCid: string | null = null;
let ephemeralSid: { id: string; ts: number } | null = null;

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

/**
 * Stable client id. Persisted in a first-party cookie only once consent is
 * granted; before then an in-memory ephemeral id is used (no cookie written).
 */
function resolveClientId(): string {
  if (consentState() === 'granted') {
    const existing = readCookie(CID_COOKIE);
    if (existing) return existing;
    const cid = genId();
    writeCookie(CID_COOKIE, cid, CID_MAX_AGE_SEC);
    return cid;
  }
  if (!ephemeralCid) ephemeralCid = genId();
  return ephemeralCid;
}

/** Rolling 30-minute session id (cookie when consented, else in-memory). */
function resolveSessionId(): string {
  const now = Date.now();
  if (consentState() === 'granted') {
    const raw = readCookie(SID_COOKIE);
    const [id, tsStr] = (raw ?? '').split('.');
    const ts = Number(tsStr);
    const sessionId = id && Number.isFinite(ts) && now - ts < SESSION_TTL_MS ? id : String(Math.floor(now / 1000));
    writeCookie(SID_COOKIE, `${sessionId}.${now}`, Math.ceil(SESSION_TTL_MS / 1000));
    return sessionId;
  }
  if (!ephemeralSid || now - ephemeralSid.ts >= SESSION_TTL_MS) {
    ephemeralSid = { id: String(Math.floor(now / 1000)), ts: now };
  } else {
    ephemeralSid = { id: ephemeralSid.id, ts: now };
  }
  return ephemeralSid.id;
}

async function postToCollect(name: string, params: GaParams): Promise<void> {
  const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';
  const channel = process.env['NEXT_PUBLIC_SALES_CHANNEL_CODE'] ?? '';
  try {
    await fetch(`${base}/api/v1/storefront/google-analytics/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(channel ? { 'X-Sales-Channel': channel } : {}),
      },
      body: JSON.stringify({
        clientId: resolveClientId(),
        consent: { analyticsStorage: consentState() },
        // session_id + engagement_time_msec let GA4 attribute sessions and
        // derive session_start / first_visit / active users server-side.
        events: [{ name, params: { ...params, session_id: resolveSessionId(), engagement_time_msec: 100 } }],
      }),
      keepalive: true,
    });
  } catch {
    // Best-effort; a failed beacon must never surface to the user.
  }
}
