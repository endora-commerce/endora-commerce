import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectRole } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { en, renderProjects } from './projects-fixtures';

/**
 * The Project Roles and loss reasons screens (`specs/163-projects-and-tasks/`,
 * User Story 4 — task T083; `contracts/admin-surfaces.md` §2,
 * `/projects/roles` and `/projects/loss-reasons`): every row with its name in
 * each admin language, built-in rows marked; adding, renaming, archiving,
 * restoring and deleting, a built-in row never deletable, a refusal shown in
 * the server's words. The Roles screen says a Role grants no permission.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

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
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { RolesPage } = await import('../../../../packages/modules/projects/src/admin/pages/RolesPage');
const { LossReasonsPage } = await import('../../../../packages/modules/projects/src/admin/pages/LossReasonsPage');

const API = '/api/v1/admin/projects';

function row(overrides: Partial<ProjectRole> & Pick<ProjectRole, 'id' | 'code' | 'defaultName'>): ProjectRole {
  return {
    name: { en: overrides.defaultName },
    label: overrides.defaultName,
    isSystem: false,
    archivedAt: null,
    position: 10,
    ...overrides,
  };
}

const SALES_REP = row({
  id: '00000000-0000-4000-8000-0000000083a1',
  code: 'sales_rep',
  defaultName: 'Sales Rep',
  name: { en: 'Sales Rep', pl: 'Handlowiec' },
  isSystem: true,
});
const INSTALLER = row({
  id: '00000000-0000-4000-8000-0000000083a2',
  code: 'installer',
  defaultName: 'Installer',
  name: { en: 'Installer', pl: 'Instalator' },
  position: 30,
});
const RETIRED = row({
  id: '00000000-0000-4000-8000-0000000083a3',
  code: 'designer',
  defaultName: 'Designer',
  archivedAt: '2026-10-20T10:00:00.000Z',
  position: 40,
});

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === `${API}/roles?active=true`) return Promise.resolve({ data: [SALES_REP, INSTALLER] });
    if (path === `${API}/roles`) return Promise.resolve({ data: [SALES_REP, INSTALLER, RETIRED] });
    if (path === `${API}/loss-reasons?active=true`) {
      return Promise.resolve({
        data: [row({ id: '00000000-0000-4000-8000-0000000083b1', code: 'price', defaultName: 'Price', isSystem: true })],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function renderRoles(): void {
  renderProjects(<RolesPage />, { permissions: ['projects:read', 'projects:configure'], path: '/projects/settings/roles' });
}

/** Open the row menu of `name` and pick `item`. */
async function pick(name: string, item: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: en('dictionary.actionsFor', { name }) }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('RolesPage', () => {
  it('lists the active Roles with a name per admin language, built-in ones marked, and says a Role grants nothing', async () => {
    renderRoles();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: en('dictionary.col.name', { language: 'English' }) })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: en('dictionary.col.name', { language: 'Polish' }) })).toBeTruthy();
    const sales = within(table).getByText('Sales Rep').closest('tr') as HTMLElement;
    expect(within(sales).getByText('Handlowiec')).toBeTruthy();
    expect(within(sales).getByText(en('roles.builtIn'))).toBeTruthy();
    const installer = within(table).getByText('Installer').closest('tr') as HTMLElement;
    expect(within(installer).queryByText(en('roles.builtIn'))).toBeNull();
    expect(within(table).queryByText('Designer')).toBeNull();
    expect(screen.getByText(en('roles.description'))).toBeTruthy();
  });

  it('shows archived Roles on request, marked, with Restore instead of Archive', async () => {
    renderRoles();
    await screen.findByText('Installer');
    await userEvent.click(screen.getByRole('checkbox', { name: en('roles.showArchived') }));
    const retired = (await screen.findByText('Designer')).closest('tr') as HTMLElement;
    expect(within(retired).getByText(en('roles.archived'))).toBeTruthy();
    postSpy.mockResolvedValue({ data: { ...RETIRED, archivedAt: null } });
    await pick('Designer', en('dictionary.restore'));
    expect(postSpy).toHaveBeenCalledWith(`${API}/roles/${RETIRED.id}/restore`);
    await userEvent.click(await screen.findByRole('button', { name: en('dictionary.actionsFor', { name: 'Designer' }) }));
    expect(screen.queryByRole('menuitem', { name: en('dictionary.archive') })).toBeNull();
  });

  it('adds a Role with a name per language; the English one is its default name', async () => {
    postSpy.mockResolvedValue({ data: row({ id: '00000000-0000-4000-8000-0000000083a9', code: 'surveyor', defaultName: 'Surveyor' }) });
    renderRoles();
    await screen.findByText('Installer');
    await userEvent.click(screen.getByRole('button', { name: en('roles.add') }));
    const dialog = await screen.findByRole('dialog', { name: en('roles.addTitle') });
    const save = within(dialog).getByRole('button', { name: en('dictionary.save') });

    // The English name is required: nothing is sent without it.
    await userEvent.click(save);
    expect(await within(dialog).findByText(en('dictionary.field.required', { language: 'English' }))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText(en('dictionary.field.name', { language: 'English' })), ' Surveyor ');
    await userEvent.type(within(dialog).getByLabelText(en('dictionary.field.name', { language: 'Polish' })), 'Geodeta');
    await userEvent.click(save);
    expect(postSpy).toHaveBeenCalledWith(`${API}/roles`, {
      defaultName: 'Surveyor',
      name: { en: 'Surveyor', pl: 'Geodeta' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The list is read again.
    expect(getSpy.mock.calls.filter(([path]) => path === `${API}/roles?active=true`).length).toBeGreaterThan(1);
  });

  it('renames a built-in Role through a form prefilled with its names; an empty language is left out', async () => {
    patchSpy.mockResolvedValue({ data: SALES_REP });
    renderRoles();
    await pick('Sales Rep', en('dictionary.rename'));
    const dialog = await screen.findByRole('dialog', { name: en('dictionary.renameTitle', { name: 'Sales Rep' }) });
    const english = within(dialog).getByLabelText(en('dictionary.field.name', { language: 'English' }));
    const polish = within(dialog).getByLabelText(en('dictionary.field.name', { language: 'Polish' }));
    expect((english as HTMLInputElement).value).toBe('Sales Rep');
    expect((polish as HTMLInputElement).value).toBe('Handlowiec');
    await userEvent.clear(english);
    await userEvent.type(english, 'Account Manager');
    await userEvent.clear(polish);
    await userEvent.click(within(dialog).getByRole('button', { name: en('dictionary.save') }));
    expect(patchSpy).toHaveBeenCalledWith(`${API}/roles/${SALES_REP.id}`, {
      defaultName: 'Account Manager',
      name: { en: 'Account Manager' },
    });
  });

  it('shows a refusal in the server’s words inside the form', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'PROJECT_DICTIONARY_NAME_TAKEN', message: 'Another entry already has this name.' },
      }),
    );
    renderRoles();
    await screen.findByText('Installer');
    await userEvent.click(screen.getByRole('button', { name: en('roles.add') }));
    const dialog = await screen.findByRole('dialog', { name: en('roles.addTitle') });
    await userEvent.type(within(dialog).getByLabelText(en('dictionary.field.name', { language: 'English' })), 'Installer');
    await userEvent.click(within(dialog).getByRole('button', { name: en('dictionary.save') }));
    expect(await within(dialog).findByText('Another entry already has this name.')).toBeTruthy();
  });

  it('archives a Role', async () => {
    postSpy.mockResolvedValue({ data: { ...INSTALLER, archivedAt: '2026-10-26T10:00:00.000Z' } });
    renderRoles();
    await pick('Installer', en('dictionary.archive'));
    expect(postSpy).toHaveBeenCalledWith(`${API}/roles/${INSTALLER.id}/archive`);
    expect(screen.getByText(en('roles.archivedNote'))).toBeTruthy();
  });

  it('never offers to delete a built-in Role', async () => {
    renderRoles();
    await userEvent.click(await screen.findByRole('button', { name: en('dictionary.actionsFor', { name: 'Sales Rep' }) }));
    const item = await screen.findByRole('menuitem', { name: en('dictionary.delete') });
    expect(item.getAttribute('aria-disabled') ?? item.getAttribute('data-disabled')).not.toBeNull();
    expect(item.getAttribute('title')).toBe(en('dictionary.deleteBuiltIn'));
  });

  it('deletes an operator Role behind a confirmation; a refusal stays in the dialog', async () => {
    deleteSpy.mockRejectedValueOnce(
      new ApiError(409, {
        error: { code: 'PROJECT_DICTIONARY_ENTRY_IN_USE', message: 'Projects or templates use this entry.' },
      }),
    );
    renderRoles();
    await pick('Installer', en('dictionary.delete'));
    const dialog = await screen.findByRole('dialog', { name: en('dictionary.deleteTitle', { name: 'Installer' }) });
    await userEvent.click(within(dialog).getByRole('button', { name: en('dictionary.delete') }));
    expect(deleteSpy).toHaveBeenCalledWith(`${API}/roles/${INSTALLER.id}`);
    expect(await within(dialog).findByText('Projects or templates use this entry.')).toBeTruthy();

    deleteSpy.mockResolvedValueOnce(undefined);
    await userEvent.click(within(dialog).getByRole('button', { name: en('dictionary.delete') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('RolesPage — one place for Add (issue #1562, WORK-13)', () => {
  it('puts the one filled Add in the page header while Roles exist', async () => {
    renderRoles();
    await screen.findByText('Sales Rep');
    const add = screen.getAllByRole('button', { name: en('roles.add') });
    expect(add).toHaveLength(1);
    expect(add[0]!.closest('header')).not.toBeNull();
    expect(add[0]!.className.split(/\s+/)).toContain('bg-primary');
  });

  it('shows the kit empty state, carrying the one Add, when the dictionary holds nothing', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderRoles();
    const title = await screen.findByText(en('roles.empty.title'));
    expect(title.closest('[data-empty-state="no-data"]')).not.toBeNull();
    const add = screen.getAllByRole('button', { name: en('roles.add') });
    expect(add).toHaveLength(1);
    expect(add[0]!.closest('header')).toBeNull();
    await userEvent.click(add[0]!);
    expect(await screen.findByRole('dialog', { name: en('roles.addTitle') })).toBeTruthy();
  });
});

describe('LossReasonsPage', () => {
  it('is the same screen over the loss reasons', async () => {
    renderProjects(<LossReasonsPage />, {
      permissions: ['projects:read', 'projects:configure'],
      path: '/projects/settings/loss-reasons',
    });
    expect(await screen.findByRole('heading', { name: en('lossReasons.title') })).toBeTruthy();
    const price = (await screen.findByText('Price')).closest('tr') as HTMLElement;
    expect(within(price).getByText(en('lossReasons.builtIn'))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('lossReasons.add') })).toBeTruthy();
  });
});
