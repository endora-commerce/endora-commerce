import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ModuleListItem, ModulePresence } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 073 / US5 (T059, T062) — "not installed here", "we turned it off"
 * and "cannot be turned off" must read differently.
 *
 * The screen is kernel-served (D-36): no module owns the surface that reports
 * on modules, so nothing here is gated on module presence. It is also the only
 * consumer `GET /api/v1/admin/modules` has ever had, which is why every column
 * it renders is asserted rather than assumed.
 *
 * Both data sources are mocked at the module boundary: the page composes the
 * platform axis (`/admin/modules`, the orchestrator's view) with the effective
 * projection (`/admin/module-presence`), and the states worth distinguishing
 * only exist in the combination.
 */

let listed: ModuleListItem[] = [];
let presence: ModulePresence[] = [];
let degraded = false;

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: presence,
    isPresent: (id: string) => presence.find((m) => m.id === id)?.present ?? false,
    presenceOf: (id: string) => presence.find((m) => m.id === id),
    degraded,
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
  setModuleActivation: vi.fn(),
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
  'platform.modules.degraded',
  'platform.modules.empty',
  'platform.modules.column.module',
  'platform.modules.column.platform',
  'platform.modules.column.activation',
  'platform.modules.column.version',
  'platform.modules.column.flags',
  'platform.modules.column.actions',
  'platform.modules.action.enable',
  'platform.modules.action.disable',
  'platform.modules.state.installed',
  'platform.modules.state.disabled',
  'platform.modules.state.installing',
  'platform.modules.state.uninstalled',
  'platform.modules.state.notInstalled',
  'platform.modules.activation.on',
  'platform.modules.activation.off',
  'platform.modules.activation.locked',
  'platform.modules.activation.alwaysOn',
  'platform.modules.activation.alwaysOnReason',
  'platform.modules.flag.orphan',
  'platform.modules.flag.pendingUpgrade',
  'platform.modules.flag.depMissing',
  'platform.modules.flag.depDisabled',
  'platform.modules.versionDrift',
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

/**
 * Renders the screen and waits for the rows, not for the table.
 *
 * `<Table>` is rendered unconditionally — `loading` decides what goes in the
 * body, never whether the body is there — so `findByRole('table')` is satisfied
 * by the **first** commit, before either fetch has resolved. Every assertion
 * below then reads a row that is not there yet. It passed anyway for as long as
 * both mocked promises settled before that first check ran, and stopped passing
 * under load, where the process is descheduled between the commits and the wait
 * observes the empty one: a race no timeout can repair, because the wait
 * succeeds — on the wrong condition.
 *
 * The condition is derived from the fixture rather than picked: every module
 * `listed` has reached the table. A screen that drops one fails here instead of
 * failing later as a missing row.
 */
async function renderPage(): Promise<void> {
  renderWithI18n(
    <MemoryRouter>
      <ModulesPage />
    </MemoryRouter>,
    bundle,
  );
  await screen.findByRole('table');
  await waitFor(() =>
    expect(document.querySelectorAll('[data-module-id]')).toHaveLength(listed.length),
  );
}

function row(moduleId: string): HTMLElement {
  const el = document.querySelector(`[data-module-id="${moduleId}"]`);
  if (!el) throw new Error(`no row rendered for module "${moduleId}"`);
  return el as HTMLElement;
}

beforeEach(() => {
  listed = [];
  presence = [];
  degraded = false;
});

describe('ModulesPage — the four states read differently (FR-034)', () => {
  it('renders a present module as available and switched on', async () => {
    listed = [moduleItem({ id: 'blog', name: 'Blog' })];
    presence = [presenceItem({ id: 'blog' })];
    await renderPage();

    const blog = row('blog');
    expect(within(blog).getByText('Blog')).toBeInTheDocument();
    expect(within(blog).getByText('platform.modules.state.installed')).toBeInTheDocument();
    expect(within(blog).getByText('platform.modules.activation.on')).toBeInTheDocument();
  });

  it('distinguishes "we turned it off" from "not installed here"', async () => {
    listed = [
      moduleItem({ id: 'blog', name: 'Blog' }),
      moduleItem({ id: 'ksef', name: 'KSeF', state: 'not-installed' }),
    ];
    presence = [
      presenceItem({ id: 'blog', present: false, activated: false }),
      presenceItem({
        id: 'ksef',
        present: false,
        platformState: 'not-installed',
        activated: true,
      }),
    ];
    await renderPage();

    // Deactivated: the deployment offers it, the operator switched it off.
    const blog = row('blog');
    expect(within(blog).getByText('platform.modules.state.installed')).toBeInTheDocument();
    expect(within(blog).getByText('platform.modules.activation.off')).toBeInTheDocument();

    // Platform-unavailable: not the operator's doing and not the operator's to
    // undo, so it never reads as merely "switched off".
    const ksef = row('ksef');
    expect(within(ksef).getByText('platform.modules.state.notInstalled')).toBeInTheDocument();
    expect(
      within(ksef).queryByText('platform.modules.activation.off'),
      'a module the deployment does not offer must not be shown as switched off by the operator',
    ).toBeNull();
  });

  it('renders a non-deactivatable module with its own declared reason', async () => {
    listed = [moduleItem({ id: 'auth', name: 'Authentication' })];
    presence = [
      presenceItem({
        id: 'auth',
        deactivatable: false,
        nonDeactivatableReason: 'Nobody could sign in to switch it back on.',
      }),
    ];
    await renderPage();

    const auth = row('auth');
    expect(within(auth).getByText('platform.modules.activation.locked')).toBeInTheDocument();
    // The reason comes from the module's manifest, through the projection —
    // SC-012: no hard-coded list of module ids anywhere in this app.
    expect(
      within(auth).getByText('Nobody could sign in to switch it back on.'),
    ).toBeInTheDocument();
  });

  it('reads a module that declares no control as always-on, in the locked shape (FR-016)', async () => {
    // Feature 074. This used to render "No switch yet", which announced an
    // omission: 66 of 67 modules were in this state while the conversion sweep
    // ran, and the label named the backlog. With the sweep finished exactly one
    // module is left here — `health_checks`, whose probes are exempt from
    // gating outright — so the cell says *why there is no switch* instead, in
    // the same affordance a core module's lock uses. An operator learns one
    // rendering for "you cannot switch this"; the difference between "core" and
    // "no seam to close" is carried by the sentence.
    listed = [moduleItem({ id: 'health_checks', name: 'Health Checks' })];
    presence = [
      presenceItem({ id: 'health_checks', deactivatable: false, nonDeactivatableReason: null }),
    ];
    await renderPage();

    const probes = row('health_checks');
    expect(within(probes).getByText('platform.modules.activation.alwaysOn')).toBeInTheDocument();
    expect(
      within(probes).getByText('platform.modules.activation.alwaysOnReason'),
    ).toBeInTheDocument();
    // Not a core lock: that copy states a platform invariant this module does
    // not have.
    expect(within(probes).queryByText('platform.modules.activation.locked')).toBeNull();
    // And the state column reads "on" like any other present module, because it
    // is: the effective state forces the operator axis true.
    expect(within(probes).getByText('platform.modules.activation.on')).toBeInTheDocument();
  });

  it('selects that copy on the absent declaration, never on the module id (FR-016)', async () => {
    // The property that keeps this from being the hard-coded exception list
    // Constitution XVII prohibits. A future module in the same position gets the
    // same cell without an edit here, and `health_checks` gets an ordinary
    // control the moment its projection carries one.
    listed = [
      moduleItem({ id: 'some_future_module', name: 'Future' }),
      moduleItem({ id: 'health_checks', name: 'Health Checks' }),
    ];
    presence = [
      presenceItem({
        id: 'some_future_module',
        deactivatable: false,
        nonDeactivatableReason: null,
      }),
      presenceItem({ id: 'health_checks', deactivatable: true, activated: false, present: false }),
    ];
    await renderPage();

    expect(
      within(row('some_future_module')).getByText('platform.modules.activation.alwaysOn'),
    ).toBeInTheDocument();
    expect(
      within(row('health_checks')).queryByText('platform.modules.activation.alwaysOn'),
    ).toBeNull();
    expect(
      within(row('health_checks')).getByText('platform.modules.activation.off'),
    ).toBeInTheDocument();
  });
});

describe('ModulesPage — platform diagnostics (T062)', () => {
  it('shows version drift between the registered and the on-disk manifest', async () => {
    listed = [
      moduleItem({
        id: 'blog',
        version: { registered: '1.0.0', onDisk: '1.2.0' },
        flags: ['pending-upgrade'],
      }),
    ];
    presence = [presenceItem({ id: 'blog' })];
    await renderPage();

    const blog = row('blog');
    expect(within(blog).getByText('platform.modules.flag.pendingUpgrade')).toBeInTheDocument();
    expect(blog.textContent).toContain('1.0.0');
    expect(blog.textContent).toContain('1.2.0');
  });

  it('flags an orphan row and the two dependency conditions', async () => {
    listed = [
      moduleItem({ id: 'ghost', state: 'installed', flags: ['orphan'], version: { registered: '1.0.0', onDisk: null } }),
      moduleItem({ id: 'quotes', flags: ['dep-missing', 'dep-disabled'], dependencies: ['pricing'] }),
    ];
    presence = [presenceItem({ id: 'quotes' })];
    await renderPage();

    expect(within(row('ghost')).getByText('platform.modules.flag.orphan')).toBeInTheDocument();
    const quotes = row('quotes');
    expect(within(quotes).getByText('platform.modules.flag.depMissing')).toBeInTheDocument();
    expect(within(quotes).getByText('platform.modules.flag.depDisabled')).toBeInTheDocument();
  });

  it('warns when the serving process is refreshing in degraded mode', async () => {
    listed = [moduleItem({ id: 'blog' })];
    presence = [presenceItem({ id: 'blog' })];
    degraded = true;
    await renderPage();

    expect(screen.getByRole('alert').textContent).toContain('platform.modules.degraded');
  });

  it('renders no degraded warning when the projection is fresh', async () => {
    listed = [moduleItem({ id: 'blog' })];
    presence = [presenceItem({ id: 'blog' })];
    await renderPage();

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
