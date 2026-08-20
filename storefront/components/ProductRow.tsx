import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { DEFAULT_VAT_RATE, grossFromNet } from '../lib/i18n/money';

/**
 * List-view row for the catalog. Same data surface as `<ProductCard>`,
 * laid out horizontally per the Industria `product-row` design:
 * media · main (sku + name) · stock · price · actions.
 *
 * Migrated to Tailwind utilities (feature 041). Reuses the shared
 * `.industria-stock` atom (kept as an @apply component class).
 */
export function ProductRow(props: {
  product: ProductSummary;
  locale: string;
  /**
   * Fractional VAT rate used to derive gross from net; defaults to the
   * deployment assumption in `lib/i18n/money` (issue #132). This row used to
   * multiply by a literal `1.23`, which is a gross figure no tax authority was
   * consulted about and no caller could correct.
   */
  vatRate?: number;
}): ReactNode {
  const { product, locale, vatRate = DEFAULT_VAT_RATE } = props;
  const t = tForLocale(locale);

  const fmtCurrency = (amount: number): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: product.price!.currency,
      minimumFractionDigits: 2,
    }).format(amount);

  const priceFmt = product.price ? fmtCurrency(product.price.amount) : null;
  // Derived through the shared seam, so the list and grid views agree and both
  // are corrected in one place. `null` price and price `0` stay distinct: the
  // first renders no figure at all, the second renders zero.
  const gross = product.price ? grossFromNet(product.price.amount, vatRate) : null;
  const grossFmt = gross === null ? null : fmtCurrency(gross);

  return (
    <article className="grid grid-cols-[88px_minmax(0,1fr)_170px_170px_130px] items-center gap-[20px] rounded-md border border-line bg-surface p-[16px] transition hover:border-[var(--ink-700)] hover:shadow-sm max-[920px]:grid-cols-[64px_minmax(0,1fr)]">
      <Link
        href={`/p/${product.slug}`}
        className="grid h-[88px] w-[88px] place-items-center overflow-hidden rounded-sm border border-line bg-surface-alt"
        aria-label={product.name}
      >
        {product.primaryAssetUrl ? (
          <img
            src={product.primaryAssetUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain p-[6px]"
          />
        ) : null}
      </Link>
      <div className="min-w-0">
        <div className="flex gap-[6px] font-mono text-[11px] text-muted">
          <span className="font-medium text-fg-soft">{product.sku}</span>
        </div>
        <h3 className="mt-[4px] mb-[6px] text-[14px] font-semibold text-fg">
          <Link href={`/p/${product.slug}`} className="text-inherit hover:text-accent">
            {product.name}
          </Link>
        </h3>
      </div>
      <div className="max-[920px]:col-start-2">{renderStock(product, t)}</div>
      <div className="text-right max-[920px]:col-start-2 max-[920px]:text-left">
        {priceFmt ? (
          <>
            <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-subtle">
              od / szt.
            </div>
            <div className="font-mono text-[16px] font-semibold tracking-[-0.01em] text-fg">
              {priceFmt}
            </div>
            {grossFmt ? (
              <div className="font-mono text-[11px] text-muted">brutto {grossFmt}</div>
            ) : null}
          </>
        ) : (
          <div className="font-mono text-[13px] font-semibold tracking-[-0.01em] text-fg">
            {t('product.requestQuote')}
          </div>
        )}
      </div>
      <div className="flex justify-end max-[920px]:col-start-2 max-[920px]:justify-start">
        <Link href={`/p/${product.slug}`} className="btn btn--outline btn--sm">
          {t('product.details')}
        </Link>
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
