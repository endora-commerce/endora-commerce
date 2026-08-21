import type { ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Checkout Failure Page panel (feature 036, US4). Presentational + pure so it
 * can be unit-tested with `renderToString`. Shown when order **placement**
 * fails: the transaction rolled back, so the cart really is preserved and the
 * buyer can adjust and retry.
 *
 * Issue #287 — that is the whole population for this panel. A buyer whose
 * order exists and whose payment did not settle reaches the same route and
 * gets `PaymentFailurePanel`, because both sentences below are false for them:
 * the placement completed their cart, and "Try again" here leads to
 * `/checkout`, which would place a second order for the same goods.
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
