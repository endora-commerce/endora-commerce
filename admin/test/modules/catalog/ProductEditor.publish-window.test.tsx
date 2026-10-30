import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 163 / T089 (US2, FR-023, FR-013) — the global publication window on the product
 * editor's Details tab: read from the scopes answer, shown in the operator's local time,
 * sent with the page Save only when it changed, and refused inline — never by a browser
 * bubble — when it does not start before it ends. The global status is handed to the
 * scope editor so its inherited labels follow it, with no warning about overrides.
 *
 * The process time zone is pinned to UTC+1 (`Etc/GMT-1`).
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const scopeEditorSpy = vi.fn((_props: Record<string, unknown>) => null);
vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor', () => ({
  ProductScopeEditor: (props: Record<string, unknown>) => scopeEditorSpy(props),
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111102';
const PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;

const BUNDLE = passthroughBundle('catalog', [
  'productEditor.loading',
  'productEditor.section.identity',
  'productEditor.field.sku',
  'productEditor.field.status',
  'productEditor.field.status.help',
  'productEditor.field.type',
  'productEditor.field.visibility',
  'productEditor.field.attributeSet',
  'productEditor.attributeSet.loading',
  'productEditor.field.defaultPrice',
  'productEditor.field.defaultPrice.help',
  'productEditor.field.publishWindow',
  'productEditor.field.publishFrom',
  'productEditor.field.publishUntil',
  'productEditor.field.publishWindow.help',
  'productEditor.error.publishWindow',
  'productEditor.scopeControls.window.invalidOrder',
  'productEditor.scopeControls.window.invalidDate',
]);

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'WINDOW-SKU',
  slug: 'window-sku',
  type: 'simple' as const,
  status: 'active' as const,
  name: { 'en-US': 'Seasonal product', 'pl-PL': '' },
  description: { 'en-US': '', 'pl-PL': '' },
  visibility: 'public' as const,
  attributeValues: {},
  attributeSetId: '22222222-2222-4222-8222-222222222202',
};

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) return Promise.resolve({ data: [] });
    if (path.includes('/attribute-sets')) {
      return Promise.resolve({
        data: [{ id: MOCK_PRODUCT.attributeSetId, code: 'default', name: { 'en-US': 'Default' }, isSystem: true }],
      });
    }
    if (path === `${PATH}/scopes`) {
      return Promise.resolve({
        data: {
          global: {
            status: 'active',
            publishFrom: '2026-12-01T07:00:00.000Z',
            publishUntil: null,
            visibility: 'public',
            allowedOrganizationIds: [],
            minOrderQuantity: null,
            returnable: true,
          },
          channels: [],
        },
      });
    }
    if (path === PATH) return Promise.resolve({ data: MOCK_PRODUCT });
    return Promise.resolve({ data: [] });
  });
}

function renderEditor(): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
      <Routes>
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      bundle: BUNDLE,
    },
  );
}

let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = 'Etc/GMT-1';
});
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('ProductEditor — global publication window (163)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    patchSpy.mockReset();
    scopeEditorSpy.mockClear();
    primeGets();
    patchSpy.mockResolvedValue({ data: MOCK_PRODUCT });
  });
  afterEach(() => vi.clearAllMocks());

  it('shows the stored window in local time and leaves it out of a save that did not change it', async () => {
    const user = userEvent.setup();
    renderEditor();
    const from = await screen.findByLabelText('productEditor.field.publishFrom');
    await waitFor(() => expect(from).toHaveValue('2026-12-01T08:00'));
    expect(screen.getByLabelText('productEditor.field.publishUntil')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    const body = patchSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('publishFrom');
    expect(body).not.toHaveProperty('publishUntil');
  });

  it('sends a changed window as ISO instants with the page Save', async () => {
    const user = userEvent.setup();
    renderEditor();
    const until = await screen.findByLabelText('productEditor.field.publishUntil');
    fireEvent.change(until, { target: { value: '2026-12-31T23:59' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    const [url, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(PATH);
    expect(body['publishFrom']).toBe('2026-12-01T07:00:00.000Z');
    expect(body['publishUntil']).toBe('2026-12-31T22:59:00.000Z');
  });

  it('refuses a window that ends before it starts, beside the fields and without a request', async () => {
    const user = userEvent.setup();
    renderEditor();
    const until = await screen.findByLabelText('productEditor.field.publishUntil');
    expect(until).not.toHaveAttribute('required');
    expect(until).not.toHaveAttribute('min');
    fireEvent.change(until, { target: { value: '2026-11-30T08:00' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    const message = await screen.findByText('productEditor.scopeControls.window.invalidOrder');
    expect(until).toHaveAttribute('aria-invalid', 'true');
    expect(until.getAttribute('aria-describedby')).toContain(message.id);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it("translates the server's window refusal instead of showing its message", async () => {
    const user = userEvent.setup();
    patchSpy.mockRejectedValueOnce(
      new ApiError(422, {
        error: { code: 'VALIDATION_FAILED', message: 'The publication window must start before it ends.', details: { field: 'window' } },
      }),
    );
    renderEditor();
    const until = await screen.findByLabelText('productEditor.field.publishUntil');
    fireEvent.change(until, { target: { value: '2026-12-02T08:00' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    expect(await screen.findByText('productEditor.error.publishWindow')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('VALIDATION_FAILED');
  });

  it('hands the live global status to the scope editor (FR-013)', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() =>
      expect(scopeEditorSpy).toHaveBeenLastCalledWith(expect.objectContaining({ globalStatus: 'active' })),
    );
    await user.selectOptions(screen.getByLabelText('productEditor.field.status'), 'inactive');
    expect(scopeEditorSpy).toHaveBeenLastCalledWith(expect.objectContaining({ globalStatus: 'inactive' }));
  });
});
