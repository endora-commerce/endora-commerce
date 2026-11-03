import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 170 (T148; FR-094, US10 #5) — the SEO screen edits categories (and CMS pages); a
 * product shows only a link to its SEO tab in the product editor, where SEO is edited at the
 * editor scope. The 163 deep link (`?entityType=product&entityId=…`, UX-4 = A) still selects
 * the product, and an id that is not a UUID is still ignored (S-M1).
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
  };
});

const { SeoPage } = await import('../../../../packages/modules/seo/src/admin/pages/SeoPage');

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const CATEGORY_ID = '00000000-0000-4000-8000-0000000000c1';

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith(`/api/v1/admin/seo/meta/category/${CATEGORY_ID}`)) {
      return Promise.resolve({
        data: {
          resolved: { title: 'Tools', description: '', openGraph: { title: 'Tools', description: '', image: null }, source: 'rule', locale: 'en-US' },
          override: null,
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => cleanup());

function renderAt(url: string): void {
  const page: ReactElement = (
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => undefined }}>
          <TranslationProvider
            language="en"
            initialBundle={{ seo: seoEn as Record<string, string>, core: coreEn as Record<string, string> }}
          >
            {withSession(<SeoPage />, { session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }) })}
          </TranslationProvider>
        </AppLanguageContext.Provider>
      </MemoryRouter>
    </StrictMode>
  );
  render(page);
}

describe('the SEO screen and products (feature 170, FR-094)', () => {
  it('a product shows only a link to its SEO tab in the product editor', async () => {
    renderAt(`/seo?entityType=product&entityId=${PRODUCT_ID}`);
    const link = await screen.findByRole('link', { name: seoEn['productLink.editInEditor'] });
    expect(link).toHaveAttribute('href', `/catalog/products/${PRODUCT_ID}?tab=seo`);
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/seo/meta/product/'));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/scope-context'));
  });

  it('a category is still edited here', async () => {
    renderAt(`/seo?entityType=category&entityId=${CATEGORY_ID}`);
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/admin/seo/meta/category/${CATEGORY_ID}?`)));
    expect(screen.queryByRole('link', { name: seoEn['productLink.editInEditor'] })).toBeNull();
  });

  it('opens with nothing selected without the parameters', async () => {
    renderAt('/seo');
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/seo/meta/'));
  });

  it('ignores an entity type it does not know', async () => {
    renderAt(`/seo?entityType=order&entityId=${PRODUCT_ID}`);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/seo/meta/order/'));
  });

  // Final security review S-M1: the address is attacker-controllable, so an id that is not
  // a UUID is ignored outright — nothing is selected and no request or link is made for it.
  it.each([
    ['a path climbing out of the meta route', '../../platform/modules'],
    ['an encoded path climbing out of the meta route', '..%2F..%2Fsettings'],
    ['a UUID followed by a path', `${PRODUCT_ID}/../../orders`],
    ['a non-UUID token', 'not-a-product'],
  ])('ignores an entity id that is not a UUID: %s', async (_label, entityId) => {
    renderAt(`/seo?entityType=category&entityId=${encodeURIComponent(entityId)}`);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/seo/meta/'));
  });
});
