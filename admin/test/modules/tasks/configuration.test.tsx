import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { en, renderTasks } from './tasks-fixtures';

/**
 * Task configuration is one place with four views (issue #1557, UX audit
 * WORK-06): one sidebar row, *Task configuration*, opening a route-tab strip
 * Workflow | Priorities | Tags | General. The sub-pages used to be reached
 * through three text links in the workflow screen's header and left only by a
 * back link; the time zone was a page of its own.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      // Every screen's load stays in flight: the strip is the screen's frame,
      // drawn before (and whatever) the data says.
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { contributions } = await import('../../../../packages/modules/tasks/src/admin/index');
const { manifest } = await import('../../../../packages/modules/tasks/src/manifest');
const { TaskWorkflowPage } = await import('../../../../packages/modules/tasks/src/admin/pages/settings/TaskWorkflowPage');
const { TaskPrioritiesPage } = await import('../../../../packages/modules/tasks/src/admin/pages/settings/TaskPrioritiesPage');
const { TaskTagsPage } = await import('../../../../packages/modules/tasks/src/admin/pages/settings/TaskTagsPage');
const { TaskGeneralSettingsPage } = await import(
  '../../../../packages/modules/tasks/src/admin/pages/settings/TaskGeneralSettingsPage'
);
const { TaskConfigurationRedirect } = await import(
  '../../../../packages/modules/tasks/src/admin/pages/settings/TaskConfigurationRedirect'
);

const CONFIGURER = ['tasks:read', 'tasks:write', 'tasks:configure'];
const CONFIGURATION = '/tasks/settings';

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation(() => new Promise(() => {}));
});

describe('Task configuration — one sidebar row', () => {
  it('is one row on tasks:configure, at the prefix of every configuration screen', () => {
    const configureRows = (contributions.nav ?? []).filter((row) => row.requiredPermission === 'tasks:configure');
    expect(configureRows).toHaveLength(1);
    expect(configureRows[0]).toMatchObject({ to: CONFIGURATION, labelKey: 'nav.configuration.label' });
    expect(en('nav.configuration.label')).toBe('Task configuration');

    // The row lights up, and the breadcrumb names it, on every tab: both are
    // prefix matches on the row's address.
    const configureRoutes = (contributions.routes ?? []).filter((route) => route.requiredPermission === 'tasks:configure');
    expect(configureRoutes.map((route) => route.path)).toEqual([
      CONFIGURATION,
      `${CONFIGURATION}/workflow`,
      `${CONFIGURATION}/priorities`,
      `${CONFIGURATION}/tags`,
      `${CONFIGURATION}/general`,
    ]);
  });

  it('keeps a palette action on every tab (Principle XVI), each on a route that exists', () => {
    const paths = new Set((contributions.routes ?? []).map((route) => route.path));
    const targets = (manifest.actions ?? [])
      .filter((action) => action.requiredPermission === 'tasks:configure')
      .map((action) => action.targetRoute);
    expect(targets).toEqual([
      CONFIGURATION,
      `${CONFIGURATION}/priorities`,
      `${CONFIGURATION}/tags`,
      `${CONFIGURATION}/general`,
    ]);
    for (const target of targets) expect(paths.has(target)).toBe(true);
  });

  it('opens on the Workflow tab, which is the row’s own address', () => {
    const workflow = (contributions.routes ?? []).find((route) => route.path === CONFIGURATION);
    expect(workflow?.requiredPermission).toBe('tasks:configure');
  });

  it('sends the workflow’s old address to the tab, the board card’s anchor kept', async () => {
    function Address(): ReactElement {
      const { pathname, hash } = useLocation();
      return <p data-testid="address">{`${pathname}${hash}`}</p>;
    }
    renderTasks(
      <Routes>
        <Route path={`${CONFIGURATION}/workflow`} element={<TaskConfigurationRedirect />} />
        <Route path={CONFIGURATION} element={<Address />} />
      </Routes>,
      { permissions: CONFIGURER, path: `${CONFIGURATION}/workflow#board-card` },
    );
    expect((await screen.findByTestId('address')).textContent).toBe(`${CONFIGURATION}#board-card`);
  });
});

describe('Task configuration — the tab strip', () => {
  const screens: ReadonlyArray<readonly [string, () => ReactElement, string]> = [
    [CONFIGURATION, () => <TaskWorkflowPage />, 'configuration.tab.workflow'],
    [`${CONFIGURATION}/priorities`, () => <TaskPrioritiesPage />, 'configuration.tab.priorities'],
    [`${CONFIGURATION}/tags`, () => <TaskTagsPage />, 'configuration.tab.tags'],
    [`${CONFIGURATION}/general`, () => <TaskGeneralSettingsPage />, 'configuration.tab.general'],
  ];

  it.each(screens)('%s shows all four tabs, its own selected, and no back link', (path, ui, labelKey) => {
    renderTasks(ui(), { permissions: CONFIGURER, path });
    const strip = screen.getByRole('tablist');
    const tabs = within(strip).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      en('configuration.tab.workflow'),
      en('configuration.tab.priorities'),
      en('configuration.tab.tags'),
      en('configuration.tab.general'),
    ]);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      CONFIGURATION,
      `${CONFIGURATION}/priorities`,
      `${CONFIGURATION}/tags`,
      `${CONFIGURATION}/general`,
    ]);
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected.map((tab) => tab.textContent)).toEqual([en(labelKey)]);
    // The strip is the way between the four; the old back link to the
    // workflow screen is gone with the header links it answered.
    expect(screen.queryByRole('link', { name: /Task statuses and workflow/ })).toBeNull();
  });

  it('the workflow header carries no text links to the other screens any more', () => {
    renderTasks(<TaskWorkflowPage />, { permissions: CONFIGURER, path: CONFIGURATION });
    expect(screen.queryByRole('navigation', { name: 'Task configuration' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'General settings' })).toBeNull();
  });
});
