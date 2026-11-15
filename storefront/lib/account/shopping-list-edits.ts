import { parseListQuantity } from '../shoppingListQuantity';

/**
 * Issue #1251 — what the shopping-list page's one form says the buyer changed.
 *
 * The form carries the list's name and every line's quantity, each beside the value the
 * page showed (`nameWas`, `quantityWas.<id>`). A field is an edit only when it differs from
 * what was shown, so a Save or a conversion with nothing typed writes nothing, and a value
 * another tab stored meanwhile is not overwritten with what this page happened to show.
 * Shared by the server actions and the client editor, so both judge a field the same way.
 */

export const NAME_FIELD = 'name';
export const NAME_WAS_FIELD = 'nameWas';
const QUANTITY_PREFIX = 'quantity.';
const QUANTITY_WAS_PREFIX = 'quantityWas.';

export const quantityField = (itemId: string): string => `${QUANTITY_PREFIX}${itemId}`;
export const quantityWasField = (itemId: string): string => `${QUANTITY_WAS_PREFIX}${itemId}`;

/** The body of `PATCH /api/v1/shopping-lists/:id` — only what changed. */
export interface ShoppingListEdits {
  name?: string;
  items?: Array<{ id: string; quantity: number }>;
}

export type ShoppingListEditsReading =
  /** `edits` is `null` when nothing changed. */
  | { kind: 'ok'; edits: ShoppingListEdits | null }
  | { kind: 'nameRequired' }
  /** The first line, in form order, whose typed quantity is refused. */
  | { kind: 'invalidQuantity'; itemId: string };

/** Whether a typed name may be stored: anything but blank. */
export function isListNameValid(raw: string): boolean {
  return raw.trim().length > 0;
}

export function readShoppingListEdits(formData: FormData): ShoppingListEditsReading {
  const edits: ShoppingListEdits = {};
  const rawName = formData.get(NAME_FIELD);
  if (typeof rawName === 'string') {
    if (!isListNameValid(rawName)) return { kind: 'nameRequired' };
    const name = rawName.trim();
    const was = formData.get(NAME_WAS_FIELD);
    if (typeof was !== 'string' || name !== was.trim()) edits.name = name;
  }
  const items: Array<{ id: string; quantity: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(QUANTITY_PREFIX)) continue;
    const itemId = key.slice(QUANTITY_PREFIX.length);
    if (itemId === '') continue;
    const quantity = parseListQuantity(value);
    if (quantity === null) return { kind: 'invalidQuantity', itemId };
    const was = formData.get(quantityWasField(itemId));
    if (typeof was === 'string' && Number(was) === quantity) continue;
    items.push({ id: itemId, quantity });
  }
  if (items.length > 0) edits.items = items;
  return { kind: 'ok', edits: edits.name !== undefined || edits.items !== undefined ? edits : null };
}
