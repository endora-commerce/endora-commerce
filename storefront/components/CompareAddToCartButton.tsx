'use client';

import { useState, type ReactNode } from 'react';

/**
 * `<CompareAddToCartButton>` — feature 007 / US3 / T046.
 *
 * Thin client-side wrapper that POSTs to the existing
 * `/api/v1/cart/items` endpoint owned by the carts module. The
 * comparisons module deliberately has no cart proxy (research.md R-9):
 * the storefront calls the cart endpoint directly, the cart enforces
 * its own business rules (channel availability, stock, etc.), and the
 * comparison stays untouched on either success or refusal.
 *
 * Mounted inside `<ComparisonTable>` only when `viewerIsOwner === true`
 * (US1 / spec FR-013, FR-015). The shared-link recipient never sees
 * this button.
 */

const apiBase =
  process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

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
      const res = await fetch(`${apiBase}/api/v1/cart/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ productId: props.productId, quantity: 1 }),
      });
      if (!res.ok) {
        let envelope: { error?: { message?: string } } | undefined;
        try {
          envelope = (await res.json()) as { error?: { message?: string } };
        } catch {
          // non-JSON
        }
        throw new Error(
          envelope?.error?.message ?? `Could not add to cart (HTTP ${res.status}).`,
        );
      }
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
