import type { ReactNode } from 'react';

/**
 * UpsellStrip (feature 027 US1).
 *
 * Renders a small horizontal strip of up-sell suggestions sourced
 * from `GET /api/v1/cart/upsells`. Server-component-friendly; the
 * parent fetches the data and hands it in. Empty list → renders
 * nothing (the spec says no banner / no placeholder).
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
  return `${m.amount.toFixed(2)} ${m.currency}`;
}

export function UpsellStrip({ upsells, strings }: UpsellStripProps): ReactNode {
  if (upsells.length === 0) return null;
  return (
    <section
      className="b2b-cart__upsells"
      style={{ marginTop: '1.5rem' }}
      aria-label={strings.heading}
    >
      <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{strings.heading}</h2>
      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))',
          gap: '0.75rem',
          listStyle: 'none',
          padding: 0,
        }}
      >
        {upsells.map((u) => (
          <li
            key={u.productId}
            className="b2b-cart__upsell"
            style={{
              border: '1px solid #e5e5e5',
              padding: '0.5rem',
              borderRadius: '0.25rem',
              background: '#fff',
            }}
          >
            <a
              href={`/p/${u.productSlug}`}
              style={{ display: 'block', color: '#222', textDecoration: 'none' }}
            >
              <span style={{ display: 'block', fontWeight: 500 }}>{u.productName}</span>
              <span
                className="b2b-cart__upsell-price"
                style={{ fontSize: '0.9rem', color: '#555' }}
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
