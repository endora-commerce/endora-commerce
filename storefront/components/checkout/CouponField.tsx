import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Checkout coupon control (feature 036, US3). Presentational + pure so it can
 * be unit-tested with `renderToString`. The code is applied to the **cart**
 * (the source of truth `placeOrder` reads), so the discount is reflected in the
 * order summary before the buyer places the order. Apply/remove are server
 * actions passed in by the page and attached via `formAction`.
 */
export interface CouponFieldProps {
  applied: { code: string; amount: number; currency: string } | null;
  error?: string | null;
  applyAction: (formData: FormData) => void | Promise<void>;
  clearAction: (formData: FormData) => void | Promise<void>;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

export function CouponField({
  applied,
  error,
  applyAction,
  clearAction,
  locale,
}: CouponFieldProps): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth__field">
      <label htmlFor="couponCode">{t('checkout.coupon.label')}</label>
      <input
        id="couponCode"
        name="couponCode"
        maxLength={64}
        defaultValue={applied?.code ?? ''}
        placeholder=" "
      />
      <button type="submit" formAction={applyAction}>
        {t('checkout.coupon.apply')}
      </button>

      {applied ? (
        <p className="b2b-auth__success">
          {t('checkout.coupon.appliedPrefix')}
          <strong>{applied.code}</strong>{' '}
          {`${t('checkout.coupon.appliedSuffix')}−${applied.amount.toFixed(2)} ${applied.currency} `}
          <button type="submit" formAction={clearAction}>
            {t('checkout.coupon.remove')}
          </button>
        </p>
      ) : null}
      {error ? <p className="b2b-auth__error">{error}</p> : null}
    </div>
  );
}
