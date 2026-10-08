import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 022 / T027 — interaction test for the Mass-editable toggle
 * inside the existing attributes table. Confirms the column renders,
 * the checkbox reflects the row's `massEditable` state, and clicking
 * it issues a PATCH to `/admin/catalog/attributes/:key` with the
 * single-field patch `{ massEditable: <next> }`.
 */

const postSpy = vi.fn();
const getSpy = vi.fn();
const patchSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
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

const BUNDLE = passthroughBundle('catalog', [
  'attributes.page.title',
  'attributes.page.description',
  'attributes.create.title',
  'attributes.column.key',
  'attributes.column.label',
  'attributes.column.type',
  'attributes.column.enumValues',
  'attributes.column.searchable',
  'attributes.column.filterable',
  'attributes.column.variantAxis',
  'attributes.column.comparable',
  'attributes.column.massEditable',
  'attributes.column.priceRule',
  'attributes.flag.priceRule',
  'attributes.loading',
  'attributes.empty',
  'attributes.success.create',
  'attributes.success.update',
  'attributes.error.load',
  'attributes.error.update',
  'attributes.error.create',
  'attributes.action.create',
  'attributes.action.save',
  'attributes.action.cancel',
  'attributes.batch.unsaved',
]);

const seedAttribute = (massEditable: boolean, isPriceRule = false): unknown => ({
  id: 'a1',
  key: 'brand',
  label: { 'en-US': 'Brand' },
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
  isPriceRule,
  filterPosition: 0,
  isVisibleOnProductPage: true,
  massEditable,
});

describe('AttributesManager — Mass-editable toggle (T027)', () => {
  beforeEach(() => {
    postSpy.mockReset();
    getSpy.mockReset();
    patchSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('patches the attribute when the Mass-editable flag is toggled and saved', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute(false)] });
    patchSpy.mockResolvedValue({ data: seedAttribute(true) });

    renderWithI18n(<AttributesManager />, BUNDLE);

    // The column header renders the passthrough key.
    await screen.findByText('attributes.column.massEditable');

    // Find the row by the attribute key.
    const keyCell = await screen.findByText('brand');
    const row = keyCell.closest('tr')!;
    expect(row).not.toBeNull();

    // Select the Mass-editable toggle by its stable aria-label
    // (`${attributeKey}-${flagKey}`) so the test is unaffected by column order.
    const massEditableCheckbox = within(row).getByLabelText('brand-massEditable') as HTMLInputElement;
    expect(massEditableCheckbox.checked).toBe(false);

    const user = userEvent.setup();
    await user.click(massEditableCheckbox);

    // Flag edits are staged locally and flushed in one batch on Save.
    const saveButton = await screen.findByText('attributes.action.save');
    await user.click(saveButton);

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/attributes/brand');
    expect(patchSpy.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ massEditable: true }),
    );
  });

  it('renders the checkbox as checked when the attribute is already flagged', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute(true)] });

    renderWithI18n(<AttributesManager />, BUNDLE);

    const keyCell = await screen.findByText('brand');
    const row = keyCell.closest('tr')!;
    const massEditableCheckbox = within(row).getByLabelText('brand-massEditable') as HTMLInputElement;
    expect(massEditableCheckbox.checked).toBe(true);
  });
});

/**
 * `isPriceRule` — whether the attribute may be used as a price-building rule
 * in a Price List. A sibling of the other list flags: a togglable column in
 * the table and a checkbox in the create/edit form.
 */
describe('AttributesManager — Price-rule flag', () => {
  beforeEach(() => {
    postSpy.mockReset();
    getSpy.mockReset();
    patchSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column and reflects the persisted flag', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute(false, true)] });

    renderWithI18n(<AttributesManager />, BUNDLE);

    await screen.findByText('attributes.column.priceRule');
    const row = (await screen.findByText('brand')).closest('tr')!;
    const checkbox = within(row).getByLabelText('brand-isPriceRule') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('patches isPriceRule when the list toggle is flipped and saved', async () => {
    getSpy.mockResolvedValue({ data: [seedAttribute(false)] });
    patchSpy.mockResolvedValue({ data: seedAttribute(false, true) });

    renderWithI18n(<AttributesManager />, BUNDLE);

    const row = (await screen.findByText('brand')).closest('tr')!;
    const checkbox = within(row).getByLabelText('brand-isPriceRule') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const user = userEvent.setup();
    await user.click(checkbox);
    await user.click(await screen.findByText('attributes.action.save'));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/attributes/brand');
    expect(patchSpy.mock.calls[0]![1]).toEqual(expect.objectContaining({ isPriceRule: true }));
  });

  it('sends isPriceRule from the create form', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: seedAttribute(false, true) });

    renderWithI18n(<AttributesManager />, BUNDLE);

    const user = userEvent.setup();
    const flag = await screen.findByLabelText('attributes.flag.priceRule');
    expect((flag as HTMLInputElement).checked).toBe(false);
    await user.click(flag);
    // The key is the form's one required field; without it the browser's own
    // validation stops the submit before the handler runs.
    await user.type(document.getElementById('akey') as HTMLInputElement, 'margin_class');
    await user.click(screen.getByText('attributes.action.create'));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![0]).toBe('/api/v1/admin/catalog/attributes');
    expect(postSpy.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ key: 'margin_class', isPriceRule: true }),
    );
  });
});
