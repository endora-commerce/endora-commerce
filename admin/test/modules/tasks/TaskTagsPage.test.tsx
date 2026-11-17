import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskTag } from '@endora-commerce/contracts';
import { core, en, renderTasks } from './tasks-fixtures';

/**
 * The Task tags screen (`specs/165-task-management/`, User Story 9 — T081,
 * T083; `contracts/admin-surfaces.md` §1, §4).
 *
 * The tags table with each tag's usage, the tag dialog (name and colour) for
 * adding and editing, the delete confirmation naming how many Tasks carry the
 * tag, and the screen on `tasks:configure` — its route and its palette action.
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
const { TaskTagsPage } = await import('../../../../packages/modules/tasks/src/admin/pages/settings/TaskTagsPage');
const { contributions } = await import('../../../../packages/modules/tasks/src/admin/index');
const { manifest } = await import('../../../../packages/modules/tasks/src/manifest');

const API = '/api/v1/admin/tasks';
const CONFIGURER = ['tasks:read', 'tasks:write', 'tasks:configure'];
const INSTALL_ID = '00000000-0000-4000-8000-0000000071a1';
const SITE_ID = '00000000-0000-4000-8000-0000000071a2';

function tags(): TaskTag[] {
  return [
    { id: INSTALL_ID, name: 'Installation', color: '#16a34a', usageCount: 4 },
    { id: SITE_ID, name: 'Site visit', color: '#64748b', usageCount: 0 },
  ];
}

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  getSpy.mockImplementation((path: string) =>
    path === `${API}/tags` ? Promise.resolve({ data: tags() }) : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
  postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-0000000071a3', name: 'Warranty', color: '#64748b', usageCount: 0 } });
  patchSpy.mockResolvedValue({ data: tags()[0] });
  deleteSpy.mockResolvedValue(undefined);
});

async function renderPage(): Promise<void> {
  renderTasks(<TaskTagsPage />, { permissions: CONFIGURER });
  await screen.findByRole('table', { name: en('tags.title') });
}

function tagRow(name: string): HTMLElement {
  const table = screen.getByRole('table', { name: en('tags.title') });
  return within(table).getByText(name).closest('tr') as HTMLElement;
}

describe('TaskTagsPage — the table', () => {
  it('lists every tag by name with how many Tasks carry it', async () => {
    await renderPage();
    expect(getSpy).toHaveBeenCalledWith(`${API}/tags`);
    expect(within(tagRow('Installation')).getByText('4')).toBeInTheDocument();
    expect(within(tagRow('Site visit')).getByText('0')).toBeInTheDocument();
  });

  it('says so when there is no tag yet, explains what a tag is for and offers one Add tag (issue #527)', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderTasks(<TaskTagsPage />, { permissions: CONFIGURER });
    expect(await screen.findByText(en('tags.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(en('tags.empty.body'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // One primary action, not a second outline button in the card header.
    const add = screen.getAllByRole('button', { name: en('tags.add') });
    expect(add).toHaveLength(1);
    await userEvent.click(add[0]!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('TaskTagsPage — the dialog', () => {
  it('adds a tag with its name and colour', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('tags.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('tags.field.name')), 'Warranty');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/tags`, { name: 'Warranty', color: '#64748b' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('refuses an empty name before it reaches the server', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('tags.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText(en('tags.error.name'))).toBeInTheDocument();
    // Focus goes to the invalid field, whose description is the error (WCAG 3.3.1, #512).
    const name = within(dialog).getByLabelText(en('tags.field.name'));
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription(en('tags.error.name'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('renames a tag and sends only what changed', async () => {
    await renderPage();
    await userEvent.click(within(tagRow('Installation')).getByRole('button', { name: en('tags.editLabel', { name: 'Installation' }) }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText(en('tags.field.name'));
    await userEvent.clear(name);
    await userEvent.type(name, 'Fitting');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(`${API}/tags/${INSTALL_ID}`, { name: 'Fitting' }));
  });

  it('shows the server’s refusal of a taken name in the dialog and keeps it open', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'TASK_TAG_NAME_TAKEN', message: 'A tag with this name already exists.' } }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('tags.add') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(en('tags.field.name')), 'installation');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText('A tag with this name already exists.')).toBeInTheDocument();
  });
});

describe('TaskTagsPage — deleting a tag', () => {
  it('asks for confirmation, naming how many Tasks carry the tag, then deletes it', async () => {
    await renderPage();
    await userEvent.click(within(tagRow('Installation')).getByRole('button', { name: en('tags.deleteLabel', { name: 'Installation' }) }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(en('tags.delete.body', { name: 'Installation' }))).toBeInTheDocument();
    expect(within(dialog).getByText(en('tags.delete.inUse', { count: 4 }))).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.delete') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${API}/tags/${INSTALL_ID}`));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not speak of Tasks for a tag nobody carries', async () => {
    await renderPage();
    await userEvent.click(within(tagRow('Site visit')).getByRole('button', { name: en('tags.deleteLabel', { name: 'Site visit' }) }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(en('tags.delete.inUse', { count: 0 }))).toBeNull();
  });
});

describe('TaskTagsPage — who sees it', () => {
  it('is a route on tasks:configure, and a palette action on the same code', () => {
    const route = (contributions.routes ?? []).find((candidate) => candidate.path === '/tasks/settings/tags');
    expect(route?.requiredPermission).toBe('tasks:configure');
    const action = (manifest.actions ?? []).find((candidate) => candidate.id === 'open-task-tags');
    expect(action).toMatchObject({ targetRoute: '/tasks/settings/tags', requiredPermission: 'tasks:configure' });
  });
});
