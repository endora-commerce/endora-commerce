import type { ReactNode } from 'react';
import type { ProductSummary } from '@endora-commerce/contracts';
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
      <p className="py-[40px] text-center text-muted">{t('catalog.empty')}</p>
    );
  }
  if (props.view === 'list') {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {props.products.map((p) => (
          <li key={p.id}>
            <ProductRow product={p} locale={props.locale} />
          </li>
        ))}
      </ul>
    );
  }
  const gridCols = props.columns === 3 ? 'grid-cols-3' : 'grid-cols-4';
  // Feature 044 / US2 — two columns on phones (Industria Mobile §03); the gap
  // tightens at the smallest widths and it collapses to a single column below
  // 380px, where two tiles become too cramped to read.
  const cls = `grid ${gridCols} gap-[16px] m-0 p-0 list-none max-[1100px]:grid-cols-2 max-[540px]:gap-[10px] max-[380px]:grid-cols-1`;
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
