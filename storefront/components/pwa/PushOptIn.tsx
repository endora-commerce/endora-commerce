'use client';

import { useEffect, useState } from 'react';
import { getPwaConfig, subscribeToPush } from '../../lib/api/pwa';

/**
 * Push opt-in (feature 046, US4). Shown only when the channel has push enabled
 * and the browser supports the Web-Push API. Respects a prior dismissal/denial
 * (no nagging — edge case). On iOS, web push requires the PWA to be installed
 * first, so when not running standalone the control explains that instead of
 * appearing broken (iOS edge case).
 */
const DISMISS_KEY = 'b2b:pwa:push-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PushOptIn(): React.ReactElement | null {
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
    if (Notification.permission === 'denied') return;

    void (async () => {
      const config = await getPwaConfig();
      if (!config || !config.pushEnabled || !config.vapidPublicKey) return;
      // iOS only allows web push once installed to the home screen.
      if (isIos() && !isStandalone()) {
        setIosHint(true);
        return;
      }
      setVapidKey(config.vapidPublicKey);
    })();
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setVapidKey(null);
    setIosHint(false);
  };

  if (done || (!vapidKey && !iosHint)) return null;

  if (iosHint) {
    return (
      <div
        role="status"
        className="flex items-center justify-between border-b border-line bg-accent-soft px-[16px] py-[10px] text-[13px] text-accent"
        data-testid="pwa-push-ios-hint"
      >
        <span>Add this store to your home screen to enable notifications.</span>
        <button type="button" className="opacity-70" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between border-b border-line bg-accent-soft px-[16px] py-[10px] text-[13px] text-accent"
      data-testid="pwa-push-optin"
    >
      <span>Get notified about your orders and quotes.</span>
      <span className="flex gap-[12px]">
        <button
          type="button"
          className="underline"
          onClick={async () => {
            const ok = await subscribeToPush(vapidKey!);
            if (ok) setDone(true);
            else dismiss();
          }}
        >
          Enable notifications
        </button>
        <button type="button" className="opacity-70" onClick={dismiss}>
          Not now
        </button>
      </span>
    </div>
  );
}
