'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Product-card action buttons (add to cart / add to shopping list / add to
 * quote), each gated by a Settings-module toggle resolved through
 * `/api/v1/storefront/settings/product-card-buttons`. The settings are fetched
 * once per page load and shared by every card via a module-level cache.
 *
 * "Add to shopping list" adds the product to the customer's default list and
 * dispatches `b2b:shopping-list:changed` so the header heart badge updates;
 * "add to cart" dispatches `b2b:cart:changed`; "add to quote" links to the
 * product page's quote section (full quantity / variant selection lives there).
 */

interface ButtonsConfig {
  showAddToCart: boolean;
  showAddToShoppingList: boolean;
  showAddToQuote: boolean;
}

let cachedConfig: Promise<ButtonsConfig> | null = null;

function loadConfig(apiBase: string): Promise<ButtonsConfig> {
  if (!cachedConfig) {
    cachedConfig = fetch(`${apiBase}/api/v1/storefront/settings/product-card-buttons`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('settings'))))
      .then((body: { data: ButtonsConfig }) => body.data)
      .catch(() => ({ showAddToCart: true, showAddToShoppingList: true, showAddToQuote: true }));
  }
  return cachedConfig;
}

type ActionState = 'idle' | 'busy' | 'done' | 'error';

export function ProductCardActions(props: {
  apiBase: string;
  productId: string;
  productSlug: string;
  /** True for a simple, directly-purchasable product (shows "add to cart"). */
  buyable: boolean;
}): ReactNode {
  const [cfg, setCfg] = useState<ButtonsConfig | null>(null);
  const [cartState, setCartState] = useState<ActionState>('idle');
  const [listState, setListState] = useState<ActionState>('idle');

  useEffect(() => {
    let cancelled = false;
    void loadConfig(props.apiBase).then((c) => {
      if (!cancelled) setCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, [props.apiBase]);

  if (!cfg) return null;

  const post = async (path: string): Promise<Response> =>
    fetch(`${props.apiBase}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ productId: props.productId, quantity: 1 }),
    });

  const addToCart = async (): Promise<void> => {
    setCartState('busy');
    try {
      const res = await post('/api/v1/cart/items');
      if (!res.ok) throw new Error('cart');
      window.dispatchEvent(new CustomEvent('b2b:cart:changed'));
      setCartState('done');
      window.setTimeout(() => setCartState('idle'), 1500);
    } catch {
      setCartState('error');
      window.setTimeout(() => setCartState('idle'), 2000);
    }
  };

  const addToList = async (): Promise<void> => {
    setListState('busy');
    try {
      const res = await post('/api/v1/shopping-lists/default/items');
      if (res.status === 401) {
        window.location.href = '/login?next=/shopping-lists';
        return;
      }
      if (!res.ok) throw new Error('list');
      window.dispatchEvent(new CustomEvent('b2b:shopping-list:changed'));
      setListState('done');
      window.setTimeout(() => setListState('idle'), 1500);
    } catch {
      setListState('error');
      window.setTimeout(() => setListState('idle'), 2000);
    }
  };

  const anyVisible =
    (cfg.showAddToCart && props.buyable) || cfg.showAddToShoppingList || cfg.showAddToQuote;
  if (!anyVisible) return null;

  return (
    <div className="mt-[10px] flex flex-wrap gap-[6px]">
      {cfg.showAddToCart && props.buyable ? (
        <button
          type="button"
          onClick={(): void => void addToCart()}
          disabled={cartState === 'busy'}
          className="btn btn--sm b2b-cta"
        >
          {cartState === 'done' ? '✓' : cartState === 'error' ? '!' : 'Do koszyka'}
        </button>
      ) : null}
      {cfg.showAddToShoppingList ? (
        <button
          type="button"
          onClick={(): void => void addToList()}
          disabled={listState === 'busy'}
          className="btn btn--outline btn--sm"
          aria-label="Dodaj do listy zakupowej"
        >
          {listState === 'done' ? '✓ Lista' : listState === 'error' ? '!' : '♡ Lista'}
        </button>
      ) : null}
      {cfg.showAddToQuote ? (
        <Link
          href={`/p/${encodeURIComponent(props.productSlug)}#quote`}
          className="btn btn--outline btn--sm"
        >
          Zapytanie
        </Link>
      ) : null}
    </div>
  );
}
