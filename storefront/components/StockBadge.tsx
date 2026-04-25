import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Renders a stock indicator. Backend may return:
 *   - `stockLevel: number` for numeric-mode products,
 *   - `stockIndicator: 'in_stock' | 'low_stock' | 'out_of_stock'` for
 *     categorical mode.
 * Falls back to nothing when both are null (e.g. virtual products).
 */
export function StockBadge(props: {
  product: Pick<ProductSummary, 'stockLevel' | 'stockIndicator'>;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  const { stockLevel, stockIndicator } = props.product;
  if (stockLevel !== null && stockLevel !== undefined) {
    if (stockLevel <= 0) {
      return <span className="b2b-stock b2b-stock--out">{t('product.outOfStock')}</span>;
    }
    return <span className="b2b-stock b2b-stock--in">{`${stockLevel} ${t('product.inStock')}`}</span>;
  }
  if (stockIndicator === 'out_of_stock') {
    return <span className="b2b-stock b2b-stock--out">{t('product.outOfStock')}</span>;
  }
  if (stockIndicator === 'available') {
    return <span className="b2b-stock b2b-stock--in">{t('product.inStock')}</span>;
  }
  if (stockIndicator === 'to_order') {
    return <span className="b2b-stock b2b-stock--low">{t('product.requestQuote')}</span>;
  }
  return null;
}
