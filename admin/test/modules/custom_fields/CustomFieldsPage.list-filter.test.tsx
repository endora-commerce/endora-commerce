import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Feature 157 (T056, US3) — `/custom-fields` shows which definitions are list
 * filters, lets the create form set the option where the entity type offers
 * it, and offers no write control to an operator who may only read
 * (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3).
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: [], customerInputSurfaces: [] },
  { entityType: 'organization', labelKey: 'customFields.entity.organization', listFilter: false, carryTargets: [], customerInputSurfaces: [] },
];

function definition(overrides: Partial<CustomFieldDefinitionDto>): CustomFieldDefinitionDto {
  return {
    id: '00000000-0000-4000-8000-00000000cf01',
    entityType: 'order',
    key: 'region',
    label: {},
    labelDefault: 'Region',
    valueType: 'text',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    listFilter: true,
    carryTo: [],
    customerInput: [],
    adminAccess: 'edit',
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ORDER_ROWS = [
  definition({}),
  definition({ id: '00000000-0000-4000-8000-00000000cf02', key: 'po_ref', labelDefault: 'PO', listFilter: false }),
];

const create = vi.fn(async (_body: unknown) => ({}));
const remove = vi.fn(async (_id: string) => ({}));
/** Replaced by a test that needs the definitions read to stay in flight. */
let listOrder: () => Promise<CustomFieldDefinitionDto[]> = async () => ORDER_ROWS;

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    list: async (entityType?: string) => (entityType === 'order' ? listOrder() : []),
    get: async () => ORDER_ROWS[0],
    create: (body: unknown) => create(body),
    update: async () => ({}),
    remove: (id: string) => remove(id),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

function renderPage(permissions: string[], bundle: Record<string, string> = en): void {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    { custom_fields: bundle, core: coreEn as Record<string, string> },
  );
}

async function chooseEntity(value: string, entityLabel = 'Record type'): Promise<void> {
  const select = await screen.findByLabelText(entityLabel);
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(ENTITY_TYPES.length));
  fireEvent.change(select, { target: { value } });
}

/** Opens the definition form in its create view (issue #447). */
async function openCreate(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'New field' }));
  return screen.findByRole('dialog', { name: 'New field' });
}

function cellOf(key: string, column: string): HTMLElement {
  const table = screen.getByRole('table');
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
  const row = within(table).getByText(key).closest('tr')!;
  return within(row).getAllByRole('cell')[headers.indexOf(column)]!;
}

beforeEach(() => {
  create.mockClear();
  remove.mockClear();
  listOrder = async () => ORDER_ROWS;
});

describe('CustomFieldsPage — the list-filter option', () => {
  it('shows a List filter column, Yes or —, in English (US3-3, FR-006)', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write']);
    await chooseEntity('order');
    await screen.findByText('po_ref');
    expect(cellOf('region', 'List filter')).toHaveTextContent('Yes');
    expect(cellOf('po_ref', 'List filter')).toHaveTextContent('No');
  });

  it('shows the column in Polish from the Polish bundle', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write'], pl as Record<string, string>);
    await chooseEntity('order', pl['customFields.form.entity']);
    await screen.findByText('po_ref');
    expect(cellOf('region', pl['customFields.table.listFilter'])).toHaveTextContent(pl['customFields.listFilter.yes']);
  });

  it('offers the option in the create form only where the entity type has it, and sends it (FR-003)', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write']);
    await chooseEntity('organization');
    const dialog = await openCreate();
    expect(within(dialog).queryByLabelText('Use as list filter')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Record type'), { target: { value: 'order' } });
    fireEvent.click(await within(dialog).findByLabelText('Use as list filter'));
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'channel_ref' } });
    fireEvent.change(within(within(dialog).getByRole('group', { name: 'Labels' })).getByLabelText('Default label'), {
      target: { value: 'Channel reference' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ entityType: 'order', key: 'channel_ref', listFilter: true });
  });

  it('asks in place before deleting a field, Keep taking the focus and giving it back', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write']);
    await chooseEntity('order');
    const trigger = await screen.findByRole('button', { name: 'Delete region' });
    fireEvent.click(trigger);
    expect(screen.getByText('Delete the field “region”?')).toBeInTheDocument();
    const keep = screen.getByRole('button', { name: 'Keep' });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(screen.getByRole('button', { name: 'Delete region' })).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete region' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(ORDER_ROWS[0]!.id));
  });

  it('says it is loading, then offers one action when a record type has no fields', async () => {
    let answer!: (rows: CustomFieldDefinitionDto[]) => void;
    listOrder = () => new Promise((resolve) => (answer = resolve));
    renderPage(['custom_fields:read', 'custom_fields:write']);
    await chooseEntity('order');
    expect(await screen.findByText('Loading fields…')).toHaveAttribute('role', 'status');
    answer([]);
    expect(await screen.findByText('No fields for this record type yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a field' }));
    const dialog = await screen.findByRole('dialog', { name: 'New field' });
    expect(within(dialog).getByLabelText('Key')).toHaveFocus();
    expect(within(dialog).getByLabelText('Record type')).toHaveValue('order');
  });

  it('offers a reader no action in the empty state', async () => {
    listOrder = async () => [];
    renderPage(['custom_fields:read']);
    await chooseEntity('order');
    expect(await screen.findByText('No fields for this record type yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a field' })).toBeNull();
  });

  it('offers Required as a checkbox in the create form', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write']);
    const dialog = await openCreate();
    expect(within(dialog).getByRole('checkbox', { name: 'Required' })).toBeInTheDocument();
  });

  it('offers no Edit, Delete, audience select or create form to a reader (US3-9)', async () => {
    renderPage(['custom_fields:read']);
    await chooseEntity('order');
    await screen.findByText('po_ref');
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.queryByLabelText('Who can see the value of region')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New field' })).toBeNull();
    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(cellOf('region', 'Visible to')).toHaveTextContent('Internal — administrators only');
  });

  it('every key the page and its components read exists in both bundles, the Polish value different (FR-018)', () => {
    const dir = resolve(__dirname, '../../../../packages/modules/custom_fields/src/admin');
    const files = [
      'pages/CustomFieldsPage.tsx',
      'components/DefinitionEditorDialog.tsx',
      'components/DefinitionForm.tsx',
      'components/DefinitionOptionsEditor.tsx',
      'components/DefinitionBehaviourFields.tsx',
      'lib/definition-draft.ts',
    ];
    const keys = new Set<string>();
    for (const file of files) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) keys.add(match[1]!);
      // The checks return bundle keys for the form to say (issue #447).
      for (const match of source.matchAll(/'(customFields\.validation\.[\w.]+)'/g)) keys.add(match[1]!);
    }
    for (const type of ['text', 'number', 'boolean', 'date', 'select', 'multiselect']) keys.add(`customFields.valueType.${type}`);
    for (const audience of ['internal', 'customer']) keys.add(`customFields.audience.${audience}`);
    expect(keys.size).toBeGreaterThan(40);
    const enBundle = en as Record<string, string>;
    const plBundle = pl as Record<string, string>;
    for (const key of keys) {
      expect(enBundle[key], key).toBeTruthy();
      expect(plBundle[key], key).toBeTruthy();
      expect(plBundle[key], key).not.toBe(enBundle[key]);
    }
  });
});
