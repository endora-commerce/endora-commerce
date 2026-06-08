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
    <div>
      <label
        htmlFor="couponCode"
        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted"
      >
        {t('checkout.coupon.label')}
      </label>
      <div className="flex gap-1.5">
        <input
          id="couponCode"
          name="couponCode"
          maxLength={64}
          defaultValue={applied?.code ?? ''}
          className="h-[40px] min-w-0 flex-1 rounded-sm border border-line bg-surface px-[12px] text-[14px] text-fg outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-[color:var(--brand-600)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.16)]"
        />
        <button type="submit" formAction={applyAction} className="btn btn--dark shrink-0">
          {t('checkout.coupon.apply')}
        </button>
      </div>

      {applied ? (
        <p className="b2b-auth__success mt-2 flex flex-wrap items-center gap-2">
          <span>
            {t('checkout.coupon.appliedPrefix')}
            <strong>{applied.code}</strong>{' '}
            {`${t('checkout.coupon.appliedSuffix')}−${applied.amount.toFixed(2)} ${applied.currency}`}
          </span>
          <button type="submit" formAction={clearAction} className="btn btn--ghost btn--sm">
            {t('checkout.coupon.remove')}
          </button>
        </p>
      ) : null}
      {error ? <p className="b2b-auth__error mt-2">{error}</p> : null}
    </div>
  );
}
