import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFilters } from '../../lib/api/catalog';
import type { RequestContext } from '../../lib/api/client';

/**
 * Issue #1326 — the filter panel's counts are counted over the listing the
 * buyer is looking at. A search page asks `/catalog/filters` with its `q`, so
 * an empty result no longer sits beside counts taken over the whole catalogue
 * ("Color (40)" next to "no product matches").
 */

const originalFetch = globalThis.fetch;
let urls: string[] = [];

function stubFetch(): void {
  urls = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CTX: RequestContext = { salesChannelCode: 'pl_retail', locale: 'pl-PL' };

function paramsOf(url: string | undefined): URLSearchParams {
  return new URL(url ?? '', 'http://storefront.test').searchParams;
}

describe('getFilters and the text query', () => {
  it('carries the query, so the counts are the result set’s', async () => {
    stubFetch();
    await getFilters(CTX, { q: 'łożysko' });

    expect(new URL(urls[0]!).pathname).toBe('/api/v1/catalog/filters');
    expect(paramsOf(urls[0]).get('q')).toBe('łożysko');
  });

  it('asks the catalogue-wide counts when there is no query', async () => {
    stubFetch();
    await getFilters(CTX);
    await getFilters(CTX, { q: '   ' });

    expect(paramsOf(urls[0]).has('q')).toBe(false);
    expect(paramsOf(urls[1]).has('q')).toBe(false);
  });
});
