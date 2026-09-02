import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ModuleListItem, ModulePresence } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/api-client';
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
  'platform.modules.activation.alwaysOn',
  'platform.modules.activation.alwaysOnReason',
  'platform.modules.activation.locked',
  'platform.modules.action.enable',
  'platform.modules.action.disable',
  'platform.modules.action.confirmDisable',
]);

// The two dependency refusals are rendered from the bundle with the blocking
// module ids interpolated, so these two keys carry a template rather than
// resolving to themselves: the assertion below is that the ids reach the
// sentence, which a passthrough key cannot show.
bundle['core']!['platform.modules.error.dependentsPresent'] = 'blocked: {name} needs {modules}';
bundle['core']!['platform.modules.error.dependenciesAbsent'] = 'missing: {name} wants {modules}';
bundle['core']!['platform.modules.error.pimConnectorAlreadyActive'] =
  'pim blocked: {name} vs {activeModuleId}';

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

  it('names the blocking modules when the server refuses the flip (FR-008)', async () => {
    // The refusal an operator is most likely to meet, and the one the sentence
    // has to make actionable: the ids come from `details`, in both languages,
    // rather than from the server's English message.
    setModuleActivation.mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'MODULE_DEPENDENTS_PRESENT',
          message: 'Module "settings" cannot be switched off while these modules need it: organizations.',
          details: { moduleId: 'settings', blockedBy: ['organizations'] },
          requestId: 'req_test',
        },
      }),
    );
    listed = [moduleItem({ id: 'settings', name: 'Settings' })];
    presence = [presenceItem({ id: 'settings' })];
    await renderPage();

    await userEvent.click(
      within(row('settings')).getByRole('button', { name: /platform.modules.action.disable/ }),
    );

    expect(await screen.findByText('blocked: Settings needs organizations')).toBeInTheDocument();
  });

  it('names the incumbent PIM connector when mutual exclusion refuses the flip (FR-003)', async () => {
    setModuleActivation.mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'PIM_CONNECTOR_ALREADY_ACTIVE',
          message: 'Another PIM connector is already active: pim_ergonode',
          details: { activeModuleId: 'pim_ergonode' },
          requestId: 'req_test',
        },
      }),
    );
    listed = [moduleItem({ id: 'pim_unopim', name: 'UnoPim PIM' })];
    presence = [presenceItem({ id: 'pim_unopim', present: false, activated: false })];
    await renderPage();

    await userEvent.click(
      within(row('pim_unopim')).getByRole('button', { name: /platform.modules.action.enable/ }),
    );

    expect(
      await screen.findByText('pim blocked: UnoPim PIM vs pim_ergonode'),
    ).toBeInTheDocument();
  });

  it('keeps the server sentence for a refusal that names no modules', async () => {
    // `MODULE_NOT_DEACTIVATABLE` carries the module's own declared reason. A
    // bundle string here would be the hard-coded exception list Constitution
    // XVII forbids, moved into the translations.
    setModuleActivation.mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'MODULE_NOT_DEACTIVATABLE',
          message: 'The single unit of tenancy.',
          requestId: 'req_test',
        },
      }),
    );
    listed = [moduleItem({ id: 'organizations', name: 'Organizations' })];
    presence = [presenceItem({ id: 'organizations' })];
    await renderPage();

    await userEvent.click(
      within(row('organizations')).getByRole('button', {
        name: /platform.modules.action.disable/,
      }),
    );

    expect(await screen.findByText('The single unit of tenancy.')).toBeInTheDocument();
  });

  it('offers no *actionable* control for a module that declares no activation setting', async () => {
    // Feature 074 changed the rendering, not the guarantee. The cell used to be
    // the "No switch yet" label with nothing in it; it is now the locked
    // affordance with its own sentence, so the button exists and is disabled.
    // What must not exist is anything that writes.
    listed = [moduleItem({ id: 'health_checks', name: 'Health Checks' })];
    presence = [presenceItem({ id: 'health_checks', deactivatable: false })];
    await renderPage();

    const control = within(row('health_checks')).getByRole('button');
    expect(control).toBeDisabled();
    await userEvent.click(control);
    expect(setModuleActivation).not.toHaveBeenCalled();
  });
});
