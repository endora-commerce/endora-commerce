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
 * `promotions` is the heaviest member of feature 091's Phase 4 batch 7 on the
 * nav axis — **two** sidebar entries for one module — and this is the off-state
 * proof `contracts/admin-contribution.md` R15 asks of a converted module.
 *
 * **Two sidebar rows is the property this file has and its three siblings do
 * not.** `/promotions` and `/promotion-rules` are two landing surfaces of one
 * module, so a test that withdrew presence and checked one row would pass with
 * the other left standing. Both are asserted on every case.
 *
 * **Three of the five routes have no sidebar row and never will** — a nav entry
 * is a landing surface. `/promotions/new`, `/promotions/:id` and
 * `/promotions/:id/stats` are deep links an operator following a stale bookmark
 * meets, so each is driven on its own: a file that only drove the two landing
 * routes would pass with all three ungated.
 *
 * The **palette actions** are the server's — `open-promotions` and
 * `new-promotion` have existed since feature 045 — resolved by
 * `AdminActionsService` against the effective enabled-set, and are proved in
 * `backend/test/integration/promotions/module-owned-surface-off-state.test.ts`.
 */

let presentModules = new Set<string>(['promotions']);
let permissions = new Set<string>(['promotions:read']);

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

/**
 * The stats screen renders an `<EChart>`, and ECharts asks jsdom's canvas for a
 * 2D context it does not have — the failure surfaces on **unmount**, as an
 * uncaught `clearRect of null` from `zrender`'s disposer, which turns a green
 * run into an exit-1 with two unattributed errors. The chart is not what this
 * file is about; the stub is a jsdom accommodation, spread over
 * `vi.importActual` so the four other kit components these screens render keep
 * their real implementations.
 */
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, EChart: () => <div data-testid="echart" /> };
});

const PROMOTION_ID = '11111111-1111-4111-8111-111111111111';

// Every screen reads on mount. The mock is at the kit's barrel, which is the
// specifier the packaged screens resolve — the admin resolves the same module,
// so one mock covers both sides of the move. It answers by path, because the
// list and the editor read two different envelopes and a single shape would
// leave one of them rendering an error where this file expects a heading.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (path: string) =>
        path.includes(`/promotions/${PROMOTION_ID}`)
          ? {
              data: {
                id: PROMOTION_ID,
                code: 'SUMMER',
                name: 'Summer',
                description: null,
                priority: 0,
                active: true,
                stopFurtherRules: false,
                startsAt: null,
                endsAt: null,
                conditions: null,
                actions: [],
                usageLimitTotal: null,
                usageLimitPerCustomer: null,
                coupons: [],
                createdAt: '2026-01-01T10:00:00.000Z',
                updatedAt: '2026-01-01T10:00:00.000Z',
              },
            }
          : { data: [] },
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
    'appShell.section.pricing',
    'app.moduleScreenLoading',
    'app.notFound',
    // The screens resolve their own copy in `core` over `_i18n`'s shared
    // bundle, which this conversion does not change — batch four's shape, the
    // same one `admin_users`' and `audit_logs`' screens are in. Only the two
    // sidebar labels moved into the package.
    'promotions.page.title',
    'promotions.page.description',
    'promotions.edit.titleNew',
    'promotionStats.title',
    'promotionRules.page.title',
  ]),
  ...passthroughBundle('promotions', ['nav.promotions.label', 'nav.promotionRules.label']),
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

/** Every route the module declares, with the heading each one renders. */
const ROUTES: readonly { path: string; heading: string }[] = [
  { path: '/promotions', heading: 'promotions.page.title' },
  { path: '/promotions/new', heading: 'promotions.edit.titleNew' },
  { path: `/promotions/${PROMOTION_ID}/stats`, heading: 'promotionStats.title' },
  { path: '/promotion-rules', heading: 'promotionRules.page.title' },
];

describe('promotions owns its admin surface', () => {
  it('contributes both sidebar entries from the registry, labelled in its own namespace', () => {
    // The positive control, and it comes first for the reason every off-state
    // assertion in this repository puts one first: an absence proves nothing
    // until the presence has been seen.
    presentModules = new Set(['promotions']);
    permissions = new Set(['promotions:read']);
    renderAt('/');
    expect(sidebarHrefs()).toContain('/promotions');
    expect(sidebarHrefs()).toContain('/promotion-rules');
    // The labels resolve in the **module's** namespace, not in `core`: both
    // `appShell.nav.*` entries are gone from the shared `_i18n` bundle.
    expect(screen.getByRole('link', { name: /nav\.promotions\.label/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /nav\.promotionRules\.label/ })).toBeTruthy();
  });

  it('renders every one of its screens at its own route while present', async () => {
    presentModules = new Set(['promotions']);
    permissions = new Set(['promotions:read']);
    for (const route of ROUTES) {
      const rendered = renderAt(route.path);
      await waitFor(() => expect(screenIsRendered(route.heading)).toBe(true));
      rendered.unmount();
    }
  });

  it('contributes no surface while the module is switched off — every sub-route included', async () => {
    // Principle XVII item 5, over every surface the module contributes. The
    // three sub-routes are asserted on their own because they have no sidebar
    // row to be withdrawn with.
    presentModules = new Set();
    permissions = new Set(['promotions:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/promotions');
    expect(sidebarHrefs()).not.toContain('/promotion-rules');
    shell.unmount();

    for (const route of ROUTES) {
      const rendered = renderAt(route.path);
      await waitFor(() => expect(notFoundIsRendered()).toBe(true));
      expect(screenIsRendered(route.heading)).toBe(false);
      rendered.unmount();
    }
  });

  it('contributes no surface to an operator without the code its routes enforce', async () => {
    // The second axis, moved on its own: a test that only switched presence
    // would pass with the permission gate missing entirely. `price_lists:read`
    // is a real code and a near miss — the row it opens is the first in the
    // same *Pricing* section — and the codes are opaque strings.
    presentModules = new Set(['promotions']);
    permissions = new Set(['price_lists:read']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/promotions');
    expect(sidebarHrefs()).not.toContain('/promotion-rules');
    shell.unmount();

    for (const route of ROUTES) {
      const rendered = renderAt(route.path);
      await waitFor(() => expect(notFoundIsRendered()).toBe(true));
      rendered.unmount();
    }
  });

  it('does not open its screens to the write code alone', async () => {
    // `promotions:write` and `promotions:delete` are real codes this module
    // declares, and neither is what its read routes enforce. Without this case
    // a declaration that named the write code would pass every assertion above.
    presentModules = new Set(['promotions']);
    permissions = new Set(['promotions:write', 'promotions:delete']);
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/promotions');
    shell.unmount();

    const rendered = renderAt('/promotions');
    await waitFor(() => expect(notFoundIsRendered()).toBe(true));
    rendered.unmount();
  });

  it('restores every surface when the module comes back, with no rebuild', async () => {
    presentModules = new Set();
    permissions = new Set(['promotions:read']);
    const off = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/promotions');
    off.unmount();

    presentModules = new Set(['promotions']);
    const back = renderAt('/');
    expect(sidebarHrefs()).toContain('/promotions');
    expect(sidebarHrefs()).toContain('/promotion-rules');
    back.unmount();

    const editor = renderAt('/promotions/new');
    await waitFor(() => expect(screenIsRendered('promotions.edit.titleNew')).toBe(true));
    editor.unmount();
  });

  it('keeps the two entries in their hand-written order relative to each other', () => {
    // The operator-visible consequence this conversion carries, asserted rather
    // than left to a reader of the plan. Every other row in *Pricing* is still
    // host-declared, so `composeNav` appends both of these after all of them —
    // where the hand-written table had them second and third of six, above
    // `/taxes` and `/delivery-methods`. The declared weights (200, 300) are what
    // restore that once the section's other rows convert; what can be restored
    // today is their order relative to each other.
    presentModules = new Set(['promotions']);
    permissions = new Set(['promotions:read']);
    renderAt('/');
    const hrefs = sidebarHrefs().filter((href) => href !== null);
    expect(hrefs.indexOf('/promotions')).toBeLessThan(hrefs.indexOf('/promotion-rules'));
  });
});

describe('the shell no longer names promotions by hand', () => {
  it('has no host route, nav entry, breadcrumb rule or palette row for the module', () => {
    // The evidence that the conversion converted something. `App.tsx` and
    // `AppShell.tsx` are the two registries 11 of the last 12 module additions
    // edited; neither declares any of the five screens now, and both are still
    // there. Leaving one standing would declare it twice, with `react-router`
    // silently taking the first match.
    const app = sourceOf('src/App.tsx');
    const shell = sourceOf('src/components/AppShell.tsx');
    for (const component of [
      '<PromotionsPage',
      '<PromotionEditPage',
      '<PromotionRulesPage',
      '<PromotionStatsPage',
    ]) {
      expect(app).not.toContain(component);
    }
    expect(app).not.toContain('modules/promotions');
    expect(shell).not.toContain("to: '/promotions'");
    expect(shell).not.toContain("to: '/promotion-rules'");
    expect(shell).not.toContain('appShell.nav.promotions');
    expect(shell).not.toContain('appShell.nav.promotionRules');
    // `CRUMB_DICT`'s four rules for this module go, so `registryCrumbs` derives
    // the trail from the nav contribution instead.
    expect(shell).not.toContain('\\/promotions\\/?$');
  });

  it('resolves every screen through the module package, never through admin/src', () => {
    // R3 / D-149: a relative reach into the package's `src/` would evaluate its
    // source beside its `dist` — two copies of every module-scope value, which
    // is silent in a frontend.
    const registry = sourceOf('src/modules.generated.ts');
    expect(registry).toContain("from '@endora-commerce/mod-promotions/admin'");
    expect(registry).not.toContain('packages/modules');
  });

  it('derives the editor’s breadcrumb from the nav contribution', () => {
    // The second operator-visible consequence, and it is the one batch 6
    // recorded for `/comparisons/:id`: the hand-written `CRUMB_DICT` rule built
    // three crumbs for `/promotions/new` — section, parent, and a literal
    // *new* leaf. `registryCrumbs` matches anything beneath a contributed
    // entry's `to` and builds two: the section, and the entry itself as a link
    // back to the list. The trail still leads home; it is one crumb shorter.
    presentModules = new Set(['promotions']);
    permissions = new Set(['promotions:read']);
    renderAt('/promotions/new');
    const crumbs = [...document.querySelectorAll('.b2b-topbar__crumbs a.crumb-link')].map((a) =>
      a.getAttribute('href'),
    );
    expect(crumbs).toContain('/promotions');
    expect(
      document.querySelectorAll('.b2b-topbar__crumbs .crumb-link, .b2b-topbar__crumbs .crumb-cur'),
    ).toHaveLength(2);
  });

  it('gates every route and both nav entries on the code its own API enforces', async () => {
    // `check:action-route-permissions` holds this module's palette actions to
    // the code enforced on their own `targetRoute`; the route and nav
    // declarations are the same statement one layer down, and nothing else
    // compares them. `GET /api/v1/admin/promotions` and
    // `GET /api/v1/admin/promotion-rules` are both behind
    // `requireAdmin(PROMOTION_PERMISSIONS.READ)`; the write and delete codes
    // gate controls inside the screens.
    const { contributions } = await import('@endora-commerce/mod-promotions/admin');
    expect(contributions.routes?.map((route) => route.path)).toEqual([
      '/promotions',
      '/promotions/new',
      '/promotions/:id',
      '/promotions/:id/stats',
      '/promotion-rules',
    ]);
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe('promotions:read');
      // FR-013: the only function-valued field is a dynamic-import factory, so
      // Vite has a split point whether or not anybody asks for one.
      expect(typeof route.component).toBe('function');
    }
    expect(contributions.nav?.map((item) => item.to)).toEqual(['/promotions', '/promotion-rules']);
    for (const item of contributions.nav ?? []) {
      expect(item.requiredPermission).toBe('promotions:read');
      expect(item.section).toBe('pricing');
    }
  });

  it('takes no `@/` reach out of the package', () => {
    // The alias resolves to `admin/src` and to nothing a package can reach, so
    // a surviving one would be a screen that compiles here and not in a
    // consumer's install.
    for (const file of [
      '../packages/modules/promotions/src/admin/pages/PromotionsPage.tsx',
      '../packages/modules/promotions/src/admin/pages/PromotionEditPage.tsx',
      '../packages/modules/promotions/src/admin/pages/PromotionRulesPage.tsx',
      '../packages/modules/promotions/src/admin/pages/PromotionStatsPage.tsx',
      '../packages/modules/promotions/src/admin/components/CouponGeneratorForm.tsx',
      '../packages/modules/promotions/src/admin/api/promotions-client.ts',
    ]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/^import .* from '@\//m);
      expect(source).not.toMatch(/^import .* from '@endora-commerce\/mod-/m);
    }
  });
});
