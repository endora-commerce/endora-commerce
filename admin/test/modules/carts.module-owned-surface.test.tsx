import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
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
 * `carts` is the **locked-and-nav-less** member of feature 091's Phase 4 batch
 * four, and the module both previous batches rejected twice over.
 *
 * Batch two rejected it for declaring `activation.nonDeactivatable`, and batch
 * two's own criterion would have rejected it again for contributing no sidebar
 * entry. `plan.md`'s two rulings retire both grounds, and this file is what one
 * looks like when they are applied together:
 *
 *  * **nav-less** (Ruling 1) — the four cases are written over the **route**,
 *    because `admin/src/App.tsx`'s `ModuleRoute` gates every registry route on
 *    `useSurfaceVisibility`, both axes, rendering the admin's own unknown-path
 *    answer. A hidden route is what an operator following a stale deep link
 *    actually meets;
 *  * **locked** (Ruling 2) — the module's presence gate is still exercised
 *    here, because `isPresent` is the frontend's own question and the admin
 *    asks it of every module whatever its manifest says. What a lock removes is
 *    the *operator's* ability to make the answer `false`, which is a fact about
 *    the platform and is asserted as one in
 *    `backend/test/integration/carts/off-state.test.ts`, from the manifest.
 *
 * The whole `App` is rendered rather than the screen, deliberately: the gate is
 * `App.tsx`'s, and a test that mounted the component directly would prove the
 * component renders, which nobody doubted.
 *
 * The palette half of Principle XVII item 5 is proved server-side. This module
 * declares no action — it is not one of the fifteen
 * `specs/deferred-defects.md` still owes one, that population being the modules
 * with a **nav entry** — and the backend file asserts the manifest and the
 * registry agree about it in both states rather than omitting the question.
 */

let presentModules = new Set<string>(['carts']);
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
    'appShell.section.sales',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('carts', [
    'carts.page.title',
    'carts.page.description',
    'carts.loading',
    'carts.empty',
  ]),
};

function renderAt(path: string): RenderResult {
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
    bundle,
  );
}

/**
 * The list screen's own heading key, rendered as its passthrough placeholder.
 * `queryAllByText` rather than `getByText`: this file asserts the screen is
 * *there*, not how many nodes carry its title.
 */
const screenIsRendered = (): boolean => screen.queryAllByText(/carts\.page\.title/).length > 0;

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

describe('carts owns its admin surface, and its proof is the route', () => {
  it('renders the list at /carts while the module is present', async () => {
    // The positive control, first: an absence proves nothing until the presence
    // has been seen. The screen is lazily loaded, so this waits rather than
    // reading the Suspense fallback.
    presentModules = new Set(['carts']);
    permissions = new Set(['carts:read']);
    renderAt('/carts');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });

  it('renders the not-found treatment while the module is switched off', async () => {
    // Principle XVII item 5, over the surface this module actually contributes.
    // The registry still names the module — it answers "what could be here" —
    // and the render is what withdraws it, so a flip needs no rebuild.
    presentModules = new Set();
    permissions = new Set(['carts:read']);
    renderAt('/carts');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
  });

  it('renders the not-found treatment for an operator without the code the route enforces', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. The codes are
    // opaque strings, so holding this module's **reject** code is not holding
    // the read code the screen's own API enforces.
    presentModules = new Set(['carts']);
    permissions = new Set(['carts:reject']);
    renderAt('/carts');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
  });

  it('restores the screen when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['carts:read']);
    const off = renderAt('/carts');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    off.unmount();

    presentModules = new Set(['carts']);
    renderAt('/carts');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });
});

describe('the shell no longer names carts by hand', () => {
  it('has no host route for either screen, and never had a nav entry', () => {
    // The evidence that the conversion converted something. `App.tsx` is one of
    // the two registries 11 of the last 12 module additions edited; it no longer
    // mentions this module, and both screens are still there. `AppShell.tsx` is
    // asserted too although this module has no sidebar row — that absence is
    // the module's shape, and asserting it keeps a later batch from adding one
    // by hand instead of declaring it.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('CartsList');
    expect(app).not.toContain('CartDetail');
    expect(app).not.toContain('modules/carts');
    expect(shell).not.toContain("to: '/carts'");
  });

  it('resolves both screens through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-carts/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('declares two lazily-loaded routes, one gate each, and no nav entry', async () => {
    // FR-013, and the declaration this whole file is about. `nav` being absent
    // is the contribution set saying so, which is what Ruling 1 asks a nav-less
    // batch member's test to derive rather than assert by omission. Both routes
    // gate on `carts:read` — the code the two reads enforce; the detail screen's
    // reject action enforces `carts:reject` on the API, which is deliberately
    // not the route's requirement.
    const { contributions } = await import('@endora-commerce/mod-carts/admin');
    const routes = contributions.routes ?? [];
    expect(routes.map((route) => route.path)).toEqual(['/carts', '/carts/:id']);
    expect(routes.map((route) => route.requiredPermission)).toEqual(['carts:read', 'carts:read']);
    expect(contributions.nav ?? []).toEqual([]);
    for (const route of routes) expect(typeof route.component).toBe('function');
    const loaded = await routes[0]!.component();
    expect(typeof loaded.default).toBe('function');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install.
    const pkg = '../packages/modules/carts/src/admin/pages';
    for (const file of [`${pkg}/CartsList.tsx`, `${pkg}/CartDetail.tsx`]) {
      expect(sourceOf(file)).not.toMatch(/^import .* from '@\//m);
    }
  });
});
