import type { ReactNode } from 'react';

/**
 * Feature 002 US4 — Related + Up-sell sections rendered after the
 * attribute table on the PDP. Cross-sell entries are NOT rendered here:
 * they belong on the cart page (CrossSellSection). Backend pre-filters
 * inactive targets and channel-restricted ones, so the component just
 * renders what it gets.
 *
 * "See all" affordance: the backend caps related at 8 / up-sell at 4
 * (spec.md US4 Assumptions). When more exist, the component shows a
 * link to the full listing — but the canonical UX renders only what's
 * provided.
 */

export interface ProductLinkSummary {
  id: string;
  kind: 'related' | 'up_sell' | 'cross_sell';
  position: number;
  product: {
    id: string;
    sku: string;
    slug: string;
    name: string;
    primaryAssetUrl: string | null;
    price: { amount: number; currency: string } | null;
  };
}

export interface ProductLinksLabels {
  related: string;
  upSell: string;
  seeAll: string;
}

function LinkCard({ link }: { link: ProductLinkSummary }): ReactNode {
  return (
    <li className="overflow-hidden rounded-md border border-line bg-surface transition hover:border-[var(--ink-700)] hover:shadow-sm">
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
  );
}

export function ProductLinksSections(props: {
  related: ProductLinkSummary[];
  upSell: ProductLinkSummary[];
  labels: ProductLinksLabels;
}): ReactNode {
  if (props.related.length === 0 && props.upSell.length === 0) return null;

  return (
    <div className="mt-8 flex flex-col gap-8">
      {props.related.length > 0 ? (
        <section data-kind="related">
          <h2 className="mb-3 text-[14px] font-semibold uppercase tracking-[0.04em] text-muted">
            {props.labels.related}
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-0">
            {props.related.map((link) => (
              <LinkCard key={link.id} link={link} />
            ))}
          </ul>
        </section>
      ) : null}
      {props.upSell.length > 0 ? (
        <section data-kind="up-sell">
          <h2 className="mb-3 text-[14px] font-semibold uppercase tracking-[0.04em] text-muted">
            {props.labels.upSell}
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-0">
            {props.upSell.map((link) => (
              <LinkCard key={link.id} link={link} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
