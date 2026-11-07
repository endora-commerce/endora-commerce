import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ProductGrid } from '../../components/ProductGrid';
import { moduleActionPresence } from '../../lib/module-action-presence';

/** Every action module present: what these cases render is not about presence (issue #672). */
const ALL_PRESENT = moduleActionPresence({ isPresent: () => true });

/**
 * Review 3 of release 0.108.0, A1 — a price-sorted or price-filtered listing
 * page that runs out of its scan budget answers `hasMore: true`, and can do so
 * with no products: every row it read was hidden from the viewer or already
 * served. Such a page must not tell the buyer that nothing matches their
 * filters while the "Next" link beside it leads to more; it says the products
 * continue on the next page.
 */
describe('an empty listing page that has more after it', () => {
  it.each([
    ['en-US', 'No products on this page. More follow on the next page.'],
    ['pl-PL', 'Na tej stronie nie ma produktów. Kolejne są na następnej stronie.'],
  ])('%s: says the products continue on the next page', (locale, text) => {
    const html = renderToString(<ProductGrid presence={ALL_PRESENT} products={[]} locale={locale} salesChannelCode={undefined} more />);
    expect(html).toContain(text);
    expect(html).not.toContain('No products match');
  });

  it('a last page with no products still says nothing matches', () => {
    const html = renderToString(<ProductGrid presence={ALL_PRESENT} products={[]} locale="en-US" salesChannelCode={undefined} />);
    expect(html).toContain('No products match your filters.');
  });
});
