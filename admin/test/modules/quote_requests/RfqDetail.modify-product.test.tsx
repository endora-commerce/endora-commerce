import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRODUCT_ID, installGet, renderRfqDetail } from './rfq-reference-fixtures';

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
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const PRODUCT = {
  id: PRODUCT_ID,
  sku: 'WID-1',
  slug: 'widget',
  name: 'Widget',
  status: 'active',
  type: 'simple',
};

beforeEach(() => {
  getSpy.mockReset();
  installGet(getSpy, {}, 'reject');
  const fallback = getSpy.getMockImplementation()!;
  getSpy.mockImplementation((url: string) =>
    url === `/api/v1/admin/catalog/products/${PRODUCT_ID}`
      ? Promise.resolve({ data: PRODUCT })
      : fallback(url),
  );
});

/**
 * Feature 146, T099 owner finding — on the Modify tab every kept line's product
 * field shows the product already on the line, without the operator opening the
 * picker. The screen renders under `<StrictMode>` (`renderRfqDetail`), as the
 * admin does.
 */
describe('RfqDetail Modify — a kept line shows its product', () => {
  it('fills the product field of a kept line without any interaction', async () => {
    renderRfqDetail(RfqDetail);
    await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const line = await screen.findByRole('group', { name: 'Widget' });
    const field = line.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(field).not.toBeNull();
    await waitFor(() => expect(field!.value).toBe('Widget'));
  });
});
