import type { ReactNode } from 'react';

/**
 * UpsellStrip — Industria-themed up-sell card grid (feature 027 US1).
 *
 * Server-component-friendly. Renders nothing when the list is empty.
 * Used below the cart card.
 */

export interface UpsellLineViewModel {
  productId: string;
  productName: string;
  productSlug: string;
  unitPrice: { amount: number; currency: string } | null;
}

interface UpsellStripProps {
  upsells: UpsellLineViewModel[];
  strings: {
    heading: string;
    noPriceLabel: string;
  };
}

function formatMoney(m: { amount: number; currency: string }): string {
  return `${m.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.currency}`;
}

export function UpsellStrip({ upsells, strings }: UpsellStripProps): ReactNode {
  if (upsells.length === 0) return null;
  return (
    <section className="cart-upsells" aria-label={strings.heading}>
      <div className="cart-upsells__head">
        <h2>{strings.heading}</h2>
      </div>
      <ul className="cart-upsells__grid">
        {upsells.map((u) => (
          <li key={u.productId} className="cart-upsells__item">
            <a href={`/p/${u.productSlug}`}>
              <span className="cart-upsells__item__name">{u.productName}</span>
              <span
                className={
                  u.unitPrice
                    ? 'cart-upsells__item__price'
                    : 'cart-upsells__item__price cart-upsells__item__price--quote'
                }
              >
                {u.unitPrice ? formatMoney(u.unitPrice) : strings.noPriceLabel}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
