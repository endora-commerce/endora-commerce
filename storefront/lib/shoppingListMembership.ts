import { getDefaultListMembershipAction } from './actions/shoppingList';

/**
 * Shared client-side view of which products are in the customer's *default*
 * shopping list, so every product card's heart can reflect membership and act
 * as an add/remove toggle.
 *
 * Membership is resolved through a server action (`getDefaultListMembershipAction`)
 * rather than a browser fetch: the `b2b_session` cookie is httpOnly and scoped
 * to the storefront origin, so it can't be forwarded cross-origin to the backend
 * from the browser. The result is cached once per page at module scope; every
 * card shares the single in-flight call. Mutations update the cached map in
 * place (remove) or invalidate + refetch (add, to learn the new item id) and
 * broadcast `b2b:shopping-list:changed` so other cards and the header badge
 * resync.
 */

export interface ShoppingListMembership {
  /** The default list's id, or null when signed out / unavailable. */
  listId: string | null;
  /** productId → shopping-list item id, for the lines currently in the list. */
  byProduct: Map<string, string>;
}

let cache: Promise<ShoppingListMembership> | null = null;

async function fetchMembership(): Promise<ShoppingListMembership> {
  try {
    const snapshot = await getDefaultListMembershipAction();
    const byProduct = new Map<string, string>();
    for (const it of snapshot.items) {
      if (!byProduct.has(it.productId)) byProduct.set(it.productId, it.itemId);
    }
    return { listId: snapshot.listId, byProduct };
  } catch {
    return { listId: null, byProduct: new Map() };
  }
}

/** Returns the shared membership snapshot, fetching once and caching it. */
export function loadShoppingListMembership(force = false): Promise<ShoppingListMembership> {
  if (force || !cache) cache = fetchMembership();
  return cache;
}

/** Drops the cache so the next `load` re-fetches (used after adding an item). */
export function invalidateShoppingListMembership(): void {
  cache = null;
}
