import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { ProductUrlKeysResponse } from '@endora-commerce/contracts';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T125 (US7, FR-071, FR-072, Q-C) — the product editor's URL-keys panel:
 * the global key, one key per language with "use inherited", channel × language
 * overrides added from the product's member channels (orphans removable), the effective
 * URL per (channel, language) exactly as the response carries it, the redirect list only
 * while the response carries `redirects`, and the two refusals a save can meet — a key
 * another product holds (`URL_KEY_TAKEN`, naming the holder) and a redirect another
 * product would lose (the takeover confirmation, naming the loser, retried with
 * `confirmTakeover`).
 *
 * Rendered inside `<StrictMode>` with the catalogue's real `en` and `pl` bundles, so a key
 * missing in either file fails here.
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

const { ProductUrlKeysPanel } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductUrlKeysPanel'
);
const { urlKeysChanges } = await import('../../../../packages/modules/catalog/src/admin/lib/product-url-keys-api');

type UrlKeys = ProductUrlKeysResponse['data'];

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const OLD = '00000000-0000-4000-8000-00000000c003';
const R_DE = '00000000-0000-4000-8000-0000000000d1';
const R_ALL = '00000000-0000-4000-8000-0000000000d2';
const LOSER = '00000000-0000-4000-8000-0000000000b8';
const HOLDER = '00000000-0000-4000-8000-0000000000b9';
const BASE = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;
const URL_KEYS_PATH = `${BASE}/url-keys`;
const CONTEXT_PATH = `${BASE}/scope-context`;

function urlKeysFixture(overrides: Partial<UrlKeys> = {}): UrlKeys {
  return {
    globalKey: 'drill',
    languageKeys: [{ languageCode: 'de', key: 'bohrer' }],
    channelKeys: [
      { channelId: B2B, languageCode: 'en', key: 'drill-pro', orphaned: false },
      { channelId: OLD, languageCode: 'pl', key: 'wiertarka-outlet', orphaned: true },
    ],
    effective: [
      { channelId: B2B, languageCode: 'de', key: 'bohrer', source: 'language', url: '/p/bohrer?lang=de' },
      { channelId: B2B, languageCode: 'en', key: 'drill-pro', source: 'channel_language', url: '/p/drill-pro' },
      { channelId: B2C, languageCode: 'pl', key: 'drill', source: 'global', url: '/p/drill' },
    ],
    redirects: [
      { id: R_DE, languageCode: 'de', key: 'alter-bohrer', createdAt: '2026-10-01T10:00:00.000Z' },
      { id: R_ALL, languageCode: null, key: 'old-drill', createdAt: '2026-09-01T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

const scopeContext = {
  productId: PRODUCT_ID,
  channels: [
    { id: B2B, code: 'b2b', name: 'B2B shop', languages: ['de', 'en'], isDefault: true },
    { id: B2C, code: 'b2c', name: 'B2C shop', languages: ['pl'], isDefault: false },
  ],
  languagesUnion: ['de', 'en', 'pl'],
  primaryAdminLanguage: 'en',
  preference: null,
};

function serve(keys: () => UrlKeys = urlKeysFixture): void {
  getSpy.mockImplementation((path: string) => {
    if (path === URL_KEYS_PATH) return Promise.resolve({ data: keys() });
    if (path === CONTEXT_PATH) return Promise.resolve({ data: scopeContext });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function wrap(
  ui: ReactElement,
  options: { permissions?: readonly string[]; language?: 'en' | 'pl' } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ catalog }}>
          {withSession(ui, {
            session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
          })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

async function renderPanel(
  options: { permissions?: readonly string[]; language?: 'en' | 'pl' } = {},
): Promise<HTMLElement> {
  render(wrap(<ProductUrlKeysPanel productId={PRODUCT_ID} />, options));
  return screen.findByRole('region', { name: /^url keys$/i });
}

function takeoverError(takeovers: Array<{ languageCode: string | null; key: string; losingProductName: string }>): ApiError {
  return new ApiError(409, {
    error: {
      code: 'URL_KEY_REDIRECT_TAKEOVER_REQUIRED',
      message: 'Takeover required.',
      details: { takeovers: takeovers.map((t) => ({ ...t, losingProductId: LOSER })) },
    },
  });
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  deleteSpy.mockReset();
  serve();
  putSpy.mockResolvedValue({ data: urlKeysFixture() });
  deleteSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('urlKeysChanges — what a save sends', () => {
  it('sends nothing when nothing changed', () => {
    const saved = urlKeysFixture();
    expect(
      urlKeysChanges(saved, {
        globalKey: 'drill',
        languageKeys: { de: 'bohrer' },
        channelKeys: [
          { channelId: B2B, languageCode: 'en', key: 'drill-pro' },
          { channelId: OLD, languageCode: 'pl', key: 'wiertarka-outlet' },
        ],
      }),
    ).toBeNull();
  });

  it('trims and lower-cases, sends null for "use inherited", and names only what changed', () => {
    const saved = urlKeysFixture();
    expect(
      urlKeysChanges(saved, {
        globalKey: '  Drill-2 ',
        languageKeys: { de: '', en: ' Drill-EN ' },
        channelKeys: [
          { channelId: B2B, languageCode: 'en', key: 'drill-pro' },
          { channelId: B2C, languageCode: 'pl', key: 'Wiertarka' },
        ],
      }),
    ).toEqual({
      globalKey: 'drill-2',
      languageKeys: [
        { languageCode: 'de', key: null },
        { languageCode: 'en', key: 'drill-en' },
      ],
      channelKeys: [
        { channelId: OLD, languageCode: 'pl', key: null },
        { channelId: B2C, languageCode: 'pl', key: 'wiertarka' },
      ],
    });
  });
});

describe('ProductUrlKeysPanel', () => {
  it('shows the global key, one row per language with the inherited key as placeholder, and the overrides', async () => {
    const panel = await renderPanel();
    expect(within(panel).getByRole('textbox', { name: /^global url key$/i })).toHaveValue('drill');
    const de = within(panel).getByRole('textbox', { name: /^url key in de$/i });
    expect(de).toHaveValue('bohrer');
    const en = within(panel).getByRole('textbox', { name: /^url key in en$/i });
    expect(en).toHaveValue('');
    expect(en).toHaveAttribute('placeholder', 'drill');
    expect(within(panel).getByRole('textbox', { name: /^url key in b2b shop · en$/i })).toHaveValue('drill-pro');
    // An orphan is shown as no longer applying, and can be removed.
    expect(within(panel).getByText(/no longer applies/i)).toBeInTheDocument();
  });

  it('shows each effective URL exactly as the response carries it, with its channel and source', async () => {
    const panel = await renderPanel();
    const table = within(panel).getByRole('table', { name: /effective urls/i });
    const deRow = within(table).getByText('/p/bohrer?lang=de').closest('tr') as HTMLElement;
    expect(within(deRow).getByText('B2B shop')).toBeInTheDocument();
    expect(within(deRow).getByText(/language key/i)).toBeInTheDocument();
    const plRow = within(table).getByText('/p/drill').closest('tr') as HTMLElement;
    expect(within(plRow).getByText('B2C shop')).toBeInTheDocument();
    expect(within(plRow).getByText(/global key/i)).toBeInTheDocument();
  });

  it('saves the changed keys only: "use inherited", a new channel × language key and a removed orphan', async () => {
    const user = userEvent.setup();
    const panel = await renderPanel();
    const global = within(panel).getByRole('textbox', { name: /^global url key$/i });
    await user.clear(global);
    await user.type(global, 'Drill-2');
    await user.click(within(panel).getByRole('button', { name: /use inherited for de$/i }));
    await user.selectOptions(within(panel).getByRole('combobox', { name: /add a channel key/i }), `${B2C}|pl`);
    await user.click(within(panel).getByRole('button', { name: /^add key$/i }));
    await user.type(within(panel).getByRole('textbox', { name: /^url key in b2c shop · pl$/i }), 'wiertarka');
    await user.click(within(panel).getByRole('button', { name: /remove the key wiertarka-outlet, which no longer applies/i }));
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [path, body] = putSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(URL_KEYS_PATH);
    expect(body).toEqual({
      globalKey: 'drill-2',
      languageKeys: [{ languageCode: 'de', key: null }],
      channelKeys: [
        { channelId: OLD, languageCode: 'pl', key: null },
        { channelId: B2C, languageCode: 'pl', key: 'wiertarka' },
      ],
    });
    expect(await within(panel).findByRole('status')).toHaveTextContent(/url keys saved/i);
  });

  it('names the product that holds a taken key, and saves nothing', async () => {
    const user = userEvent.setup();
    putSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'URL_KEY_TAKEN',
          message: 'Taken.',
          details: { conflicts: [{ languageCode: 'de', key: 'hammer', heldByProductId: HOLDER, heldByProductName: 'Hammer X' }] },
        },
      }),
    );
    const panel = await renderPanel();
    const de = within(panel).getByRole('textbox', { name: /^url key in de$/i });
    await user.clear(de);
    await user.type(de, 'hammer');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent('hammer (DE) belongs to Hammer X');
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('asks before taking over another product’s redirect, names the loser, and retries with confirmTakeover', async () => {
    const user = userEvent.setup();
    putSpy
      .mockRejectedValueOnce(takeoverError([{ languageCode: 'de', key: 'bohrer-neu', losingProductName: 'Old drill' }]))
      .mockResolvedValueOnce({ data: urlKeysFixture() });
    const panel = await renderPanel();
    const de = within(panel).getByRole('textbox', { name: /^url key in de$/i });
    await user.clear(de);
    await user.type(de, 'bohrer-neu');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Old drill');
    expect(dialog).toHaveTextContent('bohrer-neu (DE)');
    await user.click(within(dialog).getByRole('button', { name: /take over and save/i }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    const [, retry] = putSpy.mock.calls[1] as [string, Record<string, unknown>];
    expect(retry).toEqual({
      languageKeys: [{ languageCode: 'de', key: 'bohrer-neu' }],
      confirmTakeover: [{ languageCode: 'de', key: 'bohrer-neu' }],
    });
  });

  it('a confirmed takeover refused again re-opens the dialog with the new list (C-4)', async () => {
    const user = userEvent.setup();
    putSpy
      .mockRejectedValueOnce(takeoverError([{ languageCode: 'de', key: 'bohrer-neu', losingProductName: 'Old drill' }]))
      .mockRejectedValueOnce(
        takeoverError([
          { languageCode: 'de', key: 'bohrer-neu', losingProductName: 'Old drill' },
          { languageCode: 'de', key: 'bohrer-neu', losingProductName: 'Older drill' },
        ]),
      );
    const panel = await renderPanel();
    const de = within(panel).getByRole('textbox', { name: /^url key in de$/i });
    await user.clear(de);
    await user.type(de, 'bohrer-neu');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /take over and save/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    const again = await screen.findByRole('dialog');
    await waitFor(() => expect(again).toHaveTextContent('Older drill'));
    expect(within(panel).queryByText(/could not be saved/i)).toBeNull();
  });

  it('refuses a key the grammar refuses before sending it, marking the field (C-6b, D10)', async () => {
    const user = userEvent.setup();
    const panel = await renderPanel();
    const global = within(panel).getByRole('textbox', { name: /^global url key$/i });
    await user.clear(global);
    await user.type(global, 'bad key!');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));
    const error = await within(panel).findByText(/bad key! is not a valid url key/i);
    expect(putSpy).not.toHaveBeenCalled();
    expect(global).toHaveAttribute('aria-invalid', 'true');
    expect(global.getAttribute('aria-describedby')).toContain(error.closest('[id]')!.id);
  });

  it('shows the keys when the channel context cannot be read, naming channels generically and offering no new scope (C-3)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === URL_KEYS_PATH) return Promise.resolve({ data: urlKeysFixture() });
      if (path === CONTEXT_PATH) return Promise.reject(new Error('down'));
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    const panel = await renderPanel();
    expect(await within(panel).findByRole('textbox', { name: /^global url key$/i })).toHaveValue('drill');
    expect(within(panel).getByRole('textbox', { name: /^url key in de$/i })).toHaveValue('bohrer');
    expect(within(panel).getAllByText(/a channel the product left/i).length).toBeGreaterThan(0);
    expect(within(panel).queryByRole('combobox', { name: /add a channel key/i })).toBeNull();
  });

  it('shows the inherited key as visible text, not only as a placeholder (D9)', async () => {
    const panel = await renderPanel();
    const en = within(panel).getByRole('textbox', { name: /^url key in en$/i });
    const hint = document.getElementById(en.getAttribute('aria-describedby') ?? '');
    expect(hint).toHaveTextContent('Inherited: drill');
  });

  it('says when edits are not saved yet, and why Save is disabled when there are none (D10)', async () => {
    const user = userEvent.setup();
    const panel = await renderPanel();
    const save = within(panel).getByRole('button', { name: /^save url keys$/i });
    expect(save).toBeDisabled();
    expect(document.getElementById(save.getAttribute('aria-describedby') ?? '')).toHaveTextContent(/no changes to save/i);
    await user.click(within(panel).getByRole('button', { name: /^use inherited for de$/i }));
    expect(within(panel).getByText(/not saved yet/i)).toBeInTheDocument();
    expect(save).not.toBeDisabled();
  });

  it('names its sections with headings under the panel title (D10)', async () => {
    const panel = await renderPanel();
    expect(within(panel).getByRole('heading', { level: 4, name: /^per language$/i })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 4, name: /^per sales channel and language$/i })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 4, name: /^effective urls$/i })).toBeInTheDocument();
  });

  it('says the losing product loses a former global redirect in every language', async () => {
    const user = userEvent.setup();
    putSpy.mockRejectedValueOnce(takeoverError([{ languageCode: null, key: 'classic', losingProductName: 'Old drill' }]));
    const panel = await renderPanel();
    const global = within(panel).getByRole('textbox', { name: /^global url key$/i });
    await user.clear(global);
    await user.type(global, 'classic');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/old drill loses .*in every language/i);
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('lists the redirects and deletes one after a confirmation', async () => {
    const user = userEvent.setup();
    const panel = await renderPanel();
    const list = within(panel).getByRole('list', { name: /redirects/i });
    expect(within(list).getByText('alter-bohrer (DE)')).toBeInTheDocument();
    expect(within(list).getByText('old-drill (every language)')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /delete the redirect alter-bohrer/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete redirect$/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${BASE}/url-redirects/${R_DE}`));
    await waitFor(() => expect(getSpy.mock.calls.filter(([p]) => p === URL_KEYS_PATH).length).toBeGreaterThan(1));
  });

  it('with seo off (no `redirects`) shows no redirect list, note or affordance, yet still asks before a takeover', async () => {
    const user = userEvent.setup();
    serve(() => {
      const { redirects: _omitted, ...rest } = urlKeysFixture();
      return rest;
    });
    putSpy.mockRejectedValueOnce(takeoverError([{ languageCode: 'de', key: 'bohrer-neu', losingProductName: 'Old drill' }]));
    const panel = await renderPanel();
    expect(within(panel).queryByText(/redirect/i)).toBeNull();
    expect(within(panel).queryByRole('list', { name: /redirects/i })).toBeNull();

    const de = within(panel).getByRole('textbox', { name: /^url key in de$/i });
    await user.clear(de);
    await user.type(de, 'bohrer-neu');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Old drill');
  });

  it('is read-only without catalog:write', async () => {
    const panel = await renderPanel({ permissions: ['catalog:read'] });
    expect(within(panel).getByRole('textbox', { name: /^global url key$/i })).toHaveAttribute('readonly');
    expect(within(panel).queryByRole('button', { name: /save url keys/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /delete the redirect/i })).toBeNull();
    expect(within(panel).queryByRole('combobox', { name: /add a channel key/i })).toBeNull();
  });

  // Final QA review Q-M5 (FR-013, A-9): a global key change is a global write only — every
  // language and channel × language override is left as it is, and nothing warns about them.
  it('a global key change sends the global key only, keeps every override and warns about nothing (Q-M5)', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const panel = await renderPanel();
    const global = within(panel).getByRole('textbox', { name: /^global url key$/i });
    await user.clear(global);
    await user.type(global, 'drill-2');
    expect(within(panel).getByRole('textbox', { name: /^url key in de$/i })).toHaveValue('bohrer');
    expect(within(panel).getByRole('textbox', { name: /^url key in b2b shop · en$/i })).toHaveValue('drill-pro');
    await user.click(within(panel).getByRole('button', { name: /^save url keys$/i }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(URL_KEYS_PATH, { globalKey: 'drill-2' });
    expect(await within(panel).findByRole('status')).toHaveTextContent(/url keys saved/i);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(within(panel).getByRole('textbox', { name: /^url key in de$/i })).toHaveValue('bohrer');
    expect(within(panel).getByRole('textbox', { name: /^url key in b2b shop · en$/i })).toHaveValue('drill-pro');
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // Final QA review Q-L10 — owner decision UX-3 = A: one vocabulary, "Use inherited" for a
  // return to the inherited value and "No longer applies" for an orphan; no "Reset" or
  // "Restore" (kept for archive restore) anywhere in the panel.
  it('speaks the UX-3 vocabulary in English (Q-L10)', async () => {
    const panel = await renderPanel();
    expect(within(panel).getByRole('button', { name: 'Use inherited for DE' })).toHaveTextContent('Use inherited');
    expect(within(panel).getByText('No longer applies')).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Remove the key wiertarka-outlet, which no longer applies' }),
    ).toBeInTheDocument();
    expect(panel.textContent ?? '').not.toMatch(/\breset|\brestore/i);
  });

  it('speaks the UX-3 vocabulary in Polish (Q-L10)', async () => {
    render(wrap(<ProductUrlKeysPanel productId={PRODUCT_ID} />, { language: 'pl' }));
    const panel = await screen.findByRole('region', { name: /^klucze url$/i });
    expect(within(panel).getByRole('button', { name: 'Użyj dziedziczonego dla DE' })).toHaveTextContent(
      'Użyj dziedziczonego',
    );
    expect(within(panel).getByText('Nie obowiązuje już')).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Usuń klucz wiertarka-outlet, który nie obowiązuje już' }),
    ).toBeInTheDocument();
    expect(panel.textContent ?? '').not.toMatch(/przywróć|resetuj|zresetuj/i);
  });

  it('renders in Polish from the Polish bundle', async () => {
    render(wrap(<ProductUrlKeysPanel productId={PRODUCT_ID} />, { language: 'pl' }));
    expect(await screen.findByRole('region', { name: /klucze url/i })).toBeInTheDocument();
  });
});
