'use client';

import { useState, type ReactNode } from 'react';

/**
 * Adds a product to the customer's default shopping list and dispatches
 * `b2b:shopping-list:changed` so the header heart badge updates live. Used on
 * the product detail page (and reusable elsewhere). Signed-out visitors are
 * redirected to login.
 *
 * Rendered as a heart icon-button (matching the header heart) with a hover
 * tooltip carrying the label, so it sits inline with the other PDP action
 * buttons without a wide text label.
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

  const tooltip =
    state === 'done' ? 'Dodano do listy' : state === 'error' ? 'Nie udało się dodać' : props.label;

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={(): void => void add()}
        disabled={state === 'busy'}
        className={props.className ?? 'icon-btn'}
        aria-label={props.label}
        title={props.label}
      >
        <HeartIcon filled={state === 'done'} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[color:var(--ink-900)] px-2 py-1 text-[12px] text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {tooltip}
      </span>
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
