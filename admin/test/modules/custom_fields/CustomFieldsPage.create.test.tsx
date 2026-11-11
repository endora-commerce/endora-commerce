import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError, AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #447 — a field is fully defined when it is created. Create and edit
 * share one definition form: the same sections in the same order, labels per
 * admin language, options with their own labels, default flag and order, and
 * the audience in both views. Create sends **one** request carrying all of it.
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
    list: async (entityType?: string) => (entityType === 'organization' ? [EXISTING] : []),
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

const EN = en as Record<string, string>;

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  client.create.mockReset().mockResolvedValue({});
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
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    { custom_fields: EN, core: coreEn as Record<string, string> },
  );
}

async function openCreate(): Promise<HTMLElement> {
  renderPage();
  await screen.findByText('po_number');
  fireEvent.click(screen.getByRole('button', { name: 'New field' }));
  return screen.findByRole('dialog', { name: 'New field' });
}

const type = (scope: HTMLElement, label: string, value: string): void => {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
};

/** The definition's own label inputs: option rows carry inputs of the same names. */
const labels = (dialog: HTMLElement): HTMLElement => within(dialog).getByRole('group', { name: 'Labels' });

/** The option rows, in their order — each a group named by its label; the reorder buttons are groups too. */
const optionRows = (dialog: HTMLElement): HTMLElement[] =>
  within(within(dialog).getByRole('region', { name: 'Options' }))
    .getAllByRole('group')
    .filter((group) => group.hasAttribute('data-option-row'));

function addOption(dialog: HTMLElement, value: string, labelDefault: string, en?: string, pl?: string): HTMLElement {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add option' }));
  const row = optionRows(dialog).at(-1)!;
  type(row, 'Stored value', value);
  type(row, 'Default label', labelDefault);
  if (en !== undefined) type(row, 'English label', en);
  if (pl !== undefined) type(row, 'Polish label', pl);
  return row;
}

function fillIdentity(dialog: HTMLElement, key: string, labelDefault: string): void {
  type(dialog, 'Key', key);
  type(labels(dialog), 'Default label', labelDefault);
}

const submit = (dialog: HTMLElement): void => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
};

describe('CustomFieldsPage — creating a field in the definition form (issue #447)', () => {
  it('opens the form in a dialog with the sections in order, the key focused, and no comma-separated options box', async () => {
    const dialog = await openCreate();
    expect(within(dialog).getByLabelText('Key')).toHaveFocus();
    expect(within(dialog).getByLabelText('Record type')).toHaveValue('organization');
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
    const headings = within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    const legends = Array.from(dialog.querySelectorAll('legend')).map((legend) => legend.textContent);
    expect(headings).toEqual(['Definition', 'Options']);
    expect(legends).toEqual(['Labels', 'Rules']);
    expect(within(dialog).queryByPlaceholderText('gold, silver')).toBeNull();
    expect(within(dialog).queryByLabelText(/comma-separated/i)).toBeNull();
  });

  it('sends one create request carrying both language labels', async () => {
    const dialog = await openCreate();
    fillIdentity(dialog, 'po_ref', 'PO reference');
    type(labels(dialog), 'English label', 'PO reference');
    type(labels(dialog), 'Polish label', 'Numer zamówienia');
    submit(dialog);
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
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('creates a select field with three options in one request: labels per language, the default and the order', async () => {
    const dialog = await openCreate();
    fillIdentity(dialog, 'region', 'Region');
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
    addOption(dialog, 'north', 'North', 'North', 'Północ');
    const south = addOption(dialog, 'south', 'South', undefined, 'Południe');
    const east = addOption(dialog, 'east', 'East', 'East');
    fireEvent.click(within(south).getByLabelText('Default'));
    fireEvent.click(within(east).getByRole('button', { name: 'Move up' }));
    expect(within(dialog).getByText('“East” moved up to position 2 of 3.')).toHaveAttribute('role', 'status');
    expect(optionRows(dialog).map((row) => row.getAttribute('aria-label'))).toEqual(['North', 'East', 'South']);
    submit(dialog);
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
    const dialog = await openCreate();
    fillIdentity(dialog, 'tags', 'Tags');
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'multiselect' } });
    fireEvent.click(within(addOption(dialog, 'a', 'A')).getByLabelText('Default'));
    fireEvent.click(within(addOption(dialog, 'b', 'B')).getByLabelText('Default'));
    submit(dialog);
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    const { options } = client.create.mock.calls[0]![0] as { options: Array<{ isDefault: boolean }> };
    expect(options.map((o) => o.isDefault)).toEqual([true, true]);
  });

  it('removes a draft option and moves focus to the next control', async () => {
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
    addOption(dialog, 'a', 'A');
    addOption(dialog, 'b', 'B');
    fireEvent.click(within(optionRows(dialog)[0]!).getByRole('button', { name: 'Remove' }));
    expect(optionRows(dialog).map((row) => row.getAttribute('aria-label'))).toEqual(['B']);
    expect(within(optionRows(dialog)[0]!).getByLabelText('Stored value')).toHaveFocus();
  });

  it('sends the audience the operator chose', async () => {
    const dialog = await openCreate();
    fillIdentity(dialog, 'gift_note', 'Gift note');
    fireEvent.change(within(dialog).getByLabelText('Who can see the value'), { target: { value: 'customer' } });
    submit(dialog);
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'gift_note', audience: 'customer' });
  });

  describe('refuses before anything is sent', () => {
    it('a key in the wrong format, said at the key, which takes the focus', async () => {
      const dialog = await openCreate();
      fillIdentity(dialog, 'PO-Number', 'PO');
      submit(dialog);
      const key = within(dialog).getByLabelText('Key');
      await waitFor(() => expect(key).toHaveFocus());
      expect(key).toHaveAttribute('aria-invalid', 'true');
      expect(key).toHaveAccessibleDescription(expect.stringContaining(EN['customFields.validation.keyFormat']!));
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a missing default label', async () => {
      const dialog = await openCreate();
      type(dialog, 'Key', 'po_ref');
      submit(dialog);
      const input = within(labels(dialog)).getByLabelText('Default label');
      await waitFor(() => expect(input).toHaveFocus());
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(within(dialog).getByText('Enter a default label.')).toBeInTheDocument();
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a choice field without options', async () => {
      const dialog = await openCreate();
      fillIdentity(dialog, 'region', 'Region');
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
      submit(dialog);
      expect(await within(dialog).findByText(EN['customFields.validation.optionsRequired']!)).toBeInTheDocument();
      expect(client.create).not.toHaveBeenCalled();
    });

    it('an empty stored value and an option without a default label', async () => {
      const dialog = await openCreate();
      fillIdentity(dialog, 'region', 'Region');
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
      addOption(dialog, '', 'North');
      addOption(dialog, 'south', '');
      submit(dialog);
      const [first, second] = optionRows(dialog);
      await waitFor(() => expect(within(first!).getByLabelText('Stored value')).toHaveFocus());
      expect(within(first!).getByLabelText('Stored value')).toHaveAttribute('aria-invalid', 'true');
      expect(within(first!).getByText(EN['customFields.validation.optionValueRequired']!)).toBeInTheDocument();
      expect(within(second!).getByLabelText('Default label')).toHaveAttribute('aria-invalid', 'true');
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a stored value used twice', async () => {
      const dialog = await openCreate();
      fillIdentity(dialog, 'region', 'Region');
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
      addOption(dialog, 'north', 'North');
      addOption(dialog, 'north', 'North again');
      submit(dialog);
      const second = optionRows(dialog)[1]!;
      expect(
        await within(second).findByText('Another option already uses the stored value “north”.'),
      ).toBeInTheDocument();
      expect(client.create).not.toHaveBeenCalled();
    });

    it('a second default option on a single-choice field, at the option', async () => {
      const dialog = await openCreate();
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
      const north = addOption(dialog, 'north', 'North');
      const south = addOption(dialog, 'south', 'South');
      fireEvent.click(within(north).getByLabelText('Default'));
      fireEvent.click(within(south).getByLabelText('Default'));
      expect(within(south).getByLabelText('Default')).not.toBeChecked();
      expect(
        within(south).getByText('A single-choice field can start with one default option only. Clear “North” first.'),
      ).toBeInTheDocument();
    });

    it('two defaults left over from a multiple-choice draft switched to single choice', async () => {
      const dialog = await openCreate();
      fillIdentity(dialog, 'region', 'Region');
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'multiselect' } });
      fireEvent.click(within(addOption(dialog, 'north', 'North')).getByLabelText('Default'));
      fireEvent.click(within(addOption(dialog, 'south', 'South')).getByLabelText('Default'));
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
      submit(dialog);
      const south = optionRows(dialog)[1]!;
      await waitFor(() => expect(within(south).getByLabelText('Default')).toHaveFocus());
      expect(within(south).getByLabelText('Default')).toHaveAttribute('aria-invalid', 'true');
      expect(client.create).not.toHaveBeenCalled();
    });
  });

  it('shows a taken key at the key, in words, never as a code', async () => {
    client.create.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'CUSTOM_FIELD_KEY_CONFLICT' as never, message: 'A field "po_ref" already exists on organization.' },
      }),
    );
    const dialog = await openCreate();
    fillIdentity(dialog, 'po_ref', 'PO');
    submit(dialog);
    const sentence = 'A field with the key “po_ref” already exists for this record type. Choose another key.';
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    const key = within(dialog).getByLabelText('Key');
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(key).toHaveAccessibleDescription(expect.stringContaining(sentence));
    await waitFor(() => expect(key).toHaveFocus());
    expect(within(dialog).queryByText(/CUSTOM_FIELD_/)).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('shows a refusal about stored values at the audience', async () => {
    const message = 'Records already hold values under “po_ref”, left by a field that was deleted.';
    client.create.mockRejectedValue(
      new ApiError(409, { error: { code: 'CUSTOM_FIELD_STORED_VALUES_EXIST' as never, message, details: { key: 'po_ref' } } }),
    );
    const dialog = await openCreate();
    fillIdentity(dialog, 'po_ref', 'PO');
    fireEvent.change(within(dialog).getByLabelText('Who can see the value'), { target: { value: 'customer' } });
    submit(dialog);
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Who can see the value')).toHaveAccessibleDescription(
      expect.stringContaining(message),
    );
  });

  it('says any other refusal beside the submit button, with the server sentence', async () => {
    client.create.mockRejectedValue(
      new ApiError(422, { error: { code: 'CUSTOM_FIELD_DEFINITION_INVALID' as never, message: 'Something is off.' } }),
    );
    const dialog = await openCreate();
    fillIdentity(dialog, 'po_ref', 'PO');
    submit(dialog);
    expect(await within(dialog).findByText('Something is off.')).toHaveAttribute('role', 'alert');
  });

  it('marks the submit busy while the request is in flight', async () => {
    let finish!: (value: unknown) => void;
    client.create.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const dialog = await openCreate();
    fillIdentity(dialog, 'po_ref', 'PO');
    submit(dialog);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Add field' })).toHaveAttribute('aria-busy', 'true'));
    finish({});
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no axe violations with the create dialog and an option row open', async () => {
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'select' } });
    addOption(dialog, 'north', 'North');
    await expectNoAxeViolations(dialog);
  });
});

describe('CustomFieldsPage — the audience in the edit dialog (issue #447)', () => {
  it('offers the audience in the dialog and sends it with the save', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit po_number' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit po_number' });
    const audience = within(dialog).getByLabelText('Who can see the value');
    expect(audience).toHaveValue('customer');
    fireEvent.change(audience, { target: { value: 'internal' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(EXISTING.id, { audience: 'internal' }));
  });
});
