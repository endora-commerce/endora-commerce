import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

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
 * `admin_users` and `admin_roles` are feature 091's Phase 4 batch four's
 * **split pair**, and they share this file because the property under test is
 * the split itself.
 *
 * The admin's two hand-written registries disagreed about one screen and had
 * done since it was written: `App.tsx` imported `AdminRolesPage` out of
 * `admin_users`' surface directory while `AppShell.tsx`'s sidebar row declared
 * `module: 'admin_roles'`. `backend/scripts/ledgers/admin-registrations.ts`
 * records both facts rather than picking one, and `plan.md`'s open question 3
 * asked whether the move should force a single attribution. It recommended
 * keeping the split, the owner accepted, and this is where the recommendation
 * becomes something a test can fail on:
 *
 *  * **`admin_users` declares both routes** — `/admin-users` and
 *    `/admin-roles` — because both screens' APIs are its own
 *    (`packages/modules/admin_users/src/backend/routes.admin.ts`), and one
 *    sidebar entry, for its own list;
 *  * **`admin_roles` declares one sidebar entry and no route at all**, pointing
 *    at a path its sibling registers. `AdminContributions`' three arrays are
 *    each optional and `admin/test/lib/module-registry.test.ts` reads a
 *    nav-only module as legal, so this is a supported shape rather than a
 *    workaround.
 *
 * Both declare `nonDeactivatable`, so nothing an operator can do makes the
 * split observable today — asserted below, from the packages' own
 * declarations, so that unlocking either makes this red at the moment somebody
 * has to decide what withdrawing one half without the other should look like.
 * On the platform axis it is not observable either, and for a reason worth
 * knowing: `admin_roles` answers the permission check behind every guarded
 * admin route, so withdrawing it takes the whole admin API with it —
 * `backend/test/integration/admin_roles/off-state.test.ts` measures that.
 *
 * What *is* exercised here is the frontend's own question, which the admin asks
 * of every module whatever its manifest says: presence and permission, over
 * both surfaces, one axis at a time.
 *
 * **Both sidebar entries now render after the *System* section's host
 * entries**, which is this batch's one operator-visible change. Unlike the
 * *Analytics & Ads* section batch three emptied, *System* still holds
 * host-declared rows and `composeNav` appends the registry's after all of them
 * whatever weight they declare. The weights (200 and 300) reproduce the
 * hand-written table's relative order between the two, which is the half that
 * can be restored today.
 */

let presentModules = new Set<string>(['admin_users', 'admin_roles']);
let permissions = new Set<string>(['admin_users:manage']);

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    status: 'authenticated',
    me: {
      adminUser: {
        id: '1',
        email: 'admin@test.com',
        firstName: 'Ada',
        lastName: 'Min',
        preferredLanguage: 'en',
      },
      role: { name: 'Admin' },
    },
    logout: vi.fn(),
    hasPermission: (code: string) => permissions.has(code),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: (moduleId: string) => presentModules.has(moduleId),
    presenceOf: () => undefined,
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
  ModulePresenceProvider: ({ children }: { children: React.ReactNode }) => children,
  setModuleActivation: vi.fn(),
  getModulePresence: vi.fn(),
}));

vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('@/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

// The screen calls its own status endpoint on mount. It is mocked at the kit's
// barrel, which is the specifier the packaged screen resolves — the admin
// resolves the same module, so one mock covers both sides of the move.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({
        data: [],
      })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/**
 * `App.tsx` imports every host screen statically, and one of them
 * (`cms`' Puck editor) reaches `@dnd-kit/dom`, which constructs a
 * `ResizeObserver` at module scope. jsdom has none. The stub is a
 * module-load accommodation and nothing this file asserts touches it — the
 * alternative would be mounting the gate in isolation, which would be a copy of
 * `ModuleRoute` proving itself.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.system',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('admin_users', ['nav.adminUsers.label']),
  ...passthroughBundle('admin_roles', ['nav.adminRoles.label']),
  ...passthroughBundle('adminUsers', ['adminUsers.page.title']),
  ...passthroughBundle('adminRoles', ['adminRoles.page.title']),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
    bundle,
  );
}

function sidebarHrefs(): (string | null)[] {
  return [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
}

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

/** Both modules present, an operator holding the one code both screens enforce. */
function allOn(): void {
  presentModules = new Set(['admin_users', 'admin_roles']);
  permissions = new Set(['admin_users:manage']);
}

describe('admin_users and admin_roles own their admin surfaces', () => {
  it('contribute both sidebar entries from the registry, each in its own namespace', () => {
    // The positive control, first: an absence proves nothing until the presence
    // has been seen. Both labels resolve in the **owning module's** namespace —
    // `appShell.nav.users` and `appShell.nav.roles` are gone from the shared
    // `_i18n` bundle, and each package carries its replacement.
    allOn();
    renderAt('/');
    expect(sidebarHrefs()).toContain('/admin-users');
    expect(sidebarHrefs()).toContain('/admin-roles');
    expect(screen.getByRole('link', { name: /nav\.adminUsers\.label/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /nav\.adminRoles\.label/ })).toBeTruthy();
  });

  it('withdraws only the roles row when only admin_roles is absent — the split, visible', () => {
    // The whole point of keeping the attribution. The sidebar row for
    // `/admin-roles` is `admin_roles`', so it goes; the route is `admin_users`',
    // so a deep link still resolves. Both modules are locked today, so this
    // state is not one an operator can create — it is asserted because it is
    // what the declarations *mean*, and because it is what the platform would
    // do the day either lock is lifted.
    allOn();
    presentModules = new Set(['admin_users']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/admin-users');
    expect(sidebarHrefs()).not.toContain('/admin-roles');
  });

  it('withdraws the roles *screen* when admin_users is absent — the other half', async () => {
    // And the mirror: the route belongs to `admin_users`, so `/admin-roles`
    // stops resolving when *that* module goes, whatever `admin_roles` says.
    // This is the assertion that would fail if a later batch "simplified" the
    // split by moving the route to `admin_roles`.
    allOn();
    presentModules = new Set(['admin_roles']);
    renderAt('/admin-roles');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
  });

  it('contributes nothing to an operator without the code both screens enforce', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `admin_users:manage`
    // is the one code every endpoint under both API paths enforces; there is no
    // separate read code, and no `admin_roles:*` code exists in the platform.
    allOn();
    permissions = new Set(['orders:read']);
    renderAt('/');
    expect(sidebarHrefs()).not.toContain('/admin-users');
    expect(sidebarHrefs()).not.toContain('/admin-roles');

    const deepLink = renderAt('/admin-users');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('restores every surface when both modules come back, with no rebuild', () => {
    presentModules = new Set();
    permissions = new Set(['admin_users:manage']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/admin-users');
    expect(sidebarHrefs()).not.toContain('/admin-roles');
    off.unmount();

    allOn();
    renderAt('/');
    expect(sidebarHrefs()).toContain('/admin-users');
    expect(sidebarHrefs()).toContain('/admin-roles');
  });
});

describe('the shell no longer names either module by hand', () => {
  it('has no host route, nav entry, breadcrumb rule or shared label for them', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither names either module now, and both screens are still
    // there. `CRUMB_DICT` is the third and is derived rather than enumerated —
    // `registryCrumbs` builds both trails from the composed sidebar.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('AdminUsersPage');
    expect(app).not.toContain('AdminRolesPage');
    expect(app).not.toContain('modules/admin_users');
    expect(shell).not.toContain("to: '/admin-users'");
    expect(shell).not.toContain("to: '/admin-roles'");
    expect(shell).not.toContain('appShell.nav.users');
    expect(shell).not.toContain('appShell.nav.roles');
  });

  it('keeps no client-side copy of either module’s palette entry', () => {
    // The palette's Actions group is the server's — it resolves each manifest's
    // `actions` against the effective enabled-set, which is where the two
    // entries this batch adds live and where their off-state is proven. What
    // the admin must not do is carry a second, hand-written copy in
    // `PALETTE_ITEMS`: that one would keep advertising a screen after the module
    // was switched off, because nothing on the server would have been asked.
    //
    // A `PALETTE_ITEMS` entry names its destination `to: '…'`, the same spelling
    // a `NAV` entry uses, so the assertion above covers both registries. The
    // bare `'/admin-users'` the earlier batches asserted on cannot be used here
    // and the reason is worth recording: five **other** modules' hand-written
    // breadcrumb trails still use `/admin-users` as the *System* section's
    // parent link (`/api-keys`, `/webhooks`, `/platform/modules`, `/settings`,
    // `/settings/groups`). Those are those modules' trails to drain, not this
    // batch's, and the link keeps resolving — the route is the registry's now
    // rather than the host's, so an operator who cannot open it meets the
    // admin's not-found treatment where they previously met a 403 from the
    // screen's own API.
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(shell).not.toMatch(/^\s*\{ group: 'Navigate'.*'\/admin-(users|roles)'/m);
  });

  it('resolves both screens through admin_users’ package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-admin-users/admin'");
    expect(registry).toContain("from '@endora-commerce/mod-admin-roles/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('declares the split exactly as recorded: two routes here, one nav entry there', async () => {
    // The declaration this whole file is about, asserted on the artefacts rather
    // than inferred from the render. `admin_roles` contributing **no** route is
    // the half that is easy to "fix" by accident.
    const users = await import('@endora-commerce/mod-admin-users/admin');
    const roles = await import('@endora-commerce/mod-admin-roles/admin');

    expect(users.contributions.routes?.map((route) => route.path)).toEqual([
      '/admin-users',
      '/admin-roles',
    ]);
    expect(users.contributions.nav?.map((item) => item.to)).toEqual(['/admin-users']);
    expect(roles.contributions.routes ?? []).toEqual([]);
    expect(roles.contributions.nav?.map((item) => item.to)).toEqual(['/admin-roles']);

    // One code gates all four declarations, read from the routes: every endpoint
    // under both API paths enforces `admin_users:manage`, and no `admin_roles:*`
    // code exists. `check:action-route-permissions` holds the two palette
    // actions to the same comparison one layer up.
    for (const requirement of [
      ...(users.contributions.routes ?? []).map((route) => route.requiredPermission),
      ...(users.contributions.nav ?? []).map((item) => item.requiredPermission),
      ...(roles.contributions.nav ?? []).map((item) => item.requiredPermission),
    ]) {
      expect(requirement).toBe('admin_users:manage');
    }

    for (const route of users.contributions.routes ?? []) {
      expect(typeof route.component).toBe('function');
    }
  });

  it('takes no `@/` reach out of either package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install. `permission-label.ts` moved with the roles editor and
    // is covered too — it took two `@/i18n/*` reaches with it.
    const pkg = '../packages/modules/admin_users/src/admin';
    for (const file of [
      `${pkg}/pages/AdminUsersPage.tsx`,
      `${pkg}/pages/AdminRolesPage.tsx`,
      `${pkg}/permission-label.ts`,
    ]) {
      expect(sourceOf(file)).not.toMatch(/^import .* from '@\//m);
    }
  });
});
