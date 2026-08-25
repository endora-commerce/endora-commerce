'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../../lib/i18n/messages';
import { documentLocale, FALLBACK_LOCALE } from '../../../lib/i18n/document-locale';

/**
 * The checkout segment's error boundary — and the first one anywhere under
 * `storefront/app`.
 *
 * Without it, anything a checkout Server Component throws reaches Next's own
 * 500 page. That was reachable from a *supported operator action*: with
 * `payment_methods` switched off, `GET /api/v1/payment-methods` answers
 * `503 MODULE_DISABLED`, `listPaymentMethods()` threw inside the page's
 * `Promise.all` (whose only tolerated failure is a 401), and the buyer got a
 * blank server error. Constitution XVII says a module that is off behaves as if
 * never installed; a 500 is not that.
 *
 * **This boundary is not the repair for that case, and must not become it.**
 * The module refusal is handled where it is understood —
 * `listPaymentMethods` degrades `MODULE_DISABLED` (and only that) to an empty
 * catalogue, so checkout still renders and says "no payment method is
 * available" with the Place Order button disabled. What reaches here is
 * everything else: a genuine bug, a backend that is down, a malformed payload.
 *
 * So the copy deliberately does **not** mention payment methods or any other
 * product state. It says checkout failed, states what is *not* true (nothing
 * ordered, nothing charged, cart intact), offers a retry, and shows the
 * `digest` Next attaches so a support conversation can be joined to the server
 * log line. Next logs the original error and its stack server-side either way —
 * this boundary hides nothing from operators, only from the buyer, who cannot
 * act on a stack trace.
 *
 * Locale: an `error.tsx` receives only `{ error, reset }`, so there is no
 * server-resolved locale to pass in. The root layout stamps `<html lang>`, which
 * is read after mount — the first paint (and the hydration match) is the default
 * language, and the buyer's language replaces it immediately.
 */
export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  const [locale, setLocale] = useState(FALLBACK_LOCALE);

  useEffect(() => {
    setLocale(documentLocale());
  }, []);

  const t = tForLocale(locale);

  return (
    <div className="b2b-auth">
      <h1>{t('checkout.error.title')}</h1>
      <p>{t('checkout.error.body')}</p>
      {error.digest ? (
        <p className="muted font-mono text-[11px]">
          {t('checkout.error.referencePrefix')}
          {error.digest}
        </p>
      ) : null}
      <p className="b2b-auth__actions items-center gap-2">
        <button type="button" onClick={reset}>
          {t('checkout.error.retry')}
        </button>
        <Link href="/cart">{t('checkout.error.backToCart')}</Link>
      </p>
    </div>
  );
}
