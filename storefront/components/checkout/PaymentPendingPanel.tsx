import type { ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../lib/i18n/messages';
import { PaymentStatusPoller } from './PaymentStatusPoller';

/**
 * The third answer to a gateway return (issue #287).
 *
 * A buyer can be back before the gateway's confirmation has reached us, so the
 * order is legitimately neither paid nor failed. Both other pages would lie:
 * the success page would thank them for money nobody has confirmed, and the
 * failure page would tell someone whose money is in flight that it failed —
 * the worst outcome available. So the wait is a page of its own, and it says
 * the one thing that is true: the order is placed and the payment is being
 * confirmed.
 *
 * It never becomes a failure by timing out. When the poll budget is spent the
 * copy admits the wait is unusual and hands the buyer an e-mail promise, a
 * manual re-check and the order page — a real answer rather than a verdict.
 *
 * Presentational + pure so it can be unit-tested with `renderToString`; the
 * poller it renders is a client component that does nothing during SSR.
 */
export interface PaymentPendingPanelProps {
  /** Customer-facing business Order ID — the headline identifier. */
  businessId: string;
  /** Internal order id — the link to the full order. */
  orderId: string;
  /** The same landing, for a buyer (or a browser without JS) to re-check. */
  checkAgainUrl: string;
  /** The next automatic look, or `null` once the budget is spent. */
  poll: { url: string; delayMs: number } | null;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

export function PaymentPendingPanel({
  businessId,
  orderId,
  checkAgainUrl,
  poll,
  locale,
}: PaymentPendingPanelProps): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('checkout.paymentPending.title')}</h1>
      <p className="b2b-auth__success">
        {t('checkout.paymentPending.orderNumberPrefix')}
        <strong>{businessId}</strong>.
      </p>
      <p aria-live="polite">{t('checkout.paymentPending.placed')}</p>
      {poll ? null : (
        <p className="b2b-auth__hint">{t('checkout.paymentPending.stillWaiting')}</p>
      )}

      <p className="b2b-auth__hint">
        <a href={checkAgainUrl}>{t('checkout.paymentPending.checkAgain')}</a>
        {' · '}
        <Link href={`/orders/${orderId}`}>{t('checkout.paymentPending.viewOrder')}</Link>
      </p>

      {poll ? <PaymentStatusPoller nextUrl={poll.url} delayMs={poll.delayMs} /> : null}
    </div>
  );
}
