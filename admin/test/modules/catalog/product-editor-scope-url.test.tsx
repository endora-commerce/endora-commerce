import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
  CH_VIP,
  PRODUCT_ID,
  api,
  currentSearch,
  defaultRead,
  en,
  renderEditor,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 174 (T092, FR-056, spec *Edge Cases*, `contracts/editor-ui.md` §1) — the URL is the
 * source of truth for the editor scope; the editor preference seeds a URL that names none; a
 * scope the product no longer has opens the nearest valid one and says why.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

const url = (qs: string): string => `/catalog/products/${PRODUCT_ID}${qs}`;

describe('the editor scope in the URL (feature 174, FR-056)', () => {
  it('opens at the scope the URL names, without reading the preference', async () => {
    renderEditor(ProductEditor, { url: url(`?scope=channel&channel=${CH_VIP}`) });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${BASE}/scoped-values?channelId=${CH_VIP}`));
    expect(api.get).not.toHaveBeenCalledWith(`${BASE}/editor-preference`);
  });

  it('a URL without a scope is seeded from the preference and replaced', async () => {
    setUpEditorApi({ preference: { level: 'channel', channelId: CH_VIP } });
    const view = renderEditor(ProductEditor);
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
    expect(currentSearch(view).get('channel')).toBe(CH_VIP);
    expect(api.get).toHaveBeenCalledWith(`${BASE}/editor-preference`);
  });

  it('no preference opens Global', async () => {
    const view = renderEditor(ProductEditor);
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('global'));
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/scope-context'));
  });

  it('a stale scope opens the nearest valid one, with an announcement', async () => {
    setUpEditorApi({
      read: (scope: ScopeRef) => {
        if (scope.level === 'channel_language' && scope.languageCode === 'de-DE') {
          throw new ApiError(422, {
            error: {
              code: 'SCOPE_INVALID',
              message: 'not offered',
              details: { channelId: CH_RETAIL, languageCode: 'de-DE', reason: 'language_not_offered' },
            },
          } as never);
        }
        return defaultRead(scope);
      },
    });
    const view = renderEditor(ProductEditor, { url: url(`?scope=cl&channel=${CH_RETAIL}&language=de-DE`) });
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
    expect(currentSearch(view).get('channel')).toBe(CH_RETAIL);
    const words = en['productEditor.scope.channelAllLanguages']!.replace('{channel}', 'Retail PL');
    await waitFor(() =>
      expect(screen.getByTestId('editor-announcer')).toHaveTextContent(
        en['productEditor.scope.openedAt']!.replace('{scope}', words).replace(
          '{reason}',
          en['productEditor.scope.reason.languageNotOffered']!,
        ),
      ),
    );
  });

  it('a scope change is remembered as the preference', async () => {
    renderEditor(ProductEditor);
    await screen.findByRole('option', { name: 'Retail PL' });
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_RETAIL } });
    await waitFor(
      () =>
        expect(api.put).toHaveBeenCalledWith(`${BASE}/editor-preference`, {
          lastChannelId: CH_RETAIL,
          lastLanguageCode: null,
        }),
      { timeout: 2000 },
    );
  });

  // Issue #1610 — the preference is written 500 ms after a load. Opening at the scope it
  // already holds wrote that same scope back, once per open, and on a slow run the write landed
  // inside the one-Save tests' "nothing else was written" window. Waiting past the debounce
  // makes the old write certain, so these cases are deterministic rather than load-dependent.
  const preferenceWrites = (): unknown[][] => api.put.mock.calls.filter(([path]) => path === `${BASE}/editor-preference`);
  const pastTheDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 700));

  it('opening at the remembered scope does not write it back (#1610)', async () => {
    setUpEditorApi({ preference: { level: 'channel', channelId: CH_VIP } });
    renderEditor(ProductEditor);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${BASE}/scoped-values?channelId=${CH_VIP}`));
    await pastTheDebounce();
    expect(preferenceWrites()).toEqual([]);
  });

  it('opening at Global with no preference stored writes none (#1610)', async () => {
    renderEditor(ProductEditor);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`${BASE}/scoped-values`));
    await pastTheDebounce();
    expect(preferenceWrites()).toEqual([]);
  });

  it('a scope the URL names is still remembered, the preference not having been read', async () => {
    renderEditor(ProductEditor, { url: url(`?scope=channel&channel=${CH_VIP}`) });
    await waitFor(() =>
      expect(preferenceWrites()).toEqual([[`${BASE}/editor-preference`, { lastChannelId: CH_VIP, lastLanguageCode: null }]]),
    );
  });

  it('switching away and back to the remembered scope writes both moves', async () => {
    setUpEditorApi({ preference: { level: 'channel', channelId: CH_VIP } });
    const view = renderEditor(ProductEditor);
    await screen.findByRole('option', { name: 'Retail PL' });
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_RETAIL } });
    await waitFor(() => expect(preferenceWrites()).toHaveLength(1), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(preferenceWrites()).toHaveLength(2), { timeout: 2000 });
    expect(preferenceWrites().map(([, body]) => body)).toEqual([
      { lastChannelId: CH_RETAIL, lastLanguageCode: null },
      { lastChannelId: CH_VIP, lastLanguageCode: null },
    ]);
  });

  it('keeps the tab in the URL across a scope change', async () => {
    const view = renderEditor(ProductEditor, { url: url('?scope=global&tab=media') });
    await screen.findByRole('option', { name: 'B2B VIP' });
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
    expect(currentSearch(view).get('tab')).toBe('media');
  });
});
