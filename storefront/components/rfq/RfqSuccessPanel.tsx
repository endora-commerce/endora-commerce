import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { LocalizedLink } from '../../lib/i18n/localized-link';

/**
 * Quote-request success panel (feature 008). Reached right after a buyer
 * submits a quote request from `/quote-request`. Mirrors the checkout
 * `SuccessPanel`: shows the customer-facing **business ID** (never the database
 * UUID), a confirmation line, and a next-steps hint, then links to the request
 * detail, the request list, and back to the catalog. Presentational + pure so
 * it can be unit-tested with `renderToString`.
 */
export interface RfqSuccessPanelProps {
  /** Customer-facing business quote-request ID — the headline identifier. */
  businessId: string;
  /** Internal RFQ id — used only to link to the full request view. */
  rfqId: string;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

export function RfqSuccessPanel({
  businessId,
  rfqId,
  locale,
}: RfqSuccessPanelProps): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('quoteRequest.success.title')}</h1>
      <p className="b2b-auth__success">
        {t('quoteRequest.success.numberPrefix')}
        <strong>{businessId}</strong>. {t('quoteRequest.success.confirmationSent')}
      </p>

      <p>{t('quoteRequest.success.nextStepsHint')}</p>

      {/* Issue #1220 — the base reset strips every `<a>` of colour and underline, so
          these take the shared link style. It is the account area's class, and two of
          the three targets are account pages (the buyer's quote requests). */}
      <p className="b2b-auth__hint">
        <LocalizedLink href={`/quote-requests/${rfqId}`} className="b2b-account__link">{t('quoteRequest.success.viewRequest')}</LocalizedLink>
        {' · '}
        <LocalizedLink href="/quote-requests" className="b2b-account__link">{t('quoteRequest.success.allRequests')}</LocalizedLink>
        {' · '}
        <LocalizedLink href="/catalog" className="b2b-account__link">{t('quoteRequest.success.continueShopping')}</LocalizedLink>
      </p>
    </div>
  );
}
