import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { CompareToggle } from './CompareToggle';

/**
 * Industria-themed product card. Renders the brand/SKU strip, name,
 * stock pill, and price footer with `od / unit` and a brutto alt line.
 * The compare toggle floats on the media block. Backend doesn't
 * currently expose brand or technical attributes on the list summary,
 * so we display the SKU on the brand row and let category pages
 * surface attribute readouts when those are added.
 */
export function ProductCard(props: {
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
  const grossAmount = product.price ? product.price.amount * 1.23 : null;
  const grossFmt = grossAmount && product.price
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: product.price.currency,
        minimumFractionDigits: 2,
      }).format(grossAmount)
    : null;

  const stock = stockFor(product, t);

  return (
    <article className="industria-product-card">
      <Link href={`/p/${product.slug}`} className="industria-product-card__media" aria-label={product.name}>
        {product.primaryAssetUrl ? (
          <img src={product.primaryAssetUrl} alt={product.name} loading="lazy" />
        ) : (
          <span className="industria-product-card__media-placeholder" aria-hidden="true" />
        )}
      </Link>
      <CompareToggle productId={product.id} />

      <div className="industria-product-card__body">
        <div className="industria-product-card__sku">
          <span className="industria-product-card__brand">{product.sku}</span>
        </div>
        <Link href={`/p/${product.slug}`} style={{ color: 'inherit' }}>
          <h3 className="industria-product-card__name">{product.name}</h3>
        </Link>
        <div className="industria-product-card__foot">
          <div>
            {priceFmt ? (
              <>
                <div className="industria-product-card__price__from">od / szt.</div>
                <div className="industria-product-card__price__main">{priceFmt}</div>
                {grossFmt ? (
                  <div className="industria-product-card__price__alt">brutto {grossFmt}</div>
                ) : null}
              </>
            ) : (
              <div className="industria-product-card__price__main" style={{ fontSize: 13 }}>
                {t('product.requestQuote')}
              </div>
            )}
          </div>
          {stock}
        </div>
      </div>
    </article>
  );
}

function stockFor(p: ProductSummary, t: ReturnType<typeof tForLocale>): ReactNode {
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
