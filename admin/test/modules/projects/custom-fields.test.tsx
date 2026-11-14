import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordHistoryEntry } from '@endora-commerce/contracts';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../../setup';
import { EVERY_PROJECTS_PERMISSION, PROJECT_ID, ROLES, core, detail, en, renderProjects } from './projects-fixtures';

/**
 * Custom fields on a Project (`specs/163-projects-and-tasks/`, User Story 9 —
 * task T125; `contracts/admin-surfaces.md` §6).
 *
 * The fields are the kit's `CustomFieldValuesPanel` for `entityType="project"`.
 * On the Overview it saves through the Project's own `PATCH`, naming the
 * version on screen; on the create form it is embedded — no button of its own
 * — and its values travel in the create request. A refusal naming a field is
 * shown at that field. Reading the definitions is `custom_fields`' permission,
 * so a person without it is shown no fields and asks for none. The change
 * history draws a row per field of a custom-field change, by the field's name.
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OverviewTab } = await import(
  '../../../../packages/modules/projects/src/admin/pages/project-detail/tabs/OverviewTab'
);
const { ProjectCreate } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectCreate');
const { ProjectHistory } = await import('../../../../packages/modules/projects/src/admin/components/ProjectHistory');

const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=project';
const WITH_FIELDS = [...EVERY_PROJECTS_PERMISSION, 'custom_fields:read'];

const base = {
  entityType: 'project',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  audience: 'internal',
  listFilter: false,
  carryTo: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const DEFINITIONS = [
  {
    ...base,
    id: '00000000-0000-4000-8000-00000000d101',
    key: 'site_region',
    label: { en: 'Site region', pl: 'Region budowy' },
    labelDefault: 'Site region',
    valueType: 'select',
    required: true,
    options: [
      { id: 'o1', value: 'north', label: { en: 'North' }, labelDefault: 'North', isDefault: false, sortOrder: 0 },
      { id: 'o2', value: 'south', label: { en: 'South' }, labelDefault: 'South', isDefault: false, sortOrder: 1 },
    ],
  },
  {
    ...base,
    id: '00000000-0000-4000-8000-00000000d102',
    key: 'contractor',
    label: { en: 'Contractor' },
    labelDefault: 'Contractor',
    valueType: 'text',
  },
];

function refusal(): InstanceType<typeof ApiError> {
  return new ApiError(422, {
    error: {
      code: 'CUSTOM_FIELD_VALUE_INVALID',
      message: 'One or more custom fields are invalid.',
      details: [{ path: 'site_region', issue: 'Field "site_region" is required.' }],
      requestId: 'req_test',
    },
  } as never);
}

function historyEntry(overrides: Partial<RecordHistoryEntry> = {}): RecordHistoryEntry {
  return {
    id: '00000000-0000-4000-8000-0000000000e9',
    actedAt: '2026-10-25T12:00:00.000Z',
    action: 'projects.project.custom_fields_update',
    actor: { kind: 'admin', id: '00000000-0000-4000-8000-000000000c01', name: 'Anna Nowak' },
    before: { customFieldValues: { site_region: 'north' } },
    after: { customFieldValues: { site_region: 'south', contractor: 'Acme' } },
    references: [],
    ...overrides,
  };
}

/** A formatted amount as a text matcher: `Intl` writes no-break spaces, which the DOM query folds. */
const money = (text: string) => (_: string, element: Element | null): boolean =>
  element?.children.length === 0 && element.textContent?.replace(/\s+/g, ' ') === text.replace(/\s+/g, ' ');

const requested = (): string[] => getSpy.mock.calls.map(([path]) => String(path));

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === DEFINITIONS_URL) return Promise.resolve({ data: DEFINITIONS });
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    if (path === '/api/v1/admin/projects/templates?active=true') return Promise.resolve({ data: [] });
    if (path === '/api/v1/admin/projects/visibility-setting') return Promise.resolve({ data: { setting: 'members' } });
    if (path.startsWith(`/api/v1/admin/projects/${PROJECT_ID}/history`)) {
      return Promise.resolve({
        data: [historyEntry()],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        truncated: false,
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('custom fields on the Project (Overview)', () => {
  const project = detail({ version: 4, customFieldValues: { site_region: 'north', contractor: 'Globex' } });

  function renderOverview(permissions: readonly string[] = WITH_FIELDS, onChange = vi.fn()): typeof onChange {
    renderProjects(<OverviewTab project={project} onChange={onChange} reload={async (): Promise<void> => {}} />, {
      permissions,
    });
    return onChange;
  }

  it('renders the fields defined for Projects, with the stored values', async () => {
    renderOverview();
    expect(await screen.findByLabelText(/Site region/)).toHaveValue('north');
    expect(screen.getByLabelText('Contractor')).toHaveValue('Globex');
    expect(requested()).toContain(DEFINITIONS_URL);
  });

  it('saves through the Project’s own PATCH, naming the version on screen, and puts the answer on screen', async () => {
    const saved = detail({ version: 5, customFieldValues: { site_region: 'south', contractor: 'Globex' } });
    patchSpy.mockResolvedValue({ data: saved });
    const onChange = renderOverview();

    await userEvent.selectOptions(await screen.findByLabelText(/Site region/), 'south');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]).toEqual([
      `/api/v1/admin/projects/${PROJECT_ID}`,
      { customFieldValues: { site_region: 'south', contractor: 'Globex' }, version: 4 },
    ]);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
  });

  it('sends a cleared choice as null, so the stored value does not come back', async () => {
    patchSpy.mockResolvedValue({ data: detail({ version: 5, customFieldValues: { contractor: 'Globex' } }) });
    renderOverview();
    await userEvent.selectOptions(await screen.findByLabelText(/Site region/), '');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({
      customFieldValues: { site_region: null, contractor: 'Globex' },
      version: 4,
    });
  });

  it('shows a refusal at the field it names', async () => {
    patchSpy.mockRejectedValue(refusal());
    renderOverview();
    const select = await screen.findByLabelText(/Site region/);
    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));
    const message = await screen.findByText('Field "site_region" is required.');
    expect(select.parentElement).toContainElement(message);
  });

  it('shows the values, and nothing to change, to somebody who may not edit', async () => {
    renderProjects(
      <OverviewTab
        project={{ ...project, permissions: { ...project.permissions, canWrite: false } }}
        onChange={vi.fn()}
        reload={async (): Promise<void> => {}}
      />,
      { permissions: ['projects:read', 'custom_fields:read'] },
    );
    const section = await screen.findByRole('region', { name: en('customFields.heading') });
    expect(within(section).getByText('Site region')).toBeTruthy();
    expect(within(section).getByText('North')).toBeTruthy();
    expect(within(section).getByText('Globex')).toBeTruthy();
    expect(screen.queryByRole('button', { name: core('customFields.save') })).toBeNull();
  });

  it('asks for no definitions without the permission to read them', async () => {
    renderOverview(EVERY_PROJECTS_PERMISSION);
    await screen.findByText(en('overview.members'));
    expect(requested()).not.toContain(DEFINITIONS_URL);
    expect(screen.queryByLabelText(/Site region/)).toBeNull();
  });
});

describe('custom fields on the create form', () => {
  async function renderForm(permissions: readonly string[] = WITH_FIELDS): Promise<void> {
    renderProjects(<ProjectCreate />, { path: '/projects/new', permissions });
    await screen.findByRole('heading', { name: en('create.title') });
  }

  async function fillRequired(): Promise<void> {
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Warehouse fit-out');
    const stages = screen.getByRole('group', { name: en('create.stages.section') });
    await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 1 })), 'Design');
  }

  it('renders the fields inside the form, with no button of their own, and sends their values', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    await renderForm();
    const select = await screen.findByLabelText(/Site region/);
    expect(screen.queryByRole('button', { name: core('customFields.save') })).toBeNull();
    expect(select.closest('form')).not.toBeNull();

    await fillRequired();
    await userEvent.selectOptions(select, 'south');
    await userEvent.type(screen.getByLabelText('Contractor'), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({
      title: 'Warehouse fit-out',
      customFieldValues: { site_region: 'south', contractor: 'Acme' },
    });
  });

  it('shows a refusal at the field it names and in the form’s own message', async () => {
    postSpy.mockRejectedValue(refusal());
    await renderForm();
    const select = await screen.findByLabelText(/Site region/);
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    const messages = await screen.findAllByText(/Field "site_region" is required\./);
    expect(messages.some((message) => select.parentElement?.contains(message))).toBe(true);
  });

  it('sends no custom values, and asks for no definitions, without custom_fields:read', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    await renderForm(EVERY_PROJECTS_PERMISSION);
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('customFieldValues');
    expect(requested()).not.toContain(DEFINITIONS_URL);
  });
});

describe('custom fields in the change history', () => {
  it('draws a row per changed field, by its name and its option labels', async () => {
    renderProjects(<ProjectHistory project={detail()} />, { permissions: WITH_FIELDS });
    expect(await screen.findByText(en('auditLog.projects.project.custom_fields_update'))).toBeTruthy();
    expect(await screen.findByText('Site region')).toBeTruthy();
    expect(screen.getByText('North')).toBeTruthy();
    expect(screen.getByText('South')).toBeTruthy();
    expect(screen.getByText('Contractor')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
  });

  it('names the fields a change touched when the entry records no values (T144 F4)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === DEFINITIONS_URL) return Promise.resolve({ data: DEFINITIONS });
      if (path.startsWith(`/api/v1/admin/projects/${PROJECT_ID}/history`)) {
        return Promise.resolve({
          data: [
            historyEntry({ before: null, after: { changedCustomFields: ['site_region', 'contractor'] } }),
            historyEntry({
              id: '00000000-0000-4000-8000-0000000000ea',
              action: 'projects.project.update',
              before: { title: 'Old' },
              after: { title: 'Old', changedFields: ['value'] },
            }),
          ],
          pagination: { cursor: null, hasMore: false, limit: 20 },
          truncated: false,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderProjects(<ProjectHistory project={detail()} />, { permissions: WITH_FIELDS });
    expect(await screen.findByText(en('history.field.changedCustomFields'))).toBeTruthy();
    expect(await screen.findByText('Site region, Contractor')).toBeTruthy();
    expect(screen.getByText(en('history.field.changedFields'))).toBeTruthy();
    expect(screen.getByText(en('history.field.value'))).toBeTruthy();
  });

  it('shows a value change with the value before and after, as the history serves it again (T145, #470)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === DEFINITIONS_URL) return Promise.resolve({ data: DEFINITIONS });
      if (path.startsWith(`/api/v1/admin/projects/${PROJECT_ID}/history`)) {
        return Promise.resolve({
          data: [
            historyEntry({
              action: 'projects.project.update',
              before: { title: 'Old', valueAmount: '1234.56', valueCurrency: 'PLN' },
              after: { title: 'Old', valueAmount: '987.65', valueCurrency: 'PLN' },
            }),
          ],
          pagination: { cursor: null, hasMore: false, limit: 20 },
          truncated: false,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderProjects(<ProjectHistory project={detail()} />, { permissions: WITH_FIELDS });
    // One *Value* row, each side in its currency's conventions, as the Project screen shows it.
    expect(await screen.findByText(en('history.field.value'))).toBeTruthy();
    expect(screen.getByText(money(formatMoney(1234.56, 'PLN')))).toBeTruthy();
    expect(screen.getByText(money(formatMoney(987.65, 'PLN')))).toBeTruthy();
    // One row for the amount and its currency together — no *Currency* row of its own.
    expect(screen.getAllByText(en('history.field.value'))).toHaveLength(1);
    expect(screen.queryByText(en('history.field.valueCurrency'))).toBeNull();
  });

  it('shows a change of currency alone as a change of the value (T145)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === DEFINITIONS_URL) return Promise.resolve({ data: DEFINITIONS });
      if (path.startsWith(`/api/v1/admin/projects/${PROJECT_ID}/history`)) {
        return Promise.resolve({
          data: [
            historyEntry({
              action: 'projects.project.update',
              before: { valueAmount: '100.00', valueCurrency: 'PLN' },
              after: { valueAmount: '100.00', valueCurrency: 'EUR' },
            }),
          ],
          pagination: { cursor: null, hasMore: false, limit: 20 },
          truncated: false,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderProjects(<ProjectHistory project={detail()} />, { permissions: WITH_FIELDS });
    expect(await screen.findByText(money(formatMoney(100, 'EUR')))).toBeTruthy();
    expect(screen.getByText(money(formatMoney(100, 'PLN')))).toBeTruthy();
  });
});
