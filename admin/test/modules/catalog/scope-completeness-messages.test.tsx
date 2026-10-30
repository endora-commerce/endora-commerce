import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from '../../helpers/render-with-session';

/**
 * Feature 163 / T096 (second file) and T098 (US6, FR-060; G-2 → A) — the completeness
 * gate's messages where an operator changes a status one product at a time.
 *
 * - The **global status** save (`PATCH /products/:id`) answers `{ data, warnings }`. In
 *   `warn` mode a status change that switches the product on where values are missing is
 *   saved and the editor says what is missing, per channel and language, by name (US6 #1);
 *   with nothing missing it says only "Saved." (US6 #2). In `refuse` mode the answer is
 *   `422 SCOPE_INCOMPLETE` with the pairs: the editor names them and never the code
 *   (US6 #3). Channel names come from the product's `scope-context`.
 * - The **status in one channel** (`ProductScopeControls`) does the same from
 *   `PATCH …/scopes`' `warnings`.
 *
 * Restore never fires the gate (owner I1 → B), so no case here involves it.
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

// The page Save's two staged writers, as handles: what matters here is whether, and
// when, the page calls them — never before the product PATCH has been accepted.
const flushOverridesSpy = vi.fn((): Promise<void> => Promise.resolve());

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor',
  );
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    ...actual,
    ProductScopeEditor: forwardRef(function ScopeEditorStub(_props: unknown, ref): null {
      useImperativeHandle(ref, () => ({ flushOverrides: (): Promise<void> => flushOverridesSpy() }));
      return null;
    }),
  };
});

const flushGallerySpy = vi.fn((): Promise<void> => Promise.resolve());

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductGallerySection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../packages/modules/catalog/src/admin/components/ProductGallerySection',
  );
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    ...actual,
    GallerySection: forwardRef(function GalleryStub(
      props: { onDirtyChange?: (dirty: boolean) => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ flushGallery: (): Promise<void> => flushGallerySpy() }));
      return (
        <button type="button" onClick={(): void => props.onDirtyChange?.(true)}>
          stage a gallery edit
        </button>
      );
    }),
  };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');
const { ProductScopeControls } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductScopeControls'
);

const PRODUCT_ID = '11111111-1111-4111-8111-111111111163';
const PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';

const PRODUCT = {
  id: PRODUCT_ID,
  sku: 'GATE-SKU',
  slug: 'gate-sku',
  type: 'simple' as const,
  status: 'inactive' as const,
  name: { 'en-US': 'Drill', 'pl-PL': 'Wiertarka' },
  description: { 'en-US': '', 'pl-PL': '' },
  visibility: 'public' as const,
  attributeValues: {},
  attributeSetId: '22222222-2222-4222-8222-222222222263',
  archivedAt: null,
};

const CONTEXT = {
  productId: PRODUCT_ID,
  channels: [
    { id: B2B, code: 'b2b', name: 'B2B shop', languages: ['pl'], isDefault: true },
    { id: B2C, code: 'b2c', name: 'B2C shop', languages: ['de', 'pl'], isDefault: false },
  ],
  languagesUnion: ['de', 'pl'],
  primaryAdminLanguage: 'en',
  preference: null,
};

const SCOPES = {
  global: {
    status: 'inactive',
    publishFrom: null,
    publishUntil: null,
    visibility: 'public',
    allowedOrganizationIds: [],
    minOrderQuantity: null,
    returnable: true,
  },
  channels: [
    {
      channelId: B2C,
      isMember: true,
      languages: ['de', 'pl'],
      status: null,
      window: null,
      audience: null,
      minOrderQuantity: null,
      returnable: null,
      languageStatuses: [],
      orphaned: false,
    },
  ],
  organizations: [],
};

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) return Promise.resolve({ data: [] });
    if (path.includes('/attribute-sets')) {
      return Promise.resolve({
        data: [{ id: PRODUCT.attributeSetId, code: 'default', name: { 'en-US': 'Default' }, isSystem: true }],
      });
    }
    if (path === `${PATH}/scope-context`) return Promise.resolve({ data: CONTEXT });
    if (path === `${PATH}/scopes`) return Promise.resolve({ data: SCOPES });
    if (path === PATH) return Promise.resolve({ data: PRODUCT });
    return Promise.resolve({ data: [] });
  });
}

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <TranslationProvider language={language} initialBundle={{ catalog, core: {} }}>
        {withSession(ui, {
          session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }),
          presence: modulePresence({ present: everyDeclaredModule() }),
        })}
      </TranslationProvider>
    </StrictMode>
  );
}

function renderEditor(language: 'en' | 'pl' = 'en'): void {
  render(
    wrap(
      <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
        <Routes>
          <Route path="/catalog/products/:id" element={<ProductEditor />} />
        </Routes>
      </MemoryRouter>,
      language,
    ),
  );
}

async function switchOnAndSave(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const status = await screen.findByRole('combobox', { name: /^status/i });
  await waitFor(() => expect((status as HTMLSelectElement).value).toBe('inactive'));
  await user.selectOptions(status, 'active');
  await user.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(patchSpy).toHaveBeenCalled());
}

const incomplete = (): ApiError =>
  new ApiError(422, {
    error: {
      code: 'SCOPE_INCOMPLETE',
      message: 'Required values are missing.',
      details: {
        pairs: [
          { channelId: B2C, languageCode: 'de', missing: ['name', 'attribute:material'] },
          { channelId: B2B, languageCode: 'pl', missing: ['urlKey'] },
        ],
      },
    },
  });

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  flushOverridesSpy.mockClear();
  flushGallerySpy.mockClear();
  primeGets();
});
afterEach(() => vi.clearAllMocks());

describe('the global status save and the completeness gate (US6)', () => {
  it('warn: saved, and says what is missing per channel and language by name (US6 #1)', async () => {
    const user = userEvent.setup();
    patchSpy.mockResolvedValue({
      data: { ...PRODUCT, status: 'active' },
      warnings: [{ kind: 'completeness', channelId: B2C, languageCode: 'de', missing: ['name', 'attribute:material'] }],
    });
    renderEditor();
    await switchOnAndSave(user);
    const notice = await screen.findByTestId('product-gate-warning');
    expect(notice.textContent).toMatch(/saved, but values are missing/i);
    expect(notice.textContent).toContain('B2C shop · DE: name, attribute material');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('nothing missing: "Saved." and no gate message (US6 #2)', async () => {
    const user = userEvent.setup();
    patchSpy.mockResolvedValue({ data: { ...PRODUCT, status: 'active' }, warnings: [] });
    renderEditor();
    await switchOnAndSave(user);
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.queryByTestId('product-gate-warning')).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(`${PATH}/scope-context`);
  });

  it('refuse: names every pair, says the details were not saved, never shows the code (US6 #3)', async () => {
    const user = userEvent.setup();
    patchSpy.mockRejectedValue(incomplete());
    renderEditor();
    await switchOnAndSave(user);
    const alert = await screen.findByText(/were not saved/i);
    expect(alert.textContent).toContain('B2C shop · DE: name, attribute material');
    expect(alert.textContent).toContain('B2B shop · PL: URL key');
    expect(document.body.textContent).not.toContain('SCOPE_INCOMPLETE');
    // The edit stays in the form, to be completed or changed.
    expect((screen.getByRole('combobox', { name: /^status/i }) as HTMLSelectElement).value).toBe('active');
  });

  it('refuse: the staged channel overrides are not written either — the whole change is refused (US6 #3, C-1)', async () => {
    const user = userEvent.setup();
    patchSpy.mockRejectedValue(incomplete());
    renderEditor();
    await switchOnAndSave(user);
    await screen.findByText(/were not saved/i);
    expect(flushOverridesSpy).not.toHaveBeenCalled();
  });

  it('accepted: the staged channel overrides are written after the product PATCH answered (C-1)', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    patchSpy.mockImplementation(async () => {
      order.push('patch');
      return { data: { ...PRODUCT, status: 'active' }, warnings: [] };
    });
    flushOverridesSpy.mockImplementation(async () => {
      order.push('overrides');
    });
    renderEditor();
    await switchOnAndSave(user);
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(order).toEqual(['patch', 'overrides']);
  });

  async function stageGalleryEditThenGoBack(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByRole('tab', { name: /^media$/i }));
    await user.click(await screen.findByRole('button', { name: 'stage a gallery edit' }));
    await user.click(screen.getByRole('tab', { name: /^details$/i }));
  }

  it('gallery edits staged on Media survive a tab switch and are written after the PATCH (D4, C-1)', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    patchSpy.mockImplementation(async () => {
      order.push('patch');
      return { data: { ...PRODUCT, status: 'active' }, warnings: [] };
    });
    flushGallerySpy.mockImplementation(async () => {
      order.push('gallery');
    });
    renderEditor();
    await stageGalleryEditThenGoBack(user);
    await switchOnAndSave(user);
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(order).toEqual(['patch', 'gallery']);
  });

  it('refuse: staged gallery edits are not written (US6 #3, C-1)', async () => {
    const user = userEvent.setup();
    patchSpy.mockRejectedValue(incomplete());
    renderEditor();
    await stageGalleryEditThenGoBack(user);
    await switchOnAndSave(user);
    await screen.findByText(/were not saved/i);
    expect(flushGallerySpy).not.toHaveBeenCalled();
  });

  it('staged gallery edits count as unsaved changes for the leave-page prompt (D4)', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('tab', { name: /^media$/i }));
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    await user.click(await screen.findByRole('button', { name: 'stage a gallery edit' }));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });

  it('a channel whose name cannot be read is named by a short id', async () => {
    const user = userEvent.setup();
    const base = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path === `${PATH}/scope-context` ? Promise.reject(new Error('down')) : base(path),
    );
    patchSpy.mockRejectedValue(incomplete());
    renderEditor();
    await switchOnAndSave(user);
    const alert = await screen.findByText(/were not saved/i);
    expect(alert.textContent).toContain(`${B2C.slice(0, 8)} · DE`);
  });

  it('any other refusal keeps its own message', async () => {
    const user = userEvent.setup();
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'SKU GATE-SKU is taken.' } }),
    );
    renderEditor();
    await switchOnAndSave(user);
    expect(await screen.findByText('SKU GATE-SKU is taken.')).toBeTruthy();
  });

  it('says "saved" and a failed save in the admin language (C-10)', async () => {
    const user = userEvent.setup();
    patchSpy.mockResolvedValue({ data: { ...PRODUCT, status: 'active' }, warnings: [] });
    renderEditor('pl');
    const status = await screen.findByRole('combobox', { name: /^status/i });
    await waitFor(() => expect((status as HTMLSelectElement).value).toBe('inactive'));
    await user.selectOptions(status, 'active');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(String(catalogPl['productEditor.saved']))).toBeTruthy();
    patchSpy.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(String(catalogPl['productEditor.error.save']))).toBeTruthy();
  });

  it('says it in Polish', async () => {
    const user = userEvent.setup();
    patchSpy.mockResolvedValue({
      data: { ...PRODUCT, status: 'active' },
      warnings: [{ kind: 'completeness', channelId: B2C, languageCode: 'de', missing: ['name'] }],
    });
    renderEditor('pl');
    const status = await screen.findByRole('combobox', { name: /^status/i });
    await waitFor(() => expect((status as HTMLSelectElement).value).toBe('inactive'));
    await user.selectOptions(status, 'active');
    // The page's Save button is not translated yet (pre-existing literal).
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const notice = await screen.findByTestId('product-gate-warning');
    expect(notice.textContent).toContain(String(catalogPl['productEditor.scopeControls.missing.name']));
    expect(notice.textContent).toContain('B2C shop · DE');
  });
});

describe('the status in one channel and the completeness gate (US6)', () => {
  function renderControls(): void {
    render(
      wrap(
        <ProductScopeControls
          productId={PRODUCT_ID}
          channels={CONTEXT.channels}
          activeChannelId={B2C}
        />,
      ),
    );
  }

  async function switchChannelOn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status in B2C shop' }), 'active');
    await user.click(screen.getByRole('button', { name: String(catalogEn['productEditor.scopeControls.save']) }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
  }

  it('warn: names what is missing where the change switched the product on', async () => {
    const user = userEvent.setup();
    patchSpy.mockResolvedValue({
      data: SCOPES,
      warnings: [{ kind: 'completeness', channelId: B2C, languageCode: 'de', missing: ['name'] }],
    });
    renderControls();
    await switchChannelOn(user);
    expect(await screen.findByText(/values are missing.*B2C shop · DE: name/i)).toBeTruthy();
  });

  it('nothing missing: no gate message', async () => {
    const user = userEvent.setup();
    patchSpy.mockResolvedValue({ data: SCOPES, warnings: [] });
    renderControls();
    await switchChannelOn(user);
    await waitFor(() => expect(screen.getByText(String(catalogEn['productEditor.scopeControls.saved']))).toBeTruthy());
    expect(screen.queryByText(/values are missing/i)).toBeNull();
  });
});
