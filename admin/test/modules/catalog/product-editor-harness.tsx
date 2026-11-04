import { StrictMode, createElement, type ReactElement, type ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { ScopeRef, ScopedValuesResponse } from '@endora-commerce/contracts';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../../helpers/render-with-session';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { scopedField, scopedValuesResponse } from '../../helpers/scoped-values-fixtures';

/**
 * Feature 172 — the shared rig of the product editor tests: one `apiClient` double that
 * answers `GET …/scoped-values` per scope (parsed from the query), `editor-preference` with
 * `{ data: null }` unless told otherwise, and the lists the editor reads beside them.
 *
 * A test module mocks `@endora-commerce/admin-kit/lib` with {@link api} before importing the
 * editor (see the `product-editor-*.test.tsx` files).
 */

export const PRODUCT_ID = '11111111-1111-4111-8111-111111111170';
export const CH_RETAIL = '00000000-0000-4000-8000-00000000c0a1';
export const CH_VIP = '00000000-0000-4000-8000-00000000c0a2';
export const BASE = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;

export const VALID_SCOPES = {
  channels: [
    { channelId: CH_RETAIL, name: 'Retail PL', languages: [{ code: 'pl-PL', name: 'Polish' }, { code: 'en-US', name: 'English' }] },
    { channelId: CH_VIP, name: 'B2B VIP', languages: [{ code: 'pl-PL', name: 'Polish' }] },
  ],
};

import { api } from './product-editor-api-double';

export { api };

export { scopedField, scopedValuesResponse };

/** The scope a `…/scoped-values` request names. */
export function scopeOfPath(path: string): ScopeRef {
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const channelId = query.get('channelId');
  const languageCode = query.get('languageCode');
  if (channelId && languageCode) return { level: 'channel_language', channelId, languageCode };
  if (channelId) return { level: 'channel', channelId };
  return { level: 'global' };
}

export interface EditorApiOptions {
  /** The answer at a scope; defaults to a plain fixture at that scope with both demo channels. */
  read?: (scope: ScopeRef) => ScopedValuesResponse | Promise<ScopedValuesResponse>;
  preference?: ScopeRef | null;
  /** Extra GET routes, consulted first; return `undefined` to fall through. */
  extra?: (path: string) => unknown;
}

export function defaultRead(scope: ScopeRef): ScopedValuesResponse {
  return scopedValuesResponse({ scope, validScopes: VALID_SCOPES });
}

export function setUpEditorApi(options: EditorApiOptions = {}): void {
  for (const fn of Object.values(api)) fn.mockReset();
  const read = options.read ?? defaultRead;
  api.get.mockImplementation(async (path: string) => {
    const extra = options.extra?.(path);
    if (extra !== undefined) return extra;
    if (path.startsWith(`${BASE}/scoped-values`)) return read(scopeOfPath(path));
    if (path === `${BASE}/editor-preference`) {
      const pref = options.preference ?? null;
      if (!pref) return { data: null };
      return {
        data: {
          productId: PRODUCT_ID,
          adminUserId: '00000000-0000-4000-8000-0000000000ad',
          lastChannelId: pref.level === 'global' ? null : pref.channelId,
          lastLanguageCode: pref.level === 'channel_language' ? pref.languageCode : null,
          updatedAt: '2026-11-03T00:00:00.000Z',
        },
      };
    }
    if (path === '/api/v1/admin/catalog/attribute-sets') return { data: [] };
    if (path.startsWith('/api/v1/admin/catalog/attribute-sets/')) return { data: { attributes: [] } };
    return { data: [] };
  });
  api.put.mockResolvedValue({ data: null });
}

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function currentSearch(container: { getByTestId(id: string): HTMLElement }): URLSearchParams {
  const text = container.getByTestId('location').textContent ?? '';
  return new URLSearchParams(text.split('?')[1] ?? '');
}

export function renderEditor(
  editor: () => ReactNode,
  options: { url?: string; permissions?: readonly string[]; contributions?: Parameters<typeof withSession>[1]['contributions'] } = {},
): RenderResult {
  return render(
    <StrictMode>
      <TranslationProvider
        language="en"
        initialBundle={{ catalog: catalogEn as Record<string, string>, ...shippedCoreBundle('en') }}
      >
        {withSession(
          <MemoryRouter initialEntries={[options.url ?? `/catalog/products/${PRODUCT_ID}`]}>
            <Routes>
              <Route
                path="/catalog/products/:id"
                element={
                  <>
                    {createElement(editor)}
                    <LocationProbe />
                  </>
                }
              />
              <Route path="/catalog/products" element={<p>product list</p>} />
            </Routes>
          </MemoryRouter>,
          {
            session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
            presence: modulePresence({ present: everyDeclaredModule() }),
            ...(options.contributions ? { contributions: options.contributions } : {}),
          },
        )}
      </TranslationProvider>
    </StrictMode>,
  );
}

export const en = catalogEn as Record<string, string>;
