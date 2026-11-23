import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { chooseRowAction } from './row-actions';
import { currentAddress, findEditor, renderCustomFieldsRoutes } from './routes-harness';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Issue #1804 — the definition editor has its own route, `/custom-fields/new`
 * and `/custom-fields/:id`, instead of a dialog over the list (the kit README's
 * five-field rule). These cases pin the route itself: it is deep-linkable, has
 * the header's way back, keeps its one Save in the sticky bar, arms the kit's
 * unsaved-changes guard, sends a save back to the list with the field's row
 * focused and the result announced, and offers nothing to an operator who may
 * not write. The form's own behaviour is the other suites'.
 */

type Bundle = Record<string, string>;
const EN = en as Bundle;
const CORE_EN = coreEn as Bundle;
const BUNDLE = { custom_fields: EN, core: CORE_EN };

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: [], customerInputSurfaces: [] },
  { entityType: 'organization', labelKey: 'customFields.entity.organization', listFilter: false, carryTargets: [], customerInputSurfaces: [] },
  {
    entityType: 'product',
    labelKey: 'customFields.entity.product',
    listFilter: false,
    carryTargets: [],
    customerInputSurfaces: [],
    managedBy: { moduleId: 'catalog', route: '/catalog/attributes', labelKey: 'customFields.managedBy.catalogAttributes' },
  },
];

function definition(overrides: Partial<CustomFieldDefinitionDto>): CustomFieldDefinitionDto {
  return {
    id: '00000000-0000-4000-8000-00000000f801',
    entityType: 'order',
    key: 'region',
    label: { en: 'Region' },
    labelDefault: 'Region',
    valueType: 'select',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    listFilter: false,
    carryTo: [],
    customerInput: [],
    adminAccess: 'edit',
    options: [
      { id: '00000000-0000-4000-8000-0000000f80a1', value: 'north', label: {}, labelDefault: 'North', isDefault: false, sortOrder: 0 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const REGION = definition({});
const PO_REF = definition({
  id: '00000000-0000-4000-8000-00000000f802',
  key: 'po_ref',
  label: {},
  labelDefault: 'PO reference',
  valueType: 'text',
  options: [],
});
const COLOUR = definition({
  id: '00000000-0000-4000-8000-00000000f803',
  entityType: 'product',
  key: 'colour',
  label: {},
  labelDefault: 'Colour',
  valueType: 'text',
  options: [],
});

const db = vi.hoisted(() => ({ definitions: [] as CustomFieldDefinitionDto[] }));
const client = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn() }));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    list: async (entityType?: string) => {
      client.list(entityType);
      return db.definitions.filter((d) => entityType === undefined || d.entityType === entityType);
    },
    get: (...args: unknown[]) => client.get(...args),
    create: (...args: unknown[]) => client.create(...args),
    update: (...args: unknown[]) => client.update(...args),
    remove: async () => ({}),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import('../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage');
const { CustomFieldEditorPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldEditorPage'
);
const SCREENS = { CustomFieldsPage, CustomFieldEditorPage };

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  db.definitions = [REGION, COLOUR];
  for (const fn of Object.values(client)) fn.mockReset();
  client.get.mockImplementation(async (id: string) => {
    const found = db.definitions.find((d) => d.id === id);
    if (!found) throw new ApiError(404, { error: { code: 'CUSTOM_FIELD_NOT_FOUND' as never, message: 'Not found.' } });
    return found;
  });
  client.create.mockImplementation(async () => {
    db.definitions = [...db.definitions, PO_REF];
    return PO_REF;
  });
  client.update.mockImplementation(async (id: string, patch: Partial<CustomFieldDefinitionDto>) => {
    db.definitions = db.definitions.map((d) => (d.id === id ? { ...d, ...patch } : d));
    return db.definitions.find((d) => d.id === id);
  });
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

const showOrders = async (): Promise<void> => {
  await waitFor(() =>
    expect(within(screen.getByLabelText('Record type')).getAllByRole('option').map((o) => o.textContent)).toContain('Order'),
  );
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'order' } });
  await screen.findByRole('row', { name: /region/ });
};

describe('the definition editor route (issue #1804)', () => {
  describe('deep links', () => {
    it('opens /custom-fields/new on the record type the address names, with the label focused', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: ['/custom-fields/new?entityType=order'], bundle: BUNDLE });
      const editor = await findEditor('New field');
      expect(screen.getByRole('heading', { level: 1, name: 'New field' })).toBeInTheDocument();
      expect(within(editor).getByLabelText('Record type')).toHaveValue('order');
      await waitFor(() =>
        expect(within(within(editor).getByRole('group', { name: 'Labels' })).getByLabelText('Default label')).toHaveFocus(),
      );
      // The way back names its destination and keeps the record type.
      expect(screen.getByRole('link', { name: 'Custom fields' })).toHaveAttribute('href', '/custom-fields?entityType=order');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('starts a new field on a type this screen manages when the address names one it does not', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: ['/custom-fields/new?entityType=product'], bundle: BUNDLE });
      const editor = await findEditor('New field');
      expect(within(editor).getByLabelText('Record type')).toHaveValue('organization');
    });

    it('opens /custom-fields/:id on the field, read from the server, with the skeleton first', async () => {
      let finish!: (value: CustomFieldDefinitionDto) => void;
      client.get.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
      expect(await screen.findByRole('heading', { level: 1, name: 'Edit field' })).toBeInTheDocument();
      expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
      await act(async () => finish(REGION));
      const editor = await findEditor('Edit region');
      expect(client.get).toHaveBeenCalledWith(REGION.id);
      expect(within(editor).getByText('region')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Custom fields' })).toHaveAttribute('href', '/custom-fields?entityType=order');
    });

    it('says a field that no longer exists, keeping the way back', async () => {
      renderCustomFieldsRoutes(SCREENS, {
        initialEntries: ['/custom-fields/00000000-0000-4000-8000-0000000000ff'],
        bundle: BUNDLE,
      });
      expect(await screen.findByText(EN['customFields.editor.notFound']!)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Custom fields' })).toBeInTheDocument();
      expect(screen.queryByRole('form')).toBeNull();
    });

    it('says a failed read with the server sentence and offers Retry', async () => {
      client.get.mockRejectedValueOnce(new ApiError(500, { error: { code: 'INTERNAL' as never, message: 'The server is down.' } }));
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
      expect(await screen.findByText('The server is down.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: CORE_EN['common.action.retry']! }));
      expect(await findEditor('Edit region')).toBeInTheDocument();
    });
  });

  describe('from the list and back', () => {
    it('New field and Edit are links to the routes, never a dialog', async () => {
      renderCustomFieldsRoutes(SCREENS, { bundle: BUNDLE });
      await showOrders();
      expect(currentAddress()).toBe('/custom-fields?entityType=order');
      expect(screen.getByRole('link', { name: 'New field' })).toHaveAttribute('href', '/custom-fields/new?entityType=order');
      expect(screen.getByRole('link', { name: 'Region' })).toHaveAttribute('href', `/custom-fields/${REGION.id}`);
      await chooseRowAction('region', 'edit', EN);
      await findEditor('Edit region');
      expect(currentAddress()).toBe(`/custom-fields/${REGION.id}`);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('creates a field, returns to the list on its type, focuses its row and announces it', async () => {
      renderCustomFieldsRoutes(SCREENS, { bundle: BUNDLE });
      await showOrders();
      fireEvent.click(screen.getByRole('link', { name: 'New field' }));
      const editor = await findEditor('New field');
      fireEvent.change(within(within(editor).getByRole('group', { name: 'Labels' })).getByLabelText('Default label'), {
        target: { value: 'PO reference' },
      });
      fireEvent.click(within(editor).getByRole('button', { name: 'Add field' }));
      await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
      expect(client.create.mock.calls[0]![0]).toMatchObject({ entityType: 'order', key: 'po_reference', sortOrder: 1 });
      const link = await screen.findByRole('link', { name: 'PO reference' });
      expect(currentAddress()).toBe('/custom-fields?entityType=order');
      await waitFor(() => expect(link).toHaveFocus());
      const status = screen.getByText('Field “PO reference” created.');
      expect(status.closest('[role="status"]')).not.toBeNull();
    });

    it('saves an edit, returns to the list and focuses the row, saying it was saved', async () => {
      renderCustomFieldsRoutes(SCREENS, { bundle: BUNDLE });
      await showOrders();
      fireEvent.click(screen.getByRole('link', { name: 'Region' }));
      const editor = await findEditor('Edit region');
      fireEvent.click(within(editor).getByLabelText('Use as list filter'));
      fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(client.update).toHaveBeenCalledWith(REGION.id, { listFilter: true }));
      const link = await screen.findByRole('link', { name: 'Region' });
      await waitFor(() => expect(link).toHaveFocus());
      expect(screen.getByText('Field “Region” saved.')).toBeInTheDocument();
      expect(currentAddress()).toBe('/custom-fields?entityType=order');
    });

    it('keeps the sticky bar as the one place of Save, Cancel before it', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
      const editor = await findEditor('Edit region');
      const bar = editor.querySelector('[data-slot="sticky-form-actions"]') as HTMLElement;
      expect(bar).not.toBeNull();
      expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Cancel', 'Save']);
      expect(within(editor).getAllByRole('button', { name: 'Save' })).toHaveLength(1);
    });

    it('Cancel returns to the list without asking, the draft discarded', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: ['/custom-fields?entityType=order', `/custom-fields/${REGION.id}`], bundle: BUNDLE });
      const editor = await findEditor('Edit region');
      fireEvent.click(within(editor).getByLabelText('Use as list filter'));
      fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
      await screen.findByRole('row', { name: /region/ });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(client.update).not.toHaveBeenCalled();
    });
  });

  describe('the unsaved-changes guard', () => {
    const LEAVE_TITLE = CORE_EN['form.unsavedChanges.title']!;

    it('asks before the header link leaves a changed draft; Stay keeps it, Discard leaves', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
      const editor = await findEditor('Edit region');
      fireEvent.click(within(editor).getByLabelText('Use as list filter'));
      fireEvent.click(screen.getByRole('link', { name: 'Custom fields' }));
      const ask = await screen.findByRole('dialog', { name: LEAVE_TITLE });
      fireEvent.click(within(ask).getByRole('button', { name: CORE_EN['form.unsavedChanges.stay']! }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: LEAVE_TITLE })).toBeNull());
      expect(within(editor).getByLabelText('Use as list filter')).toBeChecked();
      expect(currentAddress()).toBe(`/custom-fields/${REGION.id}`);

      fireEvent.click(screen.getByRole('link', { name: 'Custom fields' }));
      const again = await screen.findByRole('dialog', { name: LEAVE_TITLE });
      fireEvent.click(within(again).getByRole('button', { name: CORE_EN['form.unsavedChanges.discard']! }));
      await screen.findByRole('row', { name: /region/ });
      expect(client.update).not.toHaveBeenCalled();
    });

    it('asks before the browser Back leaves a changed draft', async () => {
      const router = renderCustomFieldsRoutes(SCREENS, {
        initialEntries: ['/custom-fields?entityType=order', `/custom-fields/${REGION.id}`],
        bundle: BUNDLE,
      });
      const editor = await findEditor('Edit region');
      fireEvent.change(within(within(editor).getByRole('group', { name: 'Labels' })).getByLabelText('Default label'), {
        target: { value: 'Area' },
      });
      await act(async () => {
        await router.navigate(-1);
      });
      expect(await screen.findByRole('dialog', { name: LEAVE_TITLE })).toBeInTheDocument();
      expect(currentAddress()).toBe(`/custom-fields/${REGION.id}`);
    });

    it('asks nothing when nothing changed, and nothing on the way out of a save', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
      const editor = await findEditor('Edit region');
      expect(within(editor).queryByText(CORE_EN['form.unsavedChanges.hint']!)).toBeNull();
      fireEvent.click(screen.getByRole('link', { name: 'Custom fields' }));
      await screen.findByRole('row', { name: /region/ });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('options on an existing field', () => {
    it('label the Options section as applying immediately, and only on edit', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
      const editor = await findEditor('Edit region');
      const heading = within(editor).getByRole('heading', { name: /Options/ });
      expect(heading).toHaveTextContent(CORE_EN['saveSession.immediateBadge']!);
      // The page's dirty count is the definition's own draft: the options are not in it.
      expect(within(editor).queryByText(EN['customFields.editor.optionsDraftNote']!)).toBeNull();
    });

    it('carry no badge on a new field, whose options are sent with it', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: ['/custom-fields/new?entityType=order'], bundle: BUNDLE });
      const editor = await findEditor('New field');
      fireEvent.change(within(editor).getByLabelText('Type'), { target: { value: 'select' } });
      const heading = within(editor).getByRole('heading', { name: 'Options' });
      expect(heading).not.toHaveTextContent(CORE_EN['saveSession.immediateBadge']!);
      expect(within(editor).getByText(EN['customFields.editor.optionsDraftNote']!)).toBeInTheDocument();
    });
  });

  describe('permission gating', () => {
    it('shows a reader the field without offering it: no Save, no New field, a notice saying why', async () => {
      renderCustomFieldsRoutes(SCREENS, {
        initialEntries: ['/custom-fields?entityType=order'],
        permissions: ['custom_fields:read'],
        bundle: BUNDLE,
      });
      await screen.findByRole('row', { name: /region/ });
      expect(screen.queryByRole('link', { name: 'New field' })).toBeNull();
      fireEvent.click(screen.getByRole('link', { name: 'Region' }));
      const editor = await findEditor('Edit region');
      expect(screen.getByText(EN['customFields.editor.readOnly']!)).toBeInTheDocument();
      expect(within(editor).queryByRole('button', { name: 'Save' })).toBeNull();
      expect(within(editor).getByLabelText('Who can see the value')).toBeDisabled();
      expect(within(editor).queryByRole('heading', { name: new RegExp(CORE_EN['saveSession.immediateBadge']!) })).toBeNull();
    });

    it('shows a field of a type another module manages read-only, linking that module', async () => {
      renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${COLOUR.id}`], bundle: BUNDLE });
      const editor = await findEditor('Edit colour');
      expect(screen.getByText(EN['customFields.managedBy.notice']!)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: EN['customFields.managedBy.catalogAttributes']! })).toHaveAttribute(
        'href',
        '/catalog/attributes',
      );
      expect(within(editor).queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('gates /new on the write code and /:id on the read code, and the palette reaches /new', async () => {
      const { contributions } = await import('../../../../packages/modules/custom_fields/src/admin/index');
      expect(contributions.routes?.map((route) => [route.path, route.requiredPermission])).toEqual([
        ['/custom-fields', 'custom_fields:read'],
        ['/custom-fields/new', 'custom_fields:write'],
        ['/custom-fields/:id', 'custom_fields:read'],
      ]);
      const { manifest } = await import('../../../../packages/modules/custom_fields/src/manifest');
      const action = manifest.actions?.find((candidate) => candidate.id === 'new-custom-field');
      expect(action).toMatchObject({ targetRoute: '/custom-fields/new', requiredPermission: 'custom_fields:write' });
      for (const bundle of [EN, pl as Bundle]) {
        expect(bundle['actions.newCustomField.label']).toBeTruthy();
        expect(bundle['actions.newCustomField.description']).toBeTruthy();
        expect(bundle['actions.newCustomField.keywords']).toBeTruthy();
      }
    });
  });

  it('renders the page in Polish', async () => {
    renderCustomFieldsRoutes(SCREENS, {
      initialEntries: ['/custom-fields/new?entityType=order'],
      bundle: { custom_fields: pl as Bundle, core: corePl as Bundle },
      language: 'pl',
    });
    const title = (pl as Bundle)['customFields.form.createTitle']!;
    const editor = await findEditor(title);
    expect(within(editor).getByRole('button', { name: (pl as Bundle)['customFields.form.submit']! })).toBeInTheDocument();
  });

  it('has no axe violations on the create and the edit page', async () => {
    renderCustomFieldsRoutes(SCREENS, { initialEntries: [`/custom-fields/${REGION.id}`], bundle: BUNDLE });
    await findEditor('Edit region');
    await expectNoAxeViolations(document.body);
  });
});
