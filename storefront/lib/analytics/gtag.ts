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

/** Read the GA `_ga` cookie's client id, or generate an ephemeral one. */
function resolveClientId(): string {
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(/_ga=GA\d\.\d\.(\d+\.\d+)/);
    if (match?.[1]) return match[1];
  }
  return `${Math.floor(Math.random() * 1e10)}.${Math.floor(Date.now() / 1000)}`;
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
        consent: { analyticsStorage: config?.requireConsent ? 'denied' : 'granted' },
        events: [{ name, params }],
      }),
      keepalive: true,
    });
  } catch {
    // Best-effort; a failed beacon must never surface to the user.
  }
}
