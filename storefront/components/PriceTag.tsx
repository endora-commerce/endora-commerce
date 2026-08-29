import type { ReactNode } from 'react';
import type { Money } from '@endora-commerce/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { BaseSalePriceBlock } from './pricing/BaseSalePriceBlock';
import type { ResolvedPrice } from '../lib/api/pricing';

/**
 * Price rendering for the storefront.
 *
 * Two call shapes are supported so existing call-sites keep working
 * while the resolver-driven path lands:
 *   - foundation `Money | null` — single price or "request a quote".
 *   - feature-011 `ResolvedPrice | null` — Base + (optional) Sale +
 *     display mode; rendered through `BaseSalePriceBlock` so the
 *     sale typographic treatment, gross/net columns, and `none`
 *     hiding all live in one place.
 *
 * When `resolved.displayMode === 'none'`, this component renders
 * nothing and the surrounding page surface is expected to render the
 * Quote Request CTA in its place (see `pricing/QuoteRequestCta`).
 */
export function PriceTag(props: {
  price?: Money | null;
  resolved?: ResolvedPrice | null;
  locale: string;
  variant?: 'card' | 'pdp';
}): ReactNode {
  const { price, resolved, locale, variant = 'pdp' } = props;
  const t = tForLocale(locale);

  if (resolved !== undefined && resolved !== null) {
    if (resolved.displayMode === 'none') return null;
    return (
      <BaseSalePriceBlock
        basePrice={resolved.basePrice}
        salePrice={resolved.salePrice}
        displayMode={resolved.displayMode}
        locale={locale}
        variant={variant}
      />
    );
  }

  if (resolved === null) {
    return <span className="font-mono font-normal text-muted">{t('product.requestQuote')}</span>;
  }

  if (!price) {
    return <span className="font-mono font-normal text-muted">{t('product.requestQuote')}</span>;
  }
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
  }).format(price.amount);
  return <span className="font-mono font-semibold">{formatted}</span>;
}
