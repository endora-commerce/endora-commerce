import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 022 / T013 + T026 — interaction tests for
 * `ProductsBulkEditDialog`. Uses jsdom + @testing-library/react to drive
 * the touched-field tracking, submit, summary, and attribute-row flows.
 *
 * The dialog uses two collaborators that must be stubbed for an
 * isolated test: `apiClient` (network) and `useTranslation` (provided
 * by the helper's `<TranslationProvider>` wrapper with a passthrough
 * bundle).
 */

const postSpy = vi.fn();
const getSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// Import AFTER the mock so the dialog binds to the stubbed apiClient.
const { ProductsBulkEditDialog } = await import(
  '../../../src/modules/catalog/ProductsBulkEditDialog'
);

const BUNDLE_KEYS = [
  'productsList.bulkEdit.title',
  'productsList.bulkEdit.section.status',
  'productsList.bulkEdit.section.visibility',
  'productsList.bulkEdit.section.salesChannels',
  'productsList.bulkEdit.section.categories',
  'productsList.bulkEdit.section.attributes',
  'productsList.bulkEdit.untouched',
  'productsList.bulkEdit.mode.add',
  'productsList.bulkEdit.mode.replace',
  'productsList.bulkEdit.action.apply',
  'productsList.bulkEdit.action.cancel',
  'productsList.bulkEdit.summary.succeeded',
  'productsList.bulkEdit.summary.skipped',
  'productsList.bulkEdit.summary.failed',
  'productsList.bulkEdit.summary.total',
  'productsList.bulkEdit.empty',
  'categoryTreePicker.filter.placeholder',
  'categoryTreePicker.aria.treeLabel',
  'categoryTreePicker.expand',
  'categoryTreePicker.collapse',
  'categoryTreePicker.empty.noCategories',
  'categoryTreePicker.empty.noMatches',
];

const BUNDLE = passthroughBundle('catalog', BUNDLE_KEYS);

interface MockAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: string;
}

function primeOnOpenGets(opts: { attrs?: MockAttribute[] } = {}): void {
  // Each open of the dialog issues three GETs in parallel:
  //   attributes/by-flag, sales-channels, catalog/categories.
  // Return empty lists by default so the dialog mounts cleanly.
  getSpy.mockImplementation((path: string) => {
    if (path.includes('attributes/by-flag')) {
      return Promise.resolve({ data: { items: opts.attrs ?? [] } });
    }
    if (path.includes('sales-channels')) {
      return Promise.resolve({ data: [] });
    }
    if (path.includes('catalog/categories')) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [] });
  });
}

describe('ProductsBulkEditDialog — interaction', () => {
  beforeEach(() => {
    postSpy.mockReset();
    getSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Apply is disabled until at least one field-group is touched (T013)', async () => {
    primeOnOpenGets();
    renderWithI18n(
      <ProductsBulkEditDialog
        productIds={['11111111-2222-4333-8444-555555555551']}
        onClose={vi.fn()}
      />,
      BUNDLE,
    );

    const applyBtn = await screen.findByRole('button', {
      name: 'productsList.bulkEdit.action.apply',
    });
    expect(applyBtn).toBeDisabled();
  });

  it('Touching the Status group sends only `status` in the request body (T013)', async () => {
    primeOnOpenGets();
    postSpy.mockResolvedValueOnce({
      data: {
        bulkOperationId: 'op-1',
        summary: { succeeded: 1, skipped: 0, failed: 0, total: 1 },
        results: [
          { productId: '11111111-2222-4333-8444-555555555551', status: 'succeeded' },
        ],
      },
    });

    const onApplied = vi.fn();
    renderWithI18n(
      <ProductsBulkEditDialog
        productIds={['11111111-2222-4333-8444-555555555551']}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
      BUNDLE,
    );

    const user = userEvent.setup();

    // Find the Status field-group's touched checkbox (the row's <label>
    // includes the section label as its accessible text).
    const statusLabel = await screen.findByText(
      'productsList.bulkEdit.section.status',
    );
    const statusCheckbox = statusLabel
      .closest('label')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(statusCheckbox);

    const applyBtn = screen.getByRole('button', {
      name: 'productsList.bulkEdit.action.apply',
    });
    await waitFor(() => expect(applyBtn).toBeEnabled());
    await user.click(applyBtn);

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/products/bulk-update');
    expect(postSpy.mock.calls[0]![1]).toEqual({
      productIds: ['11111111-2222-4333-8444-555555555551'],
      fields: { status: 'active' },
    });
    // Visibility, salesChannels, categories, attributeValues must NOT
    // leak into the request body — only status.
    const body = postSpy.mock.calls[0]![1] as { fields: Record<string, unknown> };
    expect(Object.keys(body.fields)).toEqual(['status']);

    // Parent gets `onApplied` so it can refresh the list.
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  it('Renders the summary view after submit (T013)', async () => {
    primeOnOpenGets();
    postSpy.mockResolvedValueOnce({
      data: {
        bulkOperationId: 'op-2',
        summary: { succeeded: 3, skipped: 1, failed: 0, total: 4 },
        results: [
          { productId: 'a', status: 'succeeded' },
          { productId: 'b', status: 'succeeded' },
          { productId: 'c', status: 'succeeded' },
          { productId: 'd', status: 'skipped', reason: 'product_not_found' },
        ],
      },
    });

    renderWithI18n(
      <ProductsBulkEditDialog productIds={['a', 'b', 'c', 'd']} onClose={vi.fn()} />,
      BUNDLE,
    );

    const user = userEvent.setup();
    const statusLabel = await screen.findByText(
      'productsList.bulkEdit.section.status',
    );
    const statusCheckbox = statusLabel
      .closest('label')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(statusCheckbox);
    await user.click(
      screen.getByRole('button', { name: 'productsList.bulkEdit.action.apply' }),
    );

    // Summary badges render the counts.
    await screen.findByText('productsList.bulkEdit.summary.succeeded');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('Renders one row per mass-editable attribute and only ticked rows are submitted (T026)', async () => {
    primeOnOpenGets({
      attrs: [
        {
          id: 'attr-1',
          key: 'brand',
          label: { 'en-US': 'Brand' },
          labelDefault: 'Brand',
          valueType: 'string',
        },
        {
          id: 'attr-2',
          key: 'warranty_years',
          label: { 'en-US': 'Warranty (years)' },
          labelDefault: 'Warranty (years)',
          valueType: 'number',
        },
      ],
    });
    postSpy.mockResolvedValueOnce({
      data: {
        bulkOperationId: 'op-3',
        summary: { succeeded: 1, skipped: 0, failed: 0, total: 1 },
        results: [{ productId: 'p1', status: 'succeeded' }],
      },
    });

    renderWithI18n(
      <ProductsBulkEditDialog productIds={['p1']} onClose={vi.fn()} />,
      BUNDLE,
    );

    // Both attribute rows render once the by-flag fetch resolves.
    await screen.findByText('Brand');
    expect(screen.getByText('Warranty (years)')).toBeInTheDocument();

    const user = userEvent.setup();

    // Touch only the first attribute (brand) and type a value. The
    // attribute row is the grandparent div of the label text node.
    const brandLabel = screen.getByText('Brand');
    const brandRow = brandLabel.parentElement!.parentElement!;
    const brandCheckbox = brandRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const brandInput = brandRow.querySelector('input[type="text"]') as HTMLInputElement;
    expect(brandCheckbox).not.toBeNull();
    expect(brandInput).not.toBeNull();
    await user.click(brandCheckbox);
    await user.type(brandInput, 'Acme');

    await user.click(
      screen.getByRole('button', { name: 'productsList.bulkEdit.action.apply' }),
    );

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = postSpy.mock.calls[0]![1] as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({
      attributeValues: { brand: 'Acme' },
    });
    // Untouched warranty_years must NOT leak into the request body.
    const av = body.fields.attributeValues as Record<string, unknown>;
    expect(av.warranty_years).toBeUndefined();
  });

  it('Categories tree selection is sent in bulk POST (feature 031)', async () => {
    const CAT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    getSpy.mockImplementation((path: string) => {
      if (path.includes('attributes/by-flag')) {
        return Promise.resolve({ data: { items: [] } });
      }
      if (path.includes('sales-channels')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('catalog/categories')) {
        return Promise.resolve({
          data: [
            {
              id: CAT_ID,
              parentCategoryId: null,
              name: { 'en-US': 'Bulk Cat' },
              slug: 'bulk-cat',
              sortOrder: 1,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    postSpy.mockResolvedValueOnce({
      data: {
        bulkOperationId: 'op-cat',
        summary: { succeeded: 1, skipped: 0, failed: 0, total: 1 },
        results: [{ productId: 'p1', status: 'succeeded' }],
      },
    });

    renderWithI18n(
      <ProductsBulkEditDialog productIds={['p1']} onClose={vi.fn()} />,
      BUNDLE,
    );

    const user = userEvent.setup();
    const categoriesLabel = await screen.findByText(
      'productsList.bulkEdit.section.categories',
    );
    const touchCheckbox = categoriesLabel
      .closest('label')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(touchCheckbox);

    await user.click(screen.getByRole('checkbox', { name: 'Bulk Cat' }));

    await user.click(
      screen.getByRole('button', { name: 'productsList.bulkEdit.action.apply' }),
    );

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = postSpy.mock.calls[0]![1] as {
      fields: { categories?: { mode: string; categoryIds: string[] } };
    };
    expect(body.fields.categories).toEqual({ mode: 'add', categoryIds: [CAT_ID] });
  });
});
