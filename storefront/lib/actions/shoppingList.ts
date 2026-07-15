'use server';

import { getSessionCookie } from '../session';
import {
  addItemToShoppingList,
  getDefaultShoppingList,
  getShoppingList,
  listShoppingLists,
  removeShoppingListItem,
} from '../api/shopping-lists';
import { StorefrontApiError } from '../api/client';

/**
 * Server actions backing the storefront "heart" (default shopping-list)
 * toggle and its membership read.
 *
 * These must run on the server: the `b2b_session` cookie is httpOnly and
 * scoped to the storefront origin, so a browser `fetch` to the backend origin
 * never carries the buyer's identity. The backend then answers 401, which made
 * the heart read as empty and bounced logged-in buyers to /login on every
 * click without ever persisting the product. Reading the cookie here (via
 * `getSessionCookie`) and forwarding it through the authed API wrappers keeps
 * the authenticated identity intact.
 */

export interface ShoppingListMembershipSnapshot {
  /** The default list's id, or null when signed out / unavailable. */
  listId: string | null;
  /** One entry per product currently in the default list. */
  items: Array<{ productId: string; itemId: string }>;
}

export interface DefaultListSummary {
  listId: string | null;
  itemCount: number;
}

export type ShoppingListMutationResult =
  | { ok: true; listId: string }
  | { ok: false; reason: 'auth' }
  | { ok: false; reason: 'error' };

export async function getDefaultListMembershipAction(): Promise<ShoppingListMembershipSnapshot> {
  const session = await getSessionCookie();
  if (!session) return { listId: null, items: [] };
  try {
    const def = await getDefaultShoppingList(session);
    const list = await getShoppingList(session, def.id);
    const seen = new Set<string>();
    const items: Array<{ productId: string; itemId: string }> = [];
    for (const it of list.items) {
      if (seen.has(it.productId)) continue;
      seen.add(it.productId);
      items.push({ productId: it.productId, itemId: it.id });
    }
    return { listId: def.id, items };
  } catch {
    // 401 (anon) or transient failure — present as "no list" so the heart
    // renders empty rather than crashing the card.
    return { listId: null, items: [] };
  }
}

/** Default-list id + line count for the header heart badge. */
export async function getDefaultListSummaryAction(): Promise<DefaultListSummary> {
  const session = await getSessionCookie();
  if (!session) return { listId: null, itemCount: 0 };
  try {
    const def = await getDefaultShoppingList(session);
    return { listId: def.id, itemCount: def.itemCount };
  } catch {
    return { listId: null, itemCount: 0 };
  }
}

export interface ShoppingListOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * All of the signed-in customer's shopping lists (id + name + default flag).
 * Backs the product-card "Add to shopping list" split button: the arrow-side
 * list picker only renders when the customer owns more than one list.
 */
export async function listShoppingListsAction(): Promise<{
  ok: boolean;
  lists: ShoppingListOption[];
}> {
  const session = await getSessionCookie();
  if (!session) return { ok: false, lists: [] };
  try {
    const lists = await listShoppingLists(session);
    return {
      ok: true,
      lists: lists.map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault })),
    };
  } catch {
    return { ok: false, lists: [] };
  }
}

/** Add a product to a specific (chosen) shopping list. */
export async function addToListAction(input: {
  listId: string;
  productId: string;
  variantId?: string;
  quantity?: number;
}): Promise<ShoppingListMutationResult> {
  const session = await getSessionCookie();
  if (!session) return { ok: false, reason: 'auth' };
  try {
    const list = await addItemToShoppingList(session, input.listId, {
      productId: input.productId,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      quantity: input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : 1,
    });
    return { ok: true, listId: list.id };
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 401) {
      return { ok: false, reason: 'auth' };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function addToDefaultListAction(input: {
  productId: string;
  variantId?: string;
  quantity?: number;
}): Promise<ShoppingListMutationResult> {
  const session = await getSessionCookie();
  if (!session) return { ok: false, reason: 'auth' };
  try {
    const list = await addItemToShoppingList(session, 'default', {
      productId: input.productId,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      quantity: input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : 1,
    });
    return { ok: true, listId: list.id };
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 401) {
      return { ok: false, reason: 'auth' };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function removeFromDefaultListAction(input: {
  listId: string;
  itemId: string;
}): Promise<ShoppingListMutationResult> {
  const session = await getSessionCookie();
  if (!session) return { ok: false, reason: 'auth' };
  try {
    await removeShoppingListItem(session, input.listId, input.itemId);
    return { ok: true, listId: input.listId };
  } catch (err) {
    if (err instanceof StorefrontApiError) {
      if (err.status === 401) return { ok: false, reason: 'auth' };
      // Already gone — treat as a successful removal.
      if (err.status === 404) return { ok: true, listId: input.listId };
    }
    return { ok: false, reason: 'error' };
  }
}
