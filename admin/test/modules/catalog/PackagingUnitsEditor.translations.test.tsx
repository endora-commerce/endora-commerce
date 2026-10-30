import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';

/**
 * Feature 163 / T140 (US9 #5, FR-079) — a packaging unit's name per language ("karton" /
 * "carton"). The languages offered are the product's member channels' languages plus any
 * language the unit already has a name in (so a name in a language no channel speaks any
 * more stays reachable and removable). Save sends one `PATCH …/packaging-units/:id` with
 * the changed languages only; a cleared one is sent as `''` (use the global name).
 *
 * Real `en` and `pl` bundles, so a key missing in either file fails here.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

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

const { PackagingUnitsEditor } = await import(
  '../../../../packages/modules/catalog/src/admin/components/PackagingUnitsEditor'
);

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const UNIT = '00000000-0000-4000-8000-000000000001';
const BASE = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;

const unit = {
  id: UNIT,
  productId: PRODUCT_ID,
  name: 'Carton',
  nameTranslations: { pl: 'Karton', cs: 'Krabice' },
  baseQuantity: 12,
  position: 0,
  isDefault: true,
  minOrderUnits: null,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

const scopeContext = {
  productId: PRODUCT_ID,
  channels: [
    { id: '00000000-0000-4000-8000-00000000c001', code: 'b2b', name: 'B2B shop', languages: ['de', 'en'], isDefault: true },
    { id: '00000000-0000-4000-8000-00000000c002', code: 'b2c', name: 'B2C shop', languages: ['pl'], isDefault: false },
  ],
  languagesUnion: ['de', 'en', 'pl'],
  primaryAdminLanguage: 'en',
  preference: null,
};

function serve(options: { contextFails?: boolean } = {}): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `${BASE}/packaging-units`) return Promise.resolve({ data: [unit] });
    if (path === `${BASE}/scope-context`) {
      return options.contextFails ? Promise.reject(new Error('down')) : Promise.resolve({ data: scopeContext });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ catalog }}>
          {ui}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

async function openDialog(): Promise<HTMLElement> {
  render(wrap(<PackagingUnitsEditor productId={PRODUCT_ID} canWrite />));
  await screen.findByDisplayValue('Carton');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Names per language: Carton' }));
  return screen.findByRole('dialog', { name: 'Names per language: Carton' });
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset().mockResolvedValue({ data: unit });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PackagingUnitsEditor — names per language (US9 #5, FR-079)', () => {
  it('offers the member channels’ languages and every language the unit already has a name in', async () => {
    serve();
    const dialog = await openDialog();
    const fields = within(dialog).getAllByText(/^Name \(/).map((label) => label.textContent);
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(fields.length);
    expect(fields).toEqual(['Name (CS)', 'Name (DE)', 'Name (EN)', 'Name (PL)']);
    expect(within(dialog).getByRole('textbox', { name: 'Name (PL)' })).toHaveValue('Karton');
    expect(within(dialog).getByRole('textbox', { name: 'Name (DE)' })).toHaveAttribute('placeholder', 'Carton');
  });

  it('Save sends the changed languages only, a cleared one as ""', async () => {
    serve();
    const dialog = await openDialog();
    const user = userEvent.setup();
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name (CS)' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (DE)' }), 'Karton (DE)');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${BASE}/packaging-units/${UNIT}`, {
      nameTranslations: { cs: '', de: 'Karton (DE)' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Save with nothing changed closes without a request', async () => {
    serve();
    const dialog = await openDialog();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('without the channel read, the languages the unit already has stay editable', async () => {
    serve({ contextFails: true });
    const dialog = await openDialog();
    const fields = within(dialog).getAllByText(/^Name \(/).map((label) => label.textContent);
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(fields.length);
    expect(fields).toEqual(['Name (CS)', 'Name (PL)']);
  });

  it('shows the inherited global name as visible text beside each field (D9)', async () => {
    serve();
    const dialog = await openDialog();
    const de = within(dialog).getByRole('textbox', { name: 'Name (DE)' });
    expect(document.getElementById(de.getAttribute('aria-describedby') ?? '')).toHaveTextContent('Inherited: Carton');
  });

  it('a refusal shows the server’s message; anything else says nothing was saved (D16)', async () => {
    serve();
    patchSpy.mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'The name is too long.' } }),
    );
    const dialog = await openDialog();
    const user = userEvent.setup();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (DE)' }), 'X');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^The name is too long\.$/);
    patchSpy.mockRejectedValueOnce(new Error('network'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Nothing was saved. Try again.'));
  });

  it('says it is saving while the request is in flight (D16)', async () => {
    serve();
    patchSpy.mockImplementationOnce(() => new Promise(() => undefined));
    const dialog = await openDialog();
    const user = userEvent.setup();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (DE)' }), 'X');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('Escape with unsaved names asks before discarding them (D16)', async () => {
    serve();
    const dialog = await openDialog();
    const user = userEvent.setup();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (DE)' }), 'X');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByText(/changes that are not saved/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(within(dialog).getByRole('textbox', { name: 'Name (DE)' })).toHaveValue('X');
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('without catalog:write nothing is editable and it says so (D15)', async () => {
    serve();
    render(wrap(<PackagingUnitsEditor productId={PRODUCT_ID} canWrite={false} />));
    const name = await screen.findByDisplayValue('Carton');
    expect(name).toBeDisabled();
    expect(screen.getByText(/read-only: you can see the packaging units but not change them/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^remove$/i })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /^name$/i, hidden: false })).toBe(name);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Names per language: Carton' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Name (PL)' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('renders in Polish from the pl bundle', async () => {
    serve();
    render(wrap(<PackagingUnitsEditor productId={PRODUCT_ID} canWrite />, 'pl'));
    await screen.findByDisplayValue('Carton');
    expect(screen.getByRole('button', { name: 'Nazwy w językach: Carton' })).toBeInTheDocument();
  });
});
