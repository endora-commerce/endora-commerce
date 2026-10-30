import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import seoPl from '../../../../packages/modules/seo/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T126 (US8, FR-075, FR-014, FR-015; owner decision SEO-1 A) — the SEO
 * meta editor addresses a product override by sales channel beside language: the
 * channel selector lists the product's **member** channels only, a channel's language
 * list is that channel's, "whole channel" is the channel row; the resolved values show
 * where each field comes from; "use inherited" deletes exactly the selected scope's row.
 * A category takes no channel.
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

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const CATEGORY_ID = '00000000-0000-4000-8000-0000000000e1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const META = `/api/v1/admin/seo/meta/product/${PRODUCT_ID}`;
const CONTEXT_PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}/scope-context`;

const scopeContext = {
  productId: PRODUCT_ID,
  // The read answers member channels only; the outlet the product left is not here.
  channels: [
    { id: B2B, code: 'b2b', name: 'B2B shop', languages: ['de-DE', 'en-US'], isDefault: true },
    { id: B2C, code: 'b2c', name: 'B2C shop', languages: ['pl-PL'], isDefault: false },
  ],
  languagesUnion: ['de-DE', 'en-US', 'pl-PL'],
  primaryAdminLanguage: 'en-US',
  preference: null,
};

function metaAnswer(override: Record<string, string | null> | null) {
  return {
    data: {
      resolved: {
        title: 'B2B German title',
        description: 'Channel description',
        openGraph: { title: 'Derived name', description: 'Derived description', image: null },
        source: 'override',
        locale: 'de-DE',
      },
      sources: {
        title: 'channel_language',
        description: 'channel',
        ogTitle: 'language',
        ogDescription: 'derived',
        ogImageUrl: 'derived',
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
    if (path === CONTEXT_PATH) return Promise.resolve({ data: scopeContext });
    if (path.startsWith('/api/v1/admin/seo/meta/')) {
      return Promise.resolve(
        metaAnswer({ title: 'B2B German title', description: null, ogTitle: null, ogDescription: null, ogImageUrl: null }),
      );
    }
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

/** Picks a scope; the editor loads it on selection (D5), so this waits for the load to settle. */
async function chooseScope(user: ReturnType<typeof userEvent.setup>, channel: string, language: string): Promise<void> {
  const channelSelect = await screen.findByRole('combobox', { name: /^sales channel$/i });
  await waitFor(() => expect(channelSelect).not.toBeDisabled());
  await user.selectOptions(channelSelect, channel);
  const languageSelect = screen.getByRole('combobox', { name: /^language$/i });
  await waitFor(() => expect(languageSelect).not.toBeDisabled());
  await user.selectOptions(languageSelect, language);
  await waitFor(() => expect(screen.getByRole('combobox', { name: /^language$/i })).not.toBeDisabled());
}

function metaCalls(query: string): number {
  return getSpy.mock.calls.filter(([p]) => p === `${META}?${query}`).length;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('SeoMetaScopeEditor — a product override per sales channel × language', () => {
  it('lists only the product’s member channels, and a channel’s own languages plus the whole channel', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    const channel = await screen.findByRole('combobox', { name: /^sales channel$/i });
    const channelOptions = within(channel).getAllByRole('option').map((o) => o.textContent);
    expect(channelOptions).toEqual(['Every channel (language row)', 'B2B shop', 'B2C shop']);

    await user.selectOptions(channel, B2C);
    const language = screen.getByRole('combobox', { name: /^language$/i });
    expect(within(language).getAllByRole('option').map((o) => o.textContent)).toEqual(['Whole channel', 'PL-PL']);
  });

  it('loads the selected scope and shows where each field comes from', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${META}?channelId=${B2B}&locale=de-DE`));
    const table = await screen.findByRole('table', { name: /effective values/i });
    const row = (field: RegExp): HTMLElement => within(table).getByRole('rowheader', { name: field }).closest('tr') as HTMLElement;
    expect(within(row(/^title$/i)).getByText('Channel and language')).toBeInTheDocument();
    expect(within(row(/^description$/i)).getByText('Whole channel')).toBeInTheDocument();
    expect(within(row(/^og title$/i)).getByText('Language')).toBeInTheDocument();
    expect(within(row(/^og description$/i)).getByText('From the product')).toBeInTheDocument();
  });

  it('addresses the whole channel row with channelId only', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, '');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${META}?channelId=${B2B}`));
  });

  it('saves to the selected scope', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    const title = await screen.findByRole('textbox', { name: /^title$/i });
    await user.clear(title);
    await user.type(title, 'Neuer Titel');
    await user.click(screen.getByRole('button', { name: /save override/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [path, body] = putSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(META);
    expect(body).toMatchObject({ channelId: B2B, locale: 'de-DE', title: 'Neuer Titel' });
  });

  it('"use inherited" deletes exactly the selected scope’s row, then reloads', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    await screen.findByRole('table', { name: /effective values/i });
    const loadsBefore = metaCalls(`channelId=${B2B}&locale=de-DE`);
    await user.click(await screen.findByRole('button', { name: /use inherited/i }));
    // Asked first (D5): the dialog names the scope and the five fields it clears.
    const dialog = await screen.findByRole('dialog', { name: /use inherited for B2B shop · DE-DE/i });
    expect(dialog.textContent).toMatch(/Title, Description, OG title, OG description, OG image URL/);
    expect(deleteSpy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /^use inherited$/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    expect(deleteSpy).toHaveBeenCalledWith(`${META}?channelId=${B2B}&locale=de-DE`);
    await waitFor(() => expect(metaCalls(`channelId=${B2B}&locale=de-DE`)).toBe(loadsBefore + 1));
  });

  it('"use inherited" deletes nothing when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    await user.click(await screen.findByRole('button', { name: /use inherited/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('offers no "use inherited" where the scope holds no row', async () => {
    const user = userEvent.setup();
    getSpy.mockImplementation((path: string) =>
      path === CONTEXT_PATH ? Promise.resolve({ data: scopeContext }) : Promise.resolve(metaAnswer(null)),
    );
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2C, 'pl-PL');
    await waitFor(() => expect(metaCalls(`channelId=${B2C}&locale=pl-PL`)).toBe(1));
    await screen.findByRole('table', { name: /effective values/i });
    expect(screen.queryByRole('button', { name: /use inherited/i })).toBeNull();
  });

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

  it('loads a scope as soon as it is selected, without pressing Load (D5)', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    const channel = await screen.findByRole('combobox', { name: /^sales channel$/i });
    await waitFor(() => expect(channel).not.toBeDisabled());
    await user.selectOptions(channel, B2C);
    await waitFor(() => expect(metaCalls(`channelId=${B2C}&locale=pl-PL`)).toBe(1));
    await user.selectOptions(screen.getByRole('combobox', { name: /^language$/i }), '');
    await waitFor(() => expect(metaCalls(`channelId=${B2C}`)).toBe(1));
  });

  it('opens on the language row once the channels are read, and offers no scope before that (D5)', async () => {
    const context = deferred<{ data: typeof scopeContext }>();
    getSpy.mockImplementation((path: string) => {
      if (path === CONTEXT_PATH) return context.promise;
      return Promise.resolve(metaAnswer(null));
    });
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    expect(await screen.findByText(/reading the product’s sales channels/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^language$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^load$/i })).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/seo/meta/'));
    context.resolve({ data: scopeContext });
    expect(await screen.findByRole('combobox', { name: /^sales channel$/i })).toBeInTheDocument();
    await waitFor(() => expect(metaCalls('locale=en-US')).toBe(1));
  });

  it('keeps the scope selectors disabled while a scope is loading (C-2)', async () => {
    const b2b = deferred<ReturnType<typeof metaAnswer>>();
    getSpy.mockImplementation((path: string) => {
      if (path === CONTEXT_PATH) return Promise.resolve({ data: scopeContext });
      if (path === `${META}?channelId=${B2B}&locale=de-DE`) return b2b.promise;
      return Promise.resolve(metaAnswer(null));
    });
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    const channelSelect = await screen.findByRole('combobox', { name: /^sales channel$/i });
    await waitFor(() => expect(channelSelect).not.toBeDisabled());
    // Choosing B2B selects its first language, DE-DE, and loads it.
    await user.selectOptions(channelSelect, B2B);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^sales channel$/i })).toBeDisabled());
    expect(screen.getByRole('combobox', { name: /^language$/i })).toBeDisabled();
    b2b.resolve(metaAnswer(null));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^sales channel$/i })).not.toBeDisabled());
  });

  it('never lets a late answer for the previous scope fill the draft of the current one (C-2)', async () => {
    const b2b = deferred<ReturnType<typeof metaAnswer>>();
    getSpy.mockImplementation((path: string) => {
      if (path === CONTEXT_PATH) return Promise.resolve({ data: scopeContext });
      if (path === `${META}?channelId=${B2B}&locale=de-DE`) return b2b.promise;
      if (path === `${META}?channelId=${B2C}&locale=pl-PL`) {
        return Promise.resolve(
          metaAnswer({ title: 'B2C Polish title', description: null, ogTitle: null, ogDescription: null, ogImageUrl: null }),
        );
      }
      return Promise.resolve(metaAnswer(null));
    });
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    const channelSelect = await screen.findByRole('combobox', { name: /^sales channel$/i });
    await waitFor(() => expect(channelSelect).not.toBeDisabled());
    // Choosing B2B selects its first language, DE-DE, and loads it.
    await user.selectOptions(channelSelect, B2B);
    // The selector is disabled while B2B × DE loads; a change that reaches it anyway
    // (here dispatched directly) must still win over the late B2B answer.
    fireEvent.change(screen.getByRole('combobox', { name: /^sales channel$/i }), { target: { value: B2C } });
    expect(await screen.findByDisplayValue('B2C Polish title')).toBeInTheDocument();
    b2b.resolve(
      metaAnswer({ title: 'B2B German title', description: null, ogTitle: null, ogDescription: null, ogImageUrl: null }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('textbox', { name: /^title$/i })).toHaveValue('B2C Polish title');
    await user.click(screen.getByRole('button', { name: /save override/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0]![1]).toMatchObject({ channelId: B2C, locale: 'pl-PL', title: 'B2C Polish title' });
  });

  it('clears the outcome line when the scope changes (D5)', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    await user.click(await screen.findByRole('button', { name: /save override/i }));
    expect(await screen.findByText('Override saved.')).toBeInTheDocument();
    await chooseScope(user, B2C, 'pl-PL');
    expect(screen.queryByText('Override saved.')).toBeNull();
  });

  it('asks before an unsaved draft is discarded by a scope change (D5)', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    const title = await screen.findByRole('textbox', { name: /^title$/i });
    await user.clear(title);
    await user.type(title, 'Unsaved');
    await user.selectOptions(screen.getByRole('combobox', { name: /^sales channel$/i }), B2C);
    const dialog = await screen.findByRole('dialog', { name: /discard unsaved changes/i });
    expect(dialog.textContent).toContain('B2B shop · DE-DE');
    // Keep editing: the scope and the draft stay.
    await user.click(within(dialog).getByRole('button', { name: /keep editing/i }));
    expect(screen.getByRole('combobox', { name: /^sales channel$/i })).toHaveValue(B2B);
    expect(screen.getByRole('textbox', { name: /^title$/i })).toHaveValue('Unsaved');
    expect(metaCalls(`channelId=${B2C}&locale=pl-PL`)).toBe(0);
    // Discard: the switch happens and the new scope loads.
    await user.selectOptions(screen.getByRole('combobox', { name: /^sales channel$/i }), B2C);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /discard and switch/i }));
    await waitFor(() => expect(metaCalls(`channelId=${B2C}&locale=pl-PL`)).toBe(1));
    expect(screen.getByRole('combobox', { name: /^sales channel$/i })).toHaveValue(B2C);
  });

  it('renders in Polish from the Polish bundles', async () => {
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />, 'pl'));
    expect(await screen.findByRole('combobox', { name: /^kanał sprzedaży$/i })).toBeInTheDocument();
  });
});
