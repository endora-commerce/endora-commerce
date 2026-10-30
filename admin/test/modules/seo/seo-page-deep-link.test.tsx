import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 — owner decision UX-4 = A (2026-10-26): the SEO screen opens with a product
 * selected when its address names one (`?entityType=product&entityId=<id>`), which is
 * where the product editor's SEO link points. Without the parameters it opens as before,
 * with nothing selected.
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
const CONTEXT_PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}/scope-context`;

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === CONTEXT_PATH) {
      return Promise.resolve({
        data: { productId: PRODUCT_ID, channels: [], languagesUnion: [], primaryAdminLanguage: 'en', preference: null },
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

describe('the SEO screen opens on the product its address names (UX-4 = A)', () => {
  it('selects the product and opens its meta editor', async () => {
    renderAt(`/seo?entityType=product&entityId=${PRODUCT_ID}`);
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(CONTEXT_PATH));
  });

  it('opens with nothing selected without the parameters', async () => {
    renderAt('/seo');
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/scope-context'));
  });

  it('ignores an entity type it does not know', async () => {
    renderAt(`/seo?entityType=order&entityId=${PRODUCT_ID}`);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/scope-context'));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/seo/meta/order/'));
  });

  // Final security review S-M1: the address is attacker-controllable, so an id that is not
  // a UUID is ignored outright — nothing is selected and no request is sent for it.
  it.each([
    ['a path climbing out of the meta route', '../../platform/modules'],
    ['an encoded path climbing out of the meta route', '..%2F..%2Fsettings'],
    ['a UUID followed by a path', `${PRODUCT_ID}/../../orders`],
    ['a non-UUID token', 'not-a-product'],
  ])('ignores an entity id that is not a UUID: %s', async (_label, entityId) => {
    renderAt(`/seo?entityType=product&entityId=${encodeURIComponent(entityId)}`);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/scope-context'));
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/seo/meta/'));
  });
});
