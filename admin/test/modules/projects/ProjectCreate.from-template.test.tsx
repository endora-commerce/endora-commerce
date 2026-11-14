import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectRole, ProjectTemplateDetail } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { ADMIN_ID, ROLES, ROLE_MANAGER, core, detail, en, renderProjects } from './projects-fixtures';

/**
 * Creating a Project from a Template (`specs/163-projects-and-tasks/`, User
 * Story 3 — tasks T075 and T078; `contracts/admin-surfaces.md` §2: "optional
 * Template picker first (prefills everything, editable)").
 *
 * Choosing a Template fills the form from it — the default description, the
 * Template's Roles offered first to each Member — and shows the Stages the
 * Project will get from it, which are changed on the Project afterwards: the
 * request names the Template and sends no Stages of its own. Everything that
 * is typed stays editable, and "no Template" brings the Stage list back.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProjectCreate } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectCreate');

const TEMPLATE_ID = '00000000-0000-4000-8000-0000000007a1';
const ROLE_INSTALLER = '00000000-0000-4000-8000-000000000e03';
const ROLE_RETIRED = '00000000-0000-4000-8000-000000000e04';

const ALL_ROLES: ProjectRole[] = [
  ...ROLES,
  { id: ROLE_INSTALLER, code: 'installer', name: { en: 'Installer' }, defaultName: 'Installer', label: 'Installer', isSystem: false, archivedAt: null, position: 2 },
  { id: ROLE_RETIRED, code: 'retired', name: { en: 'Retired role' }, defaultName: 'Retired role', label: 'Retired role', isSystem: false, archivedAt: '2026-10-01T00:00:00.000Z', position: 3 },
];

const TEMPLATE: ProjectTemplateDetail = {
  id: TEMPLATE_ID,
  name: 'Showroom fit-out',
  description: 'Fit out a showroom for the client.',
  roleIds: [ROLE_INSTALLER, ROLE_RETIRED],
  stages: [
    {
      id: '00000000-0000-4000-8000-0000000007b1',
      name: 'Survey',
      color: '#0ea5e9',
      position: 1,
      plannedDurationDays: 5,
      responsibleRoleIds: [],
      alertOffsetsDays: [],
      completionGate: false,
      completionPermitted: false,
      tasks: [
        { id: '00000000-0000-4000-8000-0000000007c1', title: 'Measure', description: '', responsibleRoleId: null, dueOffsetDays: 1, position: 1 },
        { id: '00000000-0000-4000-8000-0000000007c2', title: 'Photograph', description: '', responsibleRoleId: null, dueOffsetDays: 2, position: 2 },
      ],
    },
    {
      id: '00000000-0000-4000-8000-0000000007b2',
      name: 'Build',
      color: '#f59e0b',
      position: 2,
      plannedDurationDays: 20,
      responsibleRoleIds: [],
      alertOffsetsDays: [7],
      completionGate: true,
      completionPermitted: true,
      tasks: [],
    },
  ],
  moves: [],
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ALL_ROLES });
    if (path === '/api/v1/admin/projects/templates?active=true') {
      return Promise.resolve({
        data: [{ id: TEMPLATE_ID, name: 'Showroom fit-out', stageCount: 2, archivedAt: null, updatedAt: TEMPLATE.updatedAt }],
      });
    }
    if (path === `/api/v1/admin/projects/templates/${TEMPLATE_ID}`) return Promise.resolve({ data: TEMPLATE });
    if (path.startsWith('/api/v1/admin/projects/lookups/admin-users')) {
      return Promise.resolve({ data: [{ id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' }] });
    }
    if (path.startsWith('/api/v1/admin/projects/lookups/organizations')) return Promise.resolve({ data: [] });
    if (path === '/api/v1/admin/projects/visibility-setting') return Promise.resolve({ data: { setting: 'members' } });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: detail() });
});

async function renderForm(): Promise<void> {
  renderProjects(<ProjectCreate />, { path: '/projects/new', present: ['projects', 'tasks'] });
  await screen.findByRole('heading', { name: en('create.title') });
}

const templatePicker = async (): Promise<HTMLSelectElement> =>
  (await screen.findByLabelText(en('create.template.label'))) as HTMLSelectElement;

async function chooseTemplate(): Promise<void> {
  const picker = await templatePicker();
  await within(picker).findByRole('option', { name: 'Showroom fit-out' });
  await userEvent.selectOptions(picker, TEMPLATE_ID);
  await screen.findByText(en('create.template.stagesHint'));
}

describe('ProjectCreate from a Template', () => {
  it('offers the Template picker first, with no Template chosen', async () => {
    await renderForm();
    const picker = await templatePicker();
    expect(picker.value).toBe('');
    // The first field of the form is the picker.
    const fields = [...document.querySelectorAll('form input, form select, form textarea')];
    expect(fields[0]).toBe(picker);
  });

  it('prefills every field from the Template, and each stays editable', async () => {
    await renderForm();
    await chooseTemplate();

    // The description is the reference field (a formatted editor), so its text is its content.
    const description = screen.getByLabelText(en('field.description'));
    await waitFor(() => expect(description.textContent).toBe('Fit out a showroom for the client.'));
    await userEvent.clear(description);
    await userEvent.type(description, 'Our own words.');
    expect(description.textContent).toBe('Our own words.');

    // The Stages come from the Template: listed, not typed.
    expect(screen.queryByRole('group', { name: en('create.stages.section') })).toBeNull();
    const stages = screen.getByRole('list', { name: en('create.template.stages') });
    expect(within(stages).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Survey'),
      expect.stringContaining('Build'),
    ]);
    expect(within(stages).getByText(en('create.template.stageTaskCount', { count: 2 }))).toBeTruthy();

    // The Template's Roles first — an archived one of the Template included — then the other active ones.
    await userEvent.click(screen.getByRole('button', { name: en('create.members.add') }));
    const members = screen.getByRole('group', { name: en('create.members.section') });
    const offered = within(members)
      .getAllByRole('checkbox')
      .map((box) => (box.closest('label') as HTMLElement).textContent);
    expect(offered).toEqual(['Installer', en('overview.archivedRole', { role: 'Retired role' }), 'Sales Rep', 'Project Manager']);
  });

  it('creates the Project from the Template: names it, sends no Stages, keeps what was typed', async () => {
    await renderForm();
    await chooseTemplate();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Acme showroom');
    const description = screen.getByLabelText(en('field.description'));
    await userEvent.clear(description);
    await userEvent.type(description, 'Our own words.');
    await userEvent.click(screen.getByRole('button', { name: en('create.members.add') }));
    const members = screen.getByRole('group', { name: en('create.members.section') });
    await userEvent.click(within(members).getByLabelText(en('create.members.person', { position: 1 })));
    await userEvent.click(await screen.findByRole('option', { name: /^Anna Nowak/ }));
    await userEvent.click(within(members).getByRole('checkbox', { name: 'Installer' }));
    await userEvent.click(within(members).getByRole('checkbox', { name: 'Project Manager' }));

    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/admin/projects');
    expect(body).toMatchObject({
      title: 'Acme showroom',
      templateId: TEMPLATE_ID,
      description: 'Our own words.',
      organizationIds: [],
      members: [{ adminUserId: ADMIN_ID, roleIds: [ROLE_INSTALLER, ROLE_MANAGER] }],
    });
    expect(body).not.toHaveProperty('stages');
  });

  it('"No template" brings the Stage list back and sends no Template', async () => {
    await renderForm();
    await chooseTemplate();
    await userEvent.selectOptions(await templatePicker(), '');
    const stages = await screen.findByRole('group', { name: en('create.stages.section') });
    await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'By hand');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const body = postSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('templateId');
    expect((body['stages'] as Array<Record<string, unknown>>).map((stage) => stage['name'])).toEqual(['Design']);
  });

  describe('what was typed before a Template is chosen (issue #452)', () => {
    const handStages = async (): Promise<void> => {
      const stages = await screen.findByRole('group', { name: en('create.stages.section') });
      await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    };
    const pick = async (): Promise<void> => {
      const picker = await templatePicker();
      await within(picker).findByRole('option', { name: 'Showroom fit-out' });
      await userEvent.selectOptions(picker, TEMPLATE_ID);
    };
    const replaceDialog = (): Promise<HTMLElement> =>
      screen.findByRole('dialog', { name: en('create.template.replace.title') });

    it('asks before a Template sets aside the Stages typed by hand; Cancel keeps them and no Template', async () => {
      await renderForm();
      await handStages();
      await pick();
      const dialog = await replaceDialog();
      expect(within(dialog).getByText(en('create.template.replace.stages', { name: 'Showroom fit-out' }))).toBeTruthy();
      await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.cancel') }));

      expect((await templatePicker()).value).toBe('');
      const stages = screen.getByRole('group', { name: en('create.stages.section') });
      expect((within(stages).getByLabelText(en('stage.name', { position: 1 })) as HTMLInputElement).value).toBe('Design');
      expect(getSpy).not.toHaveBeenCalledWith(`/api/v1/admin/projects/templates/${TEMPLATE_ID}`);
    });

    it('asks before a Template replaces a description typed by hand, and "No template" brings both back', async () => {
      await renderForm();
      await handStages();
      const description = screen.getByLabelText(en('field.description'));
      await userEvent.type(description, 'Our own words.');
      await pick();
      const dialog = await replaceDialog();
      expect(within(dialog).getByText(en('create.template.replace.description', { name: 'Showroom fit-out' }))).toBeTruthy();
      await userEvent.click(within(dialog).getByRole('button', { name: en('create.template.replace.confirm') }));
      await screen.findByText(en('create.template.stagesHint'));
      await waitFor(() =>
        expect(screen.getByLabelText(en('field.description')).textContent).toBe('Fit out a showroom for the client.'),
      );

      await userEvent.selectOptions(await templatePicker(), '');
      const stages = await screen.findByRole('group', { name: en('create.stages.section') });
      expect((within(stages).getByLabelText(en('stage.name', { position: 1 })) as HTMLInputElement).value).toBe('Design');
      await waitFor(() => expect(screen.getByLabelText(en('field.description')).textContent).toBe('Our own words.'));
    });

    it('asks nothing when nothing was typed', async () => {
      await renderForm();
      await chooseTemplate();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('a Template list that cannot be loaded leaves the form usable without one', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ALL_ROLES });
      if (path.startsWith('/api/v1/admin/projects/templates')) return Promise.reject(new Error('down'));
      return Promise.resolve({ data: [], pagination: { cursor: null, hasMore: false, limit: 20 } });
    });
    await renderForm();
    expect(await screen.findByText(en('create.template.loadError'))).toBeTruthy();
    expect(screen.getByRole('group', { name: en('create.stages.section') })).toBeTruthy();
  });
});
