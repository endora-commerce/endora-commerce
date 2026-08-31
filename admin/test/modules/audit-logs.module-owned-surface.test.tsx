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
 * `audit_logs` is the **locked-with-nav** member of feature 091's Phase 4 batch
 * four, and the module batch one rejected by name.
 *
 * That rejection was right for batch one — the pilot's job was to prove the
 * four instruments go red when they should, and for that it needed a real off
 * state to drive. `plan.md`'s Ruling 2 says it cannot be a rule about which
 * modules may move at all: `specs/deferred-defects.md` scopes Constitution XVII
 * item 6 to the modules declaring an `activation.settingCode` **without**
 * `nonDeactivatable`, so a locked module is outside that population by the
 * owner's own measurement, and 22 of the 47 remaining owners would otherwise be
 * excluded from the drain for good.
 *
 * What a lock removes is the **operator's** ability to make `isPresent` answer
 * `false`. It removes nothing from the frontend's question: the admin asks
 * presence of every module whatever its manifest says, and the platform axis —
 * a deployment that never installs the module — reaches it. So all four cases
 * are driven here, and the fact that the operator cannot reach one of them is
 * asserted where it belongs, in
 * `backend/test/integration/audit_logs/off-state.test.ts`, read from the
 * manifest rather than restated.
 *
 * Both surfaces this module contributes are asserted, because it contributes
 * both: the **sidebar entry**, whose label now resolves in this module's own
 * namespace rather than in `_i18n`'s shared bundle, and the **route**, which is
 * what an operator following a stale deep link meets. The **palette action**
 * this batch adds is resolved by the server and is proved in the backend file.
 *
 * **Its sidebar entry now renders last in the *System* section**, and that is
 * this batch's one operator-visible change. Unlike the *Analytics & Ads*
 * section batch three emptied, *System* still holds host-declared entries, and
 * `composeNav` appends the registry's after all of them whatever weight they
 * declare. The weights this batch declares (200, 300, 600) reproduce the
 * hand-written table's relative order among the three converted entries, which
 * is the half that can be restored today.
 */

let presentModules = new Set<string>(['audit_logs']);
let permissions = new Set<string>();

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
  ...passthroughBundle('audit_logs', ['nav.auditLog.label']),
  ...passthroughBundle('auditLog', ['auditLog.page.title', 'auditLog.page.description']),
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

/** The screen's own heading key, rendered as its passthrough placeholder. */
const screenIsRendered = (): boolean => screen.queryAllByText(/auditLog\.page\.title/).length > 0;

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

describe('audit_logs owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first.
    presentModules = new Set(['audit_logs']);
    permissions = new Set(['audit_log:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/audit-log');
    // The label resolves in the **module's** namespace, not in `core`: its
    // `appShell.nav.auditLog` entry is gone from the shared `_i18n` bundle, and
    // `nav.auditLog.label` in this package is where it lives now.
    expect(screen.getByRole('link', { name: /nav\.auditLog\.label/ })).toBeTruthy();
  });

  it('contributes neither surface while the module is switched off', async () => {
    // Principle XVII item 5, over both surfaces the module contributes. The
    // registry still names it — it answers "what could be here" — and the render
    // is what withdraws it, so a flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['audit_log:read']);
    renderAt('/');
    expect(sidebarHrefs()).not.toContain('/audit-log');

    const deepLink = renderAt('/audit-log');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
    deepLink.unmount();
  });

  it('contributes neither surface to an operator without the code its route enforces', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `platform.modules.activate`
    // is a real code this module's *other* routes enforce, and it is not this
    // one — the codes are opaque strings.
    presentModules = new Set(['audit_logs']);
    permissions = new Set(['platform.modules.activate']);
    renderAt('/');
    expect(sidebarHrefs()).not.toContain('/audit-log');

    const deepLink = renderAt('/audit-log');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('renders after the section’s host entries, in the declared order — the visible change', () => {
    // The batch's one operator-visible consequence, asserted rather than left
    // to a reader of the plan. *System* still holds host-declared rows, unlike
    // the *Analytics & Ads* section batch three emptied, and `composeNav`
    // appends the registry's after all of them whatever weight they declare. So
    // the three entries this batch converts move to the end of the section —
    // and keep their relative order, which the declared weights (200, 300, 600,
    // the hand-written table's position times a hundred) are what restore.
    presentModules = new Set(['audit_logs', 'admin_users', 'admin_roles', 'settings']);
    permissions = new Set(['audit_log:read', 'admin_users:manage', 'settings:read']);
    renderAt('/');
    const hrefs = sidebarHrefs();
    const converted = ['/admin-users', '/admin-roles', '/audit-log'];
    for (const href of converted) expect(hrefs).toContain(href);
    // Relative order among the three: preserved.
    expect(converted.map((href) => hrefs.indexOf(href))).toEqual(
      [...converted.map((href) => hrefs.indexOf(href))].sort((a, b) => a - b),
    );
    // And all three sit after `/settings`, a host-declared row that used to
    // follow them. That is the change; it closes when the section empties.
    expect(hrefs.indexOf('/settings')).toBeLessThan(hrefs.indexOf('/admin-users'));
  });

  it('restores both surfaces when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['audit_log:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/audit-log');
    off.unmount();

    presentModules = new Set(['audit_logs']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/audit-log');

    const deepLink = renderAt('/audit-log');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
    deepLink.unmount();
  });
});

describe('the shell no longer names audit_logs by hand', () => {
  it('has no host route, nav entry or shared label for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither mentions this module now, and the screen is still there.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('AuditLogViewer');
    expect(app).not.toContain('modules/audit_logs');
    expect(shell).not.toContain("to: '/audit-log'");
    expect(shell).not.toContain('appShell.nav.auditLog');
  });

  it('keeps no client-side copy of the module’s palette entry', () => {
    // The palette's Actions group is the server's — it resolves the manifest's
    // `actions` against the effective enabled-set, which is where this module's
    // entry lives and where its off-state is proven. What the admin must not do
    // is carry a second, hand-written copy in `PALETTE_ITEMS`: that one would
    // keep advertising the screen after the module was switched off, because
    // nothing on the server would have been asked.
    expect(sourceOf('src/components/AppShell.tsx')).not.toContain("'/audit-log'");
  });

  it('resolves the screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-audit-logs/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('gates the route and the nav entry on the code its own API route enforces', async () => {
    // `check:action-route-permissions` holds this module's palette action to the
    // code enforced on its own `targetRoute`; the route and nav declarations are
    // the same statement one layer down, and nothing else compares them.
    // `audit_log:read` is what `GET /api/v1/admin/audit-log` enforces — not
    // `platform.modules.activate`, which two of this module's other routes do.
    const { contributions } = await import('@endora-commerce/mod-audit-logs/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(['/audit-log']);
    expect(contributions.routes?.[0]?.requiredPermission).toBe('audit_log:read');
    expect(contributions.nav?.[0]?.requiredPermission).toBe('audit_log:read');
    expect(contributions.nav?.[0]?.section).toBe('system');
    expect(typeof contributions.routes?.[0]?.component).toBe('function');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install.
    const source = sourceOf(
      '../packages/modules/audit_logs/src/admin/pages/AuditLogViewer.tsx',
    );
    expect(source).not.toMatch(/^import .* from '@\//m);
  });
});
