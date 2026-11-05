import { StrictMode, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-001, FR-003,
 * FR-005, contracts/admin-surfaces.md §5) — the attributes screen offers the
 * Page Builder content type. Chosen, the form offers none of the capabilities
 * a document cannot have, states that the content is kept per language and
 * needs the CMS module to be edited, and offers no options. A content
 * attribute's inline flags are locked in the list, and its type cannot change.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { AttributesManager } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/AttributesManager'
);

const EN = catalogEn as Record<string, string>;
const LIST_PATH = '/api/v1/admin/catalog/attributes';

function attribute(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a1',
    key: 'material',
    label: { 'en-US': 'Material' },
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
    isVisibleOnProductPage: false,
    massEditable: false,
    quickSearchable: false,
    scopable: false,
    ...overrides,
  };
}

const GUIDE = attribute({
  id: 'a2',
  key: 'buying_guide',
  label: { 'en-US': 'Buying guide' },
  labelDefault: 'Buying guide',
  valueType: 'page_builder',
});

function wrap(ui: ReactElement): ReactElement {
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => undefined }}>
        <TranslationProvider language="en" initialBundle={{ catalog: EN }}>
          {withSession(ui, { session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }) })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

beforeEach(() => {
  getSpy.mockReset().mockImplementation((path: string) =>
    path === LIST_PATH ? Promise.resolve({ data: [attribute({}), GUIDE] }) : Promise.reject(new Error(path)),
  );
  postSpy.mockReset().mockResolvedValue({ data: GUIDE });
});

const CAPABILITY_LABELS = [
  'attributes.flag.searchable',
  'attributes.flag.filterable',
  'attributes.flag.variantAxis',
  'attributes.flag.comparable',
  'attributes.flag.massEditable',
  'attributes.column.quickSearchable',
  'attributes.flag.promoRule',
  'attributes.flag.priceRule',
  // Feature 174 — the one scope flag, `scopable`, replaced the channel and language pair.
  'attributes.scope.scopable',
].map((key) => EN[key]!);

describe('AttributesManager — Page Builder content type (feature 172)', () => {
  it('offers the type, and with it chosen hides every capability, shows the note and no options', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />));
    await screen.findByText('material');
    const form = screen.getByLabelText(EN['attributes.field.type']!).closest('form') as HTMLElement;

    const typeSelect = within(form).getByLabelText(EN['attributes.field.type']!) as HTMLSelectElement;
    expect(within(typeSelect).getByRole('option', { name: EN['attributes.type.pageBuilder']! })).toBeTruthy();
    for (const label of CAPABILITY_LABELS) expect(within(form).getByLabelText(label)).toBeTruthy();

    await user.selectOptions(typeSelect, 'page_builder');
    for (const label of CAPABILITY_LABELS) expect(within(form).queryByLabelText(label)).toBeNull();
    expect(within(form).queryByLabelText(EN['attributes.field.enumValues']!)).toBeNull();
    expect(within(form).getByText(EN['attributes.pageBuilder.languageNote']!)).toBeTruthy();

    await user.type(within(form).getByLabelText(EN['attributes.field.key']!), 'buying_guide');
    await user.click(within(form).getByRole('button', { name: EN['attributes.action.create']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(LIST_PATH);
    expect(body).toMatchObject({
      key: 'buying_guide',
      valueType: 'page_builder',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
      isComparable: false,
      massEditable: false,
      quickSearchable: false,
      isPromoRule: false,
      isPriceRule: false,
    });
    expect(body).not.toHaveProperty('scopable', true);
    expect(body).not.toHaveProperty('enumValues');
  });

  it('drops a capability ticked before Page Builder content was chosen', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />));
    await screen.findByText('material');
    const form = screen.getByLabelText(EN['attributes.field.type']!).closest('form') as HTMLElement;
    await user.click(within(form).getByLabelText(EN['attributes.flag.searchable']!));
    await user.selectOptions(within(form).getByLabelText(EN['attributes.field.type']!), 'page_builder');
    await user.type(within(form).getByLabelText(EN['attributes.field.key']!), 'guide_two');
    await user.click(within(form).getByRole('button', { name: EN['attributes.action.create']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect((postSpy.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ isSearchable: false });
  });

  it('locks the inline flags of a content attribute row, with the reason as their title', async () => {
    render(wrap(<AttributesManager />));
    const row = (await screen.findByText('buying_guide')).closest('tr') as HTMLElement;
    const checkboxes = within(row).getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    for (const checkbox of checkboxes) {
      expect(checkbox).toBeDisabled();
      expect(checkbox.closest('[title]')?.getAttribute('title')).toBe(EN['attributes.pageBuilder.flagsLocked']);
    }
    expect(within(row).getByText(EN['attributes.type.pageBuilder']!)).toBeTruthy();

    const plainRow = screen.getByText('material').closest('tr') as HTMLElement;
    for (const checkbox of within(plainRow).getAllByRole('checkbox')) expect(checkbox).not.toBeDisabled();
  });

  it('disables the type selector on edit, from and to Page Builder content (FR-005)', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />));
    const row = (await screen.findByText('buying_guide')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: EN['attributes.action.edit']! }));
    // The edit card takes the create card's place, so its form is the only one.
    await screen.findByText(EN['attributes.edit.title']!.replace('{key}', 'buying_guide'));
    const editForm = screen.getByLabelText(EN['attributes.field.type']!).closest('form') as HTMLElement;
    const typeSelect = within(editForm).getByLabelText(EN['attributes.field.type']!) as HTMLSelectElement;
    expect(typeSelect).toBeDisabled();
    expect(typeSelect.value).toBe('page_builder');
    for (const label of CAPABILITY_LABELS) expect(within(editForm).queryByLabelText(label)).toBeNull();

    await user.click(within(editForm).getByRole('button', { name: EN['attributes.action.cancel']! }));
    const plainRow = screen.getByText('material').closest('tr') as HTMLElement;
    await user.click(within(plainRow).getByRole('button', { name: EN['attributes.action.edit']! }));
    await screen.findByText(EN['attributes.edit.title']!.replace('{key}', 'material'));
    const plainForm = screen.getByLabelText(EN['attributes.field.type']!).closest('form') as HTMLElement;
    expect(within(plainForm).getByLabelText(EN['attributes.field.type']!)).toBeDisabled();
  });
});
