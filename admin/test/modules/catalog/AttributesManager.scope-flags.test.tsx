import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Feature 163 / T095a (FR-090, analyze H2) — the attribute edit form shows whether a
 * user-defined attribute's value may differ per sales channel and per language. Saving a
 * **narrowing** first asks `GET …/attributes/:key/scope-change-preview` how many values
 * set per channel or language would stop applying, and confirms with that count (total
 * and per channel) before the `PATCH` is sent; cancel sends nothing; a widening saves at
 * once; a narrowing that affects nothing still confirms. Read-only without
 * `catalog:write`. The dialog is labelled and keeps focus inside (WCAG 2.2 AA).
 *
 * Real `en` and `pl` bundles, under `<StrictMode>`.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

// jsdom lays nothing out; without this the dialog's focus trap finds nothing to focus.
installOffsetParentShim();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { AttributesManager } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/AttributesManager'
);
const { isScopeNarrowing } = await import(
  '../../../../packages/modules/catalog/src/admin/lib/attribute-scope'
);

const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const GONE = '00000000-0000-4000-8000-00000000c0ff';
const LIST_PATH = '/api/v1/admin/catalog/attributes';
const PREVIEW_PREFIX = '/api/v1/admin/catalog/attributes/material/scope-change-preview';

function attribute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    key: 'material',
    label: { 'en-US': 'Material', 'pl-PL': 'Materiał' },
    labelDefault: 'Material',
    valueType: 'string',
    enumValues: null,
    isSearchable: false,
    isFilterable: false,
    isVariantAxis: false,
    displayAsSlider: false,
    isComparable: false,
    isRequired: false,
    isPromoRule: false,
    isPriceRule: false,
    filterPosition: 0,
    isVisibleOnProductPage: true,
    massEditable: false,
    quickSearchable: false,
    channelScoped: true,
    languageScoped: true,
    ...overrides,
  };
}

let preview = { orphanedOverrides: 7, byChannel: [{ channelId: B2B, count: 5 }, { channelId: GONE, count: 2 }] };

function primeGets(attrs: unknown[] = [attribute()]): void {
  getSpy.mockImplementation((path: string) => {
    if (path === LIST_PATH) return Promise.resolve({ data: attrs });
    if (path.startsWith(PREVIEW_PREFIX)) return Promise.resolve({ data: preview });
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({
        items: [
          { id: B2B, code: 'b2b', name: { 'en-US': 'B2B shop' } },
          { id: B2C, code: 'b2c', name: { 'en-US': 'B2C shop' } },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function wrap(ui: ReactElement, permissions: readonly string[] = ['catalog:read', 'catalog:write'], language: 'en' | 'pl' = 'en'): ReactElement {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ catalog }}>
          {withSession(ui, { session: adminSession({ permissions }) })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

async function openEdit(permissions?: readonly string[]): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(wrap(<AttributesManager />, permissions));
  const row = (await screen.findByText('material')).closest('tr') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: /edit/i }));
  return screen.findByRole('group', { name: /scope/i });
}

function patchedPath(): string | undefined {
  return patchSpy.mock.calls[0]?.[0] as string | undefined;
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: attribute() });
  preview = { orphanedOverrides: 7, byChannel: [{ channelId: B2B, count: 5 }, { channelId: GONE, count: 2 }] };
  primeGets();
});
afterEach(() => vi.clearAllMocks());

describe('narrowing (pure)', () => {
  it('a flag going from on to off narrows; turning one on does not', () => {
    const both = { channelScoped: true, languageScoped: true };
    expect(isScopeNarrowing(both, { channelScoped: false, languageScoped: true })).toBe(true);
    expect(isScopeNarrowing(both, { channelScoped: true, languageScoped: false })).toBe(true);
    expect(isScopeNarrowing({ channelScoped: false, languageScoped: false }, both)).toBe(false);
    expect(isScopeNarrowing(both, both)).toBe(false);
  });
});

describe('AttributesManager — scope flags (FR-090)', () => {
  it('shows the two flags of a user-defined attribute as they are stored', async () => {
    const group = await openEdit();
    expect((within(group).getByRole('checkbox', { name: /per sales channel/i }) as HTMLInputElement).checked).toBe(true);
    expect((within(group).getByRole('checkbox', { name: /per language/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('a narrowing asks the preview first and confirms with the count, total and per channel', async () => {
    const user = userEvent.setup();
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per sales channel/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const dialog = await screen.findByRole('dialog', { name: /material/i });
    expect(getSpy).toHaveBeenCalledWith(`${PREVIEW_PREFIX}?channelScoped=false&languageScoped=true`);
    expect(dialog.textContent).toMatch(/7/);
    expect(within(dialog).getByText(/B2B shop/).textContent).toMatch(/5/);
    // A channel the admin cannot name is shown by a short id, never dropped.
    expect(dialog.textContent).toMatch(/00000000/);
    expect(patchSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /narrow the scope/i }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchedPath()).toBe('/api/v1/admin/catalog/attributes/material');
    expect(patchSpy.mock.calls[0]?.[1]).toMatchObject({ channelScoped: false, languageScoped: true });
  });

  it('Save says it is busy while the narrowing preview loads, so it cannot ask twice (D18)', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    const base = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path.startsWith(PREVIEW_PREFIX)
        ? new Promise((resolve) => {
            release = (): void => resolve({ data: preview });
          })
        : base(path),
    );
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per sales channel/i }));
    const save = screen.getByRole('button', { name: /^save$/i });
    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAttribute('aria-busy', 'true');
    await user.click(save);
    expect(getSpy.mock.calls.filter(([p]) => String(p).startsWith(PREVIEW_PREFIX))).toHaveLength(1);
    release(undefined);
    expect(await screen.findByRole('dialog', { name: /material/i })).toBeInTheDocument();
  });

  it('cancel sends nothing', async () => {
    const user = userEvent.setup();
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per language/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('a narrowing that affects nothing still confirms, saying so', async () => {
    const user = userEvent.setup();
    preview = { orphanedOverrides: 0, byChannel: [] };
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per language/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/no values/i);
  });

  it('a widening saves without the preview', async () => {
    const user = userEvent.setup();
    primeGets([attribute({ channelScoped: false, languageScoped: false })]);
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per sales channel/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).toMatchObject({ channelScoped: true, languageScoped: false });
    expect(getSpy.mock.calls.some(([p]) => String(p).startsWith(PREVIEW_PREFIX))).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the dialog is labelled, described, and takes focus', async () => {
    const user = userEvent.setup();
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per sales channel/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('is read-only without catalog:write', async () => {
    const group = await openEdit(['catalog:read']);
    for (const box of within(group).getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it('says nothing about scope while the attribute answer does not carry the flags', async () => {
    const user = userEvent.setup();
    const bare = attribute();
    delete bare['channelScoped'];
    delete bare['languageScoped'];
    primeGets([bare]);
    render(wrap(<AttributesManager />));
    const row = (await screen.findByText('material')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /edit/i }));
    await screen.findByRole('button', { name: /^save$/i });
    expect(screen.queryByRole('group', { name: /scope/i })).toBeNull();
  });

  it.each([
    [1, '1 wartość ustawiona dla kanału lub języka przestanie obowiązywać.'],
    [3, '3 wartości ustawione dla kanału lub języka przestaną obowiązywać.'],
    [7, '7 wartości ustawionych dla kanału lub języka przestanie obowiązywać.'],
  ])('says the count in Polish with its plural form: %i (D21)', async (count, sentence) => {
    preview = { orphanedOverrides: count, byChannel: [] };
    const user = userEvent.setup();
    render(wrap(<AttributesManager />, undefined, 'pl'));
    const row = (await screen.findByText('material')).closest('tr') as HTMLElement;
    await user.click(within(row).getAllByRole('button')[0] as HTMLElement);
    await user.click(await screen.findByRole('checkbox', { name: /kanału sprzedaży/i }));
    await user.click(screen.getByRole('button', { name: /^zapisz/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(sentence);
  });

  it('says the count in English with its plural form (D21)', async () => {
    preview = { orphanedOverrides: 1, byChannel: [] };
    const user = userEvent.setup();
    const group = await openEdit();
    await user.click(within(group).getByRole('checkbox', { name: /per sales channel/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect((await screen.findByRole('dialog')).textContent).toContain('1 value set per channel or language will stop applying.');
  });

  it('renders in Polish', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />, undefined, 'pl'));
    const row = (await screen.findByText('material')).closest('tr') as HTMLElement;
    await user.click(within(row).getAllByRole('button')[0] as HTMLElement);
    expect(await screen.findByRole('checkbox', { name: /kanału sprzedaży/i })).toBeTruthy();
  });
});
