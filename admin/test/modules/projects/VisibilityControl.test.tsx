import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDetail } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { ADMIN_ID, PROJECT_ID, detail, en, renderProjects } from './projects-fixtures';

/**
 * Who sees a Project — the visibility control on *New project* and on a
 * Project's *Overview* (`specs/163-projects-and-tasks/`, User Story 5 — task
 * T087; spec FR-018 – FR-019, owner ruling Q2 = A).
 *
 * Three options; the people listed are chosen only for *Members and listed
 * people*; and one sentence says what the choice means now — for *Follow the
 * module setting*, what the module setting currently is, read from the
 * module's own `GET /projects/visibility-setting`. People are found through
 * the module's own lookup, never `/admin-users`.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { VisibilityControl, visibilityBody } = await import(
  '../../../../packages/modules/projects/src/admin/components/VisibilityControl'
);
type VisibilityValue = import('../../../../packages/modules/projects/src/admin/components/VisibilityControl').VisibilityValue;
const { OverviewTab } = await import('../../../../packages/modules/projects/src/admin/pages/project-detail/tabs/OverviewTab');

const SETTING_PATH = '/api/v1/admin/projects/visibility-setting';
const PEOPLE_PATH = '/api/v1/admin/projects/lookups/admin-users';
const PIOTR_ID = '00000000-0000-4000-8000-000000000c02';

let setting: 'members' | 'everyone' | 'fail';

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  patchSpy.mockReset();
  setting = 'members';
  getSpy.mockImplementation((path: string) => {
    if (path === SETTING_PATH) {
      return setting === 'fail' ? Promise.reject(new Error('boom')) : Promise.resolve({ data: { setting } });
    }
    if (path.startsWith(PEOPLE_PATH)) {
      return Promise.resolve({
        data: [
          { id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' },
          { id: PIOTR_ID, name: 'Piotr Wiśniewski', email: 'piotr@example.com' },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function Harness(props: { initial?: VisibilityValue; onValue?: (value: VisibilityValue) => void }): ReactElement {
  const [value, setValue] = useState<VisibilityValue>(props.initial ?? { visibility: 'inherit', viewers: [] });
  return (
    <VisibilityControl
      value={value}
      onChange={(next): void => {
        setValue(next);
        props.onValue?.(next);
      }}
    />
  );
}

const group = (): HTMLElement => screen.getByRole('radiogroup', { name: en('visibility.section') });

describe('VisibilityControl', () => {
  it('offers the three choices, following the module setting by default, and says what that means now', async () => {
    renderProjects(<Harness />);
    const radios = within(group()).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['inherit', 'everyone', 'members_and_listed']);
    expect(within(group()).getByRole('radio', { name: en('visibility.option.inherit') })).toBeChecked();
    expect(
      await screen.findByText(
        en('visibility.effect.inheritMembers', { setting: en('settingLabels.projects.visibility.options.members') }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(en('visibility.listed.label'))).toBeNull();
  });

  it('names the module setting by the label its own screen shows (issue #1565, WORK-18)', async () => {
    renderProjects(<Harness />);
    const effect = await screen.findByText(new RegExp(en('settingLabels.projects.visibility.options.members')));
    // Not a third name for the same option ("Members only").
    expect(effect.textContent).not.toMatch(/Members only/);
    expect(effect.textContent?.length ?? 0).toBeLessThanOrEqual(100);
    setting = 'everyone';
    renderProjects(<Harness />);
    expect(
      await screen.findByText(new RegExp(en('settingLabels.projects.visibility.options.everyone'))),
    ).toBeInTheDocument();
  });

  it('reads the module setting as it stands — "everyone" is said as such', async () => {
    setting = 'everyone';
    renderProjects(<Harness />);
    expect(
      await screen.findByText(
        en('visibility.effect.inheritEveryone', { setting: en('settingLabels.projects.visibility.options.everyone') }),
      ),
    ).toBeInTheDocument();
  });

  it('when the setting cannot be read, still says the Project follows it, without guessing', async () => {
    setting = 'fail';
    renderProjects(<Harness />);
    expect(await screen.findByText(en('visibility.effect.inheritUnknown'))).toBeInTheDocument();
  });

  it('"Everyone" needs nobody listed and says who sees it', async () => {
    renderProjects(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: en('visibility.option.everyone') }));
    expect(screen.getByText(en('visibility.effect.everyone'))).toBeInTheDocument();
    expect(screen.queryByLabelText(en('visibility.listed.label'))).toBeNull();
  });

  it('"Members and listed people" offers the people picker; a person picked is listed and can be removed', async () => {
    const seen: VisibilityValue[] = [];
    renderProjects(<Harness onValue={(value): number => seen.push(value)} />);
    await userEvent.click(screen.getByRole('radio', { name: en('visibility.option.members_and_listed') }));
    expect(screen.getByText(en('visibility.effect.membersAndListed'))).toBeInTheDocument();
    expect(screen.getByText(en('visibility.listed.empty'))).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(en('visibility.listed.label')));
    await userEvent.click(await screen.findByRole('option', { name: /Piotr Wiśniewski/ }));
    const listed = screen.getByRole('list', { name: en('visibility.listed.label') });
    expect(within(listed).getByText('Piotr Wiśniewski')).toBeInTheDocument();
    expect(seen.at(-1)).toEqual({ visibility: 'members_and_listed', viewers: [{ id: PIOTR_ID, name: 'Piotr Wiśniewski' }] });
    expect(getSpy.mock.calls.map(([path]) => path as string).some((path) => path.startsWith('/api/v1/admin/admin-users'))).toBe(false);

    await userEvent.click(within(listed).getByRole('button', { name: en('visibility.listed.remove', { name: 'Piotr Wiśniewski' }) }));
    expect(seen.at(-1)).toEqual({ visibility: 'members_and_listed', viewers: [] });
  });

  it('the body a form sends: listed people only with "Members and listed people"', () => {
    const viewers = [{ id: PIOTR_ID, name: 'Piotr Wiśniewski' }];
    expect(visibilityBody({ visibility: 'members_and_listed', viewers })).toEqual({
      visibility: 'members_and_listed',
      viewerIds: [PIOTR_ID],
    });
    expect(visibilityBody({ visibility: 'everyone', viewers })).toEqual({ visibility: 'everyone', viewerIds: [] });
  });
});

describe('Overview — who sees this project', () => {
  function renderOverview(project: ProjectDetail, onChange = vi.fn()): ReturnType<typeof vi.fn> {
    renderProjects(<OverviewTab project={project} onChange={onChange} reload={vi.fn(async () => {})} />);
    return onChange;
  }

  it('a writer changes it and saves: one PATCH naming the version read, and the answer is put on screen', async () => {
    const answer = detail({ visibility: 'everyone', version: 4 });
    patchSpy.mockResolvedValue({ data: answer });
    const onChange = renderOverview(detail());
    const save = screen.getByRole('button', { name: en('visibility.save') });
    expect(save).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: en('visibility.option.everyone') }));
    await userEvent.click(save);

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`/api/v1/admin/projects/${PROJECT_ID}`, {
      visibility: 'everyone',
      viewerIds: [],
      version: 3,
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(answer));
    expect(await screen.findByRole('status')).toHaveTextContent(en('visibility.saved'));
  });

  it('a refusal is said where the change was made, and nothing is put on screen', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'PROJECT_CHANGED', message: 'The project changed since it was read.' } }),
    );
    const onChange = renderOverview(detail());
    await userEvent.click(screen.getByRole('radio', { name: en('visibility.option.everyone') }));
    await userEvent.click(screen.getByRole('button', { name: en('visibility.save') }));
    expect(await screen.findByText('The project changed since it was read.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  /** The Overview under a page that may put a newer read of the Project on screen — another write's answer. */
  function Page(props: { first: ProjectDetail; later: ProjectDetail }): ReactElement {
    const [project, setProject] = useState(props.first);
    return (
      <>
        <button type="button" onClick={(): void => setProject(props.later)}>
          another write
        </button>
        <OverviewTab project={project} onChange={setProject} reload={vi.fn(async () => {})} />
      </>
    );
  }

  it('follows a newer read of the Project while nothing is changed here — no stale choice, nothing to save', async () => {
    renderProjects(<Page first={detail()} later={detail({ visibility: 'everyone', version: 4 })} />);
    expect(screen.getByRole('radio', { name: en('visibility.option.inherit') })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'another write' }));
    expect(screen.getByRole('radio', { name: en('visibility.option.everyone') })).toBeChecked();
    expect(screen.getByRole('button', { name: en('visibility.save') })).toBeDisabled();
  });

  it('keeps a change somebody is making when a newer read arrives, and saves it against the newer version', async () => {
    patchSpy.mockResolvedValue({ data: detail({ visibility: 'members_and_listed', version: 5 }) });
    renderProjects(<Page first={detail()} later={detail({ title: 'Renamed', version: 4 })} />);
    await userEvent.click(screen.getByRole('radio', { name: en('visibility.option.everyone') }));
    await userEvent.click(screen.getByRole('button', { name: 'another write' }));
    expect(screen.getByRole('radio', { name: en('visibility.option.everyone') })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: en('visibility.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`/api/v1/admin/projects/${PROJECT_ID}`, {
      visibility: 'everyone',
      viewerIds: [],
      version: 4,
    });
  });

  it('a reader is told who sees it and who is listed, with nothing to change', async () => {
    renderOverview(
      detail({
        visibility: 'members_and_listed',
        viewers: [{ id: PIOTR_ID, name: 'Piotr Wiśniewski' }],
        permissions: { canWrite: false, canConfigure: false },
      }),
    );
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: en('visibility.save') })).toBeNull();
    expect(screen.getByText(en('visibility.effect.membersAndListed'))).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: en('visibility.listed.label') })).getByText('Piotr Wiśniewski')).toBeInTheDocument();
  });
});
