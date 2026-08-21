import type { ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../lib/i18n/messages';
import type { PaymentFailureReason } from '../../lib/payments/post-payment-landing';

/**
 * The failure page for a buyer whose **order already exists** (issue #287).
 *
 * `FailurePanel` next door is the other reader: placement threw, the
 * transaction rolled back, and the cart really is intact — so it promises the
 * cart was kept and sends the buyer back to `/checkout`. Neither sentence is
 * true here. The placement completed the cart, and `/checkout` would place a
 * second order for goods the buyer already owes for; the one thing this reader
 * wants is to pay *this* order, so that is the only action offered.
 *
 * Presentational + pure so it can be unit-tested with `renderToString`. The
 * "pay again" server action is passed in by the page, because the write is the
 * page's to own.
 */
export interface PaymentFailurePanelProps {
  /** Customer-facing business Order ID — the headline identifier. */
  businessId: string;
  /** Internal order id — the retry target and the link to the full order. */
  orderId: string;
  /** Why this page is showing: a decline, or a payment left unfinished. */
  reason: PaymentFailureReason;
  /**
   * Whether this order can be paid online again — decided by the platform and
   * mirrored by `lib/payment-retry.ts`, never re-derived here.
   */
  canRetry: boolean;
  /** Starts a fresh payment attempt for this order. */
  payAgainAction: (formData: FormData) => Promise<void>;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

export function PaymentFailurePanel({
  businessId,
  orderId,
  reason,
  canRetry,
  payAgainAction,
  locale,
}: PaymentFailurePanelProps): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>
        {reason === 'cancelled'
          ? t('checkout.paymentFailure.title.cancelled')
          : t('checkout.paymentFailure.title.failed')}
      </h1>
      <p className="b2b-auth__error">
        {reason === 'cancelled'
          ? t('checkout.paymentFailure.cancelledBody')
          : t('checkout.paymentFailure.failedBody')}
      </p>
      <p>
        {t('checkout.paymentFailure.orderPlacedPrefix')}
        <strong>{businessId}</strong>
        {t('checkout.paymentFailure.orderPlacedSuffix')}
      </p>

      {canRetry ? (
        <>
          <p className="b2b-auth__hint">{t('checkout.paymentFailure.retryHint')}</p>
          <form action={payAgainAction} className="b2b-auth__actions">
            <input type="hidden" name="id" value={orderId} />
            <button type="submit" className="btn btn--primary">
              {t('checkout.paymentFailure.payAgain')}
            </button>
          </form>
        </>
      ) : (
        <p className="b2b-auth__hint">{t('checkout.paymentFailure.noRetryHint')}</p>
      )}

      <p className="b2b-auth__hint">
        <Link href={`/orders/${orderId}`}>{t('checkout.paymentFailure.viewOrder')}</Link>
        {' · '}
        <Link href="/orders">{t('checkout.paymentFailure.allOrders')}</Link>
      </p>
    </div>
  );
}
