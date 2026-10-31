import type { ReactNode } from 'react';
import type { ProductSummary } from '@endora-commerce/contracts';
import { ProductCard } from '../../../components/ProductCard';
import { tForLocale } from '../../../lib/i18n/messages';

/**
 * A blog post's related products — issue #590.
 *
 * Each one is the catalogue listing's card for this viewer
 * (`getBlogRelatedProducts`), rendered by `ProductCard` from the summary's
 * `resolvedPrice` exactly as the home page's cards are: the display mode decides
 * net, gross or both, `none` is "price on request", and the amount is formatted
 * for the page language as a unit price. The strip used to print the post
 * payload's raw `{amount} {currency}`, a price resolved for nobody.
 */
export function RelatedProductsStrip({
  products,
  locale,
  salesChannelCode,
}: {
  /** In the post's order; the products this viewer may see. */
  products: ProductSummary[];
  /** The page language. */
  locale: string;
  /** The active sales channel, handed to each card's browser-side calls. */
  salesChannelCode: string | undefined;
}): ReactNode {
  if (products.length === 0) return null;
  const t = tForLocale(locale);
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-2xl font-semibold text-[--ink-700]">{t('product.links.related')}</h2>
      <ul className="m-0 grid list-none grid-cols-3 gap-[16px] p-0 max-[1100px]:grid-cols-2 max-[540px]:gap-[10px] max-[380px]:grid-cols-1">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard
              product={product}
              locale={locale}
              resolved={product.resolvedPrice ?? null}
              salesChannelCode={salesChannelCode}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
