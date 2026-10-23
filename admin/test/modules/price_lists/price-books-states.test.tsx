import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema } from '@endora-commerce/contracts';
import { BOOKS, PLATFORM_ADMIN, summaryOf } from '../../helpers/price-book-fixtures';

/**
 * The states sweep (feature 161, T096; FR-032): every screen of the editor
 * says it is loading from its first paint — well within 400 ms, before any
 * answer — says specifically what failed and offers *Try again*, which asks
 * again, shows an empty state where a list can be empty, and cannot send a
 * save twice while one is in flight.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, mountBasePricePanel, apiError } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, PRODUCTS, B } = await import('../../helpers/price-book-grid');
const { P5, basePrices } = await import('./base-price-fixture');

const ROWS = [mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } })];
const BOOK = priceBookSchema.parse({ ...BOOKS.L2, rowCount: ROWS.length, tierStarts: [1] });
const HY = {
  version: 1,
  preset: 'HY',
  categoryBeforeAttribute: true,
  depthMode: 'within_cell',
  cells: [
    'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
    'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
    'org.all', 'group.all',
  ],
};

/** Paths whose next answers are held, failed or emptied. */
let held = new Set<string>();
let failing = new Set<string>();
let empty = false;

const never = (): Promise<never> => new Promise(() => undefined);

beforeEach(() => {
  held = new Set();
  failing = new Set();
  empty = false;
  serveBook(api, { book: BOOK, lines: linesOf(ROWS) });
  const book = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string) => {
    const [path] = url.split('?');
    if (held.has(path!)) return never();
    if (failing.has(path!)) throw await apiError(500, 'INTERNAL', 'boom');
    if (path === B) {
      const data = empty ? [] : [BOOK].map(summaryOf);
      return { data, meta: { page: 1, pageSize: 20, totalCount: data.length, creatableAudienceKinds: ['everyone', 'customer_groups', 'organizations'] } };
    }
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `${B}/precedence`) return { data: HY };
    if (path === `${B}/settings/show-list-price`) return { data: { value: false } };
    if (path === '/api/v1/admin/pricing/display-mode-overrides') return { data: { items: [] } };
    if (path?.startsWith('/api/v1/admin/settings/')) return { defaultValue: 'gross_only' };
    if (path === `${B}/base-prices`) return { data: basePrices() };
    if (path === `/api/v1/admin/catalog/products/${P5}/variants`) return { data: [] };
    return book(url);
  });
});

const asked = (path: string): number => api.get.mock.calls.filter(([url]) => (url as string).split('?')[0] === path).length;

/** Loading, then a failure with its words and Try again, which asks again and shows the content. */
async function sweep(options: {
  readonly path: string;
  readonly mount: () => void;
  readonly failure: string;
  readonly loaded: () => Promise<unknown>;
}): Promise<void> {
  held.add(options.path);
  options.mount();
  // From the first paint, before any answer.
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull(), { timeout: 400 });
  document.body.innerHTML = '';

  held.delete(options.path);
  failing.add(options.path);
  const user = userEvent.setup();
  options.mount();
  expect(await screen.findByText(options.failure)).toBeInTheDocument();
  const before = asked(options.path);
  failing.delete(options.path);
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await options.loaded();
  expect(asked(options.path)).toBeGreaterThan(before);
}

describe('states sweep — loading, failure with Try again (FR-032)', () => {
  it('the book list', async () => {
    await sweep({
      path: B,
      mount: () => mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN }),
      failure: 'The price books could not be loaded.',
      loaded: () => screen.findByRole('link', { name: BOOK.name }),
    });
  });

  it('a book', async () => {
    await sweep({
      path: `${B}/${BOOK.id}`,
      mount: () => mountScreen({ path: `/price-lists/${BOOK.id}`, session: PLATFORM_ADMIN }),
      failure: 'The price book could not be loaded.',
      loaded: () => screen.findByRole('heading', { level: 1, name: BOOK.name }),
    });
  });

  it('a book’s prices', async () => {
    await sweep({
      path: `${B}/${BOOK.id}/lines`,
      mount: () => mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN }),
      failure: 'The prices could not be loaded.',
      loaded: () => screen.findByRole('grid'),
    });
  });

  it('the create flow’s currencies', async () => {
    const reachCurrency = async (): Promise<void> => {
      const user = userEvent.setup();
      mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
      await user.type(await screen.findByLabelText('Name'), 'x');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('heading', { name: 'Step 2 of 5: Currency' });
    };
    held.add(`${B}/targets/currencies`);
    await reachCurrency();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    document.body.innerHTML = '';
    held.clear();
    failing.add(`${B}/targets/currencies`);
    await reachCurrency();
    expect(await screen.findByText('The currencies could not be loaded.')).toBeInTheDocument();
    failing.clear();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: /^PLN/ })).toBeInTheDocument();
  });

  it('Pricing settings — the precedence and the list-price setting', async () => {
    await sweep({
      path: `${B}/precedence`,
      mount: () => mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN }),
      failure: 'The price precedence could not be loaded.',
      loaded: () => screen.findByText('Contract first, blanket last (HY)'),
    });
    document.body.innerHTML = '';
    await sweep({
      path: `${B}/settings/show-list-price`,
      mount: () => mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN }),
      failure: 'The setting could not be loaded.',
      loaded: () => screen.findByRole('switch', { name: "Show list price beside the buyer's price" }),
    });
  });

  it('the product’s base prices', async () => {
    await sweep({
      path: `${B}/base-prices`,
      mount: () => mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN }),
      failure: 'The base prices could not be loaded.',
      loaded: () => screen.findByRole('group', { name: 'PLN' }),
    });
  });
});

describe('states sweep — empty (FR-032)', () => {
  it('the book list says there is none yet and offers to create one', async () => {
    empty = true;
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    expect(await screen.findByText('No price books yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New price book' })).toBeInTheDocument();
  });

  it('a book’s prices say there is none yet', async () => {
    serveBook(api, { book: { ...BOOK, rowCount: 0, tierStarts: [] }, lines: [] });
    mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN });
    expect(await screen.findByText('No prices yet')).toBeInTheDocument();
  });
});

describe('states sweep — a save in flight is not sent twice (FR-032)', () => {
  it('a book’s settings', async () => {
    const user = userEvent.setup();
    api.patch.mockImplementation(never);
    mountScreen({ path: `/price-lists/${BOOK.id}`, session: PLATFORM_ADMIN });
    const name = await screen.findByLabelText('Name');
    await user.type(name, ' 2');
    const save = screen.getByRole('button', { name: 'Save changes' });
    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAttribute('aria-busy', 'true');
    await user.click(save);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('a book’s prices', async () => {
    const user = userEvent.setup();
    api.put.mockImplementation(never);
    mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN });
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getAllByRole('gridcell')[0]!);
    await user.keyboard('-25%{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('the explainer', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation(never);
    mountScreen({ path: `/price-lists/explain?productId=${PRODUCTS.P1.id}`, session: PLATFORM_ADMIN });
    const explain = await screen.findByRole('button', { name: 'Explain' });
    await user.click(explain);
    await waitFor(() => expect(explain).toBeDisabled());
    await user.click(explain);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
