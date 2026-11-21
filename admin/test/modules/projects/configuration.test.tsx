import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { en, renderProjects } from './projects-fixtures';

/**
 * Project configuration is one place with three views (issue #1557, UX audit
 * WORK-06): one sidebar row, *Project configuration*, opening a route-tab
 * strip Templates | Roles | Loss reasons. They used to be three rows of the
 * "Projects & tasks" section, two of them for two-column dictionaries.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { contributions } = await import('../../../../packages/modules/projects/src/admin/index');
const { manifest } = await import('../../../../packages/modules/projects/src/manifest');
const { TemplatesList } = await import('../../../../packages/modules/projects/src/admin/pages/TemplatesList');
const { RolesPage } = await import('../../../../packages/modules/projects/src/admin/pages/RolesPage');
const { LossReasonsPage } = await import('../../../../packages/modules/projects/src/admin/pages/LossReasonsPage');
const { ProjectConfigurationRedirect } = await import(
  '../../../../packages/modules/projects/src/admin/pages/ProjectConfigurationRedirect'
);

const CONFIGURER = ['projects:read', 'projects:configure'];
const CONFIGURATION = '/projects/settings';

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation(() => new Promise(() => {}));
});

function Address(): ReactElement {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="address">{`${pathname}${search}${hash}`}</p>;
}

describe('Project configuration — one sidebar row', () => {
  it('is one row on projects:configure, at the prefix of every configuration screen', () => {
    const configureRows = (contributions.nav ?? []).filter((row) => row.requiredPermission === 'projects:configure');
    expect(configureRows).toHaveLength(1);
    expect(configureRows[0]).toMatchObject({ to: CONFIGURATION, labelKey: 'nav.configuration.label' });
    expect(en('nav.configuration.label')).toBe('Project configuration');

    const screens = (contributions.routes ?? [])
      .filter((route) => route.requiredPermission === 'projects:configure')
      .map((route) => route.path)
      .filter((path) => path === CONFIGURATION || path.startsWith(`${CONFIGURATION}/`));
    expect(screens).toEqual([
      CONFIGURATION,
      `${CONFIGURATION}/templates/new`,
      `${CONFIGURATION}/templates/:id`,
      `${CONFIGURATION}/roles`,
      `${CONFIGURATION}/loss-reasons`,
    ]);
  });

  it('keeps a palette action on every tab (Principle XVI), each on a route that exists', () => {
    const paths = new Set((contributions.routes ?? []).map((route) => route.path));
    const targets = Object.fromEntries((manifest.actions ?? []).map((action) => [action.id, action.targetRoute]));
    expect(targets).toMatchObject({
      'open-project-templates': CONFIGURATION,
      'open-project-roles': `${CONFIGURATION}/roles`,
      'open-project-loss-reasons': `${CONFIGURATION}/loss-reasons`,
    });
    for (const target of Object.values(targets)) expect(paths.has(target)).toBe(true);
  });

  // The addresses before issue #1557, for bookmarks and links already sent.
  it.each([
    ['/projects/templates', CONFIGURATION],
    ['/projects/templates/new', `${CONFIGURATION}/templates/new`],
    ['/projects/templates/00000000-0000-4000-8000-0000000007a1?x=1', `${CONFIGURATION}/templates/00000000-0000-4000-8000-0000000007a1?x=1`],
    ['/projects/roles', `${CONFIGURATION}/roles`],
    ['/projects/loss-reasons', `${CONFIGURATION}/loss-reasons`],
  ])('%s lands on %s', async (from, to) => {
    renderProjects(
      <Routes>
        <Route path={CONFIGURATION} element={<Address />} />
        <Route path="/projects/templates/*" element={<ProjectConfigurationRedirect />} />
        <Route path="/projects/roles" element={<ProjectConfigurationRedirect />} />
        <Route path="/projects/loss-reasons" element={<ProjectConfigurationRedirect />} />
        <Route path={`${CONFIGURATION}/*`} element={<Address />} />
      </Routes>,
      { permissions: CONFIGURER, path: from },
    );
    expect((await screen.findByTestId('address')).textContent).toBe(to);
  });

  it('redirects every old address it declares', () => {
    const paths = (contributions.routes ?? []).map((route) => route.path);
    for (const old of ['/projects/templates', '/projects/templates/new', '/projects/templates/:id', '/projects/roles', '/projects/loss-reasons']) {
      expect(paths, old).toContain(old);
    }
  });
});

describe('Project configuration — the tab strip', () => {
  const screens: ReadonlyArray<readonly [string, () => ReactElement, string]> = [
    [CONFIGURATION, () => <TemplatesList />, 'configuration.tab.templates'],
    [`${CONFIGURATION}/roles`, () => <RolesPage />, 'configuration.tab.roles'],
    [`${CONFIGURATION}/loss-reasons`, () => <LossReasonsPage />, 'configuration.tab.lossReasons'],
  ];

  it.each(screens)('%s shows all three tabs with its own selected', (path, ui, labelKey) => {
    renderProjects(ui(), { permissions: CONFIGURER, path });
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual([
      [en('configuration.tab.templates'), CONFIGURATION],
      [en('configuration.tab.roles'), `${CONFIGURATION}/roles`],
      [en('configuration.tab.lossReasons'), `${CONFIGURATION}/loss-reasons`],
    ]);
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected.map((tab) => tab.textContent)).toEqual([en(labelKey)]);
  });
});
