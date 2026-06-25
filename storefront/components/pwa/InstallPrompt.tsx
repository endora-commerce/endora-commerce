'use client';

import { useEffect, useState } from 'react';

/**
 * Add-to-home-screen prompt (feature 046, US1). Captures the
 * `beforeinstallprompt` event and offers a single, dismissible install banner.
 * Renders nothing on browsers that do not fire the event (graceful degradation
 * — no broken install UI, US1 scenario 3). Reuses the storefront inline-banner
 * styling rather than introducing a modal primitive (Principle IX).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'b2b:pwa:install-dismissed';

export function InstallPrompt(): React.ReactElement | null {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return;

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between border-b border-line bg-accent-soft px-[16px] py-[10px] text-[13px] text-accent"
      data-testid="pwa-install-prompt"
    >
      <span>Install this store as an app for one-tap access.</span>
      <span className="flex gap-[12px]">
        <button
          type="button"
          className="underline"
          onClick={async () => {
            await deferred.prompt();
            await deferred.userChoice;
            setDeferred(null);
          }}
        >
          Install
        </button>
        <button type="button" className="opacity-70" onClick={dismiss}>
          Not now
        </button>
      </span>
    </div>
  );
}
