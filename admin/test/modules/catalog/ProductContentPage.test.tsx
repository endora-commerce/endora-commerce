import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-021, FR-023,
 * FR-025, contracts/admin-surfaces.md §3) — the product content screen, where
 * an operator authors one content attribute's Page Builder document per
 * language for one product.
 *
 * `catalog` owns the document, the draft and the save, and no editor: the
 * canvas is whatever contributes to `product.content.editor` (on a composed
 * platform, `cms`). The subject is the host's half — which document it hands
 * the zone, what it sends back, and what it shows without an editor. The
 * contribution is a stub; `cms`' real declaration is asserted in
 * `admin/test/modules/cms/product-content-zone.test.tsx`.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProductContentPage } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/ProductContentPage'
);

const PRODUCT_ID = '44444444-4444-4444-8444-444444444404';
const KEY = 'buying_guide';
const CONTENT_PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}/content/${KEY}`;

const tree = (marker: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'cms.RichContent', props: { id: marker, html: `<p>${marker}</p>` } }],
});

const PASSTHROUGH = passthroughBundle('catalog', [
  'productContent.page.description',
  'productContent.action.back',
  'productContent.action.save',
  'productContent.action.saving',
  'productContent.success.save',
  'productContent.error.load',
  'productContent.error.save',
  'productContent.error.notAvailable',
  'productContent.loading',
  'productContent.editor.title',
  'productContent.noEditor.title',
  'productContent.noEditor.description',
  'productContent.readOnly',
]);
const BUNDLE = {
  catalog: {
    ...PASSTHROUGH['catalog'],
    'productContent.page.title': '{attribute} — {product}',
  },
};

function EditorStub({ language, data, onChange }: AdminZoneProps<'product.content.editor'>): React.ReactNode {
  return (
    <div data-testid="editor-stub">
      <span data-testid="editor-language">{language}</span>
      <span data-testid="editor-data">{JSON.stringify(data)}</span>
      <button type="button" onClick={(): void => onChange(tree(`edited-${language}`))}>
        stub-edit
      </button>
    </div>
  );
}

const EDITOR_CONTRIBUTION = {
  moduleId: 'cms',
  contributions: {
    zones: [
      {
        zone: 'product.content.editor' as const,
        weight: 100,
        requiredPermission: 'cms.read',
        component: async () => ({ default: EditorStub as never }),
      },
    ],
  },
};

function renderPage(options: {
  readonly contributions?: readonly (typeof EDITOR_CONTRIBUTION)[];
  readonly permissions?: readonly string[];
  readonly absent?: readonly string[];
}): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}/content/${KEY}`]}>
      <Routes>
        <Route path="/catalog/products/:id/content/:attributeKey" element={<ProductContentPage />} />
        <Route path="/catalog/products/:id" element={<p>product editor</p>} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
      presence: modulePresence({
        present: everyDeclaredModule().filter((id) => !(options.absent ?? []).includes(id)),
        absent: [...(options.absent ?? [])],
      }),
      contributions: options.contributions ?? [EDITOR_CONTRIBUTION],
      bundle: BUNDLE,
    },
  );
}

function stubApi(content: { languages: Record<string, unknown> } | null): void {
  getSpy.mockImplementation(async (path: string) => {
    if (path === CONTENT_PATH) return { data: { productId: PRODUCT_ID, attributeKey: KEY, content } };
    if (path === `/api/v1/admin/catalog/products/${PRODUCT_ID}/content`) {
      return {
        data: {
          productId: PRODUCT_ID,
          attributeSetId: '55555555-5555-4555-8555-555555555505',
          attributes: [
            {
              attributeId: '66666666-6666-4666-8666-666666666606',
              key: KEY,
              label: { 'en-US': 'Buying guide', 'pl-PL': 'Poradnik zakupowy' },
              labelDefault: 'Buying guide',
              position: 0,
              languages: [],
            },
          ],
        },
      };
    }
    if (path === `/api/v1/admin/catalog/products/${PRODUCT_ID}`) {
      return { data: { id: PRODUCT_ID, name: { 'en-US': 'Cordless drill', 'pl-PL': 'Wiertarka' } } };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  putSpy.mockImplementation(async (_path: string, body: { content: unknown }) => ({
    data: { productId: PRODUCT_ID, attributeKey: KEY, content: body.content },
  }));
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

describe('ProductContentPage (feature 172)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    putSpy.mockReset();
    confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);
  });
  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('names the attribute and the product, and hands the editor the stored document', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({});
    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('en-US'));
    expect(screen.getByTestId('editor-data').textContent).toContain('stored-en');
    expect(screen.getByText('Buying guide — Cordless drill')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'productContent.action.back' }).getAttribute('href')).toBe(
      `/catalog/products/${PRODUCT_ID}?tab=attributes`,
    );
  });

  it('offers en-US, pl-PL and a language only the stored content carries (FR-021)', async () => {
    stubApi({ languages: { 'de-DE': tree('stored-de') } });
    renderPage({});
    await waitFor(() => expect(screen.getByRole('tab', { name: 'de-DE' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'en-US' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'pl-PL' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'de-DE' }));
    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('de-DE'));
    expect(screen.getByTestId('editor-data').textContent).toContain('stored-de');
  });

  it('saves every edited language in one PUT, and only on Save (FR-021, FR-025)', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({});
    await waitFor(() => expect(screen.getByText('stub-edit')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-edit'));
    fireEvent.click(screen.getByRole('tab', { name: 'pl-PL' }));
    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('pl-PL'));
    // A canvas edit — Translate's result among them — is a draft until Save.
    fireEvent.click(screen.getByText('stub-edit'));
    expect(putSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'productContent.action.save' }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(CONTENT_PATH, {
      content: { languages: { 'en-US': tree('edited-en-US'), 'pl-PL': tree('edited-pl-PL') } },
    });
    await waitFor(() => expect(screen.getByText('productContent.success.save')).toBeTruthy());
  });

  it('asks before leaving with unsaved edits (US2 #4)', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({});
    await waitFor(() => expect(screen.getByText('stub-edit')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-edit'));
    fireEvent.click(screen.getByRole('link', { name: 'productContent.action.back' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('product editor')).toBeNull();
  });

  it('is read-only without catalog:write: no Save (FR-023, US2 #5)', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({ permissions: ['catalog:read', 'cms.read'] });
    await waitFor(() => expect(screen.getByTestId('editor-stub')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'productContent.action.save' })).toBeNull();
    expect(screen.getByText('productContent.readOnly')).toBeTruthy();
  });

  it('says the content is not available, with the way back, on a 404', async () => {
    getSpy.mockImplementation(async (path: string) => {
      if (path === CONTENT_PATH) {
        throw new ApiError(404, { error: { code: 'NOT_FOUND', message: 'not a member', requestId: 'r' } });
      }
      return { data: { id: PRODUCT_ID, name: { 'en-US': 'Cordless drill' }, attributes: [] } };
    });
    renderPage({});
    await waitFor(() => expect(screen.getByText('productContent.error.notAvailable')).toBeTruthy());
    expect(screen.queryByTestId('editor-stub')).toBeNull();
    expect(screen.getByRole('link', { name: 'productContent.action.back' })).toBeTruthy();
  });

  it('explains itself, and offers no editor and no Save, when nothing contributes a Page Builder', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({ contributions: [] });
    await waitFor(() => expect(screen.getByText('productContent.noEditor.title')).toBeTruthy());
    expect(screen.queryByTestId('editor-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: 'productContent.action.save' })).toBeNull();
  });

  // FR-050, spec edge case — the CMS switched off, or an operator without the
  // CMS read code: the zone has no member, and the screen says so.
  for (const [label, options] of [
    ['the CMS is off', { absent: ['cms'] }],
    ['the operator lacks the CMS read code', { permissions: ['catalog:read', 'catalog:write'] }],
  ] as const) {
    it(`shows the no-editor notice, no canvas and no Save when ${label} (FR-050)`, async () => {
      stubApi({ languages: { 'en-US': tree('stored-en') } });
      renderPage(options);
      await waitFor(() => expect(screen.getByText('productContent.noEditor.title')).toBeTruthy());
      expect(screen.getByText('productContent.noEditor.description')).toBeTruthy();
      expect(screen.queryByTestId('editor-stub')).toBeNull();
      expect(screen.queryByRole('button', { name: 'productContent.action.save' })).toBeNull();
    });
  }

  it('names no Page Builder owner in its own source', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/catalog/src/admin/pages/ProductContentPage.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/mod-cms|module:\s*'cms'|@puckeditor/);
  });
});
