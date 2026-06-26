'use client';

import { useEffect, useState } from 'react';

/**
 * Add-to-home-screen prompt (feature 046, US1). Captures the
 * `beforeinstallprompt` event and offers a single, dismissible install
 * pop-up. Renders nothing on browsers that do not fire the event (graceful
 * degradation — no broken install UI, US1 scenario 3).
 *
 * Presented as a floating card pop-up consistent with the Storefront design
 * system (surface/line tokens, `shadow-lg`, the shared `b2b-cta` atom and the
 * `b2b-route-fade` entrance) instead of a full-width top bar. The card is
 * anchored to the bottom-right on desktop and sits above the mobile tab bar on
 * phones (`--m-tabbar-h` + safe-area inset), so it never covers fixed chrome.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'b2b:pwa:install-dismissed';

interface Copy {
  title: string;
  body: string;
  install: string;
  dismiss: string;
  close: string;
}

/** Bilingual copy keyed off `<html lang>`, mirroring CartMergeToast. */
function pickCopy(lang: string): Copy {
  if (lang.toLowerCase().startsWith('pl')) {
    return {
      title: 'Zainstaluj aplikację',
      body: 'Dodaj sklep do ekranu głównego, aby mieć do niego dostęp jednym dotknięciem — bez sklepu z aplikacjami.',
      install: 'Zainstaluj',
      dismiss: 'Nie teraz',
      close: 'Zamknij',
    };
  }
  return {
    title: 'Install our app',
    body: 'Add this store to your home screen for one-tap access — no app store needed.',
    install: 'Install',
    dismiss: 'Not now',
    close: 'Close',
  };
}

export function InstallPrompt(): React.ReactElement | null {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [lang, setLang] = useState('en');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return;

    setLang(document.documentElement.lang || 'en');

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred) return null;

  const copy = pickCopy(lang);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
  };

  const install = async () => {
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    // Fixed full-width wrapper centres the card horizontally with flex so the
    // `b2b-route-fade` entrance (which animates `transform`) can't clobber the
    // centering the way a `-translate-x-1/2` would. Anchored to the top so it
    // doesn't collide with bottom-pinned cookie-consent banners.
    <div
      className="fixed inset-x-0 z-50 flex justify-center px-[16px]"
      style={{ top: 'calc(var(--m-safe-top, 0px) + 16px)' }}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label={copy.title}
        aria-live="polite"
        data-testid="pwa-install-prompt"
        className="b2b-route-fade relative flex w-full gap-[14px] rounded-lg border border-line bg-surface p-[18px] shadow-lg sm:w-[420px]"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label={copy.close}
          className="absolute right-[8px] top-[8px] inline-flex size-[28px] items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-alt hover:text-fg"
        >
          <CloseIcon />
        </button>

        <span
          aria-hidden="true"
          className="mt-[2px] inline-flex size-[40px] shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
        >
          <InstallIcon />
        </span>

        <div className="min-w-0 pr-[20px]">
          <p className="text-[14px] font-semibold text-fg">{copy.title}</p>
          <p className="mt-[4px] text-[13px] leading-[1.45] text-muted">{copy.body}</p>
          <div className="mt-[14px] flex items-center gap-[10px]">
            <button type="button" className="b2b-cta" onClick={() => void install()}>
              {copy.install}
            </button>
            <button type="button" className="btn btn--outline" onClick={dismiss}>
              {copy.dismiss}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallIcon(): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
