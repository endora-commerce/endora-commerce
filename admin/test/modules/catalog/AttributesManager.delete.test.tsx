import { StrictMode, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-007 – FR-009, owner
 * ruling OR-5, contracts/admin-surfaces.md §5) — **Delete** on the attributes
 * screen, for every attribute type.
 *
 * The confirmation reads `GET …/attributes/:idOrKey/usage` — the query the
 * delete guard itself runs — and says, before anything is sent, what stands in
 * the way (set memberships, product values) and what goes with the attribute
 * (Page Builder content), plus one fixed sentence about other modules' rules,
 * which the catalogue cannot count.
 */

const getSpy = vi.fn();
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
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { AttributesManager } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/AttributesManager'
);

const EN = catalogEn as Record<string, string>;
const LIST_PATH = '/api/v1/admin/catalog/attributes';

function attribute(id: string, key: string, valueType: string): Record<string, unknown> {
  return {
    id,
    key,
    label: { 'en-US': `Label ${key}` },
    labelDefault: `Label ${key}`,
    valueType,
    enumValues: valueType === 'select' ? ['a'] : null,
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
    channelScoped: false,
    languageScoped: valueType === 'page_builder',
  };
}

const ATTRIBUTES = [
  attribute('a1', 'material', 'string'),
  attribute('a2', 'colour', 'select'),
  attribute('a3', 'buying_guide', 'page_builder'),
  attribute('a4', 'weight', 'number'),
];

type Usage = { attributeSetCount: number; productValueCount: number; productContentCount: number };
const NONE: Usage = { attributeSetCount: 0, productValueCount: 0, productContentCount: 0 };
let usageByKey: Record<string, Usage>;
let listed: Array<Record<string, unknown>>;

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

const fill = (key: string, params: Record<string, string | number>): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), EN[key]!);

beforeEach(() => {
  usageByKey = {};
  listed = [...ATTRIBUTES];
  getSpy.mockReset().mockImplementation(async (path: string) => {
    if (path === LIST_PATH) return { data: listed };
    const usage = /^\/api\/v1\/admin\/catalog\/attributes\/([^/]+)\/usage$/.exec(path);
    if (usage) return { data: usageByKey[usage[1]!] ?? NONE };
    throw new Error(`unexpected GET ${path}`);
  });
  deleteSpy.mockReset().mockImplementation(async (path: string) => {
    listed = listed.filter((a) => `${LIST_PATH}/${String(a['key'])}` !== path);
    return undefined;
  });
});

async function openDelete(key: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  const row = (await screen.findByText(key)).closest('tr') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: EN['attributes.delete.action']! }));
  return screen.findByRole('dialog');
}

const confirmButton = (dialog: HTMLElement): HTMLElement =>
  within(dialog).getByRole('button', { name: EN['attributes.delete.confirm']! });

describe('AttributesManager — Delete for every attribute type (feature 172, OR-5)', () => {
  it('offers Delete on a row of every type', async () => {
    render(wrap(<AttributesManager />));
    await screen.findByText('material');
    for (const a of ATTRIBUTES) {
      const row = screen.getByText(String(a['key'])).closest('tr') as HTMLElement;
      expect(within(row).getByRole('button', { name: EN['attributes.delete.action']! })).toBeTruthy();
    }
  });

  it('loads the usage, names the attribute, always states the foreign-rules note, and deletes on confirm', async () => {
    const user = userEvent.setup();
    render(wrap(<AttributesManager />));
    const dialog = await openDelete('colour');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${LIST_PATH}/colour/usage`));
    expect(within(dialog).getByText(fill('attributes.delete.title', { attribute: 'Label colour' }))).toBeTruthy();
    await within(dialog).findByText(EN['attributes.delete.foreignRules']!);
    expect(within(dialog).queryByText(/products carry content/)).toBeNull();

    await waitFor(() => expect(confirmButton(dialog)).not.toBeDisabled());
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${LIST_PATH}/colour`));
    // The list is read again, and the row is gone.
    await waitFor(() => expect(screen.queryByText('colour')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says why, and keeps confirm disabled, while the attribute is in a set', async () => {
    usageByKey['material'] = { ...NONE, attributeSetCount: 2 };
    render(wrap(<AttributesManager />));
    const dialog = await openDelete('material');
    await within(dialog).findByText(fill('attributes.delete.inSets', { count: 2 }));
    expect(confirmButton(dialog)).toBeDisabled();
    expect(within(dialog).getByText(EN['attributes.delete.foreignRules']!)).toBeTruthy();
  });

  it('says why, and keeps confirm disabled, while products hold a value', async () => {
    usageByKey['weight'] = { ...NONE, productValueCount: 7 };
    render(wrap(<AttributesManager />));
    const dialog = await openDelete('weight');
    await within(dialog).findByText(fill('attributes.delete.hasValues', { count: 7 }));
    expect(confirmButton(dialog)).toBeDisabled();
  });

  it('shows how much content goes with a content attribute, and still lets it be deleted', async () => {
    usageByKey['buying_guide'] = { ...NONE, productContentCount: 12 };
    render(wrap(<AttributesManager />));
    const dialog = await openDelete('buying_guide');
    await within(dialog).findByText(fill('attributes.delete.contentCount', { count: 12 }));
    await waitFor(() => expect(confirmButton(dialog)).not.toBeDisabled());
  });

  it('shows the API message when the delete is refused after the dialog opened', async () => {
    const user = userEvent.setup();
    deleteSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Attribute is still referenced by 1 product(s); clear values first.',
          requestId: 'r',
        },
      }),
    );
    render(wrap(<AttributesManager />));
    const dialog = await openDelete('material');
    await waitFor(() => expect(confirmButton(dialog)).not.toBeDisabled());
    await user.click(confirmButton(dialog));
    await within(dialog).findByText('Attribute is still referenced by 1 product(s); clear values first.');
    expect(screen.getByText('material')).toBeTruthy();
  });
});
