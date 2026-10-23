import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PriceBookResolvedLine } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, CATALOG, IDS, PLATFORM_ADMIN, SALES_REP_ACME } from '../../helpers/price-book-fixtures';

/**
 * The price explainer (feature 161, T078; US5; FR-023, FR-024): for a
 * channel, currency, buyer and lines, each line's price, source, cell in
 * words, book and row (linked), reference, precedence version and the
 * runner-ups by name (G16); a sale with the regular price it beat; an
 * unpriced line explained with a way to set a base price; pre-filled from
 * `productId`, `variantId`, `organizationId` and `bookId`.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, primaryActions } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';
const P1 = IDS.products.P1;
const ROW_E4A = '00000000-0000-4000-8000-000000163e4a';
const ROW_E4B = '00000000-0000-4000-8000-000000163e4b';
const ROW_E3A = '00000000-0000-4000-8000-000000163e3a';
const LABELS = { productName: null, productSku: null, variantLabel: null, variantSku: null, categoryPath: null, attributeLabel: null, attributeValueLabel: null };

/** E3.1 of the worked examples: Acme pays 95.00 for P1 from L4's org × product row. */
const E31: PriceBookResolvedLine = {
  key: '1',
  price: { amount: '95.0000', currency: 'PLN', source: 'buyer' },
  explanation: {
    tier: 'buyer',
    cell: 'org.product',
    bookId: IDS.books.L4,
    bookName: 'Acme contract',
    rowId: ROW_E4A,
    reference: '100.0000',
    precedenceVersion: 1,
    candidates: [
      { cell: 'org.product', bookId: IDS.books.L4, bookName: 'Acme contract', rowId: ROW_E4A, labels: { ...LABELS, productName: 'Screws 0200', productSku: 'P1' }, amount: '95.0000' },
      { cell: 'org.category', bookId: IDS.books.L4, bookName: 'Acme contract', rowId: ROW_E4B, labels: { ...LABELS, categoryPath: 'Screws' }, amount: '85.0000' },
      { cell: 'group.product', bookId: IDS.books.L3, bookName: 'VIP prices', rowId: ROW_E3A, labels: { ...LABELS, productName: 'Screws 0200', productSku: 'P1' }, amount: '90.0000' },
    ],
  },
};

let resolved: PriceBookResolvedLine[] = [E31];

beforeEach(() => {
  resolved = [E31];
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel] } };
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `${B}/targets/organizations`) {
      const ids = params.get('ids')?.split(',');
      const search = (params.get('search') ?? '').toLowerCase();
      return { data: { items: CATALOG.organizations.filter((o) => (ids ? ids.includes(o.id) : o.name.toLowerCase().includes(search))) } };
    }
    if (path === `${B}/${IDS.books.L4}`) return { data: BOOKS.L4 };
    if (path === `/api/v1/admin/catalog/products/${P1}`) {
      return { data: { id: P1, sku: 'P1', slug: 'p1', name: { 'en-US': 'Screws 0200' }, status: 'active', type: 'simple' } };
    }
    if (path === `/api/v1/admin/catalog/products/${P1}/variants`) return { data: [] };
    if (path === '/api/v1/admin/catalog/products') return { data: [], pagination: { page: 0, pageSize: 20, total: 0 } };
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockImplementation(async (url: string) => {
    if (url === `${B}/resolve`) return { data: resolved };
    throw new Error(`unexpected POST ${url}`);
  });
});

async function open(path: string, session = PLATFORM_ADMIN, language: 'en' | 'pl' = 'en') {
  const mounted = mountScreen({ path, session, language });
  await screen.findByRole('heading', { level: 1 });
  return mounted;
}

const explain = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: 'Explain' }));
  return screen.findByRole('region', { name: 'Line 1' });
};

describe('price explainer — the answer', () => {
  it('explains E3.1: 95.00, buyer, organization × product, the book and row linked, the runner-ups by name', async () => {
    const user = userEvent.setup();
    const { container } = await open(`/price-lists/explain?productId=${P1}&organizationId=${IDS.orgs.Acme}`);
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['Explain']);
    const line = await explain(user);
    expect(api.post).toHaveBeenCalledWith(`${B}/resolve`, {
      buyer: { organizationId: IDS.orgs.Acme },
      lines: [{ key: '1', productId: P1, quantity: 1 }],
    });
    expect(line).toHaveTextContent('95.00 PLN');
    expect(line).toHaveTextContent('Buyer price');
    expect(line).toHaveTextContent('Organization book, product line');
    expect(within(line).getByRole('link', { name: 'Acme contract' })).toHaveAttribute('href', `/price-lists/${IDS.books.L4}`);
    expect(within(line).getByRole('link', { name: 'Open the row' })).toHaveAttribute('href', `/price-lists/${IDS.books.L4}?tab=prices&search=P1`);
    expect(line).toHaveTextContent('Reference price: 100.00');
    expect(line).toHaveTextContent('Precedence version 1');
    const runnerUps = within(line).getByRole('list', { name: 'Runner-ups' });
    expect(within(runnerUps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Acme contract · Organization book, category line · Screws · 85.00',
      'VIP prices · Customer group book, product line · Screws 0200 (P1) · 90.00',
    ]);
    await expectNoAxeViolations(container);
  });

  it('shows a sale with the regular price it beat', async () => {
    const user = userEvent.setup();
    resolved = [{ ...E31, price: { amount: '90.0000', currency: 'PLN', source: 'sale', compareAt: '95.0000' }, explanation: { ...E31.explanation, tier: 'sale', cell: null } }];
    await open(`/price-lists/explain?productId=${P1}`);
    const line = await explain(user);
    expect(line).toHaveTextContent('Sale price');
    expect(line).toHaveTextContent('Below the regular price it beat: 95.00 PLN');
  });

  it('explains an unpriced line and suggests setting a base price', async () => {
    const user = userEvent.setup();
    resolved = [{ key: '1', price: null, explanation: { tier: null, precedenceVersion: 1 } }];
    await open(`/price-lists/explain?productId=${P1}`);
    const line = await explain(user);
    expect(line).toHaveTextContent('No price: no base price, catalogue, buyer or sale price applies to this line.');
    expect(within(line).getByRole('link', { name: 'Set a base price' })).toHaveAttribute('href', `/catalog/products/${P1}`);
  });
});

describe('price explainer — asking', () => {
  it('asks for a guest with a channel and a quantity', async () => {
    const user = userEvent.setup();
    await open(`/price-lists/explain?productId=${P1}`);
    expect(screen.getByRole('radio', { name: 'Guest' })).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Sales channel'), IDS.channel);
    const quantity = screen.getByLabelText('Quantity, line 1');
    await user.clear(quantity);
    await user.type(quantity, '12');
    await explain(user);
    expect(api.post).toHaveBeenCalledWith(`${B}/resolve`, {
      salesChannelId: IDS.channel,
      buyer: {},
      lines: [{ key: '1', productId: P1, quantity: 12 }],
    });
  });

  it('pre-fills from a book: its channel, its currency and its only organization', async () => {
    await open(`/price-lists/explain?bookId=${IDS.books.L4}&productId=${P1}`);
    await waitFor(() => expect(screen.getByLabelText('Sales channel')).toHaveValue(IDS.channel));
    expect(screen.getByLabelText('Currency')).toHaveValue('PLN');
    expect(screen.getByRole('radio', { name: 'Organization' })).toBeChecked();
    expect(await screen.findByText('Acme B2B (demo)')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Screws 0200')).toBeInTheDocument();
  });

  it('asks for a line before it explains', async () => {
    const user = userEvent.setup();
    await open('/price-lists/explain');
    await user.click(screen.getByRole('button', { name: 'Explain' }));
    expect(screen.getByText('Choose a product on every line.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers a representative the organizations of their scope, through the price-book targets', async () => {
    const user = userEvent.setup();
    await open('/price-lists/explain', SALES_REP_ACME);
    await user.click(screen.getByRole('radio', { name: 'Organization' }));
    await user.type(screen.getByRole('combobox', { name: 'Organization' }), 'Ac');
    expect((await screen.findAllByRole('option', { name: /Acme/ })).length).toBeGreaterThan(0);
    const asked = api.get.mock.calls.map(([url]) => url as string).filter((url) => url.includes('/organizations'));
    expect(asked.every((url) => url.startsWith(`${B}/targets/organizations`))).toBe(true);
    expect(screen.queryByRole('radio', { name: 'Customer' })).toBeNull();
  });

  it('speaks Polish', async () => {
    await open('/price-lists/explain', PLATFORM_ADMIN, 'pl');
    expect(screen.getByRole('heading', { level: 1, name: 'Wyjaśnienie ceny' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyjaśnij' })).toBeInTheDocument();
  });
});
