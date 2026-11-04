import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef, ScopedValuesResponse } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
  CH_VIP,
  VALID_SCOPES,
  api,
  currentSearch,
  defaultRead,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 172 (T091, US5 #1–#6; FR-050…FR-055, FR-057, SC-006) — one switcher sets the scope
 * of the whole editor: a channel select and a language select (by name), the scope in words, a
 * banner announced through a live region that is mounted empty, `aria-busy` while a scope
 * loads, and no other scope selector anywhere in the editor.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

function banner(): HTMLElement {
  return screen.getByTestId('scope-banner-live');
}

describe('the scope switcher (feature 172, US5)', () => {
  it('opens at Global: the channel select lists the member channels, the language select waits for a channel', async () => {
    renderEditor(ProductEditor);
    await screen.findByRole('option', { name: 'Retail PL' });
    const channel = screen.getByLabelText(en['productEditor.scope.channelSelect']!);
    const options = within(channel).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([en['productEditor.scope.allChannels'], 'Retail PL', 'B2B VIP']);
    const language = screen.getByLabelText(en['productEditor.scope.languageSelect']!);
    expect(language).toBeDisabled();
    expect(screen.getByText(en['productEditor.scope.pickChannelFirst']!)).toBeInTheDocument();
    expect(screen.getByTestId('scope-words')).toHaveTextContent(en['productEditor.scope.global']!);
    // The banner is empty at Global; the editor announces the scope after its data loads.
    expect(banner()).toBeEmptyDOMElement();
  });

  it('picking a channel reads that scope once, puts it in the URL and announces the banner', async () => {
    const view = renderEditor(ProductEditor);
    await screen.findByRole('option', { name: 'Retail PL' });
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_RETAIL } });
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
    expect(currentSearch(view).get('channel')).toBe(CH_RETAIL);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(`${BASE}/scoped-values?channelId=${CH_RETAIL}`),
    );
    const words = en['productEditor.scope.channelAllLanguages']!.replace('{channel}', 'Retail PL');
    await waitFor(() => expect(banner()).toHaveTextContent(en['productEditor.scope.banner']!.replace('{scope}', words)));
  });

  it('names languages, not codes, and a language makes the scope Channel × language', async () => {
    const view = renderEditor(ProductEditor, { url: `/catalog/products/11111111-1111-4111-8111-111111111170?scope=channel&channel=${CH_RETAIL}` });
    const language = await screen.findByLabelText(en['productEditor.scope.languageSelect']!);
    await waitFor(() => expect(language).not.toBeDisabled());
    expect(within(language).getAllByRole('option').map((o) => o.textContent)).toEqual([
      en['productEditor.scope.allLanguages'],
      'Polish',
      'English',
    ]);
    fireEvent.change(language, { target: { value: 'pl-PL' } });
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('cl'));
    expect(currentSearch(view).get('language')).toBe('pl-PL');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(`${BASE}/scoped-values?channelId=${CH_RETAIL}&languageCode=pl-PL`),
    );
  });

  it('a channel that does not offer the chosen language falls back to all languages and says so', async () => {
    const view = renderEditor(ProductEditor, {
      url: `/catalog/products/11111111-1111-4111-8111-111111111170?scope=cl&channel=${CH_RETAIL}&language=en-US`,
    });
    const channel = await screen.findByLabelText(en['productEditor.scope.channelSelect']!);
    await waitFor(() => expect(channel).toHaveValue(CH_RETAIL));
    fireEvent.change(channel, { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
    expect(currentSearch(view).get('channel')).toBe(CH_VIP);
    await waitFor(() => expect(screen.getByTestId('editor-announcer')).toHaveTextContent('B2B VIP'));
  });

  it('marks the panel busy while a scope loads and never shows the previous scope’s value as current (FR-057)', async () => {
    let release: (value: ScopedValuesResponse) => void = () => undefined;
    setUpEditorApi({
      read: (scope: ScopeRef) =>
        scope.level === 'global'
          ? scopedValuesResponse({ scope, validScopes: VALID_SCOPES, fields: { name: scopedField('Global name', { required: true }) } })
          : new Promise<ScopedValuesResponse>((resolve) => {
              release = resolve;
            }),
    });
    renderEditor(ProductEditor);
    expect(await screen.findByDisplayValue('Global name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByDisplayValue('Global name')).toBeNull();
    await act(async () => {
      release(
        scopedValuesResponse({
          scope: { level: 'channel', channelId: CH_VIP },
          validScopes: VALID_SCOPES,
          fields: { name: scopedField('VIP name', { source: 'set', ownValue: 'VIP name', required: true }) },
        }),
      );
    });
    expect(await screen.findByDisplayValue('VIP name')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
  });

  it('uses a searchable combobox past eight channel options (FR-055)', async () => {
    const channels = Array.from({ length: 9 }, (_, i) => ({
      channelId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
      name: `Channel ${i + 1}`,
      languages: [{ code: 'pl-PL', name: 'Polish' }],
    }));
    setUpEditorApi({ read: (scope) => scopedValuesResponse({ scope, validScopes: { channels } }) });
    renderEditor(ProductEditor);
    await waitFor(() => expect(screen.getByLabelText(en['productEditor.scope.channelSelect']!).tagName).toBe('INPUT'));
  });

  it('says a product in no channel can only be edited at Global', async () => {
    setUpEditorApi({ read: (scope) => scopedValuesResponse({ scope, validScopes: { channels: [] } }) });
    renderEditor(ProductEditor);
    expect(await screen.findByText(en['productEditor.scope.noChannels']!)).toBeInTheDocument();
  });

  it('is the only scope selector in the editor (SC-006)', async () => {
    setUpEditorApi({ read: defaultRead });
    renderEditor(ProductEditor, { url: `/catalog/products/11111111-1111-4111-8111-111111111170?tab=media` });
    await screen.findByLabelText(en['productEditor.scope.channelSelect']!);
    expect(screen.getAllByLabelText(/sales channel|^scope$/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/^language$/i)).toHaveLength(1);
  });
});
