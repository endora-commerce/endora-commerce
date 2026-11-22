import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1749 — the products list is the kit `ListPage` (DS-05). What moving
 * onto it changes, beside what the other `ProductsList.*` files already pin:
 *
 * - the first load draws the kit skeleton; a refresh over rows on screen (a
 *   page turn, a filter change) keeps the rows and the pager, so the focused
 *   control keeps its focus, and says *Loading…* through the count's live region;
 * - the count of matching products ends the toolbar row, announced;
 * - a load failure is the kit's error with *Retry*, which asks again;
 * - the product's name is the link into it, and a selected row is marked so.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const LIST = '/api/v1/admin/catalog/products?';
const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('catalog', 'en') };
const CORE_EN = shippedCoreBundle('en').core!;
const TOTAL = 60;

function product(n: number): unknown {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    sku: `SKU-${n}`,
    slug: `p-${n}`,
    type: 'simple',
    status: 'active',
    name: `Product ${n}`,
    visibility: 'public',
    attributeValues: {},
    updatedAt: '2026-05-15T10:00:00.000Z',
  };
}

function pageOf(path: string): unknown {
  const params = new URLSearchParams(path.slice(LIST.length));
  const page = Number(params.get('page') ?? '0');
  const size = Number(params.get('pageSize') ?? '25');
  const from = page * size;
  const rows = Array.from({ length: Math.max(0, Math.min(size, TOTAL - from)) }, (_, i) => product(from + i + 1));
  return {
    data: rows,
    pagination: { page, pageSize: size, total: TOTAL },
    counts: { all: TOTAL, active: TOTAL, inactive: 0, archived: 0 },
    stockFilterAvailable: true,
  };
}

/** Every list request answers at once, unless a test holds the next one. */
let hold: { release: () => void } | null = null;

beforeEach(() => {
  hold = null;
  getSpy.mockReset().mockImplementation(async (path: string) => {
    if (!path.startsWith(LIST)) return { data: [] };
    if (hold === null) return pageOf(path);
    await new Promise<void>((resolve) => {
      hold!.release = resolve;
    });
    return pageOf(path);
  });
});

function holdNextRequest(): void {
  hold = { release: () => undefined };
}

function renderList(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/catalog/products']}>
        <ProductsList />
      </MemoryRouter>,
      { presence: modulePresence({ present: ['catalog', 'inventory'] }), session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
  );
}

function listRequests(): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.slice(LIST.length)));
}

/** The kit's count region: the live region at the end of the toolbar row. */
function countRegion(): HTMLElement {
  const region = screen.getAllByRole('status').find((el) => el.tagName === 'P');
  expect(region).toBeDefined();
  return region!;
}

describe('ProductsList on the kit ListPage (issue #1749)', () => {
  it('draws the kit skeleton on the first load, then the rows and the announced count', async () => {
    holdNextRequest();
    renderList();
    expect(await screen.findByTestId('list-page-skeleton')).toBeInTheDocument();
    expect(countRegion()).toHaveTextContent(CORE_EN['common.state.loading']!);
    hold!.release();
    expect(await screen.findByText('Product 1')).toBeInTheDocument();
    expect(screen.queryByTestId('list-page-skeleton')).toBeNull();
    expect(countRegion()).toHaveTextContent(`Products: ${TOTAL}`);
  });

  it('keeps the rows and the pager through a page turn, and the Next button keeps the focus', async () => {
    renderList();
    await screen.findByText('Product 1');
    const user = userEvent.setup();
    const next = screen.getByRole('button', { name: /Next/ });

    holdNextRequest();
    await user.click(next);
    await waitFor(() => expect(listRequests().at(-1)!.get('page')).toBe('1'));
    // In flight: the page on screen stays, busy, with no skeleton.
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.queryByTestId('list-page-skeleton')).toBeNull();
    expect(screen.getByText('Product 1').closest('[aria-busy="true"]')).not.toBeNull();
    expect(countRegion()).toHaveTextContent(CORE_EN['common.state.loading']!);
    expect(next).toHaveFocus();

    hold!.release();
    const pageSize = Number(listRequests().at(-1)!.get('pageSize'));
    expect(await screen.findByText(`Product ${pageSize + 1}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBe(next);
    expect(next).toHaveFocus();
    expect(screen.getByText(`Product ${pageSize + 1}`).closest('[aria-busy]')).toBeNull();
  });

  it('keeps the rows while a changed filter loads', async () => {
    renderList();
    await screen.findByText('Product 1');
    const user = userEvent.setup();
    holdNextRequest();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'configurable');
    await waitFor(() => expect(listRequests().at(-1)!.get('type')).toBe('configurable'));
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.queryByTestId('list-page-skeleton')).toBeNull();
    hold!.release();
  });

  it('shows a load failure as the kit error, and Retry asks again', async () => {
    getSpy.mockImplementation(async (path: string) => {
      if (!path.startsWith(LIST)) return { data: [] };
      throw new Error('down');
    });
    renderList();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(shippedModuleBundle('catalog', 'en').catalog!['productsList.error.load']!);
    const before = listRequests().length;
    getSpy.mockImplementation(async (path: string) => (path.startsWith(LIST) ? pageOf(path) : { data: [] }));
    await userEvent.setup().click(within(alert).getByRole('button', { name: CORE_EN['common.action.retry']! }));
    expect(await screen.findByText('Product 1')).toBeInTheDocument();
    expect(listRequests().length).toBeGreaterThan(before);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("links each product's name to its editor, and marks a selected row", async () => {
    renderList();
    const link = await screen.findByRole('link', { name: 'Product 1' });
    expect(link).toHaveAttribute('href', '/catalog/products/00000000-0000-4000-8000-000000000001');
    const row = link.closest('tr')!;
    expect(row).not.toHaveAttribute('data-state');
    await userEvent.setup().click(within(row).getByRole('checkbox'));
    expect(row).toHaveAttribute('data-state', 'selected');
  });
});
