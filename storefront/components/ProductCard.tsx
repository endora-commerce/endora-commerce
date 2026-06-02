import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary, StorefrontProductStock } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { CompareToggle } from './CompareToggle';
import { BaseSalePriceBlock } from './pricing/BaseSalePriceBlock';
import { QuoteRequestCta } from './pricing/QuoteRequestCta';
import type { ResolvedPrice } from '../lib/api/pricing';

/**
 * Industria-themed product card. Renders the brand/SKU strip, name,
 * stock pill, and price footer. The compare toggle floats on the
 * media block. Backend doesn't currently expose brand or technical
 * attributes on the list summary, so we display the SKU on the brand
 * row and let category pages surface attribute readouts when those
 * are added.
 *
 * Pricing surfaces honour the feature-011 resolver when a `resolved`
 * payload is supplied:
 *   - `salePrice` present → the Special-Price typographic treatment
 *     (Base struck-through, Sale highlighted) plus a small "Sale"
 *     badge on the card body.
 *   - `displayMode === 'none'` → every price element is hidden and
 *     the price slot collapses into a Quote-Request CTA (FR-041).
 *   - Otherwise → the resolver's Base price is rendered with the
 *     resolved gross/net columns.
 *
 * When `resolved` is not provided, the card falls back to the
 * foundation-era `ProductSummary.price` projection.
 */
export function ProductCard(props: {
  product: ProductSummary;
  locale: string;
  /** Optional feature-010 storefront-public stock payload — when
   *  present it overrides the foundation `stockLevel` projection. */
  stock?: StorefrontProductStock | null;
  /** Optional feature-011 resolver payload — when present it drives
   *  the price block, sale treatment, and display-mode handling. */
  resolved?: ResolvedPrice | null;
}): ReactNode {
  const { product, locale, stock, resolved } = props;
  const t = tForLocale(locale);

  const stockNode = stock ? renderFromStorefrontStock(stock, locale, t) : stockFor(product, t);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition hover:-translate-y-[3px] hover:border-[var(--ink-700)] hover:shadow-md">
      <Link
        href={`/p/${product.slug}`}
        className="relative flex aspect-square items-center justify-center border-b border-line bg-surface-alt"
        aria-label={product.name}
      >
        {product.primaryAssetUrl ? (
          <img
            src={product.primaryAssetUrl}
            alt={product.name}
            loading="lazy"
            className="max-h-[70%] max-w-[70%] object-contain transition-transform duration-[400ms] group-hover:scale-105"
          />
        ) : (
          <span
            className="h-[60%] w-[60%] rounded-sm opacity-40 bg-[repeating-linear-gradient(45deg,var(--ink-200),var(--ink-200)_6px,transparent_6px,transparent_12px)]"
            aria-hidden="true"
          />
        )}
      </Link>
      <CompareToggle productId={product.id} />
      {resolved && resolved.salePrice ? (
        <span className="industria-badge industria-badge--sale" aria-label={t('product.requestQuote')}>
          Promocja
        </span>
      ) : null}

      <div className="flex flex-1 flex-col gap-[6px] p-[14px] pb-[16px]">
        <div className="flex gap-[6px] font-mono text-[11px] text-muted">
          <span className="font-medium text-fg-soft">{product.sku}</span>
        </div>
        <Link href={`/p/${product.slug}`} className="text-inherit">
          <h3 className="m-0 line-clamp-2 text-[13px] font-medium leading-[1.4] text-fg">
            {product.name}
          </h3>
        </Link>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-line pt-[10px]">
          <div>{renderPriceSlot({ product, locale, resolved, t })}</div>
          {stockNode}
        </div>
      </div>
    </article>
  );
}

function renderPriceSlot(args: {
  product: ProductSummary;
  locale: string;
  resolved: ResolvedPrice | null | undefined;
  t: ReturnType<typeof tForLocale>;
}): ReactNode {
  const { product, locale, resolved, t } = args;

  if (resolved) {
    if (resolved.displayMode === 'none') {
      return <QuoteRequestCta productId={product.id} productSlug={product.slug} variant="card" />;
    }
    return (
      <>
        <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-subtle">od / szt.</div>
        <BaseSalePriceBlock
          basePrice={resolved.basePrice}
          salePrice={resolved.salePrice}
          displayMode={resolved.displayMode}
          locale={locale}
          variant="card"
        />
      </>
    );
  }

  // Foundation fallback path — the legacy `attributeValues.defaultPrice`
  // pipeline that fed `product.price`. Migration 031 keeps this surface
  // working until US5 wires every read site through the resolver.
  const priceFmt = product.price
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: product.price.currency,
        minimumFractionDigits: 2,
      }).format(product.price.amount)
    : null;
  const grossAmount = product.price ? product.price.amount * 1.23 : null;
  const grossFmt =
    grossAmount && product.price
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: product.price.currency,
          minimumFractionDigits: 2,
        }).format(grossAmount)
      : null;

  if (!priceFmt) {
    return (
      <div className="font-mono text-[13px] font-semibold tracking-[-0.01em] text-fg">
        {t('product.requestQuote')}
      </div>
    );
  }

  return (
    <>
      <div className="industria-product-card__price__from">od / szt.</div>
      <div className="font-mono text-[16px] font-semibold tracking-[-0.01em] text-fg">{priceFmt}</div>
      {grossFmt ? (
        <div className="font-mono text-[11px] text-muted">brutto {grossFmt}</div>
      ) : null}
    </>
  );
}

function renderFromStorefrontStock(
  stock: StorefrontProductStock,
  locale: string,
  t: ReturnType<typeof tForLocale>,
): ReactNode {
  if (!stock.manageStock) {
    return (
      <span className="industria-stock industria-stock--in">
        <span className="dot" />
        {t('product.inStock')}
      </span>
    );
  }
  if (stock.isOutOfStock) {
    return (
      <span className="industria-stock industria-stock--out">
        <span className="dot" />
        {t('product.outOfStock')}
      </span>
    );
  }
  if (stock.displayMode === 'exact' && stock.exactOnHand !== null) {
    return (
      <span className="industria-stock industria-stock--in">
        <span className="dot" />
        {`${stock.exactOnHand.toLocaleString(locale)} szt.`}
      </span>
    );
  }
  if (stock.displayMode === 'available_or_not') {
    return (
      <span className="industria-stock industria-stock--in">
        <span className="dot" />
        {t('product.inStock')}
      </span>
    );
  }
  switch (stock.displayBand) {
    case 'high':
      return (
        <span className="industria-stock industria-stock--in">
          <span className="dot" />
          {t('product.stockBand.high')}
        </span>
      );
    case 'medium':
      return (
        <span className="industria-stock industria-stock--in">
          <span className="dot" />
          {t('product.stockBand.medium')}
        </span>
      );
    case 'low':
      return (
        <span className="industria-stock industria-stock--low">
          <span className="dot" />
          {t('product.stockBand.low')}
        </span>
      );
    case 'available':
      return (
        <span className="industria-stock industria-stock--in">
          <span className="dot" />
          {t('product.inStock')}
        </span>
      );
    case 'out_of_stock':
      return (
        <span className="industria-stock industria-stock--out">
          <span className="dot" />
          {t('product.outOfStock')}
        </span>
      );
  }
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
