import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { CategoryContent } from '../../components/CategoryContent';
import { getCategoryPageContent } from '../../lib/api/catalog';

/**
 * Category page content on the storefront.
 *
 * The operator authors a Page Builder document per language on the category;
 * the category page renders it above the product grid. Two halves are pinned
 * here:
 *
 *   - `<CategoryContent>` — server-rendered (Principle VII: what a crawler
 *     receives), through the same `PageBuilderRender` boundary a CMS page and
 *     a blog category description use, so the blocks, their sanitisation and
 *     the module-presence rule are the CMS' own and not a second copy;
 *   - `getCategoryPageContent` — reads under the tag a category write already
 *     flushes, and degrades to "no content" rather than taking the product
 *     listing down with it.
 *
 * Harness: `renderToString`, `environment: 'node'`, no jsdom.
 */

const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';

const richContent = (html: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'cms.RichContent', props: { id: 'rc-1', html } }],
  zones: {},
});

function render(content: unknown, absent: string[] = []): string {
  return renderToString(
    <BlockRenderScope presence={{ absent }} language="en-US">
      <CategoryContent content={content} language="en-US" />
    </BlockRenderScope>,
  );
}

describe('<CategoryContent>', () => {
  it('server-renders the authored document', () => {
    const html = render(richContent('<p>Hand tools for every trade.</p>'));
    expect(html).toContain('Hand tools for every trade.');
    expect(html).toContain('data-category-content');
  });

  it('renders nothing at all when there is no content', () => {
    expect(render(null)).toBe('');
    expect(render(undefined)).toBe('');
    expect(render({ root: { props: {} }, content: [], zones: {} })).toBe('');
  });

  it('sanitises authored HTML the way a CMS page does', () => {
    const html = render(
      richContent('<p onclick="steal()">Safe text</p><script>window.pwned = 1</script>'),
    );
    expect(html).toContain('Safe text');
    expect(html).not.toContain('window.pwned');
    expect(html).not.toContain('onclick');
  });

  it('draws no CMS block while the CMS module is off', () => {
    const html = render(richContent('<p>Authored before the switch</p>'), ['cms']);
    expect(html).not.toContain('Authored before the switch');
  });
});

describe('getCategoryPageContent', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads the category by id, in the caller locale, under the tag a category write flushes', async () => {
    const calls: Array<{ url: string; init: RequestInit & { next?: { tags?: string[] } } }> = [];
    const tree = richContent('<p>Hello</p>');
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as never });
      return new Response(
        JSON.stringify({ data: { categoryId: CATEGORY_ID, language: 'pl-PL', content: tree } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await getCategoryPageContent(CATEGORY_ID, { locale: 'pl-PL' });

    expect(result).toEqual({ categoryId: CATEGORY_ID, language: 'pl-PL', content: tree });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain(`/api/v1/catalog/categories/${CATEGORY_ID}/content`);
    expect((calls[0]?.init.headers as Record<string, string>)['Accept-Language']).toBe('pl-PL');
    expect(calls[0]?.init.next?.tags).toContain('catalog:categories');
  });

  it('answers "no content" when the read fails, so the listing still renders', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('backend unreachable');
    }) as unknown as typeof fetch;

    await expect(getCategoryPageContent(CATEGORY_ID, {})).resolves.toEqual({
      categoryId: CATEGORY_ID,
      language: null,
      content: null,
    });
  });
});
