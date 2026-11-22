import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { chooseRowAction } from './row-actions';
import { currentAddress, findEditor, renderCustomFieldsRoutes } from './routes-harness';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Feature 157 (T055, US3) — an existing definition is edited
 * (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3), since
 * issue #1804 on its own page, `/custom-fields/:id`, reached from the row's
 * *Edit*. The save sends only what the operator changed (threat model F-6);
 * option actions go through the option sub-routes one at a time, under the
 * section's *Applies immediately*.
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: [], customerInputSurfaces: [] },
  { entityType: 'customer', labelKey: 'customFields.entity.customer', listFilter: false, carryTargets: [], customerInputSurfaces: [] },
];

function definition(overrides: Partial<CustomFieldDefinitionDto>): CustomFieldDefinitionDto {
  return {
    id: '00000000-0000-4000-8000-00000000cf01',
    entityType: 'order',
    key: 'region',
    label: { en: 'Region' },
    labelDefault: 'Region',
    valueType: 'select',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: { hostFlag: true },
    listFilter: false,
    carryTo: [],
    customerInput: [],
    adminAccess: 'edit',
    options: [
      { id: '00000000-0000-4000-8000-0000000000a1', value: 'north', label: { en: 'North' }, labelDefault: 'North', isDefault: false, sortOrder: 0 },
      { id: '00000000-0000-4000-8000-0000000000a2', value: 'south', label: { en: 'South' }, labelDefault: 'South', isDefault: false, sortOrder: 1 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const REGION = definition({});
const TIER = definition({
  id: '00000000-0000-4000-8000-00000000cf02',
  entityType: 'customer',
  key: 'tier',
  label: {},
  labelDefault: 'Tier',
  valueType: 'text',
  options: [],
});
const NORTH_ID = REGION.options[0]!.id!;
const SOUTH_ID = REGION.options[1]!.id!;

/** While the editor page reads its definition, `get` answers the fixture; afterwards the case's own mock. */
const pageLoad = vi.hoisted(() => ({ active: false }));
const client = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  createOption: vi.fn(),
  updateOption: vi.fn(),
  removeOption: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    list: async (entityType?: string) =>
      entityType === undefined ? [REGION, TIER] : entityType === 'customer' ? [TIER] : entityType === 'order' ? [REGION] : [],
    get: (...args: unknown[]) =>
      pageLoad.active ? Promise.resolve([REGION, TIER].find((d) => d.id === args[0])) : client.get(...args),
    create: async () => ({}),
    update: (...args: unknown[]) => client.update(...args),
    remove: async () => ({}),
    createOption: (...args: unknown[]) => client.createOption(...args),
    updateOption: (...args: unknown[]) => client.updateOption(...args),
    removeOption: (...args: unknown[]) => client.removeOption(...args),
  },
}));

/** Every prop set the behaviour block was rendered with — the seam value-carry extends. */
const behaviourProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields')
  >('../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields');
  return {
    ...actual,
    DefinitionBehaviourFields: (props: Parameters<typeof actual.DefinitionBehaviourFields>[0]): ReactNode => {
      behaviourProps.push(props as unknown as Record<string, unknown>);
      return <actual.DefinitionBehaviourFields {...props} />;
    },
  };
});

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);
const { CustomFieldEditorPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldEditorPage'
);

const BUNDLE = { custom_fields: en, core: coreEn as Record<string, string> };
const PL_BUNDLE = { custom_fields: pl as Record<string, string>, core: corePl as Record<string, string> };
const plText = (key: string, params: Record<string, string> = {}): string =>
  (pl as Record<string, string>)[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '');

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.update.mockResolvedValue(REGION);
  client.get.mockResolvedValue(REGION);
  client.createOption.mockResolvedValue({ id: 'new', value: 'east' });
  client.updateOption.mockResolvedValue({ id: NORTH_ID, value: 'north' });
  client.removeOption.mockResolvedValue(undefined);
  behaviourProps.length = 0;
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

async function openEditor(
  entityType: 'order' | 'customer' = 'order',
  key = 'region',
  language: 'en' | 'pl' = 'en',
): Promise<HTMLElement> {
  const text = language === 'pl' ? plText : (k: string, p: Record<string, string> = {}): string =>
    (en as Record<string, string>)[k]!.replace(/\{(\w+)\}/g, (_m, name: string) => p[name] ?? '');
  renderCustomFieldsRoutes(
    { CustomFieldsPage, CustomFieldEditorPage },
    { bundle: language === 'pl' ? PL_BUNDLE : BUNDLE, language },
  );
  const recordType = text('customFields.form.entity');
  const orderLabel = text('customFields.entity.order');
  await waitFor(() =>
    expect(within(screen.getByLabelText(recordType)).getAllByRole('option').map((o) => o.textContent)).toContain(orderLabel),
  );
  fireEvent.change(screen.getByLabelText(recordType), { target: { value: entityType } });
  const title = text('customFields.editor.title', { key });
  pageLoad.active = true;
  await chooseRowAction(key, 'edit', (language === 'pl' ? pl : en) as Record<string, string>);
  const editor = await findEditor(title);
  pageLoad.active = false;
  return editor;
}

/** Back on the list after the editor is done: the form is gone and the address is the list's. */
async function backOnList(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  expect(currentAddress()).toMatch(/^\/custom-fields\?entityType=/);
}

function save(editor: HTMLElement): void {
  fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
}

/** The definition's own label inputs: option rows carry inputs of the same names. */
function labels(editor: HTMLElement): HTMLElement {
  return within(editor).getByRole('group', { name: 'Labels' });
}

function optionRow(editor: HTMLElement, label: string): HTMLElement {
  return within(editor).getByRole('group', { name: label });
}

describe('CustomFieldsPage — the definition editor', () => {
  it('shows key, entity type and value type as read-only text and offers no value-type control (US3-8)', async () => {
    const editor = await openEditor();
    expect(within(editor).getByText('region')).toBeInTheDocument();
    expect(within(editor).getByText('Order')).toBeInTheDocument();
    expect(within(editor).getByText('Single choice')).toBeInTheDocument();
    // The audience and — since feature 175 — the admin access are the editor's
    // only selects (issue #447); type and record type are text.
    const selects = within(editor).getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(selects[0]).toHaveAccessibleName('Who can see the value');
    expect(selects[1]).toHaveAccessibleName('Admin access');
    expect(within(editor).queryByDisplayValue('region')).toBeNull();
  });

  it('sends one PATCH holding only the changed label (F-6, US3-4)', async () => {
    const editor = await openEditor();
    fireEvent.change(within(labels(editor)).getByLabelText('Polish label'), { target: { value: 'Region PL' } });
    save(editor);
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    const [id, body] = client.update.mock.calls[0]!;
    expect(id).toBe(REGION.id);
    expect(body).toEqual({ label: { en: 'Region', pl: 'Region PL' } });
    await backOnList();
  });

  it('sends nothing when nothing changed', async () => {
    const editor = await openEditor();
    save(editor);
    await backOnList();
    expect(client.update).not.toHaveBeenCalled();
  });

  it('turns the list-filter option on (US3-1)', async () => {
    const editor = await openEditor();
    fireEvent.click(within(editor).getByLabelText('Use as list filter'));
    save(editor);
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(REGION.id, { listFilter: true }));
  });

  it('shows the required notice before saving and sends { required: true } (US3-7, FR-003b)', async () => {
    const editor = await openEditor();
    expect(within(editor).queryByText(/Existing records keep loading/)).toBeNull();
    const required = within(editor).getByLabelText('Required');
    fireEvent.click(required);
    expect(within(editor).getByText(/Existing records keep loading/)).toBeInTheDocument();
    expect(required).toHaveAccessibleDescription(/Existing records keep loading/);
    expect(client.update).not.toHaveBeenCalled();
    save(editor);
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(REGION.id, { required: true }));
  });

  it('offers no list-filter toggle for an entity type without the option (US3-2)', async () => {
    const editor = await openEditor('customer', 'tier');
    expect(within(editor).queryByLabelText('Use as list filter')).toBeNull();
  });

  it('hands the behaviour block the edited definition and its entity type entry', async () => {
    await openEditor();
    const props = behaviourProps.at(-1)!;
    expect(props.definition).toMatchObject({
      id: REGION.id,
      key: 'region',
      valueType: 'select',
      audience: 'internal',
      options: REGION.options,
    });
    expect(props.entityTypeInfo).toEqual(ENTITY_TYPES[0]);
    expect(props.value).toEqual({ listFilter: false });
  });

  it('adds an option with its value and labels', async () => {
    const editor = await openEditor();
    const add = within(editor).getByRole('group', { name: 'Add option' });
    fireEvent.change(within(add).getByLabelText('Stored value'), { target: { value: 'east' } });
    fireEvent.change(within(add).getByLabelText('Default label'), { target: { value: 'East' } });
    fireEvent.change(within(add).getByLabelText('Polish label'), { target: { value: 'Wschód' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add option' }));
    await waitFor(() => expect(client.createOption).toHaveBeenCalledTimes(1));
    expect(client.createOption).toHaveBeenCalledWith(REGION.id, {
      value: 'east',
      labelDefault: 'East',
      label: { pl: 'Wschód' },
      isDefault: false,
      sortOrder: 2,
    });
    await waitFor(() => expect(client.get).toHaveBeenCalledWith(REGION.id));
  });

  it('relabels an option without sending its value, which is read-only text', async () => {
    const editor = await openEditor();
    const row = optionRow(editor, 'North');
    expect(within(row).getByText('north')).toBeInTheDocument();
    expect(within(row).queryByDisplayValue('north')).toBeNull();
    const polish = within(row).getByLabelText('Polish label');
    fireEvent.change(polish, { target: { value: 'Północ' } });
    fireEvent.blur(polish);
    await waitFor(() => expect(client.updateOption).toHaveBeenCalledTimes(1));
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, NORTH_ID, { label: { en: 'North', pl: 'Północ' } });
  });

  it('moves an option up by patching the sortOrder of the two that swapped, and announces it', async () => {
    const editor = await openEditor();
    fireEvent.click(within(optionRow(editor, 'South')).getByRole('button', { name: 'Move up' }));
    await waitFor(() => expect(client.updateOption).toHaveBeenCalledTimes(2));
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, SOUTH_ID, { sortOrder: 0 });
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, NORTH_ID, { sortOrder: 1 });
    await waitFor(() =>
      expect(within(editor).getByText('“South” moved up to position 1 of 2.')).toHaveAttribute('role', 'status'),
    );
  });

  it('puts focus back on the moved row after a reorder, on the button still enabled', async () => {
    const reordered = definition({
      options: [
        { ...REGION.options[1]!, sortOrder: 0 },
        { ...REGION.options[0]!, sortOrder: 1 },
      ],
    });
    client.get.mockResolvedValue(reordered);
    const editor = await openEditor();
    const south = optionRow(editor, 'South');
    const moveUp = within(south).getByRole('button', { name: 'Move up' });
    moveUp.focus();
    fireEvent.click(moveUp);
    await waitFor(() => expect(client.get).toHaveBeenCalled());
    // South is first now, so its Move up is disabled and focus lands on its Move down.
    await waitFor(() =>
      expect(within(optionRow(editor, 'South')).getByRole('button', { name: 'Move down' })).toHaveFocus(),
    );
  });

  it('keeps focus and typed text when a label save lands while the operator types on (B1)', async () => {
    let finish!: (value: unknown) => void;
    client.updateOption.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const saved = definition({
      options: [{ ...REGION.options[0]!, labelDefault: 'Northern' }, REGION.options[1]!],
    });
    client.get.mockResolvedValue(saved);
    const user = userEvent.setup();
    const editor = await openEditor();
    const row = optionRow(editor, 'North');
    const defaultLabel = within(row).getByLabelText('Default label');
    const english = within(row).getByLabelText('English label');
    await user.click(defaultLabel);
    await user.clear(defaultLabel);
    await user.type(defaultLabel, 'Northern');
    await user.tab();
    expect(english).toHaveFocus();
    await waitFor(() => expect(client.updateOption).toHaveBeenCalledTimes(1));
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, NORTH_ID, { labelDefault: 'Northern' });
    expect(row).toHaveAttribute('aria-busy', 'true');
    expect(english).toBeEnabled();
    await user.type(english, ' area');
    await act(async () => {
      finish({ id: NORTH_ID, value: 'north' });
    });
    await waitFor(() => expect(client.get).toHaveBeenCalled());
    await waitFor(() => expect(within(editor).getByRole('group', { name: 'Northern' })).toHaveAttribute('aria-busy', 'false'));
    const rowAfter = within(editor).getByRole('group', { name: 'Northern' });
    expect(within(rowAfter).getByLabelText('English label')).toBe(english);
    expect(english).toHaveFocus();
    expect(english).toHaveValue('North area');
    expect(defaultLabel).toHaveValue('Northern');
    expect(within(rowAfter).getByText('Saved')).toHaveAttribute('role', 'status');
  });

  it('keeps focus in the editor, on the next control, when Tab leaves a Polish label (G1)', async () => {
    let finish!: (value: unknown) => void;
    client.updateOption.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    const editor = await openEditor();
    const row = optionRow(editor, 'North');
    await user.type(within(row).getByLabelText('Polish label'), 'Północ');
    await user.tab();
    const isDefault = within(row).getByLabelText('Default');
    expect(isDefault).toHaveFocus();
    await act(async () => {
      finish({ id: NORTH_ID, value: 'north' });
    });
    await waitFor(() => expect(client.get).toHaveBeenCalled());
    expect(editor).toContainElement(document.activeElement as HTMLElement);
    expect(isDefault).toHaveFocus();
  });

  it('re-reads the definition and shows the real order when a reorder is refused halfway (G2)', async () => {
    client.updateOption
      .mockResolvedValueOnce({ id: SOUTH_ID, value: 'south' })
      .mockRejectedValueOnce(new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } }));
    // What the server holds after the first patch only: both options at 0, north first by its id.
    const stored = definition({
      options: [
        { ...REGION.options[0]!, sortOrder: 0 },
        { ...REGION.options[1]!, sortOrder: 0 },
      ],
    });
    client.get.mockResolvedValue(stored);
    const editor = await openEditor();
    fireEvent.click(within(optionRow(editor, 'South')).getByRole('button', { name: 'Move up' }));
    await waitFor(() => expect(client.get).toHaveBeenCalledWith(REGION.id));
    await waitFor(() =>
      expect(
        within(optionRow(editor, 'South')).getByText('The option could not be changed.'),
      ).toBeInTheDocument(),
    );
    const order = within(editor)
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label'))
      .filter((name) => name === 'North' || name === 'South');
    expect(order).toEqual(['North', 'South']);
  });

  it('announces the required notice through a live region mounted before it has text (G7)', async () => {
    const editor = await openEditor();
    const region = within(editor).getByTestId('required-notice');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();
    fireEvent.click(within(editor).getByLabelText('Required'));
    expect(region).toHaveTextContent(/Existing records keep loading/);
    expect(within(editor).getByLabelText('Required')).toHaveAttribute('aria-describedby', region.id);
  });

  it('renders the editor in Polish — option rows, notices, refusal — with text that wraps (G9)', async () => {
    client.removeOption.mockRejectedValue(
      new ApiError(409, { error: { code: 'CUSTOM_FIELD_OPTION_IN_USE' as never, message: 'in use', details: { value: 'north' } } }),
    );
    const editor = await openEditor('order', 'region', 'pl');
    // Issue #1804 — the section says its changes apply at once, in the kit's badge.
    expect(
      within(editor).getByRole('heading', { name: new RegExp(plText('customFields.editor.section.options')) }),
    ).toHaveTextContent((corePl as Record<string, string>)['saveSession.immediateBadge']!);
    const row = optionRow(editor, 'North');
    const polish = plText('customFields.editor.labelIn', {
      language: new Intl.DisplayNames(['pl'], { type: 'language' }).of('pl')!,
    });
    expect(within(row).getByLabelText(polish)).toHaveClass('min-w-0');
    fireEvent.click(within(editor).getByLabelText(plText('customFields.form.required')));
    expect(within(editor).getByTestId('required-notice')).toHaveTextContent(plText('customFields.editor.requiredNotice'));
    expect(within(editor).getByTestId('required-notice')).toHaveClass('break-words');
    const remove = plText('customFields.editor.option.remove');
    fireEvent.click(within(row).getByRole('button', { name: remove }));
    fireEvent.click(within(optionRow(editor, 'North')).getByRole('button', { name: remove }));
    const refusal = await within(optionRow(editor, 'North')).findByText(
      plText('customFields.editor.option.inUse', { label: 'North' }),
    );
    expect(refusal).toHaveClass('break-words');
  });

  it('refuses a second default option on a single-choice field at the option, sending nothing (issue #447)', async () => {
    const withDefault = definition({
      options: [{ ...REGION.options[0]!, isDefault: true }, REGION.options[1]!],
    });
    client.get.mockResolvedValue(withDefault);
    const editor = await openEditor();
    // The page's read holds no default; the editor re-reads after an option action.
    fireEvent.click(within(optionRow(editor, 'North')).getByLabelText('Default'));
    await waitFor(() => expect(client.get).toHaveBeenCalled());
    await waitFor(() => expect(within(optionRow(editor, 'North')).getByLabelText('Default')).toBeChecked());
    client.updateOption.mockClear();
    fireEvent.click(within(optionRow(editor, 'South')).getByLabelText('Default'));
    expect(
      await within(optionRow(editor, 'South')).findByText(
        'A single-choice field can start with one default option only. Clear “North” first.',
      ),
    ).toBeInTheDocument();
    expect(client.updateOption).not.toHaveBeenCalled();
  });

  it('refuses a new option whose stored value is already used, before anything is sent (issue #447)', async () => {
    const editor = await openEditor();
    const add = within(editor).getByRole('group', { name: 'Add option' });
    fireEvent.change(within(add).getByLabelText('Stored value'), { target: { value: ' north ' } });
    fireEvent.change(within(add).getByLabelText('Default label'), { target: { value: 'North again' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add option' }));
    expect(await within(add).findByText('Another option already uses the stored value “north”.')).toBeInTheDocument();
    expect(within(add).getByLabelText('Stored value')).toHaveAttribute('aria-invalid', 'true');
    expect(client.createOption).not.toHaveBeenCalled();
  });

  it('marks an option as the default with one patch holding only isDefault', async () => {
    const editor = await openEditor();
    fireEvent.click(within(optionRow(editor, 'South')).getByLabelText('Default'));
    await waitFor(() => expect(client.updateOption).toHaveBeenCalledTimes(1));
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, SOUTH_ID, { isDefault: true });
  });

  it('saves an option label on Enter', async () => {
    const user = userEvent.setup();
    const editor = await openEditor();
    const polish = within(optionRow(editor, 'South')).getByLabelText('Polish label');
    await user.type(polish, 'Południe{Enter}');
    await waitFor(() =>
      expect(client.updateOption).toHaveBeenCalledWith(REGION.id, SOUTH_ID, { label: { en: 'South', pl: 'Południe' } }),
    );
  });

  it('says option changes apply at once, and Cancel becomes Close after one', async () => {
    const editor = await openEditor();
    expect(within(editor).getByRole('heading', { name: /Options/ })).toHaveTextContent('Applies immediately');
    expect(within(editor).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(within(optionRow(editor, 'North')).getByLabelText('Default'));
    await waitFor(() => expect(within(editor).getByRole('button', { name: 'Close' })).toBeInTheDocument());
    expect(within(editor).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('removes an unused option after an in-row confirmation', async () => {
    const editor = await openEditor();
    fireEvent.click(within(optionRow(editor, 'South')).getByRole('button', { name: 'Remove' }));
    expect(client.removeOption).not.toHaveBeenCalled();
    const row = optionRow(editor, 'South');
    expect(within(row).getByText('Remove the option “South”?')).toBeInTheDocument();
    // Keep takes the trigger's place and the focus.
    expect(within(row).getByRole('button', { name: 'Keep' })).toHaveFocus();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(client.removeOption).toHaveBeenCalledWith(REGION.id, SOUTH_ID));
  });

  it('returns focus to Remove when the confirmation is kept', async () => {
    const editor = await openEditor();
    fireEvent.click(within(optionRow(editor, 'South')).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(optionRow(editor, 'South')).getByRole('button', { name: 'Keep' }));
    expect(within(optionRow(editor, 'South')).getByRole('button', { name: 'Remove' })).toHaveFocus();
    expect(client.removeOption).not.toHaveBeenCalled();
  });

  for (const [shape, error] of [
    [
      'the option-in-use code',
      new ApiError(409, {
        error: { code: 'CUSTOM_FIELD_OPTION_IN_USE' as never, message: 'Option north is in use.', details: { value: 'north' } },
      }),
    ],
  ] as const) {
    it(`names an option in use by its label, in its own sentence — ${shape} (US3-6)`, async () => {
      client.removeOption.mockRejectedValue(error);
      const editor = await openEditor();
      fireEvent.click(within(optionRow(editor, 'North')).getByRole('button', { name: 'Remove' }));
      fireEvent.click(within(optionRow(editor, 'North')).getByRole('button', { name: 'Remove' }));
      expect(
        await within(optionRow(editor, 'North')).findByText(
          "The option “North” can't be removed because some records still use it. Change their value first.",
        ),
      ).toBeInTheDocument();
      expect(within(editor).queryByText(/Option north is in use/)).toBeNull();
      expect(within(editor).queryByText(/CUSTOM_FIELD_/)).toBeNull();
    });
  }

  it('stays on the editor with the server sentence when the save is refused', async () => {
    client.update.mockRejectedValue(
      new ApiError(422, { error: { code: 'CUSTOM_FIELD_DEFINITION_INVALID', message: 'The label is too long.' } }),
    );
    const editor = await openEditor();
    fireEvent.change(within(labels(editor)).getByLabelText('Default label'), { target: { value: 'Area' } });
    save(editor);
    expect(await within(editor).findByText('The label is too long.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Edit region' })).toBe(editor);
    expect(currentAddress()).toBe(`/custom-fields/${REGION.id}`);
  });

  it('asks for a default label in the editor, never through the browser', async () => {
    const editor = await openEditor();
    const input = within(labels(editor)).getByLabelText('Default label');
    expect(input).not.toBeRequired();
    fireEvent.change(input, { target: { value: '  ' } });
    save(editor);
    expect(await within(editor).findByText('Enter a default label.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(client.update).not.toHaveBeenCalled();
  });

  it('marks Save busy while saving, sends once, and leaves for the list without asking', async () => {
    let finish!: (value: unknown) => void;
    client.update.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const editor = await openEditor();
    fireEvent.click(within(editor).getByLabelText('Use as list filter'));
    save(editor);
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    const button = within(editor).getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    save(editor);
    expect(client.update).toHaveBeenCalledTimes(1);
    finish(REGION);
    await backOnList();
    // The guard does not ask on the way out of a save.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no axe violations on the editor page', async () => {
    const editor = await openEditor();
    await expectNoAxeViolations(editor);
  });
});
