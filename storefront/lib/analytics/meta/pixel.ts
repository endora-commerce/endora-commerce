import {
  META_STANDARD_EVENTS,
  type MetaStorefrontConfig,
  type MetaTriggerAction,
} from '@endora-commerce/contracts';
import { readConsent } from '../consent';

/**
 * Meta Pixel loader + event dispatcher.
 *
 * The base code installs `window.fbq`, which queues into `fbq.queue` until
 * `fbevents.js` arrives, so an event fired during the load window is not lost.
 */

type Fbq = ((...args: unknown[]) => void) & {
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  push?: (...args: unknown[]) => void;
  callMethod?: (...args: unknown[]) => void;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const SCRIPT_ID = 'meta-pixel';

let config: MetaStorefrontConfig | null = null;
let injected = false;

export function configureMeta(next: MetaStorefrontConfig): void {
  config = next;
}

export function getMetaConfig(): MetaStorefrontConfig | null {
  return config;
}

/** The channel is tracked and a pixel id is configured. */
export function isMetaConfigured(): boolean {
  return config !== null && config.enabled && config.pixelId !== null;
}

function consentGranted(): boolean {
  if (config === null) return false;
  return !config.requireConsent || readConsent() === 'granted';
}

/** Meta's documented base-code stub: queue calls until the real script loads. */
function installStub(): Fbq {
  if (window.fbq) return window.fbq;
  const fbq = function (this: unknown, ...args: unknown[]): void {
    if (fbq.callMethod) fbq.callMethod.apply(this, args);
    else fbq.queue!.push(args);
  } as Fbq;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.push = fbq;
  window.fbq = fbq;
  window._fbq = fbq;
  return fbq;
}

/**
 * Inject the Pixel and report the initial page view. Idempotent, and a no-op
 * when the channel is not configured. The consent gate is the caller's job for
 * loading, but re-checked here so it cannot be bypassed.
 */
export function loadMetaPixel(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isMetaConfigured() || injected || !consentGranted()) return;
  if (document.getElementById(SCRIPT_ID)) {
    injected = true;
    return;
  }

  const fbq = installStub();
  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
  injected = true;

  fbq('init', config!.pixelId!);
  fbq('track', 'PageView');
}

/**
 * Report one storefront action.
 *
 * Fires Meta's standard event for the action (when it has one), then any custom
 * events mapped to it. A mapping is additive — it never replaces the standard
 * event, because an operator adding an audience event would otherwise silently
 * lose their Purchase reporting.
 */
export function trackMetaEvent(
  action: MetaTriggerAction,
  params?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  if (!isMetaConfigured() || !consentGranted()) return;
  const fbq = window.fbq;
  if (!fbq) return;

  const standard = META_STANDARD_EVENTS[action];
  if (standard) fbq('track', standard, params ?? {});

  for (const mapping of config!.customEvents) {
    if (mapping.triggerAction !== action) continue;
    fbq('trackCustom', mapping.eventName, params ?? {});
  }
}

/** Test seam — resets module state between cases. */
export function resetMetaForTesting(): void {
  config = null;
  injected = false;
}
