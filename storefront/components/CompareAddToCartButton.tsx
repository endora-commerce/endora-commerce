'use client';

import { useState, type ReactNode } from 'react';
import { addProductToCartAction } from '../lib/actions/cart';

/**
 * `<CompareAddToCartButton>` — feature 007 / US3 / T046.
 *
 * Thin client-side wrapper around the carts module's add-item endpoint.
 * The comparisons module deliberately has no cart proxy (research.md R-9):
 * the cart enforces its own business rules (channel availability, stock,
 * etc.), and the comparison stays untouched on either success or refusal.
 *
 * The call goes through the `addProductToCartAction` server action, not a
 * browser fetch to the backend origin: the buyer's cart cookies are httpOnly
 * and scoped to the storefront origin, so a direct call filled a cart the
 * `/cart` page never reads (`lib/actions/cart.ts`).
 *
 * Mounted inside `<ComparisonTable>` only when `viewerIsOwner === true`
 * (US1 / spec FR-013, FR-015). The shared-link recipient never sees
 * this button.
 */

export function CompareAddToCartButton(props: {
  productId: string;
  disabled?: boolean;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onClick = async (): Promise<void> => {
    if (busy || props.disabled) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await addProductToCartAction({ productId: props.productId, quantity: 1 });
      if (!res.ok) throw new Error(res.message ?? 'Could not add to cart.');
      setSuccess(true);
      // Notify the header cart counter so it refreshes if it's listening.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('b2b:cart:changed'));
      }
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to cart.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--dark btn--sm"
        disabled={busy || props.disabled}
        onClick={(): void => void onClick()}
      >
        {success ? '✓ Dodano' : busy ? 'Dodawanie…' : 'Dodaj do koszyka'}
      </button>
      {error ? <div className="mt-1 text-[12px] text-bad">{error}</div> : null}
    </>
  );
}
