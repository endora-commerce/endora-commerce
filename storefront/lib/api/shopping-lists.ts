import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Shopping list bindings (T205). All endpoints require an authenticated
 * customer session.
 */

export interface ShoppingListItem {
  id: string;
  shoppingListId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingList {
  id: string;
  organizationId: string;
  customerAccountId: string;
  name: string;
  isDefault: boolean;
  items: ShoppingListItem[];
  createdAt: string;
  updatedAt: string;
}

export interface DefaultShoppingListSummary {
  id: string;
  name: string;
  itemCount: number;
}

export interface ConversionSkip {
  itemId: string;
  productId: string;
  reason: 'product_archived' | 'variant_unavailable' | 'product_not_found';
}

export interface ConvertToCartResult {
  shoppingListId: string;
  added: number;
  skipped: ConversionSkip[];
}

export interface ConvertToRfqResult {
  shoppingListId: string;
  rfqId: string;
  added: number;
  skipped: ConversionSkip[];
}

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
