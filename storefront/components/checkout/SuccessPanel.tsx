import type { ReactNode } from 'react';
import Link from 'next/link';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Checkout Success Page panel (feature 036, US1). Presentational + pure so it
 * can be unit-tested with `renderToString`. Shows the customer-facing
 * **business Order ID** (never the database UUID), a success confirmation, and
 * a payment-method-appropriate next-step hint.
 */
export interface SuccessPanelProps {
  /** Customer-facing business Order ID — the headline identifier. */
  businessId: string;
  /** Internal order id — used only to link to the full order view. */
  orderId: string;
  paymentKind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway' | string;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

export function SuccessPanel({
  businessId,
  orderId,
  paymentKind,
  locale,
}: SuccessPanelProps): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('checkout.success.title')}</h1>
      <p className="b2b-auth__success">
        {t('checkout.success.orderNumberPrefix')}
        <strong>{businessId}</strong>. {t('checkout.success.confirmationSent')}
      </p>

      {paymentKind === 'bank_transfer' ? <p>{t('checkout.success.bankTransferHint')}</p> : null}
      {paymentKind === 'pickup' ? <p>{t('checkout.success.pickupHint')}</p> : null}
      {paymentKind === 'credit_limit' ? (
        <p>{t('checkout.success.creditLimitHint')}</p>
      ) : null}

      <p className="b2b-auth__hint">
        <Link href={`/orders/${orderId}`}>{t('checkout.success.viewOrder')}</Link>
        {' · '}
        <Link href="/account/orders">{t('checkout.success.allOrders')}</Link>
        {' · '}
        <Link href="/catalog">{t('checkout.success.continueShopping')}</Link>
      </p>
    </div>
  );
}
