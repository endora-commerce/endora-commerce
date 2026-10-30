import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 155 / T098 (US1, US5; FR-001, FR-003) — the Inventory tab's order-rules card:
 * the "Returnable" flag for every product type, the pieces minimum only for simple and
 * configurable products (D5), saved through the product `PATCH`.
 *
 * Rendered inside `<StrictMode>` like the admin root, with the catalogue's real `en` and
 * `pl` bundles so a missing key in either file fails here rather than in production.
 */
const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { ProductOrderRulesCard } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductOrderRulesCard'
);

type ProductType = 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;

function primeProduct(values: { minOrderQuantity: number | null; returnable: boolean }): void {
  getSpy.mockImplementation((path: string) => {
    if (path === PATH) {
      return Promise.resolve({ data: { id: PRODUCT_ID, type: 'simple', ...values } });
    }
    // Feature 163 — the per-channel rules below the global ones; this file's
    // subject is the global pair, so the product is in no channel here
    // (`product-scope-controls.test.tsx` covers the channel table).
    if (path === `${PATH}/scopes`) {
      return Promise.resolve({
        data: {
          global: {
            status: 'active',
            publishFrom: null,
            publishUntil: null,
            visibility: 'public',
            allowedOrganizationIds: [],
            ...values,
          },
          channels: [],
        },
      });
    }
    if (path === `${PATH}/scope-context`) {
      return Promise.resolve({
        data: { productId: PRODUCT_ID, channels: [], languagesUnion: [], primaryAdminLanguage: 'en', preference: null },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function renderCard(productType: ProductType, language: 'en' | 'pl' = 'en'): void {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  render(
    <StrictMode>
      <TranslationProvider language={language} initialBundle={{ catalog }}>
        {withSession(<ProductOrderRulesCard productId={PRODUCT_ID} productType={productType} />, {
          session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }),
        })}
      </TranslationProvider>
    </StrictMode>,
  );
}

describe('ProductOrderRulesCard (155)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    patchSpy.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it.each(['simple', 'configurable'] as const)(
    'shows Returnable and the pieces minimum for a %s product, loaded from the product',
    async (type) => {
      primeProduct({ minOrderQuantity: 10, returnable: true });
      renderCard(type);

      const returnable = await screen.findByRole('checkbox', { name: 'Returnable' });
      await waitFor(() => expect(returnable).toBeChecked());
      const minimum = screen.getByRole('spinbutton', { name: 'Minimum order quantity (pcs)' });
      expect(minimum).toHaveValue(10);
      expect(minimum).toHaveAttribute('min', '1');
      expect(minimum).toHaveAttribute('max', '1000000');
      expect(minimum).toHaveAttribute('step', '1');
    },
  );

  it.each(['grouped', 'bundle', 'virtual'] as const)(
    'shows Returnable but no minimum for a %s product (D5)',
    async (type) => {
      primeProduct({ minOrderQuantity: null, returnable: false });
      renderCard(type);

      const returnable = await screen.findByRole('checkbox', { name: 'Returnable' });
      expect(returnable).not.toBeChecked();
      expect(
        screen.queryByRole('spinbutton', { name: 'Minimum order quantity (pcs)' }),
      ).not.toBeInTheDocument();
    },
  );

  it('saves the Returnable flag through PATCH when toggled', async () => {
    primeProduct({ minOrderQuantity: null, returnable: false });
    patchSpy.mockResolvedValue({ data: {} });
    renderCard('bundle');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Returnable' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(PATH, { returnable: true });
    await screen.findByText('Order rules saved.');
  });

  it('saves a new minimum, and an emptied input as null', async () => {
    primeProduct({ minOrderQuantity: 10, returnable: true });
    patchSpy.mockResolvedValue({ data: {} });
    renderCard('simple');

    const user = userEvent.setup();
    const minimum = await screen.findByRole('spinbutton', {
      name: 'Minimum order quantity (pcs)',
    });
    await waitFor(() => expect(minimum).toHaveValue(10));
    await user.clear(minimum);
    await user.type(minimum, '24');
    await user.click(screen.getByRole('button', { name: 'Save minimum' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenLastCalledWith(PATH, { minOrderQuantity: 24 });

    await user.clear(minimum);
    await user.click(screen.getByRole('button', { name: 'Save minimum' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(2));
    expect(patchSpy).toHaveBeenLastCalledWith(PATH, { minOrderQuantity: null });
  });

  it('clears a saved minimum with the remove action', async () => {
    primeProduct({ minOrderQuantity: 10, returnable: true });
    patchSpy.mockResolvedValue({ data: {} });
    renderCard('configurable');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove minimum' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(PATH, { minOrderQuantity: null });
  });

  it.each(['0', '1000001', '2.5'])(
    'refuses %s inline without a request, linking the error to the input',
    async (raw) => {
      primeProduct({ minOrderQuantity: null, returnable: false });
      renderCard('simple');

      const user = userEvent.setup();
      const minimum = await screen.findByRole('spinbutton', {
        name: 'Minimum order quantity (pcs)',
      });
      await user.type(minimum, raw);
      await user.click(screen.getByRole('button', { name: 'Save minimum' }));

      const message = await screen.findByText(
        'Enter a whole number from 1 to 1000000, or leave the field empty.',
      );
      expect(minimum).toHaveAttribute('aria-invalid', 'true');
      expect(minimum.getAttribute('aria-describedby')).toContain(message.id);
      expect(patchSpy).not.toHaveBeenCalled();
    },
  );

  it("shows the server's 422 refusal beside the minimum", async () => {
    primeProduct({ minOrderQuantity: null, returnable: false });
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'A minimum order quantity applies to simple and configurable products only.',
          details: { field: 'minOrderQuantity' },
        },
      }),
    );
    renderCard('simple');

    const user = userEvent.setup();
    const minimum = await screen.findByRole('spinbutton', {
      name: 'Minimum order quantity (pcs)',
    });
    await user.type(minimum, '5');
    await user.click(screen.getByRole('button', { name: 'Save minimum' }));

    const message = await screen.findByText(
      'A minimum order quantity applies to simple and configurable products only.',
    );
    expect(minimum).toHaveAttribute('aria-invalid', 'true');
    expect(minimum.getAttribute('aria-describedby')).toContain(message.id);
  });

  it('reverts the Returnable toggle and shows the error when the save fails', async () => {
    primeProduct({ minOrderQuantity: null, returnable: false });
    patchSpy.mockRejectedValue(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'Something broke.' } }),
    );
    renderCard('simple');

    const user = userEvent.setup();
    const returnable = await screen.findByRole('checkbox', { name: 'Returnable' });
    await user.click(returnable);

    await screen.findByText('Something broke.');
    expect(returnable).not.toBeChecked();
  });

  it('renders its labels in Polish', async () => {
    primeProduct({ minOrderQuantity: 3, returnable: true });
    renderCard('simple', 'pl');

    expect(await screen.findByRole('checkbox', { name: 'Podlega zwrotowi' })).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: 'Minimalna ilość zamówienia (szt.)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz minimum' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zasady zamawiania' })).toBeInTheDocument();
  });
});

/**
 * Round B UI review (Constitution IX) — the card is built from the admin kit's
 * `Checkbox`, `Input` and `Button`, not from raw elements with the legacy
 * `b2b-*` classes, so it follows the kit's focus ring and disabled states.
 */
describe('ProductOrderRulesCard — kit primitives', () => {
  it('declares no raw <input> or <button> element', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../../packages/modules/catalog/src/admin/components/ProductOrderRulesCard.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/<input\b/);
    expect(source).not.toMatch(/<button\b/);
    expect(source).toMatch(/from '@endora-commerce\/admin-kit\/ui'/);
  });
});
