import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addRfqDraftItem,
  clearRfqDraft,
  readRfqDraft,
  removeRfqDraftItem,
  rfqDraftCount,
  setRfqDraftQuantity,
  RFQ_DRAFT_STORAGE_KEY,
} from '../../lib/rfqDraft';

/**
 * Unit coverage for the client-side quote-request draft store — the
 * cart-like accumulation container backing the `/quote-request` view.
 *
 * The storefront test suite runs in the `node` environment (no jsdom), so we
 * stub the minimal `window` surface the store touches: `localStorage`,
 * `dispatchEvent`, and `CustomEvent`.
 */
describe('rfqDraft store', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as Record<string, unknown>;
    g['window'] = {
      localStorage: {
        getItem: (k: string): string | null => store.get(k) ?? null,
        setItem: (k: string, v: string): void => void store.set(k, v),
        removeItem: (k: string): void => void store.delete(k),
        clear: (): void => store.clear(),
      },
      dispatchEvent: (): boolean => true,
    };
    g['CustomEvent'] = class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)['window'];
    delete (globalThis as unknown as Record<string, unknown>)['CustomEvent'];
  });

  const base = {
    productId: 'p1',
    slug: 'screw-01',
    name: 'Screw',
    unitPrice: { amount: 9.5, currency: 'PLN' },
  };

  it('adds a new line with the given quantity', () => {
    addRfqDraftItem({ ...base, quantity: 3 });
    const items = readRfqDraft();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: 'p1', quantity: 3, name: 'Screw' });
  });

  it('merges quantity when the same product is added again', () => {
    addRfqDraftItem({ ...base, quantity: 2 });
    addRfqDraftItem({ ...base, quantity: 5 });
    const items = readRfqDraft();
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(7);
  });

  it('defaults quantity to 1 and floors/clamps invalid values', () => {
    addRfqDraftItem({ ...base });
    expect(readRfqDraft()[0]?.quantity).toBe(1);
    setRfqDraftQuantity('p1', 0);
    expect(readRfqDraft()[0]?.quantity).toBe(1);
    setRfqDraftQuantity('p1', 4.9);
    expect(readRfqDraft()[0]?.quantity).toBe(4);
  });

  it('removes a line and clears the whole draft', () => {
    addRfqDraftItem({ ...base, quantity: 1 });
    addRfqDraftItem({ productId: 'p2', slug: 'nut-01', name: 'Nut', quantity: 2 });
    expect(rfqDraftCount()).toBe(3);
    removeRfqDraftItem('p1');
    expect(readRfqDraft().map((i) => i.productId)).toEqual(['p2']);
    clearRfqDraft();
    expect(readRfqDraft()).toHaveLength(0);
  });

  it('tolerates corrupt storage payloads', () => {
    window.localStorage.setItem(RFQ_DRAFT_STORAGE_KEY, '{not json');
    expect(readRfqDraft()).toEqual([]);
  });
});
