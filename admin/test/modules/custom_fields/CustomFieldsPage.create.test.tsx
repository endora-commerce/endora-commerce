import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { chooseRowAction } from './row-actions';
import { currentAddress, findEditor, renderCustomFieldsRoutes } from './routes-harness';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #447 — a field is fully defined when it is created. Create and edit
 * share one definition form: the same sections in the same order, labels per
 * admin language, options with their own labels, default flag and order, and
 * the audience in both views. Create sends **one** request carrying all of it.
 * Since issue #1804 the form is a page of its own, `/custom-fields/new`.
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: [], customerInputSurfaces: [] },
  { entityType: 'organization', labelKey: 'customFields.entity.organization', listFilter: false, carryTargets: [], customerInputSurfaces: [] },
];

const EXISTING: CustomFieldDefinitionDto = {
  id: '00000000-0000-4000-8000-00000000cf01',
  entityType: 'organization',
  key: 'po_number',
  label: {},
  labelDefault: 'PO number',
  valueType: 'text',
  required: false,
  audience: 'customer',
  sortOrder: 0,
  config: {},
  listFilter: false,
  carryTo: [],
  customerInput: [],
  adminAccess: 'edit',
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const client = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    // Every type's definitions when no type is named: the editor page reads them all (issue #1804).
    list: async (entityType?: string) => (entityType === undefined || entityType === 'organization' ? [EXISTING] : []),
    get: async () => EXISTING,
    create: (...args: unknown[]) => client.create(...args),
    update: (...args: unknown[]) => client.update(...args),
    remove: async () => ({}),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);
const { CustomFieldEditorPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldEditorPage'
);

const EN = en as Record<string, string>;

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  client.create.mockReset().mockResolvedValue({ id: 'created' });
  client.update.mockReset().mockResolvedValue(EXISTING);
  nativeDialogs = [
    vi.spyOn(window, 'confirm').mockImplementation(() => false),
    vi.spyOn(window, 'prompt').mockImplementation(() => null),
    vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of nativeDialogs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function renderPage(): void {
  renderCustomFieldsRoutes(
    { CustomFieldsPage, CustomFieldEditorPage },
    { bundle: { custom_fields: EN, core: coreEn as Record<string, string> } },
  );
}

async function openCreate(): Promise<HTMLElement> {
  renderPage();
  await screen.findByText('po_number');
  fireEvent.click(screen.getByRole('link', { name: 'New field' }));
  return findEditor('New field');
}

/** Back on the list after a save: the editor is gone and the address is the list's. */
async function backOnList(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  expect(currentAddress()).toMatch(/^\/custom-fields\?entityType=/);
}

const type = (scope: HTMLElement, label: string, value: string): void => {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
};

/** The definition's own label inputs: option rows carry inputs of the same names. */
const labels = (editor: HTMLElement): HTMLElement => within(editor).getByRole('group', { name: 'Labels' });

/** The option rows, in their order — each a group named by its label; the reorder buttons are groups too. */
const optionRows = (editor: HTMLElement): HTMLElement[] =>
  within(within(editor).getByRole('region', { name: 'Options' }))
    .getAllByRole('group')
    .filter((group) => group.hasAttribute('data-option-row'));

function addOption(editor: HTMLElement, value: string, labelDefault: string, en?: string, pl?: string): HTMLElement {
  fireEvent.click(within(editor).getByRole('button', { name: 'Add option' }));
  const row = optionRows(editor).at(-1)!;
  type(row, 'Stored value', value);
  type(row, 'Default label', labelDefault);
  if (en !== undefined) type(row, 'English label', en);
  if (pl !== undefined) type(row, 'Polish label', pl);
  return row;
}

function fillIdentity(editor: HTMLElement, key: string, labelDefault: string): void {
  type(editor, 'Key', key);
  type(labels(editor), 'Default label', labelDefault);
}

const submit = (editor: HTMLElement): void => {
  fireEvent.click(within(editor).getByRole('button', { name: 'Add field' }));
};

describe('CustomFieldsPage — creating a field in the definition form (issues #447, #1804)', () => {
  it('opens the form on its page with the sections in order, the default label focused, and no comma-separated options box', async () => {
    const editor = await openCreate();
    // The key is derived from it (issue #1531), so the label is what is typed first.
    await waitFor(() => expect(within(labels(editor)).getByLabelText('Default label')).toHaveFocus());
    expect(within(editor).getByLabelText('Record type')).toHaveValue('organization');
    fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
    const headings = within(editor)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    const legends = Array.from(editor.querySelectorAll('legend')).map((legend) => legend.textContent);
    expect(headings).toEqual(['Definition', 'Options']);
    expect(legends).toEqual(['Labels', 'Rules']);
    expect(within(editor).queryByPlaceholderText('gold, silver')).toBeNull();
    expect(within(editor).queryByLabelText(/comma-separated/i)).toBeNull();
  });

  it('sends one create request carrying both language labels', async () => {
    const editor = await openCreate();
    fillIdentity(editor, 'po_ref', 'PO reference');
    type(labels(editor), 'English label', 'PO reference');
    type(labels(editor), 'Polish label', 'Numer zamówienia');
    submit(editor);
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({
      entityType: 'organization',
      key: 'po_ref',
      labelDefault: 'PO reference',
      label: { en: 'PO reference', pl: 'Numer zamówienia' },
      valueType: 'text',
      options: [],
      audience: 'internal',
    });
    await backOnList();
  });

  it('creates a select field with three options in one request: labels per language, the default and the order', async () => {
    const editor = await openCreate();
    fillIdentity(editor, 'region', 'Region');
    fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
    addOption(editor, 'north', 'North', 'North', 'Północ');
    const south = addOption(editor, 'south', 'South', undefined, 'Południe');
    const east = addOption(editor, 'east', 'East', 'East');
    fireEvent.click(within(south).getByLabelText('Default'));
    fireEvent.click(within(east).getByRole('button', { name: 'Move up' }));
    expect(within(editor).getByText('“East” moved up to position 2 of 3.')).toHaveAttribute('role', 'status');
    expect(optionRows(editor).map((row) => row.getAttribute('aria-label'))).toEqual(['North', 'East', 'South']);
    submit(editor);
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'region',
        valueType: 'select',
        options: [
          { value: 'north', labelDefault: 'North', label: { en: 'North', pl: 'Północ' }, isDefault: false, sortOrder: 0 },
          { value: 'east', labelDefault: 'East', label: { en: 'East' }, isDefault: false, sortOrder: 1 },
          { value: 'south', labelDefault: 'South', label: { pl: 'Południe' }, isDefault: true, sortOrder: 2 },
        ],
      }),
    );
  });

  it('allows several default options on a multiple-choice field', async () => {
    const editor = await openCreate();
    fillIdentity(editor, 'tags', 'Tags');
    fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'multiselect' } });
    fireEvent.click(within(addOption(editor, 'a', 'A')).getByLabelText('Default'));
    fireEvent.click(within(addOption(editor, 'b', 'B')).getByLabelText('Default'));
    submit(editor);
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    const { options } = client.create.mock.calls[0]![0] as { options: Array<{ isDefault: boolean }> };
    expect(options.map((o) => o.isDefault)).toEqual([true, true]);
  });

  it('removes a draft option and moves focus to the next control', async () => {
    const editor = await openCreate();
    fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
    addOption(editor, 'a', 'A');
    addOption(editor, 'b', 'B');
    fireEvent.click(within(optionRows(editor)[0]!).getByRole('button', { name: 'Remove' }));
    expect(optionRows(editor).map((row) => row.getAttribute('aria-label'))).toEqual(['B']);
    expect(within(optionRows(editor)[0]!).getByLabelText('Stored value')).toHaveFocus();
  });

  it('sends the audience the operator chose', async () => {
    const editor = await openCreate();
    fillIdentity(editor, 'gift_note', 'Gift note');
    fireEvent.change(within(editor).getByLabelText('Who can see the value'), { target: { value: 'customer' } });
    submit(editor);
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'gift_note', audience: 'customer' });
  });

  describe('refuses before anything is sent', () => {
    it('a key in the wrong format, said at the key, which takes the focus', async () => {
      const editor = await openCreate();
      // Normalised to `1_po` on submit, and still refused: a key starts with a letter.
      fillIdentity(editor, '1-PO', 'PO');
      submit(editor);
      const key = within(editor).getByLabelText('Key');
      await waitFor(() => expect(key).toHaveFocus());
      expect(key).toHaveAttribute('aria-invalid', 'true');
      expect(key).toHaveAccessibleDescription(expect.stringContaining(EN['customFields.validation.keyFormat']!));
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a missing default label', async () => {
      const editor = await openCreate();
      type(editor, 'Key', 'po_ref');
      submit(editor);
      const input = within(labels(editor)).getByLabelText('Default label');
      await waitFor(() => expect(input).toHaveFocus());
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(within(editor).getByText('Enter a default label.')).toBeInTheDocument();
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a choice field without options', async () => {
      const editor = await openCreate();
      fillIdentity(editor, 'region', 'Region');
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
      submit(editor);
      expect(await within(editor).findByText(EN['customFields.validation.optionsRequired']!)).toBeInTheDocument();
      expect(client.create).not.toHaveBeenCalled();
    });

    it('an empty stored value and an option without a default label', async () => {
      const editor = await openCreate();
      fillIdentity(editor, 'region', 'Region');
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
      addOption(editor, '', 'North');
      addOption(editor, 'south', '');
      submit(editor);
      const [first, second] = optionRows(editor);
      await waitFor(() => expect(within(first!).getByLabelText('Stored value')).toHaveFocus());
      expect(within(first!).getByLabelText('Stored value')).toHaveAttribute('aria-invalid', 'true');
      expect(within(first!).getByText(EN['customFields.validation.optionValueRequired']!)).toBeInTheDocument();
      expect(within(second!).getByLabelText('Default label')).toHaveAttribute('aria-invalid', 'true');
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a stored value used twice', async () => {
      const editor = await openCreate();
      fillIdentity(editor, 'region', 'Region');
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
      addOption(editor, 'north', 'North');
      addOption(editor, 'north', 'North again');
      submit(editor);
      const second = optionRows(editor)[1]!;
      expect(
        await within(second).findByText('Another option already uses the stored value “north”.'),
      ).toBeInTheDocument();
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a second default option on a single-choice field, at the option', async () => {
      const editor = await openCreate();
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
      const north = addOption(editor, 'north', 'North');
      const south = addOption(editor, 'south', 'South');
      fireEvent.click(within(north).getByLabelText('Default'));
      fireEvent.click(within(south).getByLabelText('Default'));
      expect(within(south).getByLabelText('Default')).not.toBeChecked();
      expect(
        within(south).getByText('A single-choice field can start with one default option only. Clear “North” first.'),
      ).toBeInTheDocument();
    });

    it('two defaults left over from a multiple-choice draft switched to single choice', async () => {
      const editor = await openCreate();
      fillIdentity(editor, 'region', 'Region');
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'multiselect' } });
      fireEvent.click(within(addOption(editor, 'north', 'North')).getByLabelText('Default'));
      fireEvent.click(within(addOption(editor, 'south', 'South')).getByLabelText('Default'));
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
      submit(editor);
      const south = optionRows(editor)[1]!;
      await waitFor(() => expect(within(south).getByLabelText('Default')).toHaveFocus());
      expect(within(south).getByLabelText('Default')).toHaveAttribute('aria-invalid', 'true');
      expect(client.create).not.toHaveBeenCalled();
    });
  });

  describe('derives the key from the default label (issue #1531, DS-22)', () => {
    it('follows the default label, Polish diacritics folded, and says the key cannot change later', async () => {
      const editor = await openCreate();
      const key = within(editor).getByLabelText('Key');
      expect(key).toHaveAccessibleDescription(EN['customFields.form.keyHelp']!);
      type(labels(editor), 'Default label', 'Numer zamówienia');
      expect(key).toHaveValue('numer_zamowienia');
      submit(editor);
      await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
      expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'numer_zamowienia', labelDefault: 'Numer zamówienia' });
    });

    it('stops following once the operator edits the key, and resumes when it is cleared', async () => {
      const editor = await openCreate();
      const key = within(editor).getByLabelText('Key');
      type(labels(editor), 'Default label', 'Gift');
      type(editor, 'Key', 'gift_note');
      type(labels(editor), 'Default label', 'Gift message');
      expect(key).toHaveValue('gift_note');
      type(editor, 'Key', '');
      type(labels(editor), 'Default label', 'Gift wrap');
      expect(key).toHaveValue('gift_wrap');
    });

    it('normalises a typed key on blur instead of refusing it', async () => {
      const editor = await openCreate();
      const key = within(editor).getByLabelText('Key');
      type(editor, 'Key', 'PO-Number');
      fireEvent.blur(key);
      expect(key).toHaveValue('po_number');
    });

    it('refuses a key the record type already has before anything is sent, never suffixing it', async () => {
      const editor = await openCreate();
      type(labels(editor), 'Default label', 'PO number');
      submit(editor);
      const key = within(editor).getByLabelText('Key');
      expect(key).toHaveValue('po_number');
      const sentence = 'A field with the key “po_number” already exists for this record type. Choose another key.';
      await waitFor(() => expect(key).toHaveAccessibleDescription(expect.stringContaining(sentence)));
      expect(key).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(key).toHaveFocus());
      expect(client.create).not.toHaveBeenCalled();
    });
  });

  it('shows a taken key at the key, in words, never as a code', async () => {
    client.create.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'CUSTOM_FIELD_KEY_CONFLICT' as never, message: 'A field "po_ref" already exists on organization.' },
      }),
    );
    const editor = await openCreate();
    fillIdentity(editor, 'po_ref', 'PO');
    submit(editor);
    const sentence = 'A field with the key “po_ref” already exists for this record type. Choose another key.';
    expect(await within(editor).findByText(sentence)).toBeInTheDocument();
    const key = within(editor).getByLabelText('Key');
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(key).toHaveAccessibleDescription(expect.stringContaining(sentence));
    await waitFor(() => expect(key).toHaveFocus());
    expect(within(editor).queryByText(/CUSTOM_FIELD_/)).toBeNull();
    expect(screen.getByRole('form', { name: 'New field' })).toBe(editor);
  });

  it('shows a refusal about stored values at the audience', async () => {
    const message = 'Records already hold values under “po_ref”, left by a field that was deleted.';
    client.create.mockRejectedValue(
      new ApiError(409, { error: { code: 'CUSTOM_FIELD_STORED_VALUES_EXIST' as never, message, details: { key: 'po_ref' } } }),
    );
    const editor = await openCreate();
    fillIdentity(editor, 'po_ref', 'PO');
    fireEvent.change(within(editor).getByLabelText('Who can see the value'), { target: { value: 'customer' } });
    submit(editor);
    expect(await within(editor).findByText(message)).toBeInTheDocument();
    expect(within(editor).getByLabelText('Who can see the value')).toHaveAccessibleDescription(
      expect.stringContaining(message),
    );
  });

  it('says any other refusal beside the submit button, with the server sentence', async () => {
    client.create.mockRejectedValue(
      new ApiError(422, { error: { code: 'CUSTOM_FIELD_DEFINITION_INVALID' as never, message: 'Something is off.' } }),
    );
    const editor = await openCreate();
    fillIdentity(editor, 'po_ref', 'PO');
    submit(editor);
    // In the sticky bar, beside the submit button (README *The editor's one Save*).
    const sentence = await within(editor).findByText('Something is off.');
    expect(sentence.closest('[role="alert"]')).not.toBeNull();
    expect(sentence.closest('[data-slot="sticky-form-actions"]')).not.toBeNull();
  });

  it('marks the submit busy while the request is in flight', async () => {
    let finish!: (value: unknown) => void;
    client.create.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const editor = await openCreate();
    fillIdentity(editor, 'po_ref', 'PO');
    submit(editor);
    await waitFor(() => expect(within(editor).getByRole('button', { name: 'Add field' })).toHaveAttribute('aria-busy', 'true'));
    finish({ id: 'created' });
    await backOnList();
  });

  it('has no axe violations with the create page and an option row open', async () => {
    const editor = await openCreate();
    fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
    addOption(editor, 'north', 'North');
    await expectNoAxeViolations(editor);
  });
});

describe('CustomFieldsPage — the audience in the editor (issue #447)', () => {
  it('offers the audience in the editor and sends it with the save', async () => {
    renderPage();
    await chooseRowAction('po_number', 'edit', EN);
    const editor = await findEditor('Edit po_number');
    const audience = within(editor).getByLabelText('Who can see the value');
    expect(audience).toHaveValue('customer');
    fireEvent.change(audience, { target: { value: 'internal' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(EXISTING.id, { audience: 'internal' }));
  });
});
