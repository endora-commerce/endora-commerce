import type { LinkedInStorefrontConfig, LinkedInTriggerAction } from '@b2b/contracts';
import { readConsent } from '../consent';

/**
 * LinkedIn Insight Tag loader + conversion dispatcher.
 *
 * The tag installs `window.lintrk`. LinkedIn's own snippet defines a stub that
 * pushes into `lintrk.q` until the real script arrives, and we keep that
 * behaviour so a conversion fired during the load window is not lost.
 */

declare global {
  interface Window {
    _linkedin_partner_id?: string;
    _linkedin_data_partner_ids?: string[];
    lintrk?: ((action: string, payload?: unknown) => void) & { q?: unknown[][] };
  }
}

const SCRIPT_ID = 'linkedin-insight-tag';

let config: LinkedInStorefrontConfig | null = null;
/** Guards against a second injection across client-side navigations. */
let injected = false;

export function configureLinkedIn(next: LinkedInStorefrontConfig): void {
  config = next;
}

export function getLinkedInConfig(): LinkedInStorefrontConfig | null {
  return config;
}

/** The channel is tracked and a partner id is configured. */
export function isLinkedInConfigured(): boolean {
  return config !== null && config.enabled && config.partnerId !== null;
}

/**
 * Inject the Insight Tag. Idempotent, and a no-op when the channel is not
 * configured. Callers are responsible for the consent gate — this function
 * deliberately does not consult it, so the gate lives in exactly one place.
 */
export function loadInsightTag(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isLinkedInConfigured() || injected) return;
  if (document.getElementById(SCRIPT_ID)) {
    injected = true;
    return;
  }

  const partnerId = config!.partnerId!;
  window._linkedin_partner_id = partnerId;
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids ?? [];
  window._linkedin_data_partner_ids.push(partnerId);

  if (!window.lintrk) {
    const stub = ((action: string, payload?: unknown): void => {
      stub.q!.push([action, payload]);
    }) as NonNullable<Window['lintrk']>;
    stub.q = [];
    window.lintrk = stub;
  }

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
  document.head.appendChild(script);
  injected = true;
}

/**
 * Report every enabled mapping for an action.
 *
 * Suppressed when the channel reports server-side, so a conversion has exactly
 * one transport and cannot be double-counted.
 */
export function trackLinkedInConversions(action: LinkedInTriggerAction): void {
  if (typeof window === 'undefined') return;
  if (!isLinkedInConfigured() || config!.serverSide) return;
  // A denied visitor would already fail the `lintrk` check below, since the tag
  // is never injected — but that is incidental. Check consent explicitly so the
  // guarantee does not depend on load order (FR-007).
  if (config!.requireConsent && readConsent() !== 'granted') return;
  const lintrk = window.lintrk;
  if (!lintrk) return;
  for (const mapping of config!.conversionMappings) {
    if (mapping.triggerAction !== action) continue;
    lintrk('track', { conversion_id: mapping.conversionId });
  }
}

/** Test seam — resets module state between cases. */
export function resetLinkedInForTesting(): void {
  config = null;
  injected = false;
}
