import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import seoPl from '../../../../packages/modules/seo/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T126, reduced by feature 174 (T126, FR-094) — the SEO screen's meta editor
 * now addresses categories (and CMS pages) by language only. Its product mode (channel ×
 * language over catalog's retired `scope-context`) is gone: a product's SEO is edited in the
 * product editor (`product-seo-section.test.tsx`), and the SEO screen links there
 * (`seo-screen-product-link.test.tsx`).
 */

const getSpy = vi.fn();
const putSpy = vi.fn();
const deleteSpy = vi.fn();

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
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { SeoMetaScopeEditor } = await import(
  '../../../../packages/modules/seo/src/admin/pages/SeoMetaScopeEditor'
);

const CATEGORY_ID = '00000000-0000-4000-8000-0000000000e1';

function metaAnswer(override: Record<string, string | null> | null) {
  return {
    data: {
      resolved: {
        title: 'Category title',
        description: 'Category description',
        openGraph: { title: 'Category title', description: 'Category description', image: null },
        source: 'rule',
        locale: 'en-US',
      },
      override,
    },
  };
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/seo/meta/')) return Promise.resolve(metaAnswer(null));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  putSpy.mockResolvedValue({ data: {} });
  deleteSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const seo = (language === 'en' ? seoEn : seoPl) as Record<string, string>;
  const core = (language === 'en' ? coreEn : corePl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ seo, core }}>
          {withSession(ui, { session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }) })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

describe('SeoMetaScopeEditor — a category override per language', () => {
  it('keeps a category on the language row: no channel selector, the locale as before', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="category" entityId={CATEGORY_ID} />));
    await screen.findByRole('button', { name: /^load$/i });
    expect(screen.queryByRole('combobox', { name: /sales channel/i })).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('scope-context'));
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/seo/meta/category/${CATEGORY_ID}?locale=en-US`),
    );
  });

  it('encodes the entity id into the meta path, so an id cannot address another admin route (S-M1)', async () => {
    getSpy.mockImplementation(() => Promise.resolve(metaAnswer(null)));
    render(wrap(<SeoMetaScopeEditor entityType="category" entityId="../../platform/modules" />));
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/seo/meta/category/..%2F..%2Fplatform%2Fmodules?locale=en-US'),
    );
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/category/../'));
  });

  it('renders in Polish from the Polish bundles', async () => {
    render(wrap(<SeoMetaScopeEditor entityType="category" entityId={CATEGORY_ID} />, 'pl'));
    expect(await screen.findByLabelText(seoPl['metaScope.language'])).toBeInTheDocument();
  });
});
