import type { ReactNode } from 'react';
import type { CartVat, DisplayMode } from '@endora-commerce/contracts';
import { moneyByModeWithGross } from '../lib/i18n/money';

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
  /**
   * Issue #436 — the cart read's VAT per rate. The gross figures come from
   * here and nowhere else; without it the summary shows the net, tagged net.
   */
  vat?: CartVat | null;
  itemCount: number;
  /** Active Sales Channel display locale (e.g. `pl-PL`). */
  locale?: string;
  /** Settings-resolved price display mode — drives net/gross rendering so the
   *  summary matches the cart lines, PDP, and product cards. Defaults to
   *  `net_only`. */
  displayMode?: DisplayMode;
  strings: {
    subtotalLabel: (itemCount: number) => string;
    discountLabel: (code: string | null) => string;
    grandTotalLabel: string;
    deliveryLabel: string;
    deliveryValue: string;
    netSuffix: string;
    grossSuffix: string;
  };
}

export function CartTotals({
  subtotal,
  discount,
  grandTotal,
  vat = null,
  itemCount,
  locale,
  displayMode = 'net_only',
  strings,
}: CartTotalsProps): ReactNode {
  const suffixFor = (kind: 'net' | 'gross' | null): string =>
    kind === 'net' ? strings.netSuffix : kind === 'gross' ? strings.grossSuffix : '';
  // Issue #436 — the gross is the backend's VAT per rate, the order's figure;
  // the discount comes off the gross untaxed, so it reads the same on both
  // sides and `subtotal − discount = total` holds in either column.
  const renderAmount = (
    m: { amount: number; currency: string },
    gross: number | null,
    prefix = '',
  ): ReactNode => {
    const priced = moneyByModeWithGross(m, gross, displayMode, locale);
    return (
      <>
        {prefix}
        {priced.primary}
        {priced.primaryKind ? (
          <span className="ml-[3px] text-[10px] font-normal text-muted">{suffixFor(priced.primaryKind)}</span>
        ) : null}
        {priced.secondary ? (
          <span className="ml-[6px] text-[11px] font-normal text-muted">
            {priced.secondary}
            <span className="ml-[3px] text-[10px]">{suffixFor(priced.secondaryKind)}</span>
          </span>
        ) : null}
      </>
    );
  };
  return (
    <>
      <div className="flex justify-between py-[6px] text-[13px] text-[color:var(--ink-600)]">
        <span>{strings.subtotalLabel(itemCount)}</span>
        <span className="font-mono font-medium text-fg">{renderAmount(subtotal, vat?.subtotalGross ?? null)}</span>
      </div>
      <div className="flex justify-between py-[6px] text-[13px] text-[color:var(--ink-600)]">
        <span>{strings.deliveryLabel}</span>
        <span className="font-mono font-medium text-ok">{strings.deliveryValue}</span>
      </div>
      {discount ? (
        <div className="flex justify-between py-[6px] text-[13px] text-[color:var(--ink-600)]">
          <span>{strings.discountLabel(discount.code)}</span>
          <span className="font-mono font-medium text-ok">
            {renderAmount(
              { amount: discount.amount, currency: discount.currency },
              vat ? discount.amount : null,
              '−',
            )}
          </span>
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-[14px]">
        <span className="text-[13px] font-semibold text-fg">{strings.grandTotalLabel}</span>
        <span className="font-mono text-[22px] font-semibold tracking-[-0.01em] text-fg">
          {renderAmount(grandTotal, vat?.grandTotalGross ?? null)}
        </span>
      </div>
    </>
  );
}
