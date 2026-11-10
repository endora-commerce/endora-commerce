import { StrictMode, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-036, SD-2) — product
 * attributes are custom-field definitions the catalogue manages through the
 * apply seam, so the *Admin access* selector reaches them here, on the
 * attributes screen: offered on create and edit with the sentence that it is a
 * panel convenience and not a permission, sent with the attribute, and with
 * read-only and hidden unavailable while the attribute is required.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

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

const EN = catalogEn as Record<string, string>;
const PL = catalogPl as Record<string, string>;
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
    adminAccess: 'edit',
    ...overrides,
  };
}

const SKU_CODE = attribute({ id: 'a2', key: 'erp_sku', labelDefault: 'ERP SKU', label: { 'en-US': 'ERP SKU' }, adminAccess: 'read' });
const MANDATORY = attribute({ id: 'a3', key: 'ean', labelDefault: 'EAN', label: { 'en-US': 'EAN' }, isRequired: true });

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
    path === LIST_PATH
      ? Promise.resolve({ data: [attribute({}), SKU_CODE, MANDATORY] })
      : Promise.reject(new Error(path)),
  );
  postSpy.mockReset().mockResolvedValue({ data: attribute({}) });
  patchSpy.mockReset().mockResolvedValue({ data: attribute({}) });
});

async function editFormOf(key: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  const row = (await screen.findByText(key)).closest('tr') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: EN['attributes.action.edit']! }));
  await screen.findByText(EN['attributes.edit.title']!.replace('{key}', key));
  return screen.getByLabelText(EN['attributes.field.type']!).closest('form') as HTMLElement;
}

describe('AttributesManager — admin access (feature 175)', () => {
  it('ships its sentences in English and Polish', () => {
    for (const key of [
      'attributes.adminAccess.label',
      'attributes.adminAccess.edit',
      'attributes.adminAccess.read',
      'attributes.adminAccess.hidden',
      'attributes.adminAccess.help',
      'attributes.adminAccess.requiredReason',
    ]) {
      expect(EN[key], `en ${key}`).toBeTruthy();
      expect(PL[key], `pl ${key}`).toBeTruthy();
    }
  });

  it('offers the selector on create, with its help sentence, and sends the choice', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />));
    await screen.findByText('material');
    const form = screen.getByLabelText(EN['attributes.field.type']!).closest('form') as HTMLElement;

    const select = within(form).getByLabelText(EN['attributes.adminAccess.label']!) as HTMLSelectElement;
    expect(Array.from(select.options, (o) => o.value)).toEqual(['edit', 'read', 'hidden']);
    expect(select.value).toBe('edit');
    expect(within(form).getByText(EN['attributes.adminAccess.help']!)).toBeTruthy();

    await user.selectOptions(select, 'hidden');
    await user.type(within(form).getByLabelText(EN['attributes.field.key']!), 'sync_hash');
    await user.click(within(form).getByRole('button', { name: EN['attributes.action.create']! }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(LIST_PATH);
    expect(body).toMatchObject({ key: 'sync_hash', adminAccess: 'hidden' });
  });

  it('shows the stored level on edit and sends a change', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />));
    const form = await editFormOf('erp_sku');
    const select = within(form).getByLabelText(EN['attributes.adminAccess.label']!) as HTMLSelectElement;
    expect(select.value).toBe('read');

    await user.selectOptions(select, 'edit');
    await user.click(within(form).getByRole('button', { name: EN['attributes.action.saveEdit']! }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [path, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`${LIST_PATH}/erp_sku`);
    expect(body).toMatchObject({ adminAccess: 'edit' });
  });

  it('keeps read-only and hidden unavailable, with the reason, while the attribute is required', async () => {
    render(wrap(<AttributesManager />));
    const form = await editFormOf('ean');
    const select = within(form).getByLabelText(EN['attributes.adminAccess.label']!) as HTMLSelectElement;
    const option = (value: string): HTMLOptionElement => Array.from(select.options).find((o) => o.value === value)!;
    expect(option('read').disabled).toBe(true);
    expect(option('hidden').disabled).toBe(true);
    expect(within(form).getByText(EN['attributes.adminAccess.requiredReason']!)).toBeTruthy();
  });
});
