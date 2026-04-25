'use client';

import { useEffect } from 'react';

/**
 * Registers the storefront service worker (T236 / FR-104). Mounted from
 * the root layout. Themes that disable PWA support drop this component.
 *
 * The registration is intentionally fire-and-forget — failures (HTTPS
 * required in production, browser without SW support) degrade silently
 * to a non-PWA experience.
 */
export function PwaRegister(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development') return;
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Swallow — the user gets the non-PWA experience.
    });
  }, []);
  return null;
}
