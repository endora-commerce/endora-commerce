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

/** Adds a line (or bumps the quantity of an existing one) and persists. */
export function addRfqDraftItem(
  item: Omit<RfqDraftItem, 'quantity'> & { quantity?: number },
): RfqDraftItem[] {
  const qty = Math.max(1, Math.floor(item.quantity ?? 1));
  const items = readRfqDraft();
  const existing = items.find((i) => i.productId === item.productId);
  if (existing) {
    existing.quantity += qty;
    if (item.unitPrice) existing.unitPrice = item.unitPrice;
  } else {
    items.push({
      productId: item.productId,
      slug: item.slug,
      name: item.name,
      unitPrice: item.unitPrice ?? null,
      proposedUnitPrice: item.proposedUnitPrice ?? null,
      quantity: qty,
    });
  }
  writeRfqDraft(items);
  return items;
}

export function setRfqDraftQuantity(productId: string, quantity: number): RfqDraftItem[] {
  const qty = Math.max(1, Math.floor(Number.isFinite(quantity) ? quantity : 1));
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
