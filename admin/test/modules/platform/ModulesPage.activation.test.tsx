import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ModuleListItem, ModulePresence } from '@b2b/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * D-36a item 1 — the activation control renders on `/platform/modules`.
 *
 * Constitution XVII's three binding requirements are unchanged: exactly one
 * control per module, declared by the owning module's manifest, reachable
 * without CLI access. Only the surface moves, off the Settings screen, so that
 * no module owns the surface that toggles modules — switching Settings off used
 * to take the control that would switch it back on with it.
 */

let listed: ModuleListItem[] = [];
let presence: ModulePresence[] = [];
const setModuleActivation = vi.fn(async () => ({}));
const refresh = vi.fn(async () => {});

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: presence,
    isPresent: (id: string) => presence.find((m) => m.id === id)?.present ?? false,
    presenceOf: (id: string) => presence.find((m) => m.id === id),
    degraded: false,
    isLoading: false,
    error: null,
    refresh,
  }),
  setModuleActivation,
  getModulePresence: vi.fn(),
}));

vi.mock('@/modules/platform/api', () => ({
  listModules: vi.fn(async () => ({ modules: listed })),
}));

const { ModulesPage } = await import('../../../src/modules/platform/ModulesPage');

const bundle = passthroughBundle('core', [
  'platform.modules.title',
  'platform.modules.description',
  'platform.modules.cliHint',
  'platform.modules.empty',
  'platform.modules.column.module',
  'platform.modules.column.platform',
  'platform.modules.column.activation',
  'platform.modules.column.version',
  'platform.modules.column.flags',
  'platform.modules.column.actions',
  'platform.modules.state.installed',
  'platform.modules.state.notInstalled',
  'platform.modules.activation.on',
  'platform.modules.activation.off',
  'platform.modules.activation.unmanaged',
  'platform.modules.activation.locked',
  'platform.modules.action.enable',
  'platform.modules.action.disable',
  'platform.modules.action.confirmDisable',
]);

function moduleItem(patch: Partial<ModuleListItem> & { id: string }): ModuleListItem {
  return {
    name: patch.id,
    description: null,
    version: { registered: '1.0.0', onDisk: '1.0.0' },
    state: 'installed',
    dependencies: [],
    flags: [],
    license: null,
    installedAt: '2026-08-01T00:00:00.000Z',
    lastStateChangeAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

function presenceItem(patch: Partial<ModulePresence> & { id: string }): ModulePresence {
  return {
    present: true,
    platformState: 'installed',
    activated: true,
    deactivatable: true,
    nonDeactivatableReason: null,
    ...patch,
  };
}

async function renderPage(): Promise<void> {
  renderWithI18n(
    <MemoryRouter>
      <ModulesPage />
    </MemoryRouter>,
    bundle,
  );
  await screen.findByRole('table');
}

function row(moduleId: string): HTMLElement {
  const el = document.querySelector(`[data-module-id="${moduleId}"]`);
  if (!el) throw new Error(`no row rendered for module "${moduleId}"`);
  return el as HTMLElement;
}

beforeEach(() => {
  listed = [];
  presence = [];
  setModuleActivation.mockClear();
  refresh.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('ModulesPage — the activation control lives here now (D-36a)', () => {
  it('switches a module off through the audited endpoint and re-reads presence', async () => {
    listed = [moduleItem({ id: 'blog', name: 'Blog' })];
    presence = [presenceItem({ id: 'blog' })];
    await renderPage();

    await userEvent.click(
      within(row('blog')).getByRole('button', { name: /platform.modules.action.disable/ }),
    );

    expect(setModuleActivation).toHaveBeenCalledWith('blog', false);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('offers the way back for a module the operator already switched off', async () => {
    listed = [moduleItem({ id: 'blog', name: 'Blog' })];
    presence = [presenceItem({ id: 'blog', present: false, activated: false })];
    await renderPage();

    await userEvent.click(
      within(row('blog')).getByRole('button', { name: /platform.modules.action.enable/ }),
    );

    expect(setModuleActivation).toHaveBeenCalledWith('blog', true);
  });

  it('confirms before switching off, and abandons the flip when the operator declines', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    listed = [moduleItem({ id: 'blog', name: 'Blog' })];
    presence = [presenceItem({ id: 'blog' })];
    await renderPage();

    await userEvent.click(
      within(row('blog')).getByRole('button', { name: /platform.modules.action.disable/ }),
    );

    expect(setModuleActivation).not.toHaveBeenCalled();
  });

  it('offers no control for a module the deployment does not install', async () => {
    listed = [moduleItem({ id: 'ksef', name: 'KSeF', state: 'not-installed' })];
    presence = [presenceItem({ id: 'ksef', present: false, platformState: 'not-installed' })];
    await renderPage();

    // That axis belongs to whoever operates the deployment and is changed with
    // the CLI; a button here would be a promise this screen cannot keep.
    expect(within(row('ksef')).queryByRole('button')).toBeNull();
  });

  it('renders a non-deactivatable module locked, with the reason the module itself declared', async () => {
    // T063 / SC-012. The id is deliberately one no module will ever have: the
    // lock and its wording come from the projection, and the admin app contains
    // no list of module ids that may not be switched off.
    listed = [moduleItem({ id: 'load_bearing_thing', name: 'Load-bearing thing' })];
    presence = [
      presenceItem({
        id: 'load_bearing_thing',
        deactivatable: false,
        nonDeactivatableReason: 'Nobody could sign in to switch it back on.',
      }),
    ];
    await renderPage();

    const control = within(row('load_bearing_thing')).getByRole('button', {
      name: /platform.modules.activation.locked/,
    });
    expect(control).toBeDisabled();
    expect(control.getAttribute('title')).toBe('Nobody could sign in to switch it back on.');
    expect(
      within(row('load_bearing_thing')).getByText('Nobody could sign in to switch it back on.'),
    ).toBeInTheDocument();

    await userEvent.click(control);
    expect(setModuleActivation).not.toHaveBeenCalled();
  });

  it('offers no control for a module that has declared no activation setting', async () => {
    listed = [moduleItem({ id: 'catalog', name: 'Catalog' })];
    presence = [presenceItem({ id: 'catalog', deactivatable: false })];
    await renderPage();

    expect(within(row('catalog')).queryByRole('button')).toBeNull();
  });
});
