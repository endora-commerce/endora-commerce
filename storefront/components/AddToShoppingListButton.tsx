'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  invalidateShoppingListMembership,
  loadShoppingListMembership,
} from '../lib/shoppingListMembership';
import {
  addToDefaultListAction,
  removeFromDefaultListAction,
} from '../lib/actions/shoppingList';

/**
 * Heart toggle for the customer's default shopping list. A first click adds the
 * product, a second click removes it, and the filled heart reflects the current
 * default-list membership — the same behaviour as the product-card heart. State
 * is the authoritative server membership, shared across cards/PDP via the
 * membership cache, and kept in sync through `b2b:shopping-list:changed`.
 *
 * Used on the product detail page (and reusable elsewhere). Signed-out visitors
 * are redirected to login. Rendered as a heart icon-button (matching the header
 * heart) with a hover tooltip carrying the label.
 */
export function AddToShoppingListButton(props: {
  apiBase: string;
  productId: string;
  variantId?: string | null;
  quantity?: number;
  /** Label shown when the product is NOT yet in the list (e.g. "Add to list"). */
  label: string;
  /** Optional label shown when the product IS in the list (e.g. "Remove from list"). */
  removeLabel?: string;
  className?: string;
}): ReactNode {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  /** Whether this product is currently in the customer's default list. */
  const [inList, setInList] = useState(false);

  // Reflect default-list membership on the heart, and keep it in sync when any
  // card (or the header) changes the list via `b2b:shopping-list:changed`.
  useEffect(() => {
    let cancelled = false;
    const sync = (): void => {
      void loadShoppingListMembership().then((m) => {
        if (!cancelled) setInList(m.byProduct.has(props.productId));
      });
    };
    sync();
    window.addEventListener('b2b:shopping-list:changed', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('b2b:shopping-list:changed', sync);
    };
  }, [props.apiBase, props.productId]);

  // First click adds, second click removes. Membership (and the filled heart)
  // is the authoritative server state shared across the page via the cache.
  const toggle = async (): Promise<void> => {
    setState('busy');
    try {
      const membership = await loadShoppingListMembership();
      const existingItemId = membership.byProduct.get(props.productId);

      if (existingItemId && membership.listId) {
        const res = await removeFromDefaultListAction({
          listId: membership.listId,
          itemId: existingItemId,
        });
        if (!res.ok && res.reason === 'auth') {
          window.location.href = '/login?next=/shopping-lists';
          return;
        }
        if (!res.ok) throw new Error('list');
        membership.byProduct.delete(props.productId);
        setInList(false);
      } else {
        const res = await addToDefaultListAction({
          productId: props.productId,
          ...(props.variantId ? { variantId: props.variantId } : {}),
          quantity: props.quantity && props.quantity > 0 ? Math.floor(props.quantity) : 1,
        });
        if (!res.ok && res.reason === 'auth') {
          window.location.href = '/login?next=/shopping-lists';
          return;
        }
        if (!res.ok) throw new Error('list');
        // The add response doesn't carry the new item id, so refetch the
        // membership map to learn it for a later removal.
        invalidateShoppingListMembership();
        const fresh = await loadShoppingListMembership(true);
        setInList(fresh.byProduct.has(props.productId));
      }
      window.dispatchEvent(new CustomEvent('b2b:shopping-list:changed'));
      setState('idle');
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2200);
    }
  };

  const activeLabel = inList ? (props.removeLabel ?? 'Usuń z listy zakupowej') : props.label;
  const tooltip = state === 'error' ? 'Nie udało się zmienić listy' : activeLabel;

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={(): void => void toggle()}
        disabled={state === 'busy'}
        aria-pressed={inList}
        className={props.className ?? 'icon-btn'}
        aria-label={activeLabel}
      >
        <HeartIcon filled={inList} />
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
