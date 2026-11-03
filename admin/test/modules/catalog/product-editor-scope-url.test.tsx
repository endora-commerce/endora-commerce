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
 * Feature 170 (T092, FR-056, spec *Edge Cases*, `contracts/editor-ui.md` §1) — the URL is the
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

describe('the editor scope in the URL (feature 170, FR-056)', () => {
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

  it('keeps the tab in the URL across a scope change', async () => {
    const view = renderEditor(ProductEditor, { url: url('?scope=global&tab=media') });
    await screen.findByRole('option', { name: 'B2B VIP' });
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
    expect(currentSearch(view).get('tab')).toBe('media');
  });
});
