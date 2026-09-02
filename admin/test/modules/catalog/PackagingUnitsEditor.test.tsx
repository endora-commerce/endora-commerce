import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 043 — interaction test for the packaging-units editor in the
 * product Inventory tab.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
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

const { PackagingUnitsEditor } = await import(
  '../../../../packages/modules/catalog/src/admin/components/PackagingUnitsEditor'
);

const BUNDLE = passthroughBundle('catalog', [
  'packagingUnits.title',
  'packagingUnits.help',
  'packagingUnits.loading',
  'packagingUnits.empty',
  'packagingUnits.newName',
  'packagingUnits.newQuantity',
  'packagingUnits.col.name',
  'packagingUnits.col.baseQuantity',
  'packagingUnits.col.default',
  'packagingUnits.col.order',
  'packagingUnits.action.add',
  'packagingUnits.action.remove',
  'packagingUnits.action.moveUp',
  'packagingUnits.action.moveDown',
  'packagingUnits.error.load',
  'packagingUnits.error.save',
  'packagingUnits.error.invalid',
]);

const unit = {
  id: '00000000-0000-4000-8000-000000000001',
  productId: 'p1',
  name: 'Paleta',
  baseQuantity: 480,
  position: 0,
  isDefault: true,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

describe('PackagingUnitsEditor (043)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    postSpy.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('lists units returned by the API', async () => {
    getSpy.mockResolvedValue({ data: [unit] });
    renderWithI18n(<PackagingUnitsEditor productId="p1" />, BUNDLE);
    await screen.findByDisplayValue('Paleta');
    expect(screen.getByDisplayValue('480')).toBeInTheDocument();
  });

  it('posts a new unit when the operator adds one', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: unit });
    renderWithI18n(<PackagingUnitsEditor productId="p1" />, BUNDLE);
    await screen.findByText('packagingUnits.empty');

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('packagingUnits.newName'), 'Paleta');
    await user.type(screen.getByPlaceholderText('packagingUnits.newQuantity'), '480');
    await user.click(screen.getByText('packagingUnits.action.add'));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/products/p1/packaging-units');
    expect(postSpy.mock.calls[0]![1]).toEqual({ name: 'Paleta', baseQuantity: 480 });
  });
});
