import type { ReactNode } from 'react';
import type { ProductSummary, StorefrontProductStock } from '@endora-commerce/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Stock badge — feature 010 / US5.
 *
 * Three rendering paths in priority order:
 *   1. The new feature-010 `StorefrontProductStock` payload (carries
 *      `displayMode` + `displayBand` + optional `exactOnHand`).
 *   2. Foundation 001 `stockLevel: number` projection.
 *   3. Foundation 001 categorical `stockIndicator`.
 *
 * The display mode controls the wording:
 *   - `exact` → renders the exact integer
 *   - `band` → maps the band enum to localised labels (`Dużo` / `Średnio` / `Mało` / `Brak`)
 *   - `available_or_not` → collapses to `Dostępny` / `Brak w magazynie`
 */
export function StockBadge(props: {
  product: Pick<ProductSummary, 'stockLevel' | 'stockIndicator'>;
  stock?: StorefrontProductStock | null;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);

  if (props.stock) {
    return renderFromStorefrontStock(props.stock, props.locale, t);
  }

  const { stockLevel, stockIndicator } = props.product;
  if (stockLevel !== null && stockLevel !== undefined) {
    if (stockLevel <= 0) {
      return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-bad-soft text-bad">{t('product.outOfStock')}</span>;
    }
    return (
      <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{`${stockLevel} ${t('product.inStock')}`}</span>
    );
  }
  if (stockIndicator === 'out_of_stock') {
    return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-bad-soft text-bad">{t('product.outOfStock')}</span>;
  }
  if (stockIndicator === 'available') {
    return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{t('product.inStock')}</span>;
  }
  if (stockIndicator === 'to_order') {
    return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-warn-soft text-warn">{t('product.requestQuote')}</span>;
  }
  return null;
}

function renderFromStorefrontStock(
  stock: StorefrontProductStock,
  locale: string,
  t: ReturnType<typeof tForLocale>,
): ReactNode {
  if (!stock.manageStock) {
    return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{t('product.inStock')}</span>;
  }
  if (stock.isOutOfStock) {
    return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-bad-soft text-bad">{t('product.outOfStock')}</span>;
  }

  if (stock.displayMode === 'exact' && stock.exactOnHand !== null) {
    return (
      <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">
        {`${stock.exactOnHand.toLocaleString(locale)} ${t('product.inStock')}`}
      </span>
    );
  }

  if (stock.displayMode === 'available_or_not') {
    return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{t('product.inStock')}</span>;
  }

  // band
  switch (stock.displayBand) {
    case 'high':
      return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{t('product.stockBand.high')}</span>;
    case 'medium':
      return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{t('product.stockBand.medium')}</span>;
    case 'low':
      return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-warn-soft text-warn">{t('product.stockBand.low')}</span>;
    case 'available':
      return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">{t('product.inStock')}</span>;
    case 'out_of_stock':
      return <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-bad-soft text-bad">{t('product.outOfStock')}</span>;
  }
}
