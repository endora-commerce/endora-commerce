import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import type { CheckoutBelowMinimumRow } from '../../lib/cartMinimum';
import { LocalizedLink } from '../../lib/i18n/localized-link';

/**
 * Feature 155 (FR-013, FR-037) — the checkout's list of basket lines placement will refuse,
 * from the preview's `belowMinimumLines` (`checkoutBelowMinimumRows`) or the cart view's own
 * flags. Rendered above the Place Order button, which it describes while blocked.
 *
 * Server component: static, assertable from markup. Its one action leads back to the cart,
 * where the quantity is changed or the line removed — checkout has no quantity control.
 * Renders nothing without rows.
 */
export function BelowMinimumSummary({
  id,
  rows,
  locale,
}: {
  /** The id the blocked Place Order button points at with `aria-describedby`. */
  id: string;
  rows: readonly CheckoutBelowMinimumRow[];
  locale: string;
}): ReactNode {
  if (rows.length === 0) return null;
  const t = tForLocale(locale);
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="b2b-auth__warning my-[16px] rounded-md px-[16px] py-[14px] text-[14px]"
    >
      <h3 id={headingId} className="m-0 mb-1 flex items-center gap-2 text-[15px] font-semibold">
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-warn"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        {t('checkout.belowMinimum.heading')}
      </h3>
      <p className="m-0 mb-2 text-[13px]">{t('checkout.belowMinimum.intro')}</p>
      <ul className="m-0 mb-3 list-none p-0">
        {rows.map((row) => (
          <li key={row.cartItemId} className="border-t border-warn/25 py-[6px] text-[13px] first:border-t-0">
            <strong className="font-semibold">{row.name}</strong>
            {' — '}
            <span>{row.reasons.join(' · ')}</span>
          </li>
        ))}
      </ul>
      <LocalizedLink
        href="/cart"
        className="inline-flex min-h-[44px] items-center rounded-sm border border-line-strong bg-surface px-[14px] text-[14px] font-medium text-fg no-underline hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← {t('checkout.belowMinimum.backToCart')}
      </LocalizedLink>
    </section>
  );
}
