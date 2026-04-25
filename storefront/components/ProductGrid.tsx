import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { ProductCard } from './ProductCard';
import { tForLocale } from '../lib/i18n/messages';

export function ProductGrid(props: {
  products: ProductSummary[];
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  if (props.products.length === 0) {
    return (
      <p className="b2b-grid b2b-grid--empty muted">{t('catalog.empty')}</p>
    );
  }
  return (
    <ul className="b2b-grid">
      {props.products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} locale={props.locale} />
        </li>
      ))}
    </ul>
  );
}
