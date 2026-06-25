'use client';

import { useEffect, useState } from 'react';

/**
 * Registers the storefront service worker (feature 046) and surfaces a
 * non-blocking "new version available" prompt when an updated SW is waiting
 * (FR-027/028). Mounted from the root layout.
 *
 * The registration is fire-and-forget — failures (HTTPS required in production,
 * browser without SW support) degrade silently to a non-PWA experience.
 *
 * Update flow: the SW does NOT `skipWaiting` on its own; when a new worker
 * reaches the `waiting` state we show the prompt, and only on the user's click
 * do we post `pwa:skip-waiting` and reload — so an update never discards
 * in-progress work mid-task (FR-028).
 */
export function PwaRegister(): React.ReactElement | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development') return;

    const version = process.env['NEXT_PUBLIC_BUILD_ID'] ?? 'v1';
    let reloading = false;

    navigator.serviceWorker
      .register(`/service-worker.js?v=${encodeURIComponent(version)}`)
      .then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(registration.waiting);
            }
          });
        });
      })
      .catch(() => {
        // Swallow — the user gets the non-PWA experience.
      });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-line bg-accent-soft px-[16px] py-[10px] text-[13px] text-accent"
      data-testid="pwa-update-banner"
    >
      <span>A new version is available.</span>
      <button
        type="button"
        className="ml-[12px] underline"
        onClick={() => {
          waiting.postMessage({ type: 'pwa:skip-waiting' });
        }}
      >
        Reload
      </button>
    </div>
  );
}
