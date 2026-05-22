import type { ReactNode } from 'react';

/**
 * CartTotals (feature 027 US1).
 *
 * Pure presentational summary block. Shows the subtotal, optional
 * applied-coupon discount, and the grand total. The parent passes the
 * already-resolved amounts; this component does no math beyond the
 * money format helper.
 */

interface CartTotalsProps {
  subtotal: { amount: number; currency: string };
  discount: { code: string; amount: number; currency: string } | null;
  grandTotal: { amount: number; currency: string };
  strings: {
    subtotalLabel: string;
    discountLabel: (code: string) => string;
    grandTotalLabel: string;
  };
}

function formatMoney(m: { amount: number; currency: string }): string {
  return `${m.amount.toFixed(2)} ${m.currency}`;
}

export function CartTotals({
  subtotal,
  discount,
  grandTotal,
  strings,
}: CartTotalsProps): ReactNode {
  return (
    <div
      className="b2b-cart__totals"
      style={{
        marginTop: '1.5rem',
        padding: '1rem',
        background: '#fafafa',
        border: '1px solid #e5e5e5',
        borderRadius: '0.25rem',
      }}
    >
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem 1rem' }}>
        <dt>{strings.subtotalLabel}</dt>
        <dd>{formatMoney(subtotal)}</dd>
        {discount ? (
          <>
            <dt>{strings.discountLabel(discount.code)}</dt>
            <dd>−{formatMoney({ amount: discount.amount, currency: discount.currency })}</dd>
          </>
        ) : null}
        <dt style={{ fontWeight: 600 }}>{strings.grandTotalLabel}</dt>
        <dd style={{ fontWeight: 600 }}>{formatMoney(grandTotal)}</dd>
      </dl>
    </div>
  );
}
