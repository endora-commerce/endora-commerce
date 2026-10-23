import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { priceBookSchema } from '@endora-commerce/contracts';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import { BOOKS, CATALOG, IDS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';
import { modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Where the explainer is opened from (feature 161, T079; FR-024): a book's
 * header, a grid cell's detail, the product's base-price panel and the
 * organization's detail each open it pre-filled with what they are about.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, currentLocation, bundles } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, gridCell, PRODUCTS } = await import('../../helpers/price-book-grid');

const B = '/api/v1/admin/price-books';
const book = priceBookSchema.parse({ ...BOOKS.L4, tierStarts: [1] });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  serveBook(api, { book, lines: linesOf([mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-5.00' } })]) });
  const served = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string) => {
    const [path] = url.split('?');
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `/api/v1/admin/catalog/products/${PRODUCTS.P1.id}`) {
      return { data: { id: PRODUCTS.P1.id, sku: 'P1', slug: 'p1', name: { 'en-US': 'Screws 0200' }, status: 'active', type: 'simple' } };
    }
    if (path === `/api/v1/admin/catalog/products/${PRODUCTS.P1.id}/variants`) return { data: [] };
    if (path === '/api/v1/admin/catalog/products') return { data: [], pagination: { page: 0, pageSize: 20, total: 0 } };
    return served(url);
  });
});

describe('the explainer’s entry points', () => {
  it('opens from a book’s header with the book’s channel and currency', async () => {
    const user = userEvent.setup();
    mountScreen({ path: `/price-lists/${book.id}`, session: PLATFORM_ADMIN });
    await screen.findByRole('heading', { level: 1, name: book.name });
    const link = screen.getByRole('link', { name: 'Explain a price' });
    expect(link).toHaveAttribute('href', `/price-lists/explain?bookId=${book.id}`);
    await user.click(link);
    await screen.findByRole('heading', { level: 1, name: 'Price explainer' });
    await waitFor(() => expect(screen.getByLabelText('Sales channel')).toHaveValue(IDS.channel));
    expect(screen.getByLabelText('Currency')).toHaveValue('PLN');
  });

  it('opens from a grid cell’s detail with the line’s product', async () => {
    const user = userEvent.setup();
    mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session: PLATFORM_ADMIN });
    await screen.findByRole('grid');
    await user.click(gridCell('Screws 0200', 1));
    await user.click(screen.getByRole('button', { name: 'Cell details' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('link', { name: 'Why this price?' }));
    await waitFor(() => expect(currentLocation()).toBe(`/price-lists/explain?productId=${PRODUCTS.P1.id}&bookId=${book.id}`));
    expect(await screen.findByDisplayValue('Screws 0200')).toBeInTheDocument();
  });

  it('opens from the product’s base-price panel with the product', async () => {
    const { contributions } = await import('@endora-commerce/mod-price-lists/admin');
    const zone = (contributions.zones ?? []).find((z) => z.zone === 'product.editor.pricing.after')!;
    const Panel = ((await zone.component()) as { default: ComponentType<{ productId: string }> }).default;
    api.get.mockImplementation(async (url: string) => {
      const [path] = url.split('?');
      if (path === `${B}/base-prices`) return { data: { productId: PRODUCTS.P1.id, byCurrency: {}, writable: true } };
      if (path === `${B}/targets/currencies`) return { data: { items: [] } };
      if (path === B) return { data: [], meta: { page: 1, pageSize: 200, totalCount: 0, creatableAudienceKinds: [] } };
      if (path === `/api/v1/admin/catalog/products/${PRODUCTS.P1.id}/variants`) return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
    renderInShell(<Panel productId={PRODUCTS.P1.id} />);
    expect(await screen.findByRole('link', { name: 'Why this price?' })).toHaveAttribute('href', `/price-lists/explain?productId=${PRODUCTS.P1.id}`);
  });

  it('opens from an organization’s detail with the organization', async () => {
    const { contributions } = await import('@endora-commerce/mod-price-lists/admin');
    const zone = (contributions.zones ?? []).find((z) => z.zone === 'organization.detail.after')!;
    const Panel = ((await zone.component()) as { default: ComponentType<{ organizationId: string }> }).default;
    api.get.mockImplementation(async () => ({ data: { mode: 'inherit' } }));
    renderInShell(<Panel organizationId={IDS.orgs.Acme} />);
    expect(await screen.findByRole('link', { name: 'Explain a price for this organization' })).toHaveAttribute(
      'href',
      `/price-lists/explain?organizationId=${IDS.orgs.Acme}`,
    );
    expect(CATALOG.organizations[0]!.id).toBe(IDS.orgs.Acme);
  });
});

function renderInShell(ui: ReactElement): void {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language="en" initialBundle={bundles('en')}>
      {withSession(<MemoryRouter>{children}</MemoryRouter>, { session: PLATFORM_ADMIN, presence: modulePresence({ present: ['price_lists'] }) })}
    </TranslationProvider>
  );
  render(ui, { wrapper });
}
