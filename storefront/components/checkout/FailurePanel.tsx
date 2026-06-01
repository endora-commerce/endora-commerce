import type { ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Checkout Failure Page panel (feature 036, US4). Presentational + pure so it
 * can be unit-tested with `renderToString`. Shown when order placement fails;
 * the cart is preserved, so the buyer can adjust and retry.
 */
export interface FailurePanelProps {
  reason?: string | null;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

export function FailurePanel({ reason, locale }: FailurePanelProps): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth" style={{ maxWidth: 720 }}>
      <h1>{t('checkout.failure.title')}</h1>
      <p className="b2b-auth__error">
        {reason && reason.trim().length > 0 ? reason : t('checkout.failure.generic')}
      </p>
      <p>{t('checkout.failure.cartKept')}</p>
      <div className="b2b-auth__actions">
        <Link href="/checkout">
          <button type="button">{t('checkout.failure.tryAgain')}</button>
        </Link>
      </div>
      <p className="b2b-auth__hint">
        <Link href="/cart">{t('checkout.failure.backToCart')}</Link>
      </p>
    </div>
  );
}
