import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { ProductCard } from './ProductCard';
import { ProductRow } from './ProductRow';
import { tForLocale } from '../lib/i18n/messages';

export function ProductGrid(props: {
  products: ProductSummary[];
  locale: string;
  /** Force a 3-column grid (e.g. category landing); defaults to 4-column. */
  columns?: 3 | 4;
  /** Render mode — `grid` (cards) or `list` (rows). Defaults to `grid`. */
  view?: 'grid' | 'list';
}): ReactNode {
  const t = tForLocale(props.locale);
  if (props.products.length === 0) {
    return (
      <p
        className="industria-grid--empty muted"
        style={{ textAlign: 'center', padding: '40px 0' }}
      >
        {t('catalog.empty')}
      </p>
    );
  }
  if (props.view === 'list') {
    return (
      <ul className="industria-product-list">
        {props.products.map((p) => (
          <li key={p.id}>
            <ProductRow product={p} locale={props.locale} />
          </li>
        ))}
      </ul>
    );
  }
  const cls =
    props.columns === 3
      ? 'industria-product-grid industria-product-grid--3'
      : 'industria-product-grid';
  return (
    <ul className={cls}>
      {props.products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} locale={props.locale} />
        </li>
      ))}
    </ul>
  );
}
