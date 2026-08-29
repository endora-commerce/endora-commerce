import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary, StorefrontProductStock } from '@endora-commerce/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { DEFAULT_VAT_RATE, grossFromNet } from '../lib/i18n/money';
import { CompareToggle } from './CompareToggle';
import { BaseSalePriceBlock } from './pricing/BaseSalePriceBlock';
import { QuoteRequestCta } from './pricing/QuoteRequestCta';
import { ProductCardActions } from './ProductCardActions';
import type { ResolvedPrice } from '../lib/api/pricing';
import { toAbsoluteAssetUrl } from '../lib/asset-url';

// Handed to the client `<ProductCardActions>` (shopping-list heart + add to
// cart), which fetches from the browser — so it must be the public,
// build-time-baked `NEXT_PUBLIC_API_BASE_URL`, never the server-only
// `BACKEND_BASE_URL` (internal `http://backend:3001`) that triggers a Mixed
// Content block over HTTPS.
const CARD_API_BASE =
  process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

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
  /**
   * Fractional VAT rate used to derive gross from net; defaults to the
   * deployment assumption in `lib/i18n/money` (issue #132). The card used to
   * bake its own `1.23` literal here.
   */
  vatRate?: number;
}): ReactNode {
  const { product, locale, stock, resolved, vatRate = DEFAULT_VAT_RATE } = props;
  const t = tForLocale(locale);

  const stockNode = stock ? renderFromStorefrontStock(stock, locale, t) : stockFor(product, t);

  return (
    <article className="group relative flex flex-col rounded-lg border border-line bg-surface transition hover:-translate-y-[3px] hover:border-[var(--ink-700)] hover:shadow-md">
      <Link
        href={`/p/${product.slug}`}
        className="relative flex aspect-square items-center justify-center overflow-hidden rounded-t-lg border-b border-line bg-surface-alt"
        aria-label={product.name}
      >
        {product.primaryAssetUrl ? (
          <img
            src={toAbsoluteAssetUrl(product.primaryAssetUrl)}
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

      <div className="flex flex-1 flex-col gap-[6px] p-[14px] pb-[16px] max-md:gap-[5px] max-md:p-[10px] max-md:pb-[12px]">
        <div className="flex gap-[6px] font-mono text-[11px] text-muted">
          <span className="font-medium text-fg-soft">{product.sku}</span>
        </div>
        <Link href={`/p/${product.slug}`} className="text-inherit">
          <h3 className="m-0 line-clamp-2 text-[13px] font-medium leading-[1.4] text-fg">
            {product.name}
          </h3>
        </Link>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-line pt-[10px]">
          <div>{renderPriceSlot({ product, locale, resolved, t, vatRate })}</div>
          {stockNode}
        </div>
        <ProductCardActions
          apiBase={CARD_API_BASE}
          productId={product.id}
          productSlug={product.slug}
          productName={product.name}
          unitPrice={product.price ?? null}
          buyable={resolved ? resolved.displayMode !== 'none' : product.price != null}
        />
      </div>
    </article>
  );
}

function renderPriceSlot(args: {
  product: ProductSummary;
  locale: string;
  resolved: ResolvedPrice | null | undefined;
  t: ReturnType<typeof tForLocale>;
  vatRate: number;
}): ReactNode {
  const { product, locale, resolved, t, vatRate } = args;

  if (resolved) {
    if (resolved.displayMode === 'none') {
      return (
        <QuoteRequestCta
          productId={product.id}
          productSlug={product.slug}
          productName={product.name}
          variant="card"
        />
      );
    }
    return (
      <>
        <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-subtle">od / szt.</div>
        <BaseSalePriceBlock
          basePrice={resolved.basePrice}
          salePrice={resolved.salePrice}
          displayMode={resolved.displayMode}
          locale={locale}
          vatRate={vatRate}
          variant="card"
        />
      </>
    );
  }

  // `ProductSummary.price` — since issue #132 this is the pricing engine's own
  // answer for the listing, resolved server-side through the `pricingService`
  // port, not the catalogue's legacy `defaultPrice` projection it used to be.
  const priceFmt = product.price
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: product.price.currency,
        minimumFractionDigits: 2,
      }).format(product.price.amount)
    : null;
  // Derived through the shared seam (issue #132). The previous form multiplied
  // by a literal `1.23` and then tested the product with `grossAmount &&`, so a
  // price of zero lost its gross line entirely — the "no price" / "price zero"
  // collapse, on the render side.
  const grossAmount = product.price ? grossFromNet(product.price.amount, vatRate) : null;
  const grossFmt =
    grossAmount !== null && product.price
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
