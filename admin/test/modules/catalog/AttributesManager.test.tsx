import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { openAttribute, openNewAttribute, rowOf } from './attributes-manager-helpers';

/**
 * The attribute list (issue #1527, UX audit CAT-12; issue #1590): the list
 * first, a search, *New attribute* in the header, and one editor dialog whose
 * Save is the screen's only save. The capabilities — searchable, mass-editable,
 * price list rules and the rest — are edited there and read in the list as
 * badges; the eight checkbox columns and the second Save bar are gone, and so
 * are the controls named by developer ids (`brand-massEditable`).
 */

const postSpy = vi.fn();
const getSpy = vi.fn();
const patchSpy = vi.fn();

// jsdom lays nothing out; without this the dialog's focus trap finds nothing to focus.
installOffsetParentShim();

// The subject resolves `@endora-commerce/admin-kit/lib`; mocking the shim
// `@/lib/api-client` instead would leave the mock inert (feature 091, batch 15).
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { AttributesManager } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/AttributesManager'
);
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

const EN = catalogEn as Record<string, string>;
const PL = catalogPl as Record<string, string>;

const seedAttribute = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a1',
  key: 'brand',
  label: { 'en-US': 'Brand', 'pl-PL': 'Marka' },
  labelDefault: 'Brand',
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
  ...overrides,
});

function renderPage(permissions: string[] = ['catalog:read', 'catalog:write'], language: 'en' | 'pl' = 'en'): void {
  render(
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ catalog: language === 'en' ? EN : PL }}>
          {withSession(<AttributesManager />, { session: adminSession({ permissions }) })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>,
  );
}

beforeEach(() => {
  postSpy.mockReset();
  getSpy.mockReset();
  patchSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AttributesManager — the list comes first (#1527)', () => {
  it('shows the list with New attribute in the header, and no form drawn open', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute()] });
    renderPage();
    await rowOf('brand');
    expect(screen.getByRole('button', { name: EN['attributes.action.new']! })).toBeTruthy();
    expect(document.getElementById('akey')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('search', { name: EN['attributes.toolbar.label']! })).toBeTruthy();
  });

  it('names the label in the admin language and the type in words, not the stored enum', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute({ valueType: 'multiselect', enumValues: ['a', 'b'] })] });
    renderPage(undefined, 'pl');
    const row = await rowOf('brand');
    expect(within(row).getByRole('button', { name: 'Marka' })).toBeTruthy();
    expect(within(row).getByText(PL['attributes.type.multiselect']!)).toBeTruthy();
    expect(within(row).queryByText('multiselect')).toBeNull();
  });

  it('reads the capabilities as badges, with no checkbox in the row', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute({ massEditable: true, isPriceRule: true })] });
    renderPage();
    const row = await rowOf('brand');
    expect(within(row).queryAllByRole('checkbox')).toHaveLength(0);
    const badges = within(row).getByRole('list', { name: EN['attributes.column.capabilities']! });
    expect(within(badges).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      EN['attributes.column.massEditable']!,
      EN['attributes.column.priceRule']!,
    ]);
  });

  it('says when an attribute is used for nothing', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute()] });
    renderPage();
    const row = await rowOf('brand');
    expect(within(row).getByText(EN['attributes.capabilities.none']!)).toBeTruthy();
  });

  it('searches by key or label as the operator types, and offers Clear filters when nothing matches', async () => {
    getSpy.mockResolvedValue({
      data: [seedAttribute(), seedAttribute({ id: 'a2', key: 'colour', label: { 'en-US': 'Colour' }, labelDefault: 'Colour' })],
    });
    renderPage();
    const user = userEvent.setup();
    await rowOf('colour');
    const search = screen.getByRole('searchbox', { name: EN['attributes.search.label']! });
    await user.type(search, 'COL');
    expect(screen.queryByText('brand', { selector: 'code' })).toBeNull();
    expect(screen.getByText('colour', { selector: 'code' })).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'nothing-like-it');
    expect(screen.getByText(EN['attributes.emptyFiltered']!)).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /clear/i })[0]!);
    await rowOf('brand');
  });

  it('narrows by type', async () => {
    getSpy.mockResolvedValue({
      data: [seedAttribute(), seedAttribute({ id: 'a2', key: 'colour', valueType: 'select', enumValues: ['red'] })],
    });
    renderPage();
    const user = userEvent.setup();
    await rowOf('colour');
    await user.selectOptions(screen.getByRole('combobox', { name: EN['attributes.filter.type']! }), 'select');
    expect(screen.queryByText('brand', { selector: 'code' })).toBeNull();
    expect(screen.getByText('colour', { selector: 'code' })).toBeTruthy();
  });

  it('offers the first attribute from the empty state, with no second New in the header', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderPage();
    await screen.findByText(EN['attributes.empty']!);
    expect(screen.getAllByRole('button', { name: EN['attributes.action.new']! })).toHaveLength(1);
  });

  it('opens the editor from the row menu too', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute()] });
    renderPage();
    const user = userEvent.setup();
    await rowOf('brand');
    await user.click(screen.getByRole('button', { name: 'Actions for Brand' }));
    await user.click(await screen.findByRole('menuitem', { name: EN['attributes.action.edit']! }));
    expect(await screen.findByRole('dialog', { name: 'Edit attribute brand' })).toBeTruthy();
  });

  it('without catalog:write offers no New, no Delete and no Save, and shows the attribute read-only', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute()] });
    renderPage(['catalog:read']);
    const user = userEvent.setup();
    await rowOf('brand');
    expect(screen.queryByRole('button', { name: EN['attributes.action.new']! })).toBeNull();
    const dialog = await openAttribute(user, 'brand');
    expect(within(dialog).queryByRole('button', { name: EN['attributes.action.saveEdit']! })).toBeNull();
    expect(within(dialog).getByLabelText(EN['attributes.field.labelEn']!)).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: EN['attributes.action.close']! })).toBeTruthy();
  });
});

describe('AttributesManager — capabilities are saved by the editor’s one Save (#1527, #1590)', () => {
  it('patches massEditable from the editor, named by its label', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute()] });
    patchSpy.mockResolvedValue({ data: seedAttribute({ massEditable: true }) });
    renderPage();
    const user = userEvent.setup();
    const dialog = await openAttribute(user, 'brand');

    const box = within(dialog).getByRole('checkbox', { name: EN['attributes.flag.massEditable']! }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: EN['attributes.action.saveEdit']! }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/attributes/brand');
    expect(patchSpy.mock.calls[0]![1]).toEqual(expect.objectContaining({ massEditable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the stored isPriceRule in the editor and patches a change', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute({ isPriceRule: true })] });
    patchSpy.mockResolvedValue({ data: seedAttribute() });
    renderPage();
    const user = userEvent.setup();
    const dialog = await openAttribute(user, 'brand');
    const box = within(dialog).getByRole('checkbox', { name: EN['attributes.flag.priceRule']! }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: EN['attributes.action.saveEdit']! }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]![1]).toEqual(expect.objectContaining({ isPriceRule: false }));
  });

  it('keeps the dialog open with the server’s message when the save is refused', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute()] });
    patchSpy.mockRejectedValue(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'The label is too long.', requestId: 'r' } }),
    );
    renderPage();
    const user = userEvent.setup();
    const dialog = await openAttribute(user, 'brand');
    await user.click(within(dialog).getByRole('button', { name: EN['attributes.action.saveEdit']! }));
    expect(await within(dialog).findByText('The label is too long.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('sends isPriceRule from the create dialog', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: seedAttribute({ isPriceRule: true }) });
    renderPage();
    const user = userEvent.setup();
    const dialog = await openNewAttribute(user, EN['attributes.action.new']!);
    expect(within(dialog).getByRole('heading', { name: EN['attributes.create.title']! })).toBeTruthy();
    await user.click(within(dialog).getByRole('checkbox', { name: EN['attributes.flag.priceRule']! }));
    // The key is the form's one required field; without it the browser's own
    // validation stops the submit before the handler runs.
    await user.type(within(dialog).getByLabelText(EN['attributes.field.key']!), 'margin_class');
    await user.click(within(dialog).getByRole('button', { name: EN['attributes.action.create']! }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/attributes');
    expect(postSpy.mock.calls[0]![1]).toEqual(expect.objectContaining({ key: 'margin_class', isPriceRule: true }));
  });
});

/**
 * Issue #682 — `select` (dropdown single-select) is a select-style type like
 * `enum` / `multiselect`: the locked Type field must show it (not fall back to
 * the first option, `string`) and the options editor must be rendered.
 */
describe('AttributesManager — select value type (#682)', () => {
  const selectAttribute = (): Record<string, unknown> =>
    seedAttribute({ key: 'color', label: { 'en-US': 'Color' }, labelDefault: 'Color', valueType: 'select', enumValues: ['red', 'blue'] });

  it('shows type `select` and the options editor, its controls named in words (#1590)', async () => {
    getSpy.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/options')
          ? { data: { items: [{ id: 'o1', value: 'red', label: { 'en-US': 'Red' }, labelDefault: 'Red', isDefault: false, sortOrder: 0 }] } }
          : { data: [selectAttribute()] },
      ),
    );
    renderPage();
    const user = userEvent.setup();
    const dialog = await openAttribute(user, 'color');

    expect((within(dialog).getByLabelText(EN['attributes.field.type']!) as HTMLSelectElement).value).toBe('select');
    const options = await within(dialog).findByRole('region', { name: /options/i });
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/attributes/a1/options'));
    expect(await within(options).findByRole('textbox', { name: 'Label for option red' })).toBeTruthy();
    expect(within(options).getByRole('button', { name: 'Remove option red' })).toBeTruthy();
  });

  it('collects enum values when creating a select attribute', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: selectAttribute() });
    renderPage();
    const user = userEvent.setup();
    const dialog = await openNewAttribute(user, EN['attributes.action.new']!);
    await user.type(within(dialog).getByLabelText(EN['attributes.field.key']!), 'color');
    await user.selectOptions(within(dialog).getByLabelText(EN['attributes.field.type']!), 'select');
    await user.type(within(dialog).getByLabelText(EN['attributes.field.enumValues']!), 'red, blue');
    await user.click(within(dialog).getByRole('button', { name: EN['attributes.action.create']! }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ key: 'color', valueType: 'select', enumValues: ['red', 'blue'] }),
    );
  });
});
