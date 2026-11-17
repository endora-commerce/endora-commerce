import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CatalogToolbar } from '../../components/CatalogToolbar';

/**
 * Issue #1326 — the toolbar's range line on an empty listing.
 *
 * It printed `1–{shown}` whatever `shown` was, so a search with no hit read
 * "Showing 1–0 results" ("Wyświetlono 1–0 wyników") above the empty state. An
 * empty listing has no range: the line says how many results there are.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/search',
}));

function rangeLine(shown: number, locale: string): string {
  const html = renderToString(
    <CatalogToolbar
      shown={shown}
      sort="relevance"
      limit={24}
      view="grid"
      baseQuery={{ q: 'bearing' }}
      locale={locale}
      priceOrdering={false}
      priceControlsActive={false}
    />,
  ).replaceAll('<!-- -->', '');
  const match = /<span class="max-md:text-\[12px\]">(.*?)<\/span><\/div>/.exec(html);
  if (!match?.[1]) throw new Error(`no range line in ${html}`);
  return match[1].replace(/<[^>]+>/g, '');
}

describe('CatalogToolbar — the range line', () => {
  it.each([
    ['en-US', '0 results'],
    ['pl-PL', '0 wyników'],
  ])('reads a count, not a range, on an empty listing (%s: "%s")', (locale, expected) => {
    const line = rangeLine(0, locale);
    expect(line).toBe(expected);
    expect(line).not.toContain('1–0');
  });

  it.each([
    ['en-US', 'Showing 1–12 results'],
    ['pl-PL', 'Wyświetlono 1–12 wyników'],
  ])('keeps the range when there are results (%s)', (locale, expected) => {
    expect(rangeLine(12, locale)).toBe(expected);
  });
});
