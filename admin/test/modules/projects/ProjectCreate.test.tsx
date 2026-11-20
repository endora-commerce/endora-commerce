import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import {
  ADMIN_ID,
  ORGANIZATION_ID,
  PROJECT_ID,
  ROLES,
  ROLE_MANAGER,
  core,
  detail,
  en,
  renderProjects,
} from './projects-fixtures';

/**
 * Creating a Project by hand (`specs/163-projects-and-tasks/`, User Story 1 —
 * tasks T047 and T055; `contracts/admin-surfaces.md` §2, `/projects/new`).
 *
 * Without a Template (`ProjectCreate.from-template.test.tsx`) `POST /projects`
 * requires its Stages, so the form carries a Stage list (name, colour, planned
 * duration; at least one). Members are chosen each with the active Project
 * Roles of `GET /projects/roles`. An empty Organization list is an internal
 * Project, and the form says what that means for who sees it.
 *
 * Organizations and people are found through the module's own lookups
 * (`/projects/lookups/*`, User Story 5 — task T088): a role holding only
 * `projects:*` may not read `/organizations` or `/admin-users`, so those reject
 * here, and the form must neither need nor ask them.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const PIOTR_ID = '00000000-0000-4000-8000-000000000c02';

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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { ProjectCreate } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectCreate');

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    // Every Role: a Template may offer one archived since (User Story 3); the form offers the active ones.
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    if (path === '/api/v1/admin/projects/templates?active=true') return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/projects/lookups/organizations')) {
      return Promise.resolve({ data: [{ id: ORGANIZATION_ID, name: 'Acme' }] });
    }
    if (path.startsWith('/api/v1/admin/projects/lookups/admin-users')) {
      return Promise.resolve({
        data: [
          { id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' },
          { id: PIOTR_ID, name: 'Piotr Wiśniewski', email: 'piotr@example.com' },
        ],
      });
    }
    if (path === '/api/v1/admin/projects/visibility-setting') return Promise.resolve({ data: { setting: 'members' } });
    if (path.startsWith('/api/v1/admin/projects/lookups/mentionable')) {
      return Promise.resolve({ data: [{ id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: detail() });
});

function AddressProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="address">{location.pathname}</output>;
}

async function renderForm(): Promise<void> {
  renderProjects(
    <>
      <ProjectCreate />
      <AddressProbe />
    </>,
    { path: '/projects/new' },
  );
  await screen.findByRole('heading', { name: en('create.title') });
}

/** Open a lookup picker and choose the option whose name starts with `name`. */
async function pick(input: HTMLElement, name: string): Promise<void> {
  await userEvent.click(input);
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${name}`) }));
}

function requested(): string[] {
  return getSpy.mock.calls.map(([path]) => path as string);
}

const stagesSection = (): HTMLElement => screen.getByRole('group', { name: en('create.stages.section') });

describe('ProjectCreate', () => {
  it('refuses to send a Project without a title or a named Stage, and says why', async () => {
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(screen.getByText(en('create.error.title'))).toBeTruthy();
    expect(screen.getByText(en('create.error.stageName'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('explains that a Project with no Organization is internal', async () => {
    await renderForm();
    expect(screen.getByText(en('create.internalNote'))).toBeTruthy();
  });

  it('creates the Project with its Stages and Members, then opens it', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Warehouse fit-out');
    await userEvent.type(screen.getByLabelText(en('field.valueAmount')), '12 500,5');
    await userEvent.type(screen.getByLabelText(en('field.valueCurrency')), 'pln');

    const stages = stagesSection();
    await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    const firstDuration = within(stages).getByLabelText(en('stage.duration', { position: 1 }));
    await userEvent.clear(firstDuration);
    await userEvent.type(firstDuration, '14');
    await userEvent.click(within(stages).getByRole('button', { name: en('create.stages.add') }));
    await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 2 })), 'Build');

    await userEvent.click(screen.getByRole('button', { name: en('create.members.add') }));
    const members = screen.getByRole('group', { name: en('create.members.section') });
    await pick(within(members).getByLabelText(en('create.members.person', { position: 1 })), 'Anna Nowak');
    await userEvent.click(await within(members).findByRole('checkbox', { name: 'Project Manager' }));

    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/admin/projects');
    expect(body).toMatchObject({
      title: 'Warehouse fit-out',
      organizationIds: [],
      value: { amount: '12500.50', currency: 'PLN' },
      members: [{ adminUserId: ADMIN_ID, roleIds: [ROLE_MANAGER] }],
    });
    const sentStages = body['stages'] as Array<Record<string, unknown>>;
    expect(sentStages.map((entry) => [entry['name'], entry['plannedDurationDays']])).toEqual([
      ['Design', 14],
      ['Build', 0],
    ]);
    for (const entry of sentStages) expect(entry['color']).toMatch(/^#[0-9a-f]{6}$/i);
    // Nothing a later story owns is sent.
    expect(body).not.toHaveProperty('templateId');
    expect(body).not.toHaveProperty('customFieldValues');
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(`/projects/${PROJECT_ID}`));
  });

  it('writes the description in the reference field: `@` offers people before the Project exists', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Warehouse fit-out');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    const field = screen.getByLabelText(en('field.description'));
    await userEvent.type(field, 'Ask @');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.person') });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Anna Nowak'),
    ]);
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    // The chosen person is a token followed by a space, as the kit's field writes it.
    expect(body['description']).toBe(`Ask [[admin_user:${ADMIN_ID}]] `);
    // Asked of the module's own lookup, with no Project to name yet.
    const lookups = requested().filter((path) => path.startsWith('/api/v1/admin/projects/lookups/mentionable'));
    expect(lookups.length).toBeGreaterThan(0);
    for (const path of lookups) expect(path).not.toContain('projectId');
  });

  it('removes and reorders Stages, and keeps at least one', async () => {
    await renderForm();
    const stages = stagesSection();
    expect(within(stages).queryByRole('button', { name: en('stage.remove', { position: 1 }) })).toBeNull();
    await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    await userEvent.click(within(stages).getByRole('button', { name: en('create.stages.add') }));
    await userEvent.type(within(stages).getByLabelText(en('stage.name', { position: 2 })), 'Build');
    await userEvent.click(within(stages).getByRole('button', { name: en('stage.moveUp', { position: 2 }) }));
    expect((within(stages).getByLabelText(en('stage.name', { position: 1 })) as HTMLInputElement).value).toBe('Build');
    await userEvent.click(within(stages).getByRole('button', { name: en('stage.remove', { position: 1 }) }));
    expect((within(stages).getByLabelText(en('stage.name', { position: 1 })) as HTMLInputElement).value).toBe('Design');
    expect(within(stages).queryByLabelText(en('stage.name', { position: 2 }))).toBeNull();
  });

  it('refuses an amount with more than two decimal places instead of rounding it', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Fit-out');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    await userEvent.type(screen.getByLabelText(en('field.valueAmount')), '10.555');
    await userEvent.type(screen.getByLabelText(en('field.valueCurrency')), 'PLN');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(screen.getByText(en('create.error.value'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("shows the server's sentence when the Project is refused", async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'PROJECT_ORGANIZATION_OUT_OF_SCOPE',
          message: 'One of the organizations is not available to you.',
        },
      }),
    );
    await renderForm();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Fit-out');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(await screen.findByText('One of the organizations is not available to you.')).toBeTruthy();
    expect(screen.getByTestId('address').textContent).toBe('/projects/new');
  });
  it('chooses Organizations and people through the module’s own lookups, never another module’s list', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Fit-out');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    await pick(screen.getByLabelText(en('field.organizations')), 'Acme');
    expect(screen.queryByText(en('create.internalNote'))).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect((postSpy.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ organizationIds: [ORGANIZATION_ID] });
    expect(requested().some((path) => path.startsWith('/api/v1/admin/projects/lookups/organizations'))).toBe(true);
    expect(requested().filter((path) => /^\/api\/v1\/admin\/(organizations|admin-users)/.test(path))).toEqual([]);
  });

  it('starts with the Organization the address names — the Organization screen’s "New project" (T133)', async () => {
    renderProjects(
      <>
        <ProjectCreate />
        <AddressProbe />
      </>,
      { path: `/projects/new?organizationId=${ORGANIZATION_ID}` },
    );
    await screen.findByRole('heading', { name: en('create.title') });
    expect(await screen.findByRole('button', { name: en('field.organizationsRemove', { name: 'Acme' }) })).toBeTruthy();
    expect(screen.queryByText(en('create.internalNote'))).toBeNull();
    expect(requested()).toContain(`/api/v1/admin/projects/lookups/organizations?id=${ORGANIZATION_ID}`);

    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Fit-out');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect((postSpy.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ organizationIds: [ORGANIZATION_ID] });
  });

  it('starts with no Organization when the one the address names is not in the reader’s reach', async () => {
    getSpy.mockImplementation((path: string) =>
      path.startsWith('/api/v1/admin/projects/lookups/organizations?id=')
        ? Promise.resolve({ data: [] })
        : path === '/api/v1/admin/projects/roles'
          ? Promise.resolve({ data: ROLES })
          : path === '/api/v1/admin/projects/templates?active=true'
            ? Promise.resolve({ data: [] })
            : path === '/api/v1/admin/projects/visibility-setting'
              ? Promise.resolve({ data: { setting: 'members' } })
              : Promise.reject(new Error(`unexpected GET ${path}`)),
    );
    renderProjects(<ProjectCreate />, { path: `/projects/new?organizationId=${ORGANIZATION_ID}` });
    await screen.findByRole('heading', { name: en('create.title') });
    await waitFor(() =>
      expect(requested()).toContain(`/api/v1/admin/projects/lookups/organizations?id=${ORGANIZATION_ID}`),
    );
    expect(screen.getByText(en('create.internalNote'))).toBeTruthy();
  });

  it('sends who sees the Project: following the module setting by default, or members and the people listed', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText(new RegExp(en('field.title'))), 'Fit-out');
    await userEvent.type(within(stagesSection()).getByLabelText(en('stage.name', { position: 1 })), 'Design');
    expect(screen.getByRole('radio', { name: en('visibility.option.inherit') })).toBeChecked();
    expect(await screen.findByText(en('visibility.effect.inheritMembers'))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: en('visibility.option.members_and_listed') }));
    await pick(screen.getByLabelText(en('visibility.listed.label')), 'Piotr');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect((postSpy.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      visibility: 'members_and_listed',
      viewerIds: [PIOTR_ID],
    });
  });
});

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; WORK-16) — every create form ends with the kit's
 * sticky save bar: in view while the form scrolls, the secondary action first and the one
 * primary last (Von Restorff, Jakob).
 */
describe('ProjectCreate — the sticky save bar (#1449)', () => {
  it('ends the form with Cancel, then Create last', async () => {
    await renderForm();
    const bar = screen.getByRole('button', { name: en('create.submit') }).closest<HTMLElement>('[data-slot="sticky-form-actions"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    expect(
      within(bar!)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([core('common.action.cancel'), en('create.submit')]);
  });
});
