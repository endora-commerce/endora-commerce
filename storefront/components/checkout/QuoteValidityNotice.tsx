import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import type { QuoteCommitmentRefusal } from '../../lib/api/orders';
import { LocalizedLink } from '../../lib/i18n/localized-link';

const LINK_CLASS =
  'inline-flex min-h-[44px] items-center rounded-sm border border-line-strong bg-surface px-[14px] text-[14px] font-medium text-fg no-underline hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Issue #167 — the basket is priced at a quote that no longer binds (the checkout preview's
 * `quoteCommitmentRefusal`), so placement will refuse it with `410 QUOTE_VALIDITY_ENDED`. Says
 * which of the three it is and what to do, above the Place Order button it describes while
 * blocked.
 *
 * Server component, static, rendered like `BelowMinimumSummary` beside it. A lapsed or withdrawn
 * quote leads to the buyer's quote requests, where a new one is asked for; while quote prices
 * cannot be confirmed at all (the quote desk is switched off) that page is not there to lead to,
 * so only the basket is offered. Renders nothing without a refusal.
 */
export function QuoteValidityNotice({
  id,
  refusal,
  locale,
}: {
  /** The id the blocked Place Order button points at with `aria-describedby`. */
  id: string;
  refusal: QuoteCommitmentRefusal | null;
  locale: string;
}): ReactNode {
  if (refusal === null) return null;
  const t = tForLocale(locale);
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="my-[16px] rounded-md border border-warn bg-warn-soft px-[16px] py-[14px] text-fg"
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
        {t(`checkout.quoteEnded.heading.${refusal}`)}
      </h3>
      <p className="m-0 mb-3 text-[13px] text-fg-soft">{t(`checkout.quoteEnded.body.${refusal}`)}</p>
      <div className="flex flex-wrap gap-2">
        {refusal !== 'unavailable' ? (
          <LocalizedLink href="/quote-requests" className={LINK_CLASS}>
            {t('checkout.quoteEnded.toQuotes')}
          </LocalizedLink>
        ) : null}
        <LocalizedLink href="/cart" className={LINK_CLASS}>
          ← {t('checkout.quoteEnded.toCart')}
        </LocalizedLink>
      </div>
    </section>
  );
}
