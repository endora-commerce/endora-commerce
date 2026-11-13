import type {
  ConvertToCartResponse,
  ConvertToRfqResponse,
  DefaultShoppingListSummary,
  ShoppingList,
} from '@endora-commerce/contracts';
import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Shopping list bindings (T205). All endpoints require an authenticated
 * customer session.
 */

/**
 * The reply shapes are the published contracts (issue #599). The two
 * conversion results keep their storefront names as aliases.
 */
export type {
  ConversionSkip,
  DefaultShoppingListSummary,
  ShoppingList,
  ShoppingListItem,
} from '@endora-commerce/contracts';
export type ConvertToCartResult = ConvertToCartResponse;
export type ConvertToRfqResult = ConvertToRfqResponse;

export async function listShoppingLists(sessionCookie: string): Promise<ShoppingList[]> {
  return apiGetAuthed<ShoppingList[]>({
    path: '/api/v1/shopping-lists',
    sessionCookie,
  });
}

export async function getShoppingList(
  sessionCookie: string,
  id: string,
): Promise<ShoppingList> {
  return apiGetAuthed<ShoppingList>({
    path: `/api/v1/shopping-lists/${id}`,
    sessionCookie,
  });
}

export async function createShoppingList(
  sessionCookie: string,
  name: string,
): Promise<ShoppingList> {
  const res = await apiMutate<ShoppingList>({
    method: 'POST',
    path: '/api/v1/shopping-lists',
    body: { name },
    sessionCookie,
  });
  return res.data!;
}

export async function renameShoppingList(
  sessionCookie: string,
  id: string,
  name: string,
): Promise<ShoppingList> {
  const res = await apiMutate<ShoppingList>({
    method: 'PATCH',
    path: `/api/v1/shopping-lists/${id}`,
    body: { name },
    sessionCookie,
  });
  return res.data!;
}

export async function deleteShoppingList(sessionCookie: string, id: string): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/shopping-lists/${id}`,
    sessionCookie,
  });
}

export async function addItemToShoppingList(
  sessionCookie: string,
  id: string,
  payload: { productId: string; variantId?: string; quantity: number; note?: string },
): Promise<ShoppingList> {
  const res = await apiMutate<ShoppingList>({
    method: 'POST',
    path: `/api/v1/shopping-lists/${id}/items`,
    body: payload,
    sessionCookie,
  });
  return res.data!;
}

export async function updateShoppingListItem(
  sessionCookie: string,
  listId: string,
  itemId: string,
  patch: { quantity?: number; note?: string | null },
): Promise<ShoppingList> {
  const res = await apiMutate<ShoppingList>({
    method: 'PATCH',
    path: `/api/v1/shopping-lists/${listId}/items/${itemId}`,
    body: patch,
    sessionCookie,
  });
  return res.data!;
}

export async function removeShoppingListItem(
  sessionCookie: string,
  listId: string,
  itemId: string,
): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/shopping-lists/${listId}/items/${itemId}`,
    sessionCookie,
  });
}

/** Removes every item from a list, keeping the list itself. */
export async function clearShoppingListItems(
  sessionCookie: string,
  listId: string,
): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/shopping-lists/${listId}/items`,
    sessionCookie,
  });
}

export async function setDefaultShoppingList(
  sessionCookie: string,
  id: string,
): Promise<ShoppingList> {
  const res = await apiMutate<ShoppingList>({
    method: 'POST',
    path: `/api/v1/shopping-lists/${id}/set-default`,
    body: {},
    sessionCookie,
  });
  return res.data!;
}

export async function getDefaultShoppingList(
  sessionCookie: string,
): Promise<DefaultShoppingListSummary> {
  return apiGetAuthed<DefaultShoppingListSummary>({
    path: '/api/v1/shopping-lists/default',
    sessionCookie,
  });
}

export async function convertShoppingListToCart(
  sessionCookie: string,
  id: string,
  itemIds?: string[],
): Promise<ConvertToCartResult> {
  const res = await apiMutate<ConvertToCartResult>({
    method: 'POST',
    path: `/api/v1/shopping-lists/${id}/convert-to-cart`,
    body: itemIds && itemIds.length > 0 ? { itemIds } : {},
    sessionCookie,
  });
  return res.data!;
}

export async function convertShoppingListToRfq(
  sessionCookie: string,
  id: string,
  itemIds?: string[],
): Promise<ConvertToRfqResult> {
  const res = await apiMutate<ConvertToRfqResult>({
    method: 'POST',
    path: `/api/v1/shopping-lists/${id}/convert-to-rfq`,
    body: itemIds && itemIds.length > 0 ? { itemIds } : {},
    sessionCookie,
  });
  return res.data!;
}
