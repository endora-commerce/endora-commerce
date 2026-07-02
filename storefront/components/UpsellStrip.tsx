import type { ReactNode } from 'react';
import { formatMoneyObject } from '../lib/i18n/money';

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
  /** Active Sales Channel display locale (e.g. `pl-PL`). */
  locale?: string;
  strings: {
    heading: string;
    noPriceLabel: string;
  };
}

export function UpsellStrip({ upsells, locale, strings }: UpsellStripProps): ReactNode {
  if (upsells.length === 0) return null;
  const formatMoney = (m: { amount: number; currency: string }): string =>
    formatMoneyObject(m, locale);
  return (
    <section className="mt-[28px]" aria-label={strings.heading}>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="m-0 text-[14px] font-semibold uppercase tracking-[0.04em] text-muted">
          {strings.heading}
        </h2>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-0">
        {upsells.map((u) => (
          <li
            key={u.productId}
            className="rounded-md border border-line bg-surface p-[14px] transition hover:border-[var(--ink-700)] hover:shadow-sm"
          >
            <a href={`/p/${u.productSlug}`} className="flex flex-col gap-1.5 text-inherit">
              <span className="line-clamp-2 text-[13px] font-medium leading-[1.3] text-fg">
                {u.productName}
              </span>
              <span
                className={
                  u.unitPrice
                    ? 'font-mono text-[13px] font-medium text-accent'
                    : 'font-mono text-[13px] font-normal italic text-muted'
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
