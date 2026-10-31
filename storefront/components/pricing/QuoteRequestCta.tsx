import type { ReactNode } from 'react';
import { AddToRfqButton } from '../rfq/AddToRfqButton';
import { LocalizedAnchor } from '../../lib/i18n/localized-link';
import { tForLocale } from '../../lib/i18n/messages';

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
  /** Optional copy override — defaults to the catalogue's "Price on request" (card) or hint (PDP). */
  label?: string;
  /** Hide the explanatory blurb shown above the form on the PDP. */
  withoutHint?: boolean;
  /**
   * Feature 155 (FR-032) — the product's pieces minimum: the PDP variant's quantity starts at
   * it and the add never puts fewer pieces in the quote-request draft. `null`/absent = none.
   */
  minOrderQuantity?: number | null | undefined;
  /** Request locale for the CTA's copy, the add button's copy and the minimum statement. */
  locale: string;
}): ReactNode {
  const { productId, productSlug, productName, variant = 'pdp', unitPrice, label, withoutHint } =
    props;
  const t = tForLocale(props.locale);

  if (variant === 'card') {
    return (
      <LocalizedAnchor
        href={`/p/${encodeURIComponent(productSlug)}#quote`}
        className="inline-block font-mono text-[12px] text-accent underline"
        data-product-id={productId}
      >
        {label ?? t('commerce.common.priceOnRequest')}
      </LocalizedAnchor>
    );
  }

  return (
    <div className="flex flex-col gap-[8px]" id="quote">
      {!withoutHint ? (
        <p className="m-0 text-[14px] text-fg-soft">
          {label ?? t('commerce.quoteCta.hint')}
        </p>
      ) : null}
      <AddToRfqButton
        productId={productId}
        productSlug={productSlug}
        productName={productName ?? productSlug}
        unitPrice={unitPrice ?? null}
        withQuantity
        minOrderQuantity={props.minOrderQuantity ?? null}
        locale={props.locale}
      />
    </div>
  );
}
