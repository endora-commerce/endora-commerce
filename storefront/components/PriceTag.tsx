import type { ReactNode } from 'react';
import type { Money } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Money rendering. Uses Intl.NumberFormat with the active locale — the
 * default reference behaviour. Themes that need custom formatting
 * (e.g. tax-inclusive markers, "from" prefix on grouped products)
 * replace this component.
 */
export function PriceTag(props: {
  price: Money | null;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  if (!props.price) {
    return <span className="b2b-price b2b-price--none">{t('product.requestQuote')}</span>;
  }
  const formatted = new Intl.NumberFormat(props.locale, {
    style: 'currency',
    currency: props.price.currency,
  }).format(props.price.amount);
  return <span className="b2b-price">{formatted}</span>;
}
