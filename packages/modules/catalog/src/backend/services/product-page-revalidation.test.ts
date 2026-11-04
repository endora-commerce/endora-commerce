import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontRevalidator } from '@endora-commerce/platform/http';
import {
  PRODUCT_PAGE_CHANGE_EVENTS,
  ProductPageRevalidation,
  REVALIDATION_DEBOUNCE_MS,
  REVALIDATION_MAX_PENDING,
  productPageChangeHandler,
} from './product-page-revalidation.js';

/**
 * Feature 163 (T155 finding CACHE-1; security review M2, code review m1–m3) — after
 * a committed write that can change whether or where a product is available, the
 * storefront's cached product-page reads of that product are dropped by tag: every
 * key they may have been asked by (the product id, its slug, its URL keys and its
 * former keys). Next keeps only a `200`, so without this a product switched off
 * went on showing.
 *
 * A short trailing debounce gathers a bulk operation's announcements into one call;
 * the pending set is capped, and past the cap the shared tag is dropped once. One
 * call is in flight at a time, so a hung storefront cannot grow a queue behind it.
 * Best-effort: nothing here may fail the write.
 */

const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const tag = (key: string): string => `catalog:product:${key}`;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function rig(keys: Record<string, string[]> = {}) {
  const revalidate = vi.fn(async (_tags: string[]) => undefined);
  const keysOf = vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => keys[id] ?? []));
  const warn = vi.fn();
  const revalidation = new ProductPageRevalidation({
    revalidator: { enabled: true, revalidate },
    keysOf,
    log: { warn },
  });
  return { revalidation, revalidate, keysOf, warn };
}

/** Lets the debounce elapse and the batch it sent settle. */
async function settle(revalidation: ProductPageRevalidation): Promise<void> {
  await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS * 10);
  await revalidation.idle();
}

const tagsOf = (revalidate: ReturnType<typeof vi.fn>): string[] =>
  revalidate.mock.calls.flatMap(([tags]) => tags as string[]).sort();

describe('ProductPageRevalidation', () => {
  it('drops the reads asked by the product’s id, slug, URL keys and former keys', async () => {
    const { revalidation, revalidate } = rig({ [P1]: ['wiertarka', 'drill', 'old-drill'] });
    revalidation.productChanged(P1);
    await settle(revalidation);
    expect(tagsOf(revalidate)).toEqual([tag(P1), tag('drill'), tag('old-drill'), tag('wiertarka')].sort());
  });

  it('gathers announcements that arrive apart, within the debounce, into one call', async () => {
    const { revalidation, revalidate, keysOf } = rig({ [P1]: ['a'], [P2]: ['b'] });
    revalidation.productChanged(P1);
    await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS / 2);
    revalidation.productChanged(P2);
    await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS / 2);
    revalidation.productChanged(P1);
    expect(revalidate).not.toHaveBeenCalled();
    await settle(revalidation);
    expect(keysOf).toHaveBeenCalledTimes(1);
    expect(keysOf.mock.calls[0]?.[0]).toEqual([P1, P2]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(tagsOf(revalidate)).toEqual([tag(P1), tag(P2), tag('a'), tag('b')].sort());
  });

  it('sends more than one call when a batch carries more than 200 tags', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `key-${i}`);
    const { revalidation, revalidate } = rig({ [P1]: many });
    revalidation.productChanged(P1);
    await settle(revalidation);
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(revalidate.mock.calls[0]?.[0]).toHaveLength(200);
    expect(tagsOf(revalidate)).toHaveLength(251);
  });

  it('past the pending cap, drops the shared tag once instead of reading every key', async () => {
    const { revalidation, revalidate, keysOf } = rig();
    for (let i = 0; i <= REVALIDATION_MAX_PENDING; i += 1) {
      revalidation.productChanged(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    }
    await settle(revalidation);
    expect(keysOf).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.mock.calls[0]?.[0]).toEqual(['catalog:product']);
  });

  it('a deleted product drops its own keys and the former keys its announcement carries', async () => {
    const { revalidation, revalidate } = rig({ [P1]: ['drill'] });
    revalidation.productRemoved(P1, ['old-drill']);
    await settle(revalidation);
    expect(tagsOf(revalidate)).toEqual([tag(P1), tag('drill'), tag('old-drill')].sort());
  });

  it('a deleted product whose keys cannot be read drops the shared tag', async () => {
    const { revalidation, revalidate, keysOf, warn } = rig();
    keysOf.mockRejectedValueOnce(new Error('db down'));
    revalidation.productRemoved(P1, []);
    await settle(revalidation);
    expect(revalidate.mock.calls.flatMap(([tags]) => tags as string[])).toContain('catalog:product');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a changed product whose keys cannot be read still drops its id’s reads, and logs it', async () => {
    const { revalidation, revalidate, keysOf, warn } = rig();
    keysOf.mockRejectedValueOnce(new Error('db down'));
    revalidation.productChanged(P1);
    await settle(revalidation);
    expect(tagsOf(revalidate)).toEqual([tag(P1)]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps one call in flight: announcements during a hung call wait for it, then go in one batch', async () => {
    let release: () => void = () => undefined;
    const revalidate = vi.fn(
      (_tags: string[]) =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const revalidation = new ProductPageRevalidation({
      revalidator: { enabled: true, revalidate },
      keysOf: async () => [],
    });
    revalidation.productChanged(P1);
    await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS * 10);
    expect(revalidate).toHaveBeenCalledTimes(1);
    revalidation.productChanged(P2);
    await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS * 10);
    revalidation.productChanged(P1);
    await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS * 10);
    expect(revalidate).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(REVALIDATION_DEBOUNCE_MS * 10);
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect([...(revalidate.mock.calls[1]?.[0] ?? [])].sort()).toEqual([tag(P1), tag(P2)].sort());
    release();
    await revalidation.idle();
  });

  it('a storefront that refuses the call is logged by the real revalidator, and never reaches the write', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(async () => new Response(null, { status: 401 }));
    const revalidator = new StorefrontRevalidator({
      baseUrl: 'http://storefront',
      secret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
      logger: { warn },
    });
    const revalidation = new ProductPageRevalidation({ revalidator, keysOf: async () => [] });
    revalidation.productChanged(P1);
    await settle(revalidation);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }), expect.any(String));
  });

  it('guards a revalidator that rejects instead of swallowing: logged, never thrown', async () => {
    const { revalidation, revalidate, warn } = rig();
    revalidate.mockRejectedValueOnce(new Error('unreachable'));
    revalidation.productChanged(P1);
    await expect(settle(revalidation)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaves out a tag Next would drop for its length', async () => {
    const { revalidation, revalidate } = rig({ [P1]: ['k'.repeat(300)] });
    revalidation.productChanged(P1);
    await settle(revalidation);
    expect(tagsOf(revalidate)).toEqual([tag(P1)]);
  });

  it('never holds the process open: the debounce timer is unref’d', async () => {
    vi.useRealTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    let handle: NodeJS.Timeout | undefined;
    try {
      const { revalidation } = rig();
      revalidation.productChanged(P1);
      handle = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout;
      expect(handle.hasRef()).toBe(false);
    } finally {
      clearTimeout(handle);
      setTimeoutSpy.mockRestore();
    }
  });

  it('reads nothing and asks nothing while the storefront revalidator is not configured', async () => {
    const revalidate = vi.fn();
    const keysOf = vi.fn();
    const revalidation = new ProductPageRevalidation({ revalidator: { enabled: false, revalidate }, keysOf });
    revalidation.productChanged(P1);
    revalidation.productRemoved(P1, []);
    await settle(revalidation);
    expect(keysOf).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
});

/**
 * Feature 172 (FR-035, research R-9) — a saved product content value drops the
 * product's cached storefront pages, so the next load shows it. It does so on
 * its own event, `product.content.updated.v1`, which nothing re-indexes on.
 */
describe('product page change subscriptions', () => {
  it('include product.content.updated.v1 beside the availability events', () => {
    expect([...PRODUCT_PAGE_CHANGE_EVENTS].sort()).toEqual(
      ['product.archived.v1', 'product.content.updated.v1', 'product.updated.v1'].sort(),
    );
  });

  it('hand the payload’s productId to productChanged', () => {
    const productChanged = vi.fn();
    const handler = productPageChangeHandler(() => ({ productChanged }));
    handler({ productId: P1, attributeKey: 'buying_guide' });
    handler({ attributeKey: 'no_product' });
    handler(null);
    expect(productChanged.mock.calls).toEqual([[P1]]);
  });
});
