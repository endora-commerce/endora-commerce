import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1455 (UX audit 2026-11-17, CAT-02) on the kit toolbar of issue #1440
 * (DS-06). The products list had dead controls that looked exactly like live
 * ones: Import and Export buttons with no handler, Category and Channel chips
 * whose click did nothing, a Stock chip that emptied the list whatever was in
 * stock, a permanently disabled *Edit price*, an unnamed clear-selection icon
 * and a per-row "more" icon that opened nothing. Every control left on the
 * screen now does what it looks like it does (Law of Similarity).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const LIST_VIEWS = '/api/v1/admin/catalog/products/list-views';
const PAGE = {
  data: [
    {
      id: '00000000-0000-4000-8000-000000000b01',
      sku: 'BOLT-1',
      slug: 'bolt-1',
      type: 'simple',
      status: 'active',
      name: 'Hex bolt',
      visibility: 'public',
      attributeValues: {},
      updatedAt: '2026-05-15T10:00:00.000Z',
    },
  ],
  pagination: { page: 0, pageSize: 25, total: 1 },
  counts: { all: 1, active: 1, inactive: 0, archived: 0 },
};

const BUNDLE = passthroughBundle('catalog', [
  'productsList.title',
  'productsList.subtitle',
  'productsList.action.newProduct',
  'productsList.action.importExport',
  'productsList.toolbar.label',
  'productsList.search.label',
  'productsList.search.placeholder',
  'productsList.filter.type',
  'productsList.filter.typeAll',
  'productEditor.type.simple',
  'productEditor.type.configurable',
  'productEditor.type.grouped',
  'productEditor.type.bundle',
  'productEditor.type.virtual',
  'productsList.bulk.edit',
  'productsList.bulk.delete',
  'productsList.selection.selected',
  'productsList.selection.scopePage',
  'productsList.selection.clear',
  'productsList.error.load',
  'productsList.tab.all',
  'productsList.tab.active',
  'productsList.tab.inactive',
  'productsList.tab.archived',
]);

function answer(): void {
  getSpy.mockImplementation(async (path: string) => (path.startsWith(LIST_VIEWS) ? { data: [] } : PAGE));
}

function mount(options: { importExport?: boolean; permissions?: string[] } = {}): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/catalog/products']}>
        <ProductsList />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
        presence: modulePresence(
          options.importExport === false
            ? { present: ['catalog'], absent: ['import_export'] }
            : { present: ['catalog', 'import_export'] },
        ),
      },
    ),
    BUNDLE,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  answer();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ProductsList — header actions (CAT-02)', () => {
  it('offers Import / export as one outline link to the import–export centre', async () => {
    mount();
    await screen.findByText('Hex bolt');
    const link = screen.getByRole('link', { name: 'productsList.action.importExport' });
    expect(link.getAttribute('href')).toBe('/import-export');
    expect(screen.queryByRole('button', { name: /productsList\.action\.(import|export)$/ })).toBeNull();
  });

  it('offers no Import / export while the import_export module is off', async () => {
    mount({ importExport: false });
    await screen.findByText('Hex bolt');
    expect(screen.queryByRole('link', { name: 'productsList.action.importExport' })).toBeNull();
  });
});

describe('ProductsList — the kit toolbar (DS-06, CAT-02)', () => {
  it('is a named search landmark with a labelled search box', async () => {
    mount();
    await screen.findByText('Hex bolt');
    const region = screen.getByRole('search', { name: 'productsList.toolbar.label' });
    expect(within(region).getByRole('searchbox', { name: 'productsList.search.label' })).toBeInTheDocument();
  });

  it('carries no dead chips: no Category, Channel or Stock control', async () => {
    mount();
    await screen.findByText('Hex bolt');
    const region = screen.getByRole('search', { name: 'productsList.toolbar.label' });
    expect(within(region).queryByRole('button', { name: /chip\.(category|channel|stock)/ })).toBeNull();
    expect(within(region).queryByText(/productsList\.chip\./)).toBeNull();
  });

  it('filters by type through a labelled select, and the API is asked for that type', async () => {
    mount();
    await screen.findByText('Hex bolt');
    const type = screen.getByRole('combobox', { name: 'productsList.filter.type' });
    expect((type as HTMLSelectElement).value).toBe('');
    await userEvent.selectOptions(type, 'configurable');
    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([path]) => typeof path === 'string' && path.startsWith('/api/v1/admin/catalog/products?') && path.includes('type=configurable'),
        ),
      ).toBe(true),
    );
  });
});

describe('ProductsList — selection bar (CAT-02)', () => {
  it('has no Edit price, and the clear-selection icon has a name and no inline colour', async () => {
    mount();
    await screen.findByText('Hex bolt');
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]!);
    await screen.findByText('productsList.bulk.edit');
    expect(screen.queryByText(/productsList\.bulk\.editPrice/)).toBeNull();
    const clear = screen.getByRole('button', { name: 'productsList.selection.clear' });
    expect(clear.getAttribute('style')).toBeNull();
    await userEvent.click(clear);
    expect(screen.queryByText('productsList.bulk.edit')).toBeNull();
  });

  it('leaves no unnamed button in a row', async () => {
    mount();
    const cell = await screen.findByText('Hex bolt');
    const row = cell.closest('tr') as HTMLElement;
    for (const button of within(row).queryAllByRole('button')) {
      expect(button.textContent?.trim() || button.getAttribute('aria-label')).toBeTruthy();
    }
  });
});

describe('ProductsList — load failure (CAT-02)', () => {
  it('is an alert, not a card painted with a hard-coded colour', async () => {
    getSpy.mockImplementation(async (path: string) => {
      if (path.startsWith(LIST_VIEWS)) return { data: [] };
      throw new Error('down');
    });
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('productsList.error.load');
    expect(alert.getAttribute('style')).toBeNull();
  });
});
