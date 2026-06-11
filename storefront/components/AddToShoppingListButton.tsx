'use client';

import { useState, type ReactNode } from 'react';

/**
 * Adds a product to the customer's default shopping list and dispatches
 * `b2b:shopping-list:changed` so the header heart badge updates live. Used on
 * the product detail page (and reusable elsewhere). Signed-out visitors are
 * redirected to login.
 */
export function AddToShoppingListButton(props: {
  apiBase: string;
  productId: string;
  variantId?: string | null;
  quantity?: number;
  label: string;
  className?: string;
}): ReactNode {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const add = async (): Promise<void> => {
    setState('busy');
    try {
      const res = await fetch(`${props.apiBase}/api/v1/shopping-lists/default/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          productId: props.productId,
          ...(props.variantId ? { variantId: props.variantId } : {}),
          quantity: props.quantity && props.quantity > 0 ? Math.floor(props.quantity) : 1,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login?next=/shopping-lists';
        return;
      }
      if (!res.ok) throw new Error('list');
      window.dispatchEvent(new CustomEvent('b2b:shopping-list:changed'));
      setState('done');
      window.setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2200);
    }
  };

  return (
    <button
      type="button"
      onClick={(): void => void add()}
      disabled={state === 'busy'}
      className={props.className ?? 'btn btn--outline'}
      aria-label={props.label}
    >
      {state === 'done' ? '✓ Dodano' : state === 'error' ? 'Błąd' : props.label}
    </button>
  );
}
