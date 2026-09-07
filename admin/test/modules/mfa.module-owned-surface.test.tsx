import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
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
 * `mfa` is the **nav-less** member of feature 091's Phase 4 batch four, and
 * this file is the evidence `plan.md`'s Ruling 1 rests on.
 *
 * Batch two rejected this module because it contributes no sidebar entry, so
 * *"half the ratchet would not move and half the evidence would be missing"*.
 * Applied as a selection rule that excludes 22 of the 47 remaining owners and
 * `check:admin-registrations` is never deleted, which is SC-007 not happening.
 * The rule is wrong for a simpler reason too: **the off-state test's subject was
 * never the sidebar.** `admin/src/App.tsx`'s `ModuleRoute` gates every
 * registry-contributed route on `useSurfaceVisibility` — the same predicate, both
 * axes — and renders `NotFoundPage` when the answer is no. So the four cases
 * batch three wrote over `sidebarHrefs()` are written here over the **route**,
 * which is a stronger subject: a hidden route is what an operator following a
 * stale deep link actually meets, and a sidebar that omits an entry is not
 * evidence that the screen is unreachable.
 *
 * The whole `App` is rendered rather than the screen, deliberately — the gate is
 * `App.tsx`'s and a test that mounted the component directly would prove the
 * component renders, which nobody doubted.
 *
 * **`/security` carries no `requiredPermission`**, so the permission axis is
 * asserted as the *absence* of a gate rather than as one: every endpoint under
 * `/api/v1/admin/account/mfa/` is gated by the bare admin guard, because an
 * operator manages their own second factor and no code could gate that without
 * locking somebody out of their own account. An operator holding **no** code at
 * all must therefore still reach the screen, and that is the assertion — it is
 * the one that would go red if somebody "tightened" the declaration by copying
 * a neighbour's code.
 *
 * The palette half of Principle XVII item 5 is proved server-side, in
 * `backend/test/integration/mfa/module-owned-surface-off-state.test.ts`: this
 * module declares no action, and that file asserts the manifest and the registry
 * agree about it in both states rather than omitting the question.
 */

let presentModules = new Set<string>(['mfa']);
let permissions = new Set<string>();



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
        data: { totpActive: false, recoveryCodesRemaining: 0, totpEnabledForScope: true },
      })),
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
 * screen reaches the same constructor, and only the reason changed. The stub is a
 * module-load accommodation and nothing this file asserts touches it — the
 * alternative would be mounting the gate in isolation, which would be a copy of
 * `ModuleRoute` proving itself.
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
    'appShell.section.system',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
};

function renderAt(path: string): RenderResult {
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

/**
 * The screen's own heading. `getAllByText` rather than `getByText`: the card
 * title and its description both carry the phrase, and this file is asserting
 * that the screen is *there*, not how many times it says its own name.
 */
const screenIsRendered = (): boolean =>
  screen.queryAllByText(/Two-factor authentication/).length > 0;

/** The admin's own unknown-path answer, rendered by `ModuleRoute`'s gate. */
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

describe('mfa owns its admin surface, and its proof is the route', () => {
  it('renders the screen at /security while the module is present', async () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen. The screen is lazily loaded, so the
    // assertion waits rather than reading the Suspense fallback.
    presentModules = new Set(['mfa']);
    permissions = new Set();
    renderAt('/security');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });

  it('renders the not-found treatment while the module is switched off', async () => {
    // Principle XVII item 5, over the surface this module actually contributes.
    // The registry still names the module — it answers "what could be here" —
    // and the render is what withdraws it, so an operator's flip needs no
    // rebuild. What the operator meets is the admin's own unknown-path answer,
    // which is what the surface is already telling them by not listing it.
    presentModules = new Set();
    permissions = new Set();
    renderAt('/security');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered()).toBe(false);
  });

  it('renders the screen for an operator holding no permission code at all', async () => {
    // The permission axis, and for this module the assertion is that there is
    // no gate — read from the route, where every `/api/v1/admin/account/mfa/`
    // endpoint carries the bare admin guard and no `requireAdmin(...)`. An
    // operator manages their own second factor. This goes red if the
    // declaration ever acquires a code copied from a neighbour.
    presentModules = new Set(['mfa']);
    permissions = new Set();
    renderAt('/security');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });

  it('restores the screen when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set();
    const off = renderAt('/security');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    off.unmount();

    presentModules = new Set(['mfa']);
    renderAt('/security');
    await waitFor(() => expect(screenIsRendered()).toBe(true));
  });
});

describe('the shell no longer names mfa by hand', () => {
  it('has no host route for the module, and never had a nav entry', () => {
    // The evidence that the conversion converted something. `App.tsx` is one of
    // the two registries 11 of the last 12 module additions edited; it no longer
    // mentions this module, and the screen is still there. `AppShell.tsx` is
    // asserted too even though this module has no sidebar row — that absence is
    // the module's shape, and asserting it keeps a later batch from adding one
    // by hand instead of declaring it.
    const app = sourceOf('../packages/admin-shell/src/App.tsx');
    const shell = sourceOf('../packages/admin-shell/src/components/AppShell.tsx');
    expect(app).not.toContain('AdminSecuritySettings');
    expect(app).not.toContain('modules/mfa');
    expect(shell).not.toContain("to: '/security'");
  });

  it('resolves the screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-mfa/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('declares one lazily-loaded route and no nav entry', async () => {
    // FR-013, and the declaration this whole file is about. `nav` being absent
    // is the module's contribution set saying so, which is what Ruling 1 asks a
    // nav-less batch member's test to derive rather than assert by omission.
    const { contributions } = await import('@endora-commerce/mod-mfa/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual(['/security']);
    expect(contributions.nav ?? []).toEqual([]);
    expect(typeof contributions.routes?.[0]?.component).toBe('function');
    expect(contributions.routes?.[0]?.requiredPermission).toBeUndefined();
    const loaded = await contributions.routes![0]!.component();
    expect(typeof loaded.default).toBe('function');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install.
    const source = sourceOf('../packages/modules/mfa/src/admin/pages/AdminSecuritySettings.tsx');
    expect(source).not.toMatch(/^import .* from '@\//m);
  });
});
