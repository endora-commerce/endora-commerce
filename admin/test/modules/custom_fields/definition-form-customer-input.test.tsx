import { StrictMode } from 'react';
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
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-035, FR-036, SD-2,
 * contracts/admin-panel-and-check.md §2): the definition editor offers
 * *Collect from the buyer at registration* where the record type declares the
 * surface — disabled, with its reason, while the field is internal or holds
 * Page Builder content — and *Admin access* on every definition, with the
 * sentence saying it is a panel convenience and not a permission. A required
 * field cannot be read-only or hidden, and the other way round. The list names
 * the fields collected at registration and the ones not editable in the panel.
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'organization', labelKey: 'customFields.entity.organization', listFilter: false, carryTargets: [], customerInputSurfaces: ['organization.register'] },
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: [], customerInputSurfaces: [] },
];

function definition(overrides: Partial<CustomFieldDefinitionDto>): CustomFieldDefinitionDto {
  return {
    id: '00000000-0000-4000-8000-00000000c175',
    entityType: 'organization',
    key: 'acquisition_source',
    label: {},
    labelDefault: 'How did you hear about us',
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
    ...overrides,
  };
}

const OPEN = definition({ customerInput: ['organization.register'] });
const READ_ONLY = definition({ id: '00000000-0000-4000-8000-00000000c176', key: 'erp_customer_code', labelDefault: 'ERP code', adminAccess: 'read', audience: 'internal' });
const HIDDEN = definition({ id: '00000000-0000-4000-8000-00000000c177', key: 'sync_checksum', labelDefault: 'Sync checksum', adminAccess: 'hidden', audience: 'internal' });

const client = vi.hoisted(() => ({
  listEntityTypes: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  createOption: vi.fn(),
  updateOption: vi.fn(),
  removeOption: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: client,
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);
const { DefinitionBehaviourFields } = await import(
  '../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields'
);

const bundles = { custom_fields: en as Record<string, string>, core: coreEn as Record<string, string> };
const COPY = en as Record<string, string>;

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.listEntityTypes.mockResolvedValue(ENTITY_TYPES);
  client.list.mockImplementation(async (entityType?: string) =>
    entityType === 'organization' ? [OPEN, READ_ONLY, HIDDEN] : [],
  );
  client.get.mockImplementation(async (id: string) => [OPEN, READ_ONLY, HIDDEN].find((d) => d.id === id));
  client.create.mockResolvedValue(OPEN);
  client.update.mockResolvedValue(OPEN);
});

function renderPage(): void {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    bundles,
  );
}

async function openCreate(recordType: 'organization' | 'order'): Promise<HTMLElement> {
  renderPage();
  await screen.findByText('acquisition_source');
  fireEvent.click(screen.getByRole('button', { name: COPY['customFields.form.createTitle']! }));
  const dialog = await screen.findByRole('dialog', { name: COPY['customFields.form.createTitle']! });
  fireEvent.change(within(dialog).getByLabelText(COPY['customFields.form.entity']!), { target: { value: recordType } });
  return dialog;
}

describe('definition editor — buyer input (FR-035)', () => {
  it('ships every new sentence in English and Polish', () => {
    const keys = [
      'customFields.customerInput.legend',
      'customFields.customerInput.surface.organization.register',
      'customFields.customerInput.help',
      'customFields.customerInput.disabledAudience',
      'customFields.customerInput.disabledPageBuilder',
      'customFields.adminAccess.label',
      'customFields.adminAccess.edit',
      'customFields.adminAccess.read',
      'customFields.adminAccess.hidden',
      'customFields.adminAccess.help',
      'customFields.adminAccess.requiredReason',
      'customFields.form.requiredAccessReason',
      'customFields.badge.registration',
      'customFields.badge.read',
      'customFields.badge.hidden',
    ];
    for (const key of keys) {
      expect(COPY[key], `en ${key}`).toBeTruthy();
      expect((pl as Record<string, string>)[key], `pl ${key}`).toBeTruthy();
    }
    expect(COPY['customFields.adminAccess.help']).toBe(
      'Read-only and hidden only change this admin panel. They do not restrict the API, filters, exports or the audit log.',
    );
  });

  it('offers the option only for a record type that declares a surface', async () => {
    const dialog = await openCreate('organization');
    expect(within(dialog).getByLabelText(COPY['customFields.customerInput.surface.organization.register']!)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.form.entity']!), { target: { value: 'order' } });
    expect(within(dialog).queryByLabelText(COPY['customFields.customerInput.surface.organization.register']!)).toBeNull();
  });

  it('disables it with its reason while the field is internal, and enables it once customer-visible', async () => {
    const dialog = await openCreate('organization');
    const box = within(dialog).getByLabelText(COPY['customFields.customerInput.surface.organization.register']!);
    expect(box).toBeDisabled();
    expect(within(dialog).getByText(COPY['customFields.customerInput.disabledAudience']!)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.audience.label']!), { target: { value: 'customer' } });
    expect(box).not.toBeDisabled();
    expect(within(dialog).queryByText(COPY['customFields.customerInput.disabledAudience']!)).toBeNull();
  });

  it('disables it with its reason for a Page Builder field', () => {
    renderWithI18n(
      <DefinitionBehaviourFields
        definition={{ key: 'story', valueType: 'page_builder', options: [], audience: 'customer' }}
        entityTypeInfo={ENTITY_TYPES[0]!}
        value={{ listFilter: false, customerInput: [] }}
        onChange={(): void => {}}
      />,
      bundles,
    );
    expect(screen.getByLabelText(COPY['customFields.customerInput.surface.organization.register']!)).toBeDisabled();
    expect(screen.getByText(COPY['customFields.customerInput.disabledPageBuilder']!)).toBeTruthy();
  });

  it('sends the ticked surface and the chosen admin access on create', async () => {
    const dialog = await openCreate('organization');
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.form.key']!), { target: { value: 'phone' } });
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.editor.labelDefault']!), { target: { value: 'Phone' } });
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.audience.label']!), { target: { value: 'customer' } });
    fireEvent.click(within(dialog).getByLabelText(COPY['customFields.customerInput.surface.organization.register']!));
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.adminAccess.label']!), { target: { value: 'read' } });
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['customFields.form.submit']! }));

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]?.[0]).toMatchObject({
      entityType: 'organization',
      key: 'phone',
      audience: 'customer',
      customerInput: ['organization.register'],
      adminAccess: 'read',
    });
  });

  it('sends the server defaults on create for a record type with no surface', async () => {
    const dialog = await openCreate('order');
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.form.key']!), { target: { value: 'po' } });
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.editor.labelDefault']!), { target: { value: 'PO' } });
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['customFields.form.submit']! }));

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]?.[0]).toMatchObject({ customerInput: [], adminAccess: 'edit' });
  });
});

describe('definition editor — admin access (FR-036, SD-2)', () => {
  it('offers the selector with its help sentence for every record type', async () => {
    const dialog = await openCreate('order');
    const select = within(dialog).getByLabelText(COPY['customFields.adminAccess.label']!) as HTMLSelectElement;
    expect(Array.from(select.options, (o) => o.value)).toEqual(['edit', 'read', 'hidden']);
    expect(select.value).toBe('edit');
    expect(within(dialog).getByText(COPY['customFields.adminAccess.help']!)).toBeTruthy();
  });

  it('disables read-only and hidden while the field is required, and required while it is not editable', async () => {
    const dialog = await openCreate('order');
    const select = within(dialog).getByLabelText(COPY['customFields.adminAccess.label']!) as HTMLSelectElement;
    const required = within(dialog).getByLabelText(COPY['customFields.form.required']!);

    fireEvent.click(required);
    const option = (value: string): HTMLOptionElement =>
      Array.from(select.options).find((o) => o.value === value)!;
    expect(option('read').disabled).toBe(true);
    expect(option('hidden').disabled).toBe(true);
    expect(within(dialog).getByText(COPY['customFields.adminAccess.requiredReason']!)).toBeTruthy();

    fireEvent.click(required);
    fireEvent.change(select, { target: { value: 'hidden' } });
    expect(required).toBeDisabled();
    expect(within(dialog).getByText(COPY['customFields.form.requiredAccessReason']!)).toBeTruthy();
  });

  it('sends only the changed admin access on edit', async () => {
    renderPage();
    await screen.findByText('acquisition_source');
    fireEvent.click(screen.getByRole('button', { name: COPY['customFields.editor.title']!.replace('{key}', 'acquisition_source') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(COPY['customFields.adminAccess.label']!), { target: { value: 'hidden' } });
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['customFields.editor.save']! }));

    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    expect(client.update.mock.calls[0]).toEqual([OPEN.id, { adminAccess: 'hidden' }]);
  });

  it('sends the unticked surface on edit', async () => {
    renderPage();
    await screen.findByText('acquisition_source');
    fireEvent.click(screen.getByRole('button', { name: COPY['customFields.editor.title']!.replace('{key}', 'acquisition_source') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(COPY['customFields.customerInput.surface.organization.register']!));
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['customFields.editor.save']! }));

    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    expect(client.update.mock.calls[0]).toEqual([OPEN.id, { customerInput: [] }]);
  });
});

describe('definitions list — badges (FR-035, FR-036)', () => {
  it('lists every definition, naming the ones collected at registration and the ones not editable', async () => {
    renderPage();
    await screen.findByText('acquisition_source');
    expect(screen.getByText('erp_customer_code')).toBeTruthy();
    expect(screen.getByText('sync_checksum')).toBeTruthy();

    const row = (key: string): HTMLElement => screen.getByText(key).closest('tr') ?? screen.getByText(key).parentElement!;
    expect(within(row('acquisition_source')).getByText(COPY['customFields.badge.registration']!)).toBeTruthy();
    expect(within(row('erp_customer_code')).getByText(COPY['customFields.badge.read']!)).toBeTruthy();
    expect(within(row('sync_checksum')).getByText(COPY['customFields.badge.hidden']!)).toBeTruthy();
    expect(within(row('acquisition_source')).queryByText(COPY['customFields.badge.read']!)).toBeNull();
  });
});
