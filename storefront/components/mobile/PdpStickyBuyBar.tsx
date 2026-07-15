'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { ADD_TO_CART_IDLE, type AddToCartResult } from '../../lib/cartAddState';
import { CartAddedPopup } from '../CartAddedPopup';

/**
 * Feature 044 / US3 — sticky bottom add-to-cart bar for the PDP (Industria
 * Mobile design §04). Fixed above the bottom tab bar on phones (`.m-actionbar`
 * is `md:hidden` and reserves the home-indicator inset), so the buyer can set a
 * quantity and add to cart at any scroll position.
 *
 * It posts the page's own `addToCartAction` server action (the same one the
 * inline {@link ProductBuyActions} uses), so cart semantics are reused — no new
 * endpoint. A secondary datasheet button links to the first attachment.
 */
export function PdpStickyBuyBar(props: {
  productId: string;
  variantId?: string;
  addToCartAction: (
    prevState: AddToCartResult,
    formData: FormData,
  ) => AddToCartResult | Promise<AddToCartResult>;
  addToCartLabel: string;
  datasheetHref?: string;
  datasheetLabel?: string;
}): ReactNode {
  const [qty, setQty] = useState(1);
  const clamp = (n: number): number => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
  const [cartState, cartFormAction, cartPending] = useActionState(
    props.addToCartAction,
    ADD_TO_CART_IDLE,
  );

  return (
    <form action={cartFormAction} className="m-actionbar">
      <input type="hidden" name="productId" value={props.productId} />
      {props.variantId ? <input type="hidden" name="variantId" value={props.variantId} /> : null}
      <div className="qty__stepper shrink-0">
        <button
          type="button"
          aria-label="−"
          onClick={() => setQty((q) => clamp(q - 1))}
        >
          −
        </button>
        <input
          type="number"
          name="quantity"
          min={1}
          value={qty}
          inputMode="numeric"
          aria-label="Ilość"
          onChange={(e) => setQty(clamp(Number(e.target.value)))}
        />
        <button type="button" aria-label="+" onClick={() => setQty((q) => clamp(q + 1))}>
          +
        </button>
      </div>
      <button
        type="submit"
        disabled={cartPending}
        aria-busy={cartPending || undefined}
        className="btn btn--dark justify-center"
        style={{ flex: 1, height: 44 }}
      >
        <CartIcon /> {props.addToCartLabel}
      </button>
      <CartAddedPopup state={cartState} />
      {props.datasheetHref ? (
        <a
          href={props.datasheetHref}
          target="_blank"
          rel="noreferrer"
          className="btn btn--outline"
          style={{ height: 44, flex: '0 0 44px', padding: 0, justifyContent: 'center' }}
          aria-label={props.datasheetLabel ?? 'Karta katalogowa'}
        >
          <DocIcon />
        </a>
      ) : null}
    </form>
  );
}

function CartIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  );
}

function DocIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
