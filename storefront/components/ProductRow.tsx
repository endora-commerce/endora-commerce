import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * List-view row for the catalog. Same data surface as `<ProductCard>`,
 * laid out horizontally per the Industria `product-row` design:
 * media · main (sku + name) · stock · price · actions.
 *
 * Backend list summaries don't currently expose technical attributes
 * or alt-currency prices, so the "attrs" row from the prototype is
 * omitted until a richer projection lands.
 */
export function ProductRow(props: {
  product: ProductSummary;
  locale: string;
}): ReactNode {
  const { product, locale } = props;
  const t = tForLocale(locale);

  const priceFmt = product.price
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: product.price.currency,
        minimumFractionDigits: 2,
      }).format(product.price.amount)
    : null;

  return (
    <article className="industria-product-row">
      <Link
        href={`/p/${product.slug}`}
        className="industria-product-row__media"
        aria-label={product.name}
      >
        {product.primaryAssetUrl ? (
          <img src={product.primaryAssetUrl} alt={product.name} loading="lazy" />
        ) : null}
      </Link>
      <div className="industria-product-row__main">
        <div className="industria-product-card__sku">
          <span className="industria-product-card__brand">{product.sku}</span>
        </div>
        <h3>
          <Link href={`/p/${product.slug}`} style={{ color: 'inherit' }}>
            {product.name}
          </Link>
        </h3>
      </div>
      <div className="industria-product-row__stock">
        {renderStock(product, t)}
      </div>
      <div className="industria-product-row__price">
        {priceFmt ? (
          <div className="industria-product-card__price__main">{priceFmt}</div>
        ) : (
          <div className="industria-product-card__price__main" style={{ fontSize: 13 }}>
            {t('product.requestQuote')}
          </div>
        )}
      </div>
    </article>
  );
}

function renderStock(p: ProductSummary, t: ReturnType<typeof tForLocale>): ReactNode {
  if (p.stockLevel !== null && p.stockLevel !== undefined) {
    if (p.stockLevel <= 0) {
      return (
        <span className="industria-stock industria-stock--out">
          <span className="dot" />
          {t('product.outOfStock')}
        </span>
      );
    }
    if (p.stockLevel < 10) {
      return (
        <span className="industria-stock industria-stock--low">
          <span className="dot" />
          Mało: {p.stockLevel}
        </span>
      );
    }
    return (
      <span className="industria-stock industria-stock--in">
        <span className="dot" />
        {p.stockLevel.toLocaleString('pl-PL')} szt.
      </span>
    );
  }
  if (p.stockIndicator === 'out_of_stock') {
    return (
      <span className="industria-stock industria-stock--out">
        <span className="dot" />
        {t('product.outOfStock')}
      </span>
    );
  }
  if (p.stockIndicator === 'available') {
    return (
      <span className="industria-stock industria-stock--in">
        <span className="dot" />
        {t('product.inStock')}
      </span>
    );
  }
  if (p.stockIndicator === 'to_order') {
    return (
      <span className="industria-stock industria-stock--low">
        <span className="dot" />
        Na zamówienie
      </span>
    );
  }
  return null;
}
