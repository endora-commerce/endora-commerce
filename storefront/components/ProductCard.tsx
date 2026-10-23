import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductSummary, StorefrontProductStock } from '@endora-commerce/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { cardAddToCartLabel } from '../lib/orderMinimum';
import { DEFAULT_VAT_RATE, grossFromNet } from '../lib/i18n/money';
import { CompareToggle } from './CompareToggle';
import { BaseSalePriceBlock } from './pricing/BaseSalePriceBlock';
import { QuoteRequestCta } from './pricing/QuoteRequestCta';
import { ProductCardActions } from './ProductCardActions';
import type { PriceDisplay } from '../lib/api/pricing';
import { toAbsoluteAssetUrl } from '../lib/asset-url';
import { publicApiBaseUrl } from '../lib/env.mjs';

// Handed to the client `<ProductCardActions>` (shopping-list heart + add to
// cart), which fetches from the browser — so it must be the public,
// build-time-baked `NEXT_PUBLIC_API_BASE_URL`, never the server-only
// `BACKEND_BASE_URL` (internal `http://backend:3001`) that triggers a Mixed
// Content block over HTTPS.
const CARD_API_BASE = publicApiBaseUrl();

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
  resolved?: PriceDisplay | null;
  /**
   * Fractional VAT rate used to derive gross from net; defaults to the
   * deployment assumption in `lib/i18n/money` (issue #132). The card used to
   * bake its own `1.23` literal here.
   */
  vatRate?: number;
  /**
   * The active sales channel. The card's compare toggle and action buttons call
   * the backend from the browser, where no request header carries it.
   */
  salesChannelCode: string | undefined;
}): ReactNode {
  const { product, locale, stock, resolved, vatRate = DEFAULT_VAT_RATE } = props;
  const t = tForLocale(locale);

  const stockNode = stock ? renderFromStorefrontStock(stock, locale, t) : stockFor(product, t);

  return (
    // The `active:` half is the click's own acknowledgement, and it is not
    // decoration (`specs/108-storefront-response-status/`, the owner's Q1
    // ruling). `NavigationFeedback` is delay-gated at 200 ms and the measured
    // medians on this storefront are 69–128 ms, so **most navigations show
    // nothing at all** — which is the right answer to flicker only if the press
    // itself says something. Until now the card carried `hover:` and no
    // `active:`, so a tap on a touch device gave no feedback until the next
    // page arrived; the route-level skeleton had been covering that at ~20 ms.
    //
    // Both idioms are ones `globals.css` already ships, reused rather than
    // invented: `.btn:active`'s "the press cancels the lift"
    // (`translate-y-0 shadow-none`) and `.m-tap`'s "the press tints the
    // surface" (`active:bg-surface-alt`). `:active` matches the ancestors of
    // the pressed element, so a tap anywhere in the card — the image link, the
    // heading link — lands here.
    <article className="group relative flex flex-col rounded-lg border border-line bg-surface transition hover:-translate-y-[3px] hover:border-[var(--ink-700)] hover:shadow-md active:translate-y-0 active:border-line-strong active:bg-surface-alt active:shadow-none">
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
      <CompareToggle productId={product.id} salesChannelCode={props.salesChannelCode} />
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
          salesChannelCode={props.salesChannelCode}
          productId={product.id}
          productSlug={product.slug}
          productName={product.name}
          unitPrice={product.price ?? null}
          buyable={resolved ? resolved.displayMode !== 'none' : product.price != null}
          minOrderQuantity={product.minOrderQuantity ?? null}
          addToCartMinimumLabel={cardAddToCartLabel(product.minOrderQuantity, locale)}
          locale={locale}
        />
      </div>
    </article>
  );
}

function renderPriceSlot(args: {
  product: ProductSummary;
  locale: string;
  resolved: PriceDisplay | null | undefined;
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
          listPrice={resolved.listPrice ?? null}
          displayMode={resolved.displayMode}
          locale={locale}
          vatRate={vatRate}
          variant="card"
          listLabel={t('product.listPrice')}
          yourPriceLabel={t('product.yourPrice')}
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

  // Feature 160 — the buyer's own price, struck through, when `price` is a
  // charged sale (FR-025); and "from" when the variants differ (FR-024).
  const compareAtFmt = product.compareAtPrice
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: product.compareAtPrice.currency,
        minimumFractionDigits: 2,
      }).format(product.compareAtPrice.amount)
    : null;

  // Feature 161 (FR-026) — "list price / your price". The catalogue and search
  // listings render this card without `resolved`, so the list price is read
  // from the summary's own resolution; it is present only when the pricing
  // engine decided to show it (setting on, catalogue price above `price`).
  const listPrice = product.resolvedPrice?.listPrice;
  const listFmt = listPrice
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: listPrice.currency,
        minimumFractionDigits: 2,
      }).format(Number(listPrice.amount))
    : null;

  return (
    <>
      <div className="industria-product-card__price__from">
        {product.priceVariesByVariant ? t('product.priceFromVariants') : 'od / szt.'}
      </div>
      {compareAtFmt ? (
        <s
          data-testid="card-compare-at"
          aria-label={t('product.compareAtLabel')}
          className="font-mono text-[11px] text-muted"
        >
          {compareAtFmt}
        </s>
      ) : null}
      {listFmt ? (
        <div data-testid="card-list-price" className="flex items-baseline gap-[6px] font-mono text-[11px] text-muted">
          <span className="text-[10px] uppercase tracking-[0.04em] text-subtle">{t('product.listPrice')}</span>
          <span>{listFmt}</span>
        </div>
      ) : null}
      {listFmt ? (
        <div className="flex items-baseline gap-[6px]">
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-subtle">{t('product.yourPrice')}</span>
          <div className="font-mono text-[16px] font-semibold tracking-[-0.01em] text-fg">{priceFmt}</div>
        </div>
      ) : (
        <div className="font-mono text-[16px] font-semibold tracking-[-0.01em] text-fg">{priceFmt}</div>
      )}
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
