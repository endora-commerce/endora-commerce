/**
 * Shared analytics-consent decision.
 *
 * The decision itself has always lived in localStorage under `ga-consent`,
 * written by the cookie banner. That key is kept as-is so an existing visitor's
 * choice survives — it is the storefront's single consent decision, not a
 * Google-specific one, and every ad platform reads it rather than shipping a
 * second banner.
 *
 * `subscribeConsent` exists so a platform that was blocked at first render can
 * start the moment consent is granted, without a page reload.
 */

export const CONSENT_STORAGE_KEY = 'ga-consent';

/** Fired on the window whenever the visitor's decision changes. */
const CONSENT_EVENT = 'b2b:analytics-consent';

export type ConsentState = 'granted' | 'denied';

/** The stored decision, defaulting to denied until the visitor decides. */
export function readConsent(): ConsentState {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === 'granted' ? 'granted' : 'denied';
  } catch {
    // Private-mode / blocked storage: treat as undecided, i.e. denied.
    return 'denied';
  }
}

/** Announce a decision change so subscribers can start or stop immediately. */
export function broadcastConsent(granted: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: granted ? 'granted' : 'denied' }),
  );
}

/** Subscribe to decision changes. Returns an unsubscribe function. */
export function subscribeConsent(handler: (state: ConsentState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event): void => {
    handler((e as CustomEvent<ConsentState>).detail);
  };
  window.addEventListener(CONSENT_EVENT, listener);
  return (): void => window.removeEventListener(CONSENT_EVENT, listener);
}
