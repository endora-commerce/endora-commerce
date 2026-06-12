import type { ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../lib/i18n/messages';

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

      <p className="b2b-auth__hint">
        <Link href={`/quote-requests/${rfqId}`}>{t('quoteRequest.success.viewRequest')}</Link>
        {' · '}
        <Link href="/quote-requests">{t('quoteRequest.success.allRequests')}</Link>
        {' · '}
        <Link href="/catalog">{t('quoteRequest.success.continueShopping')}</Link>
      </p>
    </div>
  );
}
