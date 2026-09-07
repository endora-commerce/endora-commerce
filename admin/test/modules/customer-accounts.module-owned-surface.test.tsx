import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';

/**
 * One of the admin's own source files, read as text.
 *
 * From the workspace root vitest hands this file, because `import.meta.url` is
 * an `http:` URL under jsdom and `node:fs` cannot read one.
 */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * `customer_accounts` is the **locked-with-nav** member of feature 091's Phase
 * 4 batch 7 — the shape batch four established with `audit_logs` and
 * `admin_users`.
 *
 * The module declares `activation.nonDeactivatable`, and what a lock removes is
 * the **operator's** ability to make `isPresent` answer `false`. It removes
 * nothing from the frontend's question: the admin asks presence of every module
 * whatever its manifest says, and the platform axis — a deployment that never
 * installs it — reaches the same gate. So all four cases are driven here, and
 * the fact that the operator cannot reach one of them is asserted where it
 * belongs, in `backend/test/integration/customer_accounts/…`, read from the
 * manifest rather than restated. `plan.md`'s Ruling 2 is what makes a locked
 * module eligible for the drain at all.
 *
 * Both surfaces this module contributes are asserted, because it contributes
 * both: the **sidebar entry**, whose label now resolves in this module's own
 * namespace rather than in `_i18n`'s shared bundle, and the **route**, which is
 * what an operator following a stale deep link meets. The **palette action** is
 * the server's — it has existed since feature 076 — and is proved in
 * `backend/test/integration/customer_accounts/module-owned-surface-off-state.test.ts`.
 */

let presentModules = new Set<string>(['customer_accounts']);
let permissions = new Set<string>(['customer_groups:read']);

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

// The screen lists its groups on mount. The mock is at the kit's barrel, which
// is the specifier the packaged screen resolves — the admin resolves the same
// module, so one mock covers both sides of the move.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: [] })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/**
 * `@dnd-kit/dom` constructs a `ResizeObserver` at module scope, and jsdom has
 * none. This read *"`App.tsx` imports every host screen statically, and one of
 * them (`cms`' Puck editor)"* until feature 091's batch 16 moved that editor
 * into `@endora-commerce/mod-cms`; the stub stays because a lazily loaded
 * screen reaches the same constructor, and only the reason changed. The stub is a module-load accommodation and nothing
 * this file asserts touches it.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../packages/admin-shell/src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.customers',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('customer_accounts', [
    'nav.customerGroups.label',
    'groups.page.title',
    'groups.page.description',
  ]),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} modulePresence={modulePresence({ present: [...presentModules] })} />
      </MemoryRouter>,
      { session: adminSession({ permissions: [...permissions] }) },
    ),
    bundle,
  );
}

function sidebarHrefs(): (string | null)[] {
  return [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
}

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

/** The screen's own heading key, rendered as its passthrough placeholder. */
const screenIsRendered = (): boolean =>
  screen.queryAllByText(/groups\.page\.title/).length > 0;

describe('customer_accounts owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['customer_accounts']);
    permissions = new Set(['customer_groups:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/customer-groups');
    // The label resolves in the **module's** namespace, not in `core`: its
    // `appShell.nav.customerGroups` entry is gone from the shared `_i18n`
    // bundle.
    expect(screen.getByRole('link', { name: /nav\.customerGroups\.label/ })).toBeTruthy();
  });

  it('renders its screen at its own route while present', async () => {
    presentModules = new Set(['customer_accounts']);
    permissions = new Set(['customer_groups:read']);
    renderAt('/customer-groups');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });

  it('contributes no surface while the module is absent from the platform', async () => {
    // Principle XVII item 5, over both surfaces the module contributes. The
    // registry still names it — it answers "what could be here" — and the
    // render is what withdraws it, so a flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['customer_groups:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/customer-groups');
    shell.unmount();

    const deepLink = renderAt('/customer-groups');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
    deepLink.unmount();
  });

  it('contributes no surface to an operator without the code its route enforces', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `customers:read` is
    // a real code and a near miss — the row it opens is the first in the same
    // *Customers* section, and the two screens are about the same people — and
    // the codes are opaque strings.
    presentModules = new Set(['customer_accounts']);
    permissions = new Set(['customers:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/customer-groups');
    shell.unmount();

    const deepLink = renderAt('/customer-groups');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
    deepLink.unmount();
  });

  it('restores both surfaces when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['customer_groups:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/customer-groups');
    off.unmount();

    presentModules = new Set(['customer_accounts']);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain('/customer-groups');
    back.unmount();

    const screenBack = renderAt('/customer-groups');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
    screenBack.unmount();
  });

  it('keeps its position in the Customers section', () => {
    // The entry's position does not change: every other row in *Customers* is
    // still host-declared, so `composeNav` appends the registry's after all of
    // them — which is where the hand-written table had this one, above
    // `/credit-limits` and below `/organizations`. The half that can be
    // restored today is that it still follows `/organizations`.
    presentModules = new Set(['customer_accounts', 'organizations']);
    permissions = new Set(['customer_groups:read', 'customers:read']);
    renderAt('/');
    const hrefs = sidebarHrefs().filter((href) => href !== null);
    expect(hrefs.indexOf('/organizations')).toBeLessThan(hrefs.indexOf('/customer-groups'));
  });
});

describe('the shell no longer names customer_accounts by hand', () => {
  it('has no host route, nav entry or shared label for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither declares the screen now, and both are still there.
    // Leaving one standing would declare it twice, with `react-router` silently
    // taking the first match.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('<CustomerGroupsPage');
    expect(app).not.toContain('modules/customer_accounts');
    expect(shell).not.toContain("to: '/customer-groups'");
    expect(shell).not.toContain('appShell.nav.customerGroups');
  });

  it('resolves the screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-customer-accounts/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('gates its route and its nav entry on the code its own API enforces', async () => {
    // `check:action-route-permissions` holds this module's palette action to
    // the code enforced on its own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. `GET /api/v1/admin/customer-groups` is behind
    // `requireAdmin('customer_groups:read')`, which is what opens the screen;
    // the two write handlers beside it take `customer_groups:write`, which
    // gates controls inside it.
    const { contributions } = await import('@endora-commerce/mod-customer-accounts/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(['/customer-groups']);
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe('customer_groups:read');
      // FR-013: the only function-valued field is a dynamic-import factory, so
      // Vite has a split point whether or not anybody asks for one.
      expect(typeof route.component).toBe('function');
    }
    expect(contributions.nav?.[0]?.requiredPermission).toBe('customer_groups:read');
    expect(contributions.nav?.[0]?.section).toBe('customers');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install.
    for (const file of [
      '../packages/modules/customer_accounts/src/admin/pages/CustomerGroupsPage.tsx',
      '../packages/modules/customer_accounts/src/admin/api/customer-groups-client.ts',
    ]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/^import .* from '@\//m);
      expect(source).not.toMatch(/^import .* from '@endora-commerce\/mod-/m);
    }
  });
});
