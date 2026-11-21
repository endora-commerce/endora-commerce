import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { en, renderCrm } from './crm-fixtures';

/**
 * CRM configuration is one place (issue #1557, UX audit WORK-06): one sidebar
 * row, *Configuration*, opening a route-tab strip Workflow | Tags. Tags and
 * Workflow used to be two rows of the CRM section.
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

const { contributions } = await import('../../../../packages/modules/crm/src/admin/index');
const { manifest } = await import('../../../../packages/modules/crm/src/manifest');
const { WorkflowConfigPage } = await import('../../../../packages/modules/crm/src/admin/pages/WorkflowConfigPage');
const { TagsPage } = await import('../../../../packages/modules/crm/src/admin/pages/TagsPage');
const { CrmTagsRedirect } = await import('../../../../packages/modules/crm/src/admin/pages/CrmTagsRedirect');

const CONFIGURER = ['crm:read', 'crm:write', 'crm:configure'];
const CONFIGURATION = '/crm/workflow';

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation(() => new Promise(() => {}));
});

describe('CRM configuration — one sidebar row', () => {
  it('is one row on crm:configure, at the prefix of every configuration screen', () => {
    const configureRows = (contributions.nav ?? []).filter((row) => row.requiredPermission === 'crm:configure');
    expect(configureRows).toHaveLength(1);
    expect(configureRows[0]).toMatchObject({ to: CONFIGURATION, labelKey: 'nav.configuration.label' });
    expect(en('nav.configuration.label')).toBe('Configuration');

    const paths = (contributions.routes ?? []).map((route) => route.path);
    expect(paths).toContain(CONFIGURATION);
    expect(paths).toContain(`${CONFIGURATION}/tags`);
  });

  it('keeps a palette action on both tabs (Principle XVI), each on a route that exists', () => {
    const paths = new Set((contributions.routes ?? []).map((route) => route.path));
    const targets = Object.fromEntries((manifest.actions ?? []).map((action) => [action.id, action.targetRoute]));
    expect(targets).toMatchObject({ 'open-crm-workflow': CONFIGURATION, 'open-crm-tags': `${CONFIGURATION}/tags` });
    for (const target of Object.values(targets)) expect(paths.has(target), target).toBe(true);
  });

  it('sends the tag list’s old address to the Tags tab', async () => {
    function Address(): ReactElement {
      return <p data-testid="address">{useLocation().pathname}</p>;
    }
    renderCrm(
      <Routes>
        <Route path="/crm/tags" element={<CrmTagsRedirect />} />
        <Route path={`${CONFIGURATION}/tags`} element={<Address />} />
      </Routes>,
      { permissions: CONFIGURER, path: '/crm/tags' },
    );
    expect((await screen.findByTestId('address')).textContent).toBe(`${CONFIGURATION}/tags`);
  });
});

describe('CRM configuration — the tab strip', () => {
  it.each([
    [CONFIGURATION, () => <WorkflowConfigPage />, 'configuration.tab.workflow'],
    [`${CONFIGURATION}/tags`, () => <TagsPage />, 'configuration.tab.tags'],
  ] as const)('%s shows both tabs with its own selected', (path, ui, labelKey) => {
    renderCrm(ui(), { permissions: CONFIGURER, path });
    const strips = screen.getAllByRole('tablist');
    const strip = strips.find((candidate) =>
      within(candidate).queryByRole('tab', { name: en('configuration.tab.tags') }),
    );
    expect(strip).toBeDefined();
    const tabs = within(strip!).getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('href'))).toContain(`${CONFIGURATION}/tags`);
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected.map((tab) => tab.textContent)).toEqual([en(labelKey)]);
  });
});
