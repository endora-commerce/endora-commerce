import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

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
 * `api_keys` and `webhooks` are two thirds of feature 091's Phase 4 batch — the
 * one `plan.md`'s sequence table calls **batch 6** — and this is the off-state
 * proof `contracts/admin-contribution.md` R15 asks of a converted module.
 *
 * **They are in one file because they share one permission.**
 * `integrations:manage` is the code every route of both modules' admin APIs
 * enforces, and issue #213 records why: the core `PERMISSION_CATALOGUE` row
 * that carries its label can name only one module, so both manifests declare it
 * and the presence filter on `/admin-roles` keeps it grantable while **either**
 * surface is on. A shared code makes one assertion possible that neither module
 * could make alone, and it is the one that matters here: switching `api_keys`
 * off must take `/api-keys` and leave `/webhooks` standing. A per-module file
 * would have proved each screen disappears with its own module and said nothing
 * about the pair, which is where a presence gate keyed on the *permission*
 * instead of on the module would hide.
 *
 * Both modules contribute a **route**, a **sidebar entry** and — since this
 * batch — a **palette action**. The first two are asserted here; the third is
 * the server's answer, resolved by `AdminActionsService` against the effective
 * enabled-set, and is proved in
 * `backend/test/integration/{api_keys,webhooks}/module-owned-surface-off-state.test.ts`.
 * What this file asserts about the palette is the half that is the admin's:
 * that `AppShell.tsx` keeps no hand-written copy of either route for the
 * server's answer to disagree with.
 *
 * The permission axis is driven beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['api_keys', 'webhooks']);
let permissions = new Set<string>(['integrations:manage']);



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

// Both screens list on mount. The mock is at the kit's barrel, which is the
// specifier the packaged screens resolve — the admin resolves the same module,
// so one mock covers both sides of the move.
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
 * `App.tsx` imports every host screen statically, and one of them (`cms`' Puck
 * editor) reaches `@dnd-kit/dom`, which constructs a `ResizeObserver` at module
 * scope. jsdom has none. The stub is a module-load accommodation and nothing
 * this file asserts touches it.
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
    // Both screens still resolve their own copy in the `core` scope — this
    // batch moves the two **declaration** labels into the packages and leaves
    // the screen copy where batch four left `admin_users`' and `audit_logs`'.
    'apiKeys.page.title',
    'webhooks.page.title',
  ]),
  ...passthroughBundle('api_keys', ['nav.apiKeys.label']),
  ...passthroughBundle('webhooks', ['nav.webhooks.label']),
};

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App modulePresence={modulePresence({ present: [...presentModules] })} />
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

const screenIsRendered = (key: string): boolean =>
  screen.queryAllByText(new RegExp(key.replace(/\./g, '\\.'))).length > 0;

describe('api_keys and webhooks own their admin surfaces', () => {
  it('contribute their sidebar entries from the registry, labelled in their own namespaces', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['api_keys', 'webhooks']);
    permissions = new Set(['integrations:manage']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/api-keys');
    expect(sidebarHrefs()).toContain('/webhooks');
    // The labels resolve in the **modules'** namespaces, not in `core`: the two
    // `appShell.nav.*` entries are gone from the shared `_i18n` bundle.
    expect(screen.getByRole('link', { name: /nav\.apiKeys\.label/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /nav\.webhooks\.label/ })).toBeTruthy();
  });

  it('render their screens at their own routes while present', async () => {
    presentModules = new Set(['api_keys', 'webhooks']);
    permissions = new Set(['integrations:manage']);
    const keys = renderAt('/api-keys');
    await waitFor(() => expect(screenIsRendered('apiKeys.page.title')).toBe(true));
    keys.unmount();

    renderAt('/webhooks');
    await waitFor(() => expect(screenIsRendered('webhooks.page.title')).toBe(true));
  });

  it('withdraw both surfaces of the module that is off, and only that module’s', async () => {
    // The assertion the shared permission makes possible, and the reason these
    // two are one file. `integrations:manage` opens both screens, so a gate
    // keyed on the permission rather than on the module would take neither row
    // away — and would look exactly like a correct platform in a per-module
    // test that switched both modules off together.
    presentModules = new Set(['webhooks']);
    permissions = new Set(['integrations:manage']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/api-keys');
    expect(sidebarHrefs()).toContain('/webhooks');
    shell.unmount();

    const deepLink = renderAt('/api-keys');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered('apiKeys.page.title')).toBe(false);
    deepLink.unmount();

    // And the mirror, so neither direction rests on the other's shape. Each
    // render is unmounted before the next: `sidebarHrefs()` reads the whole
    // document, so two live shells would report the union of both answers and
    // this assertion could never fail.
    presentModules = new Set(['api_keys']);
    const mirror = renderAt('/');
    expect(sidebarHrefs()).toContain('/api-keys');
    expect(sidebarHrefs()).not.toContain('/webhooks');
    mirror.unmount();
  });

  it('contribute nothing to an operator without the code their routes enforce', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `credentials:read`
    // is a real code and a near miss — the row it opens sits beside these two
    // in *System* — and the codes are opaque strings, so it opens neither.
    presentModules = new Set(['api_keys', 'webhooks']);
    permissions = new Set(['credentials:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/api-keys');
    expect(sidebarHrefs()).not.toContain('/webhooks');
    shell.unmount();

    const deepLink = renderAt('/webhooks');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    deepLink.unmount();
  });

  it('restore both surfaces when the modules come back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['integrations:manage']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/api-keys');
    expect(sidebarHrefs()).not.toContain('/webhooks');
    off.unmount();

    presentModules = new Set(['api_keys', 'webhooks']);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain('/api-keys');
    expect(sidebarHrefs()).toContain('/webhooks');
    back.unmount();

    const deepLink = renderAt('/api-keys');
    await waitFor(() => expect(screenIsRendered('apiKeys.page.title')).toBe(true));
    deepLink.unmount();
  });

  it('render after the section’s host entries, in the declared order — the visible change', () => {
    // The batch's operator-visible consequence for these two, asserted rather
    // than left to a reader of the plan. *System* still holds host-declared
    // rows, unlike the *Analytics & Ads* section batch three emptied, and
    // `composeNav` appends the registry's after all of them whatever weight
    // they declare. The declared weights (700, 800 — the hand-written table's
    // position times a hundred, batch four's convention) are what keep
    // `/api-keys` above `/webhooks`, which is the half that can be restored
    // while any host row remains.
    presentModules = new Set(['api_keys', 'webhooks', 'credentials']);
    permissions = new Set(['integrations:manage', 'credentials:read']);
    renderAt('/');
    const hrefs = sidebarHrefs();
    expect(hrefs.indexOf('/api-keys')).toBeLessThan(hrefs.indexOf('/webhooks'));
    // `/credentials` is a host row that used to follow both. It precedes them
    // now; that is the change, and it closes when *System* empties.
    expect(hrefs.indexOf('/credentials')).toBeLessThan(hrefs.indexOf('/api-keys'));
  });
});

describe('the shell no longer names api_keys or webhooks by hand', () => {
  it('has no host route, nav entry or shared label for either module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither declares either screen now, and both screens are still
    // there. Leaving one standing would declare it twice, with `react-router`
    // silently taking the first match.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('<ApiKeysPage');
    expect(app).not.toContain('<WebhooksPage');
    expect(app).not.toContain('modules/api_keys');
    expect(app).not.toContain('modules/webhooks');
    expect(shell).not.toContain("to: '/api-keys'");
    expect(shell).not.toContain("to: '/webhooks'");
    expect(shell).not.toContain('appShell.nav.apiKeys');
    expect(shell).not.toContain('appShell.nav.webhooks');
  });

  it('keeps no client-side copy of either module’s palette entry', () => {
    // The palette's Actions group is the server's — it resolves each manifest's
    // `actions` against the effective enabled-set, which is where these two
    // entries live since this batch and where their off-state is proven. What
    // the admin must not do is carry a second, hand-written copy in
    // `PALETTE_ITEMS`: that one would keep advertising the screen after an
    // operator switched the module off, because nothing on the server would
    // have been asked.
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(shell).not.toContain("'/api-keys'");
    expect(shell).not.toContain("'/webhooks'");
  });

  it('resolves both screens through the module packages, never through admin/src', () => {
    // R3 / D-149: a relative reach into a package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-api-keys/admin'");
    expect(registry).toContain("from '@endora-commerce/mod-webhooks/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('gates each route and nav entry on the code that route’s API enforces', async () => {
    // `check:action-route-permissions` holds each module's palette action to
    // the code enforced on its own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. Both take `integrations:manage`, which is what
    // `GET /api/v1/admin/api-keys` and `GET /api/v1/admin/webhooks` enforce —
    // there is no `api_keys:`- or `webhooks:`-prefixed code to take instead.
    const keys = await import('@endora-commerce/mod-api-keys/admin');
    const hooks = await import('@endora-commerce/mod-webhooks/admin');
    expect(keys.contributions.routes?.map((route) => route.path)).toEqual(['/api-keys']);
    expect(hooks.contributions.routes?.map((route) => route.path)).toEqual(['/webhooks']);
    for (const contributions of [keys.contributions, hooks.contributions]) {
      expect(contributions.routes?.[0]?.requiredPermission).toBe('integrations:manage');
      expect(contributions.nav?.[0]?.requiredPermission).toBe('integrations:manage');
      expect(contributions.nav?.[0]?.section).toBe('system');
      // FR-013: the only function-valued field is a dynamic-import factory, so
      // Vite has a split point whether or not anybody asks for one.
      expect(typeof contributions.routes?.[0]?.component).toBe('function');
    }
  });

  it('takes no `@/` reach out of either package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install. The three pickers both screens render are the kit's
    // since P2 — that is the drain `plan.md` credits this batch with not having
    // to pay — so this also asserts the exit was the published one and not a
    // package specifier into another module, which would be the same coupling
    // under a supported name.
    for (const file of [
      '../packages/modules/api_keys/src/admin/pages/ApiKeysPage.tsx',
      '../packages/modules/webhooks/src/admin/pages/WebhooksPage.tsx',
    ]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/^import .* from '@\//m);
      expect(source).not.toMatch(/^import .* from '@endora-commerce\/mod-/m);
    }
  });
});
