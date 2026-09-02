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
 * `comparisons` is one third of feature 091's Phase 4 batch — the one
 * `plan.md`'s sequence table calls **batch 6** — and this is the off-state
 * proof `contracts/admin-contribution.md` R15 asks of a converted module.
 *
 * **It is the batch's only member with a second route**, and the second route
 * is what this file has that its sibling does not: `/comparisons/:id` has no
 * sidebar row and never will, because a nav entry is a landing surface. So the
 * detail screen's gate is asserted on its own — a test that only drove the
 * landing route would pass with the sub-route ungated, which is a deep link an
 * operator following a stale bookmark actually meets.
 *
 * The module contributes a **route pair**, a **sidebar entry** and — since this
 * batch — a **palette action**. The first two are asserted here; the third is
 * the server's answer, resolved by `AdminActionsService` against the effective
 * enabled-set, and is proved in
 * `backend/test/integration/comparisons/module-owned-surface-off-state.test.ts`.
 *
 * The permission axis is driven beside the presence one, because they are two
 * axes and a test that only moved one would pass with either gate missing.
 */

let presentModules = new Set<string>(['comparisons']);
let permissions = new Set<string>(['comparisons:read']);



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

const DETAIL_ID = '11111111-1111-4111-8111-111111111111';

// Both screens read on mount. The mock is at the kit's barrel, which is the
// specifier the packaged screens resolve — the admin resolves the same module,
// so one mock covers both sides of the move. It answers by path, because the
// two screens read two different envelopes and a single shape would leave the
// detail screen rendering an error where this file expects a heading.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (path: string) =>
        path.includes(`/comparisons/`)
          ? {
              data: {
                id: DETAIL_ID,
                shareToken: 'tok_abc',
                owner: { kind: 'anonymous', anonymousToken: 'anon_1' },
                salesChannel: {
                  id: '22222222-2222-4222-8222-222222222222',
                  code: 'b2b',
                  name: 'B2B',
                },
                displayMode: 'full',
                products: [],
                comparableAttributes: [],
                createdAt: '2026-01-01T10:00:00.000Z',
                updatedAt: '2026-01-01T10:00:00.000Z',
              },
            }
          : { data: [], meta: { limit: 20, nextCursor: null } },
      ),
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

const { App } = await import('../../src/App');

const bundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.customers',
    'app.moduleScreenLoading',
    'app.notFound',
  ]),
  ...passthroughBundle('comparisons', [
    'nav.comparisons.label',
    'list.page.title',
    'detail.page.title',
    'common.loading',
  ]),
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

const DETAIL_PATH = `/comparisons/${DETAIL_ID}`;

describe('comparisons owns its admin surface', () => {
  it('contributes its sidebar entry from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['comparisons']);
    permissions = new Set(['comparisons:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/comparisons');
    // The label resolves in the **module's** namespace, not in `core`: its
    // `appShell.nav.comparisons` entry is gone from the shared `_i18n` bundle.
    expect(screen.getByRole('link', { name: /nav\.comparisons\.label/ })).toBeTruthy();
  });

  it('renders both screens at their own routes while present', async () => {
    presentModules = new Set(['comparisons']);
    permissions = new Set(['comparisons:read']);
    const list = renderAt('/comparisons');
    await waitFor(() => expect(screenIsRendered('list.page.title')).toBe(true));
    list.unmount();

    renderAt(DETAIL_PATH);
    await waitFor(() => expect(screenIsRendered('detail.page.title')).toBe(true));
  });

  it('contributes no surface while the module is switched off — the sub-route included', async () => {
    // Principle XVII item 5, over every surface the module contributes. The
    // detail route is asserted on its own because it has no sidebar row to be
    // withdrawn with: it is a deep link an operator following a stale bookmark
    // meets, and a test that only drove the landing route would pass with it
    // ungated.
    presentModules = new Set();
    permissions = new Set(['comparisons:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/comparisons');
    shell.unmount();

    const list = renderAt('/comparisons');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered('list.page.title')).toBe(false);
    list.unmount();

    const detail = renderAt(DETAIL_PATH);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    expect(screenIsRendered('detail.page.title')).toBe(false);
    detail.unmount();
  });

  it('contributes no surface to an operator without the code its routes enforce', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `customers:read` is
    // a real code and a near miss — the row it opens is the first in the same
    // *Customers* section — and the codes are opaque strings.
    presentModules = new Set(['comparisons']);
    permissions = new Set(['customers:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/comparisons');
    shell.unmount();

    const list = renderAt('/comparisons');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    list.unmount();

    const detail = renderAt(DETAIL_PATH);
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    detail.unmount();
  });

  it('restores every surface when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['comparisons:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/comparisons');
    off.unmount();

    presentModules = new Set(['comparisons']);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain('/comparisons');
    back.unmount();

    const detail = renderAt(DETAIL_PATH);
    await waitFor(() => expect(screenIsRendered('detail.page.title')).toBe(true));
    detail.unmount();
  });

  it('keeps its position last in the Customers section', () => {
    // Unlike `api_keys` and `webhooks`, this entry's position does **not**
    // change: every other row in *Customers* is still host-declared, so
    // `composeNav` appends the registry's after all of them — which is exactly
    // where the hand-written table had it. The declared weight (600, the
    // hand-written position times a hundred) is what will keep it there once
    // the section's other rows convert.
    presentModules = new Set(['comparisons', 'customers']);
    permissions = new Set(['comparisons:read', 'customers:read']);
    renderAt('/');
    const hrefs = sidebarHrefs().filter((href) => href !== null);
    expect(hrefs.indexOf('/customers')).toBeLessThan(hrefs.indexOf('/comparisons'));
  });
});

describe('the shell no longer names comparisons by hand', () => {
  it('has no host route, nav entry, breadcrumb rule or shared label for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither declares either screen now, and both are still there.
    // Leaving one standing would declare it twice, with `react-router` silently
    // taking the first match.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    expect(app).not.toContain('<ComparisonsListPage');
    expect(app).not.toContain('<ComparisonDetailPage');
    expect(app).not.toContain('modules/comparisons');
    expect(shell).not.toContain("to: '/comparisons'");
    expect(shell).not.toContain('appShell.nav.comparisons');
    // `CRUMB_DICT` is the third host registry this feature does not convert;
    // the two rules it held for this module go because `registryCrumbs` derives
    // the trail from the nav contribution instead.
    expect(shell).not.toContain('\\/comparisons');
  });

  it('keeps no client-side copy of the module’s palette entry', () => {
    // The palette's Actions group is the server's — it resolves the manifest's
    // `actions` against the effective enabled-set, which is where this entry
    // lives since this batch and where its off-state is proven. What the admin
    // must not do is carry a second, hand-written copy in `PALETTE_ITEMS`.
    expect(sourceOf('src/components/AppShell.tsx')).not.toContain("'/comparisons'");
  });

  it('derives the detail screen’s breadcrumb from the nav contribution', () => {
    // The one operator-visible consequence this module's conversion carries,
    // asserted rather than left to a reader of the plan. The hand-written
    // `CRUMB_DICT` rule built three crumbs for `/comparisons/:id` — section,
    // parent, and a literal *detail* leaf. `registryCrumbs` matches anything
    // beneath a contributed entry's `to` and builds two: the section, and the
    // entry itself as a link back to the list. The trail still leads home; it
    // is one crumb shorter.
    presentModules = new Set(['comparisons']);
    permissions = new Set(['comparisons:read']);
    renderAt(DETAIL_PATH);
    const crumbs = [...document.querySelectorAll('.b2b-topbar__crumbs a.crumb-link')].map((a) =>
      a.getAttribute('href'),
    );
    expect(crumbs).toContain('/comparisons');
    // Two crumbs, not three: the section and the entry. The hand-written rule
    // added a literal *detail* leaf, which `registryCrumbs` has nothing to
    // derive.
    expect(
      document.querySelectorAll('.b2b-topbar__crumbs .crumb-link, .b2b-topbar__crumbs .crumb-cur'),
    ).toHaveLength(2);
  });

  it('resolves both screens through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-comparisons/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('gates both routes and the nav entry on the code its own API enforces', async () => {
    // `check:action-route-permissions` holds this module's palette action to
    // the code enforced on its own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. The admin side of this module is read-only — both handlers
    // in `routes.admin.ts` are behind `requireAdmin('comparisons:read')` — so
    // the read code is the whole of what it gates, and the two routes are not
    // allowed to disagree.
    const { contributions } = await import('@endora-commerce/mod-comparisons/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual([
      '/comparisons',
      '/comparisons/:id',
    ]);
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe('comparisons:read');
      // FR-013: the only function-valued field is a dynamic-import factory, so
      // Vite has a split point whether or not anybody asks for one.
      expect(typeof route.component).toBe('function');
    }
    expect(contributions.nav?.[0]?.requiredPermission).toBe('comparisons:read');
    expect(contributions.nav?.[0]?.section).toBe('customers');
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install. The `SalesChannelPicker` the list screen renders is
    // the kit's since P2 — that is the drain `plan.md` credits this batch with
    // not having to pay — so this also asserts the exit was the published one
    // and not a package specifier into `sales_channels`, which would be the
    // same coupling under a supported name.
    for (const file of [
      '../packages/modules/comparisons/src/admin/pages/ComparisonsListPage.tsx',
      '../packages/modules/comparisons/src/admin/pages/ComparisonDetailPage.tsx',
      '../packages/modules/comparisons/src/admin/api/comparisons-client.ts',
    ]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/^import .* from '@\//m);
      expect(source).not.toMatch(/^import .* from '@endora-commerce\/mod-/m);
    }
  });
});
