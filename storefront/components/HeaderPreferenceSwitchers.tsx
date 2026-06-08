'use client';

import { useTransition, type ChangeEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LanguagePicker } from '../lib/dictionary/pickers/LanguagePicker';
import { CurrencyPicker } from '../lib/dictionary/pickers/CurrencyPicker';

/**
 * Header language + currency switchers.
 *
 * The previous markup wrapped each picker in a `<form method="GET">` with no
 * submit trigger, so changing the dropdown did nothing — and even a submit
 * would not have persisted, because the root layout (which renders this
 * header) never reads a `?lang`/`?currency` query param. These client
 * switchers instead persist the choice in a site-wide cookie and refresh the
 * server tree, so `getServerContext` picks the preference up on the next
 * render (locale resolution + the currency passed to the pricing API).
 */

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function setPreferenceCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function LocaleSwitcher({ locale }: { locale: string }): ReactNode {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setPreferenceCookie('lang', event.target.value);
    startTransition(() => router.refresh());
  };
  return (
    <div className="industria-topbar__switcher">
      <label htmlFor="b2b-locale">Język:</label>
      <LanguagePicker id="b2b-locale" name="lang" value={locale} onChange={onChange} />
    </div>
  );
}

export function CurrencySwitcher({ currency }: { currency?: string | undefined }): ReactNode {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setPreferenceCookie('currency', event.target.value);
    startTransition(() => router.refresh());
  };
  return (
    <div className="industria-topbar__switcher">
      <label htmlFor="b2b-currency">Waluta:</label>
      {currency ? (
        <CurrencyPicker id="b2b-currency" name="currency" value={currency} onChange={onChange} />
      ) : (
        <CurrencyPicker id="b2b-currency" name="currency" onChange={onChange} />
      )}
    </div>
  );
}
