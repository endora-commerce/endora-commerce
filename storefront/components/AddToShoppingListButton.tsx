'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  invalidateShoppingListMembership,
  loadShoppingListMembership,
} from '../lib/shoppingListMembership';
import {
  addToDefaultListAction,
  addToListAction,
  listShoppingListsAction,
  removeFromDefaultListAction,
  type ShoppingListOption,
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
  /**
   * Render the label as visible text next to the heart (a full button) instead
   * of the icon-only card heart. Used in the PDP action zone so it lines up with
   * the other labelled buttons. The hover tooltip is dropped in this mode.
   */
  showLabel?: boolean;
}): ReactNode {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  /** Whether this product is currently in the customer's default list. */
  const [inList, setInList] = useState(false);
  /** The customer's shopping lists — drives the split-button list picker; the
   *  arrow only renders when there is more than one list. */
  const [lists, setLists] = useState<ShoppingListOption[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  // Load the customer's lists so the split button knows whether to offer the
  // arrow-side picker (only when > 1 list). Only needed for the labelled PDP
  // variant. Refreshes when any surface mutates a list.
  useEffect(() => {
    if (!props.showLabel) return undefined;
    let cancelled = false;
    const load = (): void => {
      void listShoppingListsAction().then((r) => {
        if (!cancelled) setLists(r.lists);
      });
    };
    load();
    window.addEventListener('b2b:shopping-list:changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('b2b:shopping-list:changed', load);
    };
  }, [props.showLabel]);

  // Close the picker on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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

  // Add the product to a specific (chosen) list from the picker.
  const addToSpecific = async (option: ShoppingListOption): Promise<void> => {
    setMenuOpen(false);
    setState('busy');
    try {
      const res = await addToListAction({
        listId: option.id,
        productId: props.productId,
        ...(props.variantId ? { variantId: props.variantId } : {}),
        quantity: props.quantity && props.quantity > 0 ? Math.floor(props.quantity) : 1,
      });
      if (!res.ok && res.reason === 'auth') {
        window.location.href = '/login?next=/shopping-lists';
        return;
      }
      if (!res.ok) throw new Error('list');
      invalidateShoppingListMembership();
      const fresh = await loadShoppingListMembership(true);
      setInList(fresh.byProduct.has(props.productId));
      window.dispatchEvent(new CustomEvent('b2b:shopping-list:changed'));
      setAddedTo(option.name);
      window.setTimeout(() => setAddedTo(null), 2200);
      setState('idle');
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2200);
    }
  };

  const activeLabel = inList ? (props.removeLabel ?? 'Usuń z listy zakupowej') : props.label;
  const tooltip = state === 'error' ? 'Nie udało się zmienić listy' : activeLabel;

  if (props.showLabel) {
    const hasPicker = lists.length > 1;
    const mainLabel = addedTo ? `Dodano do „${addedTo}”` : activeLabel;
    const baseClass = props.className ?? 'btn btn--outline';
    return (
      <div ref={rootRef} className="relative inline-flex">
        <div className="inline-flex">
          <button
            type="button"
            onClick={(): void => void toggle()}
            disabled={state === 'busy'}
            aria-pressed={inList}
            className={`${baseClass} btn--split${hasPicker ? ' rounded-r-none' : ''}`}
            aria-label={activeLabel}
          >
            <HeartIcon filled={inList} />
            {mainLabel}
          </button>
          {hasPicker ? (
            <button
              type="button"
              onClick={(): void => setMenuOpen((v) => !v)}
              disabled={state === 'busy'}
              className={`${baseClass} btn--split rounded-l-none border-l-0 px-2`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Wybierz listę zakupową"
            >
              <ChevronIcon open={menuOpen} />
            </button>
          ) : null}
        </div>
        {hasPicker && menuOpen ? (
          <ul
            role="menu"
            className="absolute right-0 top-full z-20 m-0 mt-1 min-w-[220px] list-none overflow-hidden rounded-md border border-line bg-surface px-0 py-1 shadow-md"
          >
            {lists.map((l) => (
              <li key={l.id} role="none" className="list-none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={(): void => void addToSpecific(l)}
                  disabled={state === 'busy'}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-fg hover:bg-surface-alt"
                >
                  <span className="truncate">{l.name}</span>
                  {l.isDefault ? (
                    <span className="shrink-0 text-[11px] text-muted">domyślna</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

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

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
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
