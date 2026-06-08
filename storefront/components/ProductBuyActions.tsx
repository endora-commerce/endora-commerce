'use client';

import { useState, type ReactNode } from 'react';

/**
 * PDP purchase row: a single styled quantity input shared by both the
 * "Add to quote" and "Add to cart" actions, rendered in that order.
 *
 * Previously the PDP showed two separate quantity inputs (an unstyled one in
 * the add-to-cart form and a styled one in the RFQ form). This consolidates
 * them into one client-owned quantity that both server actions read via a
 * hidden field.
 */
export interface ProductBuyActionsProps {
  productId: string;
  productSlug: string;
  variantId?: string | undefined;
  /** Show the "Add to cart" button (product is purchasable / in stock). */
  showCart: boolean;
  /** Show the "Add to quote" button (RFQ enabled for this storefront). */
  showQuote: boolean;
  addToCartAction: (formData: FormData) => void | Promise<void>;
  addToQuoteAction: (formData: FormData) => void | Promise<void>;
  addToCartLabel: string;
}

export function ProductBuyActions({
  productId,
  productSlug,
  variantId,
  showCart,
  showQuote,
  addToCartAction,
  addToQuoteAction,
  addToCartLabel,
}: ProductBuyActionsProps): ReactNode {
  const [qty, setQty] = useState(1);
  if (!showCart && !showQuote) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`buy-qty-${productId}`} className="text-[12px]">
        Ilość
      </label>
      <input
        id={`buy-qty-${productId}`}
        type="number"
        min={1}
        max={9999}
        value={qty}
        onChange={(e): void => {
          const n = Number(e.target.value);
          setQty(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
        }}
        className="w-[5rem] rounded-sm border border-line px-[8px] py-[6px]"
      />

      {showQuote ? (
        <form action={addToQuoteAction}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="productSlug" value={productSlug} />
          {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}
          <input type="hidden" name="quantity" value={qty} />
          <button type="submit" className="btn btn--outline btn--sm">
            Dodaj do zapytania
          </button>
        </form>
      ) : null}

      {showCart ? (
        <form action={addToCartAction}>
          <input type="hidden" name="productId" value={productId} />
          {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}
          <input type="hidden" name="quantity" value={qty} />
          <button type="submit" className="b2b-cta">
            {addToCartLabel}
          </button>
        </form>
      ) : null}
    </div>
  );
}
