/**
 * Shared client-side view of which products are in the customer's *default*
 * shopping list, so every product card's heart can reflect membership and act
 * as an add/remove toggle.
 *
 * The backend has no "is product X in my default list" endpoint and the
 * add-item response doesn't return the created item id, so we resolve the
 * default list once per page (GET /default → GET /:id) and cache the
 * product→itemId map at module scope — exactly like `cachedConfig` in
 * ProductCardActions. Every card shares the single in-flight fetch; mutations
 * update the cached map in place (remove) or invalidate + refetch (add, to
 * learn the new item id) and broadcast `b2b:shopping-list:changed` so other
 * cards and the header badge resync.
 */

export interface ShoppingListMembership {
  /** The default list's id, or null when signed out / unavailable. */
  listId: string | null;
  /** productId → shopping-list item id, for the lines currently in the list. */
  byProduct: Map<string, string>;
}

let cache: Promise<ShoppingListMembership> | null = null;

async function fetchMembership(apiBase: string): Promise<ShoppingListMembership> {
  const empty: ShoppingListMembership = { listId: null, byProduct: new Map() };
  try {
    const defRes = await fetch(`${apiBase}/api/v1/shopping-lists/default`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!defRes.ok) return empty; // 401 for anon, etc.
    const def = (await defRes.json()) as { data?: { id?: string } };
    const listId = def.data?.id ?? null;
    if (!listId) return empty;

    const listRes = await fetch(`${apiBase}/api/v1/shopping-lists/${listId}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!listRes.ok) return { listId, byProduct: new Map() };
    const body = (await listRes.json()) as {
      data?: { items?: Array<{ id: string; productId: string }> };
    };
    const byProduct = new Map<string, string>();
    for (const it of body.data?.items ?? []) {
      if (!byProduct.has(it.productId)) byProduct.set(it.productId, it.id);
    }
    return { listId, byProduct };
  } catch {
    return empty;
  }
}

/** Returns the shared membership snapshot, fetching once and caching it. */
export function loadShoppingListMembership(
  apiBase: string,
  force = false,
): Promise<ShoppingListMembership> {
  if (force || !cache) cache = fetchMembership(apiBase);
  return cache;
}

/** Drops the cache so the next `load` re-fetches (used after adding an item). */
export function invalidateShoppingListMembership(): void {
  cache = null;
}
