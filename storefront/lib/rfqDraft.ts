/**
 * Client-side Quote Request "draft" — the storefront-only accumulation
 * container that gives Quote Requests a cart-like "add several products,
 * review, then submit" flow (feature 008 storefront UX).
 *
 * Quote Requests have no server-held draft state: the backend
 * `POST /api/v1/quote-requests` is one-shot — it creates an already-submitted
 * Pending request from a full `items[]` payload. So we hold the in-progress
 * lines in `localStorage` and POST them all at once when the buyer presses
 * "Submit quote request" on the draft view.
 *
 * Every mutation persists to `localStorage` and dispatches
 * `b2b:rfq-draft:changed` so the header badge and the draft view stay in sync
 * across components; cross-tab sync rides the native `storage` event.
 *
 * No `'use client'` here on purpose — the guards make every function a no-op
 * during SSR, so the module is safe to import from either side.
 */

import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';

export const RFQ_DRAFT_STORAGE_KEY = 'b2b:rfq-draft';
export const RFQ_DRAFT_CHANGED_EVENT = 'b2b:rfq-draft:changed';

export interface RfqDraftItem {
  productId: string;
  slug: string;
  name: string;
  /** Optional catalogue unit-price snapshot, shown for reference only. */
  unitPrice?: { amount: number; currency: string } | null;
  /**
   * Buyer's proposed unit price (the price they would like to negotiate).
   * `null`/absent means "no proposal — price on request". Submitted to the
   * backend as the line's `desiredUnitPrice`.
   */
  proposedUnitPrice?: number | null;
  quantity: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function readRfqDraft(): RfqDraftItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(RFQ_DRAFT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RfqDraftItem =>
          !!x &&
          typeof (x as RfqDraftItem).productId === 'string' &&
          typeof (x as RfqDraftItem).quantity === 'number',
      )
      .map((x) => ({
        productId: x.productId,
        slug: typeof x.slug === 'string' ? x.slug : '',
        name: typeof x.name === 'string' ? x.name : x.productId,
        unitPrice: x.unitPrice ?? null,
        proposedUnitPrice:
          typeof x.proposedUnitPrice === 'number' && Number.isFinite(x.proposedUnitPrice)
            ? x.proposedUnitPrice
            : null,
        quantity: Math.max(1, Math.floor(x.quantity)),
      }));
  } catch {
    return [];
  }
}

function writeRfqDraft(items: RfqDraftItem[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(RFQ_DRAFT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota / privacy-mode failures are non-fatal — the draft just won't persist.
  }
  window.dispatchEvent(new CustomEvent(RFQ_DRAFT_CHANGED_EVENT));
}

/** The fields an "add to quote request" passes; `quantity` defaults to 1. */
export type RfqDraftAddition = Omit<RfqDraftItem, 'quantity'> & { quantity?: number };

/**
 * Feature 155 (FR-032) — a draft line's quantity normalised: a whole number, never below the
 * product's pieces minimum (`null`/absent or ≤ 1 = none, floor 1). The draft page's stepper
 * and input go through this, so a line cannot be lowered below the minimum. Nor raised past
 * `LINE_QUANTITY_MAX`, which the submit would refuse (issue #351).
 */
export function clampDraftQuantity(quantity: number, minimum: number | null | undefined): number {
  const floor = typeof minimum === 'number' && minimum > 1 ? Math.floor(minimum) : 1;
  if (!Number.isFinite(quantity)) return floor;
  return Math.min(Math.max(Math.floor(quantity), floor), LINE_QUANTITY_MAX);
}

/**
 * Feature 155 (FR-032) — the draft line's floor, which is also the quantity its "Set to N"
 * fix writes: the pieces minimum when above 1, else 1.
 */
export function draftQuantityFloor(minimum: number | null | undefined): number {
  return clampDraftQuantity(1, minimum);
}

/**
 * Feature 155 (FR-032) — the quantity a draft line saves while the buyer types, or `null` to
 * keep the text unsaved until blur: only a whole quantity at or above the floor is saved, so
 * "15" over a floor of 10 is not rewritten on its "1".
 */
export function draftQuantityOnType(text: string, minimum: number | null | undefined): number | null {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || n < draftQuantityFloor(minimum)) return null;
  return clampDraftQuantity(n, minimum);
}

/**
 * Feature 155 (FR-032) — the quantity a draft line saves when its input loses focus, or `null`
 * when nothing was typed since the last save: what was typed, lifted to the floor (empty or
 * not a number → the floor).
 */
export function draftQuantityOnBlur(
  text: string,
  minimum: number | null | undefined,
  edited: boolean,
): number | null {
  if (!edited) return null;
  return clampDraftQuantity(Number(text), minimum);
}

/**
 * Adds a line (or bumps the quantity of an existing one) on the passed-in draft and returns a
 * new array; the input is left untouched. Pure, so the add rule is testable without
 * `localStorage`.
 *
 * Feature 155 (FR-032, US4 #13): with the product's pieces `minimum`, the line ends at least
 * at the minimum — a new line starts there, and an existing line still below it after the add
 * is lifted to it — mirroring the cart. The API refusal at submission stays the binding rule.
 */
export function addToRfqDraft(
  items: readonly RfqDraftItem[],
  item: RfqDraftAddition,
  minimum?: number | null,
): RfqDraftItem[] {
  const qty = Math.max(1, Math.floor(item.quantity ?? 1));
  const existing = items.find((i) => i.productId === item.productId);
  if (existing) {
    return items.map((i) =>
      i.productId === item.productId
        ? {
            ...i,
            quantity: clampDraftQuantity(i.quantity + qty, minimum),
            ...(item.unitPrice ? { unitPrice: item.unitPrice } : {}),
          }
        : i,
    );
  }
  return [
    ...items,
    {
      productId: item.productId,
      slug: item.slug,
      name: item.name,
      unitPrice: item.unitPrice ?? null,
      proposedUnitPrice: item.proposedUnitPrice ?? null,
      quantity: clampDraftQuantity(qty, minimum),
    },
  ];
}

/**
 * Adds a line (or bumps the quantity of an existing one) and persists. `minimum` is the
 * product's pieces minimum (feature 155): the line ends at least there.
 */
export function addRfqDraftItem(item: RfqDraftAddition, minimum?: number | null): RfqDraftItem[] {
  const items = addToRfqDraft(readRfqDraft(), item, minimum);
  writeRfqDraft(items);
  return items;
}

/**
 * Sets a line's quantity and persists. `minimum` is the product's current pieces minimum, when
 * the draft page knows it (feature 155): the quantity is never set below it.
 */
export function setRfqDraftQuantity(
  productId: string,
  quantity: number,
  minimum?: number | null,
): RfqDraftItem[] {
  const qty = clampDraftQuantity(quantity, minimum);
  const items = readRfqDraft().map((i) =>
    i.productId === productId ? { ...i, quantity: qty } : i,
  );
  writeRfqDraft(items);
  return items;
}

/**
 * Sets (or clears) the buyer's proposed unit price for a line. Pass `null` to
 * clear the proposal (back to "price on request").
 */
export function setRfqDraftProposedPrice(
  productId: string,
  price: number | null,
): RfqDraftItem[] {
  const normalized =
    price !== null && Number.isFinite(price) && price >= 0 ? price : null;
  const items = readRfqDraft().map((i) =>
    i.productId === productId ? { ...i, proposedUnitPrice: normalized } : i,
  );
  writeRfqDraft(items);
  return items;
}

export function removeRfqDraftItem(productId: string): RfqDraftItem[] {
  const items = readRfqDraft().filter((i) => i.productId !== productId);
  writeRfqDraft(items);
  return items;
}

export function clearRfqDraft(): void {
  writeRfqDraft([]);
}

/** Total quantity across all lines (used by the header badge). */
export function rfqDraftCount(items: RfqDraftItem[] = readRfqDraft()): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}
