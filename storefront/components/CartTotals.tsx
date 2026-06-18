import type { ReactNode } from 'react';

/**
 * CartTotals — Industria-themed summary block (feature 027 US1).
 *
 * Mirrors the `.summary` aside from
 * `specs/b2b-platform-storefront-ui/project/industria-views-checkout.jsx`.
 * Sticky right column with subtotal, optional discount row (in green),
 * and a font-mono total. The page renders this inside a `.cart-summary`
 * card; the component itself emits only the rows + total so it can be
 * embedded alongside a coupon block / shipping hint without wrestling
 * the surrounding container.
 */

interface CartTotalsProps {
  subtotal: { amount: number; currency: string };
  // Feature 045 — `code` is null for automatic (couponless) promotions.
  discount: { code: string | null; amount: number; currency: string } | null;
  grandTotal: { amount: number; currency: string };
  itemCount: number;
  strings: {
    subtotalLabel: (itemCount: number) => string;
    discountLabel: (code: string | null) => string;
    grandTotalLabel: string;
    deliveryLabel: string;
    deliveryValue: string;
  };
}

function formatMoney(m: { amount: number; currency: string }): string {
  return `${m.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.currency}`;
}

export function CartTotals({
  subtotal,
  discount,
  grandTotal,
  itemCount,
  strings,
}: CartTotalsProps): ReactNode {
  return (
    <>
      <div className="flex justify-between py-[6px] text-[13px] text-[color:var(--ink-600)]">
        <span>{strings.subtotalLabel(itemCount)}</span>
        <span className="font-mono font-medium text-fg">{formatMoney(subtotal)}</span>
      </div>
      <div className="flex justify-between py-[6px] text-[13px] text-[color:var(--ink-600)]">
        <span>{strings.deliveryLabel}</span>
        <span className="font-mono font-medium text-ok">{strings.deliveryValue}</span>
      </div>
      {discount ? (
        <div className="flex justify-between py-[6px] text-[13px] text-[color:var(--ink-600)]">
          <span>{strings.discountLabel(discount.code)}</span>
          <span className="font-mono font-medium text-ok">
            −{formatMoney({ amount: discount.amount, currency: discount.currency })}
          </span>
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-[14px]">
        <span className="text-[13px] font-semibold text-fg">{strings.grandTotalLabel}</span>
        <span className="font-mono text-[22px] font-semibold tracking-[-0.01em] text-fg">
          {formatMoney(grandTotal)}
        </span>
      </div>
    </>
  );
}
