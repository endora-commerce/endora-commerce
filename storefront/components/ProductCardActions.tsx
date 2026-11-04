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
import { addRfqDraftItem } from '../lib/rfqDraft';
import { addProductToCartAction, getCommerceAbilitiesAction } from '../lib/actions/cart';
import {
  cardActionVisibility,
  VISITOR_ABILITIES,
  type CommerceAbilities,
  type ProductCardButtonsConfig,
} from '../lib/commerce-permissions';
import { channelHeaders } from '../lib/channel/channel-header';
import { cardAddToCartPayload, quoteAddQuantity } from '../lib/orderMinimum';
import { productCardActionLabels, type CardActionState } from '../lib/buyActionLabels';
import { useLocalizedPath } from '../lib/i18n/localized-link';

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
 *
 * `specs/170-organization-roles/` (FR-057): a button also needs the buyer's
 * role to allow it (`cardActionVisibility`); what the role allows is read once
 * per page load through a server action, beside the settings, so a list-only
 * member's cards offer no cart button. A visitor keeps every button (PR-4).
 */

type ButtonsConfig = ProductCardButtonsConfig;

/** Settings and abilities, resolved together so the card renders once, in its final shape. */
interface CardState {
  config: ButtonsConfig;
  abilities: CommerceAbilities;
}

/** Per channel: the toggles are channel-scoped settings. */
const cachedConfig = new Map<string, Promise<ButtonsConfig>>();

function loadConfig(apiBase: string, channelCode: string | undefined): Promise<ButtonsConfig> {
  const key = channelCode ?? '';
  let config = cachedConfig.get(key);
  if (!config) {
    config = fetch(`${apiBase}/api/v1/storefront/settings/product-card-buttons`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...channelHeaders(channelCode) },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('settings'))))
      .then((body: { data: ButtonsConfig }) => body.data)
      .catch(() => ({ showAddToCart: true, showAddToShoppingList: true, showAddToQuote: true }));
    cachedConfig.set(key, config);
  }
  return config;
}

/** The buyer's abilities, once per page load; on any failure the visitor's (the backend still guards). */
let cachedAbilities: Promise<CommerceAbilities> | null = null;

function loadAbilities(): Promise<CommerceAbilities> {
  cachedAbilities ??= getCommerceAbilitiesAction().catch(() => VISITOR_ABILITIES);
  return cachedAbilities;
}

type ActionState = CardActionState;

export function ProductCardActions(props: {
  apiBase: string;
  /** The active sales channel, sent on the settings read. Supplied by the layout's page. */
  salesChannelCode: string | undefined;
  productId: string;
  productSlug: string;
  /** Display name carried into the client-side quote-request draft. */
  productName: string;
  /** Optional catalogue unit price snapshot, stored on the RFQ draft line. */
  unitPrice?: { amount: number; currency: string } | null;
  /** True for a simple, directly-purchasable product (shows "add to cart"). */
  buyable: boolean;
  /**
   * Feature 155 (FR-016) — the product's pieces minimum; "add to cart" adds it in one action.
   * `null`/absent = none (adds 1, as before).
   */
  minOrderQuantity?: number | null | undefined;
  /**
   * Localized accessible name for "add to cart" — "Add 10 pcs to cart" when it adds the
   * minimum, else the plain label — rendered by the server card through `cardAddToCartLabel`.
   */
  addToCartMinimumLabel?: string | null | undefined;
  /**
   * The server card's request locale; every tooltip and accessible name is worded in it (U4 —
   * they were Polish literals whatever the page's language). Polish when absent, as before.
   */
  locale?: string | undefined;
}): ReactNode {
  const [cfg, setCfg] = useState<CardState | null>(null);
  const [cartState, setCartState] = useState<ActionState>('idle');
  const [listState, setListState] = useState<ActionState>('idle');
  /** Whether this product is currently in the customer's default list. */
  const localize = useLocalizedPath();
  const [inList, setInList] = useState(false);
  const [quoteState, setQuoteState] = useState<ActionState>('idle');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadConfig(props.apiBase, props.salesChannelCode), loadAbilities()]).then(
      ([config, abilities]) => {
        if (!cancelled) setCfg({ config, abilities });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.apiBase, props.salesChannelCode]);

  // Reflect default-list membership on the heart, and keep it in sync when any
  // other card (or the header) changes the list via `b2b:shopping-list:changed`.
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

  if (!cfg) return null;

  const addToCart = async (): Promise<void> => {
    setCartState('busy');
    try {
      // A server action, not a browser fetch to the backend origin: the cart
      // cookies are httpOnly and scoped to the storefront origin, so a direct
      // call filled a cart neither the header badge's server render nor the
      // `/cart` page reads.
      const res = await addProductToCartAction(
        cardAddToCartPayload(props.productId, props.minOrderQuantity),
      );
      if (!res.ok) throw new Error('cart');
      window.dispatchEvent(new CustomEvent('b2b:cart:changed'));
      setCartState('done');
      window.setTimeout(() => setCartState('idle'), 1500);
    } catch {
      setCartState('error');
      window.setTimeout(() => setCartState('idle'), 2000);
    }
  };

  // The heart toggles default-list membership: a first click adds the product,
  // a second click removes it. Membership (and the filled heart) is the
  // authoritative server state shared across cards via the membership cache.
  const toggleList = async (): Promise<void> => {
    setListState('busy');
    try {
      const membership = await loadShoppingListMembership();
      const existingItemId = membership.byProduct.get(props.productId);

      if (existingItemId && membership.listId) {
        const res = await removeFromDefaultListAction({
          listId: membership.listId,
          itemId: existingItemId,
        });
        if (!res.ok && res.reason === 'auth') {
          window.location.href = localize(`/login?next=${encodeURIComponent(localize('/shopping-lists'))}`);
          return;
        }
        if (!res.ok) throw new Error('list');
        membership.byProduct.delete(props.productId);
        setInList(false);
      } else {
        const res = await addToDefaultListAction({ productId: props.productId, quantity: 1 });
        if (!res.ok && res.reason === 'auth') {
          window.location.href = localize(`/login?next=${encodeURIComponent(localize('/shopping-lists'))}`);
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
      setListState('idle');
    } catch {
      setListState('error');
      window.setTimeout(() => setListState('idle'), 2000);
    }
  };

  const addToQuote = (): void => {
    addRfqDraftItem({
      productId: props.productId,
      slug: props.productSlug,
      name: props.productName,
      unitPrice: props.unitPrice ?? null,
      // Feature 155 (FR-032, US4 #13) — one click adds the minimum, as "add to cart" does.
      quantity: quoteAddQuantity(props.minOrderQuantity),
    }, props.minOrderQuantity ?? null);
    setQuoteState('done');
    window.setTimeout(() => setQuoteState('idle'), 1500);
  };

  const visible = cardActionVisibility(cfg.config, cfg.abilities, props.buyable);
  if (!visible.cart && !visible.list && !visible.quote) return null;

  // Order: shopping list → quote → cart. Each action is an icon button (icons
  // consistent with the header) and reveals its label as a tooltip on hover.
  const labels = productCardActionLabels({
    locale: props.locale ?? 'pl-PL',
    cartState,
    listState,
    quoteState,
    inList,
    addToCartLabel: props.addToCartMinimumLabel,
  });

  return (
    <div className="mt-[10px] flex flex-wrap gap-[6px]">
      {visible.list ? (
        <WithTooltip label={labels.list}>
          <button
            type="button"
            onClick={(): void => void toggleList()}
            disabled={listState === 'busy'}
            aria-pressed={inList}
            className="icon-btn"
            aria-label={labels.list}
          >
            <HeartIcon filled={inList} />
          </button>
        </WithTooltip>
      ) : null}
      {visible.quote ? (
        <WithTooltip label={labels.quote}>
          <button
            type="button"
            onClick={addToQuote}
            className="icon-btn"
            aria-label={labels.quoteName}
          >
            <QuoteIcon filled={quoteState === 'done'} />
          </button>
        </WithTooltip>
      ) : null}
      {visible.cart ? (
        <WithTooltip label={labels.cart}>
          <button
            type="button"
            onClick={(): void => void addToCart()}
            disabled={cartState === 'busy'}
            className="icon-btn"
            aria-label={labels.cartName}
          >
            <CartIcon />
          </button>
        </WithTooltip>
      ) : null}
    </div>
  );
}

function WithTooltip({ label, children }: { label: string; children: ReactNode }): ReactNode {
  // Named group (`group/tip`) so the tooltip reveals ONLY when its own button is
  // hovered/focused — not when hovering anywhere on the surrounding product card,
  // whose `<article>` also carries the unnamed `group` class. A 700ms appear-delay
  // (applied only while hovered) keeps the tooltip from flashing on a quick pass;
  // it still hides instantly when the pointer leaves.
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[color:var(--ink-900)] px-2 py-1 text-[11px] text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/tip:opacity-100 group-hover/tip:delay-700 group-focus-within/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
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

function QuoteIcon({ filled = false }: { filled?: boolean }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function CartIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
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
