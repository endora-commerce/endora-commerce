import type { ReactNode } from 'react';
import type { ProductLinkSummary } from './ProductLinksSections';

/**
 * Feature 002 US4 — "You may also need" section on the
 * cart page. Receives the union of cross-sell links across all cart
 * items; deduplicates by product id so the same target shows up once
 * even when reached via multiple cart entries.
 */

export function CrossSellSection(props: {
  links: ProductLinkSummary[];
  heading: string;
  locale: string;
}): ReactNode {
  if (props.links.length === 0) return null;

  // Dedupe by target product id; keep the first-seen link's position so
  // the backend's curated ordering survives (cart-side dedup just drops
  // later duplicates).
  const seen = new Set<string>();
  const unique: ProductLinkSummary[] = [];
  for (const link of props.links) {
    if (seen.has(link.product.id)) continue;
    seen.add(link.product.id);
    unique.push(link);
  }
  if (unique.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="b2b-cross-sell-heading">
      <h2
        id="b2b-cross-sell-heading"
        className="mb-3 text-[14px] font-semibold uppercase tracking-[0.04em] text-muted"
      >
        {props.heading}
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-0">
        {unique.map((link) => (
          <li
            key={link.id}
            className="overflow-hidden rounded-md border border-line bg-surface transition hover:border-[var(--ink-700)] hover:shadow-sm"
          >
            <a
              href={`/p/${link.product.slug}`}
              className="flex flex-col gap-1.5 p-[10px] text-inherit"
            >
              {link.product.primaryAssetUrl ? (
                <img
                  src={link.product.primaryAssetUrl}
                  alt=""
                  className="aspect-square w-full rounded-sm bg-surface-alt object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-square w-full rounded-sm bg-surface-alt" />
              )}
              <span className="line-clamp-2 text-[12px] font-medium leading-[1.3] text-fg">
                {link.product.name}
              </span>
              {link.product.price ? (
                <span className="font-mono text-[12px] font-medium text-accent">
                  {link.product.price.amount.toFixed(2)} {link.product.price.currency}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
