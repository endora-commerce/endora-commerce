'use client';

import { useEffect, useState } from 'react';
import { PUSH_DISMISS_KEY, getPwaConfig, subscribeToPush } from '../../lib/api/pwa';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Push opt-in (feature 046, US4). Shown only when the channel has push enabled
 * and the browser supports the Web-Push API. Respects a prior dismissal/denial
 * (no nagging — edge case). On iOS, web push requires the PWA to be installed
 * first, so when not running standalone the control explains that instead of
 * appearing broken (iOS edge case).
 */
const DISMISS_KEY = PUSH_DISMISS_KEY;

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** @param locale The page's locale, from the root layout (issue #85). */
export function PushOptIn({ locale }: { locale: string }): React.ReactElement | null {
  const t = tForLocale(locale);
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
        <span>{t('chrome.pwa.push.iosHint')}</span>
        <button type="button" className="opacity-70" onClick={dismiss}>
          {t('chrome.pwa.push.iosDismiss')}
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
      <span>{t('chrome.pwa.push.prompt')}</span>
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
          {t('chrome.pwa.push.enable')}
        </button>
        <button type="button" className="opacity-70" onClick={dismiss}>
          {t('chrome.pwa.push.notNow')}
        </button>
      </span>
    </div>
  );
}
