import type { ReactNode } from 'react';
import { AddToRfqButton } from '../rfq/AddToRfqButton';

/**
 * CTA replacement rendered when the resolved display mode is `none` (FR-041).
 *
 * The storefront hides every price element on these surfaces and routes the
 * customer's purchase intent into the Quote Request flow (feature 008). The
 * compact `card` variant fits the catalog grid and links through to the PDP;
 * the `pdp` variant adds the product straight to the client-side quote-request
 * draft (`lib/rfqDraft`), from where the buyer reviews and submits on
 * `/quote-request`.
 */
export function QuoteRequestCta(props: {
  productId: string;
  productSlug: string;
  /** Display name carried into the quote-request draft (PDP variant). */
  productName?: string;
  variant?: 'card' | 'pdp';
  unitPrice?: { amount: number; currency: string } | null;
  /** Optional copy override — defaults to a generic Polish "Request a quote". */
  label?: string;
  /** Hide the explanatory blurb shown above the form on the PDP. */
  withoutHint?: boolean;
}): ReactNode {
  const { productId, productSlug, productName, variant = 'pdp', unitPrice, label, withoutHint } =
    props;

  if (variant === 'card') {
    return (
      <a
        href={`/p/${encodeURIComponent(productSlug)}#quote`}
        className="inline-block font-mono text-[12px] text-accent underline"
        data-product-id={productId}
      >
        {label ?? 'Cena na zapytanie'}
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-[8px]" id="quote">
      {!withoutHint ? (
        <p className="m-0 text-[14px] text-fg-soft">
          {label ?? 'Cena tego produktu jest dostępna w odpowiedzi na zapytanie ofertowe.'}
        </p>
      ) : null}
      <AddToRfqButton
        productId={productId}
        productSlug={productSlug}
        productName={productName ?? productSlug}
        unitPrice={unitPrice ?? null}
        withQuantity
      />
    </div>
  );
}
