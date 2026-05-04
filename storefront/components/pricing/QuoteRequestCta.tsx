import type { ReactNode } from 'react';
import { AddToRfqForm } from '../rfq/AddToRfqForm';

/**
 * CTA replacement rendered when the resolved display mode is `none` (FR-041).
 *
 * The storefront hides every price element on these surfaces and routes
 * the customer's purchase intent into the existing Quote Request flow
 * from feature 008. The compact `card` variant fits the catalog grid;
 * the `pdp` variant uses the larger PDP-friendly form. Both ultimately
 * land in `AddToRfqForm`, which redirects anonymous shoppers to /login
 * before creating the quote-request draft (so we don't have to repeat
 * that gate here).
 */
export function QuoteRequestCta(props: {
  productId: string;
  productSlug: string;
  variant?: 'card' | 'pdp';
  /** Optional copy override — defaults to a generic Polish "Request a quote". */
  label?: string;
  /** Hide the explanatory blurb shown above the form on the PDP. */
  withoutHint?: boolean;
}): ReactNode {
  const { productId, productSlug, variant = 'pdp', label, withoutHint } = props;

  if (variant === 'card') {
    return (
      <a
        href={`/p/${encodeURIComponent(productSlug)}#quote`}
        className="b2b-quote-cta b2b-quote-cta--card"
        data-product-id={productId}
      >
        {label ?? 'Cena na zapytanie'}
      </a>
    );
  }

  return (
    <div className="b2b-quote-cta b2b-quote-cta--pdp" id="quote">
      {!withoutHint ? (
        <p className="b2b-quote-cta__hint">
          {label ?? 'Cena tego produktu jest dostępna w odpowiedzi na zapytanie ofertowe.'}
        </p>
      ) : null}
      <AddToRfqForm productId={productId} productSlug={productSlug} />
    </div>
  );
}
