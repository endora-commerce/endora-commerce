import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { paginationSchema } from '@endora-commerce/contracts';
import { Pagination } from '../../components/Pagination';
import { listProducts } from '../../lib/api/catalog';
import type { RequestContext } from '../../lib/api/client';

/**
 * The catalogue's "next page" link, from the API's answer to the anchor.
 *
 * The listing read `pagination.nextCursor`, a field the API does not send — the
 * published shape is `{ cursor, hasMore, limit }` — so the component was always
 * handed `undefined` and a shop with more products than one page showed only
 * the first. The component itself was right; what was wrong was the type that
 * described the answer, and nothing compared that type with the contract.
 *
 * So the second half of this file starts from a response body as the API sends
 * it, checks the fixture against `paginationSchema` so it cannot drift into the
 * storefront's own idea of the shape, and follows it through `listProducts`
 * into the rendered link.
 */

const BASE = { basePath: '/catalog', baseQuery: { sort: 'name' }, locale: 'en-US' };

describe('Pagination — SSR rendering', () => {
  it('renders a rel="next" link carrying the cursor when there is a further page', () => {
    const html = renderToString(<Pagination {...BASE} nextCursor="b3BhcXVl" hasMore />);

    expect(html).toContain('rel="next"');
    expect(html).toContain('href="/catalog?sort=name&amp;cursor=b3BhcXVl"');
  });

  it('renders nothing on the last page', () => {
    expect(renderToString(<Pagination {...BASE} nextCursor={null} hasMore={false} />)).toBe('');
  });

  it('renders nothing when more is reported but no cursor leads there', () => {
    expect(renderToString(<Pagination {...BASE} nextCursor={null} hasMore />)).toBe('');
  });
});

describe('the listing hands Pagination the cursor the API sent', () => {
  const originalFetch = globalThis.fetch;
  const CTX: RequestContext = { salesChannelCode: 'pl_retail', locale: 'en-US' };

  function stubListing(pagination: unknown): void {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [], pagination }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads the contract field, so a further page produces a link', async () => {
    const wire = { cursor: 'b3BhcXVl', hasMore: true, limit: 24 };
    // The fixture is the contract's shape and nothing else: `strict()` refuses
    // a key the published schema does not name.
    expect(paginationSchema.strict().parse(wire)).toEqual(wire);
    stubListing(wire);

    const products = await listProducts({ limit: 24 }, CTX);
    const html = renderToString(
      <Pagination
        {...BASE}
        nextCursor={products.pagination.cursor}
        hasMore={products.pagination.hasMore}
      />,
    );

    expect(html).toContain('rel="next"');
    expect(html).toContain('cursor=b3BhcXVl');
  });

  it('produces no link from the last page', async () => {
    const wire = { cursor: null, hasMore: false, limit: 24 };
    expect(paginationSchema.strict().parse(wire)).toEqual(wire);
    stubListing(wire);

    const products = await listProducts({ limit: 24 }, CTX);

    expect(
      renderToString(
        <Pagination
          {...BASE}
          nextCursor={products.pagination.cursor}
          hasMore={products.pagination.hasMore}
        />,
      ),
    ).toBe('');
  });
});
