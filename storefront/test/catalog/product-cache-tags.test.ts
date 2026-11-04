import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProductBySlug, productCacheTags } from '../../lib/api/catalog';

/**
 * Feature 163 (checkpoint E security review, I4) — a product read's cache tags carry
 * the URL-derived key only while the tag fits Next's 256-character limit; a longer
 * key (anyone can open `/p/<anything>`) keeps the shared `catalog:product` tag alone
 * rather than a tag Next would drop.
 */
describe('productCacheTags', () => {
  it('tags a read with the shared tag and the key', () => {
    expect(productCacheTags('wiertarka')).toEqual(['catalog:product', 'catalog:product:wiertarka']);
  });

  it('never emits a tag over 256 characters', () => {
    const tags = productCacheTags('k'.repeat(400));
    expect(tags).toEqual(['catalog:product']);
    expect(productCacheTags('k'.repeat(256 - 'catalog:product:'.length))).toHaveLength(2);
    expect(productCacheTags('k'.repeat(257 - 'catalog:product:'.length))).toHaveLength(1);
  });

  it('can name another shared tag', () => {
    expect(productCacheTags('drill', 'catalog:links')).toEqual(['catalog:links', 'catalog:product:drill']);
  });
});

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-035, FR-036,
 * research R-11) — the product page asks for its Page Builder content with
 * `?include=content`; the read stays under the product's own cache tags, so a
 * saved content change drops it, and no other caller of the product read asks
 * for the documents.
 */
describe('getProductBySlug — include=content', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function capture(): Array<{ url: string; init: RequestInit & { next?: { tags?: string[] } } }> {
    const calls: Array<{ url: string; init: RequestInit & { next?: { tags?: string[] } } }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as never });
      return new Response(JSON.stringify({ data: { id: 'p1', contentAttributes: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return calls;
  }

  it('adds include=content and keeps the per-product tags', async () => {
    const calls = capture();
    await getProductBySlug('wiertarka', {}, { include: ['content'] });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get('include')).toBe('content');
    expect(calls[0]!.init.next?.tags).toEqual(productCacheTags('wiertarka'));
  });

  it('asks for nothing extra without the option', async () => {
    const calls = capture();
    await getProductBySlug('wiertarka', {});
    expect(new URL(calls[0]!.url).searchParams.has('include')).toBe(false);
    expect(calls[0]!.init.next?.tags).toEqual(productCacheTags('wiertarka'));
  });

  it('is passed by the product page’s read alone', () => {
    const root = resolve(process.cwd());
    const callers = [
      'app/(catalog)/p/[slug]/resolution.ts',
      'app/(catalog)/p/[slug]/page.tsx',
      'app/(account)/shopping-lists/[id]/page.tsx',
      'lib/page-builder/block-data.ts',
      'lib/api/catalog.ts',
    ];
    const asking = callers.filter((file) =>
      /getProductBySlug\([^)]*include:\s*\[\s*'content'/.test(readFileSync(resolve(root, file), 'utf8')),
    );
    expect(asking).toEqual(['app/(catalog)/p/[slug]/resolution.ts']);
  });
});
